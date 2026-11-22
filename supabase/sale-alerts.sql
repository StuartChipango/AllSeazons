-- =====================================================================
-- Sale alerts: a "cha-ching" notification on staff phones every time a
-- customer places an order on the website.
--
-- Run this once in Supabase > SQL Editor (it is safe to run again).
-- Then deploy the sale-alert edge function (see SETUP.md, "Sale alerts").
--
-- How it works:
--   1. A staff phone taps "Turn on sale alerts" in the staff app (Me page).
--      The phone's push address is saved in push_subscriptions.
--   2. A customer checks out on the website -> place_order() adds a row
--      to orders -> the trigger below asks the sale-alert edge function
--      to send the alert (through pg_net, after the order is saved).
--   3. The edge function sends a push message to every saved phone.
-- Orders that staff type in themselves (WhatsApp orders, shop sales) do
-- not ring: you already know about those.
-- =====================================================================

do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise warning 'Could not turn on pg_net (Database > Extensions > pg_net): %', sqlerrm;
end $$;

-- Each phone (or browser) that wants sale alerts.
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  staff_email text,
  device text,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subs_staff_read on public.push_subscriptions;
create policy push_subs_staff_read on public.push_subscriptions
  for select to authenticated using (public.is_staff());
grant select on public.push_subscriptions to authenticated;

-- The shop's own push keys. Made by the edge function the first time it
-- runs. Nobody but the edge function (service role) can read this table.
create table if not exists public.push_keys (
  id int primary key default 1 check (id = 1),
  public_key text not null,
  private_jwk jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.push_keys enable row level security;
revoke all on public.push_keys from anon, authenticated;

-- So each order only rings once.
alter table public.orders add column if not exists alerted_at timestamptz;

-- Staff phone: start or stop getting alerts.
create or replace function public.push_subscribe(p_sub jsonb, p_device text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_endpoint text := p_sub->>'endpoint';
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  if v_endpoint is null or v_endpoint !~ '^https://' or p_sub#>>'{keys,p256dh}' is null or p_sub#>>'{keys,auth}' is null then
    raise exception 'This phone gave an incomplete push address. Try again.';
  end if;
  insert into public.push_subscriptions (endpoint, p256dh, auth, staff_email, device)
  values (v_endpoint, p_sub#>>'{keys,p256dh}', p_sub#>>'{keys,auth}', public._my_email(), left(p_device, 120))
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth,
        staff_email = excluded.staff_email, device = excluded.device;
end;
$$;

create or replace function public.push_unsubscribe(p_endpoint text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
end;
$$;

revoke all on function public.push_subscribe(jsonb, text) from public, anon;
revoke all on function public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_subscribe(jsonb, text) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;

-- Where the edge function lives. Change this only if the Supabase project changes.
create or replace function public._sale_alert_url() returns text
language sql immutable as $$
  select 'https://bibeeobkgrrrvvrwebpp.supabase.co/functions/v1/sale-alert'
$$;

-- After a customer's website order is saved, ask the edge function to ring.
-- pg_net sends the request only once the order is committed, so a checkout
-- that fails never rings. Anything going wrong here never stops an order.
create or replace function public._alert_new_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.channel <> 'online' or public.is_staff() then
    return new;
  end if;
  begin
    perform net.http_post(
      url := public._sale_alert_url(),
      body := jsonb_build_object('order_id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'sale alert not sent: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists orders_sale_alert on public.orders;
create trigger orders_sale_alert after insert on public.orders
  for each row execute function public._alert_new_order();

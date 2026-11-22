-- Shop sale: Sold out / Relist with a New stock tag. Paste into Supabase SQL Editor and press Run. Safe to run more than once.
alter table public.toys add column if not exists restocked_at timestamptz;
create or replace function public._require_sales_or_stock() returns void
language plpgsql stable security definer set search_path = public as $$
begin
perform public._require_staff();
if not (public.has_role('sales') or public.has_role('stock')) then
raise exception 'Only Sales or Stock staff can do this.' using errcode = '42501';
end if;
end;
$$;
create or replace function public.toy_sold_out(p_toy uuid) returns public.toys
language plpgsql security definer set search_path = public as $$
declare t public.toys;
begin
perform public._require_sales_or_stock();
select * into t from public.toys where id = p_toy for update;
if not found then raise exception 'That toy is not in stock any more.' using errcode = 'P0001'; end if;
if t.status = 'reserved' then
raise exception '% is on hold for an order. Cancel or finish the order first.', t.name using errcode = 'P0001';
end if;
if t.status <> 'available' then
raise exception '% is not in the shop.', t.name using errcode = 'P0001';
end if;
update public.toys set status = 'sold', quantity = 0, sold_at = now()
where id = t.id returning * into t;
return t;
end;
$$;
create or replace function public.toy_relist(p_toy uuid, p_qty int default 1, p_price int default null)
returns public.toys
language plpgsql security definer set search_path = public as $$
declare t public.toys;
begin
perform public._require_sales_or_stock();
if coalesce(p_qty, 0) < 1 then raise exception 'How many came in? At least 1.' using errcode = 'P0001'; end if;
if p_price is not null and p_price < 0 then raise exception 'The price cannot be below zero.' using errcode = 'P0001'; end if;
select * into t from public.toys where id = p_toy for update;
if not found then raise exception 'That toy was deleted.' using errcode = 'P0001'; end if;
if t.status not in ('sold', 'hidden') then
raise exception '% is already in the shop.', t.name using errcode = 'P0001';
end if;
if t.image_path is null then raise exception '% has no picture yet.', t.name using errcode = 'P0001'; end if;
if p_price is not null and p_price <> t.price and not public.has_role('stock') then
raise exception 'Only Stock staff can change the price.' using errcode = '42501';
end if;
update public.toys
set status = 'available', quantity = p_qty, price = coalesce(p_price, price),
sold_at = null, restocked_at = now(), approved_at = now()
where id = t.id returning * into t;
return t;
end;
$$;
revoke execute on function public._require_sales_or_stock() from public, anon;
revoke execute on function public.toy_sold_out(uuid) from public, anon;
revoke execute on function public.toy_relist(uuid, int, int) from public, anon;
grant execute on function public.toy_sold_out(uuid) to authenticated;
grant execute on function public.toy_relist(uuid, int, int) to authenticated;
notify pgrst, 'reload schema';

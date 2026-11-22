-- =====================================================================
-- All Seazons Play: delivery fees are not sales.
-- Paste all of this into Supabase SQL Editor and press Run. Safe to run
-- again.
--
-- 1. Out-of-town checkout shows a suggested courier fee only. Staff set
--    the real fee (by parcel size) when they confirm the order.
-- 2. Sales everywhere are the toys only. Courier, Yango and K40
--    packaging money is passed on, so it is left out of sales, money in
--    and turnover tax, for past orders too.
-- =====================================================================

alter table public.orders add column if not exists delivery_estimate int;

create or replace function public.place_order(p_items jsonb, p_customer jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.settings;
  v_town public.towns;
  v_order public.orders;
  v_name text := btrim(coalesce(p_customer->>'name', ''));
  v_phone text := regexp_replace(coalesce(p_customer->>'phone', ''), '[^0-9+]', '', 'g');
  v_location text := p_customer->>'location';
  v_method text := p_customer->>'delivery_method';
  v_address text := nullif(btrim(coalesce(p_customer->>'address', '')), '');
  v_note text := nullif(btrim(coalesce(p_customer->>'note', '')), '');
  v_count int;
  v_subtotal int;
  v_estimate int;
begin
  perform public.release_expired_holds();
  select * into s from public.settings where id = 1;

  if length(v_name) < 2 then
    raise exception 'Please enter your name.' using errcode = 'P0001', hint = 'name';
  end if;
  if length(regexp_replace(v_phone, '\D', '', 'g')) < 9 then
    raise exception 'Please enter a valid phone number.' using errcode = 'P0001', hint = 'phone';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.' using errcode = 'P0001', hint = 'cart';
  end if;
  if jsonb_array_length(p_items) > 40 then
    raise exception 'That is a lot of toys! Please message us on WhatsApp for orders over 40 items.'
      using errcode = 'P0001', hint = 'cart';
  end if;
  if (select count(*) from public.orders where phone = v_phone and status = 'held') >= 3 then
    raise exception 'You already have 3 orders waiting. Please finish those with us on WhatsApp first.'
      using errcode = 'P0001', hint = 'limit';
  end if;

  if v_location = 'lusaka' then
    if v_method is null or v_method not in ('pickup', 'yango') then
      raise exception 'Please choose pickup or Yango delivery.' using errcode = 'P0001', hint = 'delivery_method';
    end if;
    if v_method = 'yango' and v_address is null then
      raise exception 'Please enter your delivery address.' using errcode = 'P0001', hint = 'address';
    end if;
  elsif v_location = 'out_of_town' then
    select * into v_town from public.towns
    where id = nullif(p_customer->>'town_id', '')::int and active;
    if not found then
      raise exception 'Please choose your town.' using errcode = 'P0001', hint = 'town';
    end if;
    v_method := 'courier';
  else
    raise exception 'Please choose Lusaka or out of town.' using errcode = 'P0001', hint = 'location';
  end if;

  insert into public.orders (customer_name, phone, location, town, courier, delivery_method,
                             address, note, hold_until)
  values (v_name, v_phone, v_location,
          case when v_location = 'lusaka' then 'Lusaka' else v_town.name end,
          v_town.courier, v_method, v_address, v_note,
          now() + make_interval(mins => s.hold_minutes))
  returning * into v_order;

  insert into public.order_items (order_id, toy_id, toy_code, name, condition, price, qty, image_path)
  select v_order.id, t.id, t.code, t.name, t.condition, coalesce(t.sale_price, t.price), x.qty, coalesce(t.photo_path, t.image_path)
  from (
    select (e->>'toy_id')::uuid as toy_id, sum(greatest(coalesce((e->>'qty')::int, 1), 1))::int as qty
    from jsonb_array_elements(p_items) e
    group by 1
  ) x
  join public.toys t on t.id = x.toy_id;

  if (select count(*) from public.order_items where order_id = v_order.id)
     < (select count(distinct e->>'toy_id') from jsonb_array_elements(p_items) e) then
    raise exception 'Sorry, a toy in your cart is no longer in the shop. Please refresh the page.'
      using errcode = 'P0001', hint = 'unavailable';
  end if;

  perform public._reserve_order(v_order.id);

  select coalesce(sum(qty), 0), coalesce(sum(price * qty), 0) into v_count, v_subtotal
  from public.order_items where order_id = v_order.id;
  -- Courier fees depend on the parcel size, which nobody knows until the
  -- toys are packed. The customer sees a suggestion (the town's lowest
  -- fee plus packaging); staff set the real fee when they confirm.
  if v_method = 'courier' then
    select min(f) into v_estimate
    from (values (v_town.fee_small), (v_town.fee_medium), (v_town.fee_large)) x(f);
    v_estimate := v_estimate + s.packaging_fee;
  end if;

  update public.orders
  set item_count = v_count, subtotal = v_subtotal, parcel_size = null,
      delivery_fee = case when v_method = 'courier' then null else 0 end,
      delivery_estimate = v_estimate, total = v_subtotal
  where id = v_order.id
  returning * into v_order;

  return jsonb_build_object(
    'code', v_order.code,
    'link_key', v_order.link_key,
    'customer_name', v_order.customer_name,
    'phone', v_order.phone,
    'location', v_order.location,
    'town', v_order.town,
    'courier', v_order.courier,
    'delivery_method', v_order.delivery_method,
    'address', v_order.address,
    'note', v_order.note,
    'parcel_size', v_order.parcel_size,
    'item_count', v_order.item_count,
    'subtotal', v_order.subtotal,
    'delivery_fee', v_order.delivery_fee,
    'delivery_estimate', v_order.delivery_estimate,
    'total', v_order.total,
    'hold_until', v_order.hold_until,
    'items', (
      select jsonb_agg(jsonb_build_object('code', toy_code, 'name', name, 'condition', condition,
                                          'price', price, 'qty', qty) order by id)
      from public.order_items where order_id = v_order.id
    )
  );
end;
$$;

create or replace function public.get_order_public(p_code text, p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', o.code,
    'status', o.status,
    'created_at', o.created_at,
    'delivery_method', o.delivery_method,
    'item_count', o.item_count,
    'subtotal', o.subtotal,
    'delivery_fee', o.delivery_fee,
    'delivery_estimate', o.delivery_estimate,
    'total', o.total,
    'items', (
      select jsonb_agg(jsonb_build_object('code', toy_code, 'name', name, 'condition', condition,
                                          'price', price, 'qty', qty, 'image_path', image_path)
                       order by id)
      from public.order_items where order_id = o.id
    )
  )
  from public.orders o
  where o.code = upper(btrim(p_code)) and o.link_key = lower(btrim(p_key));
$$;

create or replace function public.set_delivery_fee(p_order uuid, p_fee int, p_size text default null)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  perform public._require_role('sales');
  if p_fee is null or p_fee < 0 or p_fee > 100000 then
    raise exception 'Type the delivery fee in kwacha.' using errcode = 'P0001';
  end if;
  if p_size is not null and p_size not in ('small', 'medium', 'large') then
    raise exception 'Pick small, medium or large.' using errcode = 'P0001';
  end if;
  select * into o from public.orders where id = p_order for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0001';
  end if;
  if o.status in ('cancelled', 'expired') then
    raise exception 'This order is closed. Reopen it first.' using errcode = 'P0001';
  end if;
  update public.orders
  set delivery_fee = p_fee, parcel_size = coalesce(p_size, parcel_size), total = subtotal + p_fee
  where id = o.id returning * into o;
  perform public._log('delivery_fee', o.code || ' delivery fee K' || p_fee
    || coalesce(' (' || p_size || ' parcel)', ''), null, o.id);
  return o;
end;
$$;

revoke execute on function public.set_delivery_fee(uuid, int, text) from public, anon;
grant execute on function public.set_delivery_fee(uuid, int, text) to authenticated;

create or replace function public.track(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := p->>'kind';
  v_session text := public._tag(p->>'session');
  v_visitor text := public._tag(p->>'visitor');
  v_order public.orders;
  v_amount int;
begin
  if v_kind is null or v_kind not in ('visit', 'toy', 'whatsapp', 'order') or v_session is null or v_visitor is null then
    return;
  end if;
  -- A busy shopper makes a few dozen rows; this stops anyone filling the table.
  if (select count(*) from public.visits where session = v_session and at > now() - interval '1 day') >= 300 then
    return;
  end if;
  if v_kind = 'order' then
    -- The amount comes from the order itself, never from the website.
    select * into v_order from public.orders
      where code = upper(btrim(coalesce(p->>'order_code', ''))) and created_at > now() - interval '2 hours';
    if not found or exists (select 1 from public.visits where kind = 'order' and order_code = v_order.code) then
      return;
    end if;
    -- Toys only: delivery money goes to the courier, so it is not a sale.
    v_amount := v_order.subtotal;
  end if;
  insert into public.visits (kind, visitor, session, source, via, campaign, referrer, device, toy_code, order_code, amount)
  values (v_kind, v_visitor, v_session,
    coalesce(public._tag(p->>'source', 20), 'direct'), public._tag(p->>'via'), public._tag(p->>'campaign', 60),
    public._tag(p->>'referrer', 80), public._tag(p->>'device', 10),
    case when v_kind = 'toy' then upper(left(btrim(coalesce(p->>'toy_code', '')), 20)) end,
    v_order.code, v_amount);
  if random() < 0.01 then
    delete from public.visits where at < now() - interval '400 days';
  end if;
end;
$$;

-- Website sales on the visitors page: toys only, for past orders too.
update public.visits v set amount = o.subtotal
from public.orders o
where v.kind = 'order' and v.order_code = o.code and v.amount is distinct from o.subtotal;


-- The Books: delivery fees are shown but not counted as money in or taxed.
-- (Only if the Books are set up already; books.sql has the same change.)
do $do$
begin
  if to_regclass('public.book_entries') is not null then
    execute $sql$create or replace function public.books_report(p_year int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_rate numeric := coalesce((select turnover_tax_rate from public.settings where id = 1), 5);
  v_from date := make_date(p_year, 1, 1);
  v_out jsonb;
begin
  perform public._require_role('owner');
  with months as (
    select generate_series(v_from, make_date(p_year, 12, 1), interval '1 month')::date as m
  ),
  sales as (
    select date_trunc('month', o.paid_at at time zone 'Africa/Lusaka')::date as m,
           count(*) as orders,
           sum(o.subtotal) filter (where o.channel = 'online') as online,
           sum(o.subtotal) filter (where o.channel = 'shop') as shop,
           sum(coalesce(o.delivery_fee, 0)) as delivery,
           sum(o.item_count) as toys_sold
    from public.orders o
    where o.status in ('paid', 'packed', 'sent', 'delivered')
      and o.paid_at >= (v_from::timestamp at time zone 'Africa/Lusaka')
      and o.paid_at < (make_date(p_year + 1, 1, 1)::timestamp at time zone 'Africa/Lusaka')
    group by 1
  ),
  entries as (
    select date_trunc('month', spent_on)::date as m, kind, category, amount, items, status, receipt_path
    from public.book_entries
    where spent_on >= v_from and spent_on < make_date(p_year + 1, 1, 1)
  ),
  boxes_unbooked as (
    select date_trunc('month', coalesce(b.purchased_on, (b.created_at at time zone 'Africa/Lusaka')::date))::date as m,
           sum(b.cost + b.delivery + b.other) as amount, sum(coalesce(b.expected_count, 0)) as items, count(*) as n
    from public.boxes b
    where not exists (select 1 from public.book_entries e where e.box_id = b.id)
      and coalesce(b.purchased_on, (b.created_at at time zone 'Africa/Lusaka')::date) >= v_from
      and coalesce(b.purchased_on, (b.created_at at time zone 'Africa/Lusaka')::date) < make_date(p_year + 1, 1, 1)
    group by 1
  ),
  per_month as (
    select mo.m,
      coalesce(s.orders, 0) as orders,
      coalesce(s.toys_sold, 0) as toys_sold,
      coalesce(s.online, 0) as online_sales,
      coalesce(s.shop, 0) as shop_sales,
      coalesce(s.delivery, 0) as delivery,
      coalesce((select sum(amount) from entries e where e.m = mo.m and e.kind = 'income'), 0) as income,
      coalesce((select sum(amount) from entries e where e.m = mo.m and e.kind = 'expense' and e.category = 'stock'), 0)
        + coalesce(bu.amount, 0) as stock,
      coalesce((select sum(items) from entries e where e.m = mo.m and e.kind = 'expense' and e.category = 'stock'), 0)
        + coalesce(bu.items, 0) as stock_items,
      coalesce(bu.n, 0) as boxes,
      coalesce((select sum(amount) from entries e where e.m = mo.m and e.kind = 'expense' and e.category = 'setup'), 0) as setup,
      coalesce((select sum(amount) from entries e where e.m = mo.m and e.kind = 'expense' and e.category not in ('stock', 'setup')), 0) as expenses,
      coalesce((select jsonb_object_agg(category, total) from (
        select category, sum(amount) as total from entries e
        where e.m = mo.m and e.kind = 'expense' group by category) c), '{}'::jsonb) as by_category,
      (select count(*) from entries e where e.m = mo.m and e.status = 'check') as to_check,
      (select count(*) from entries e where e.m = mo.m and e.kind = 'expense' and e.receipt_path is null) as no_receipt,
      (select count(*) from entries e where e.m = mo.m) as entries,
      bm.closed, bm.tax_paid, bm.tax_paid_on, bm.tax_ref, bm.notes
    from months mo
    left join sales s on s.m = mo.m
    left join boxes_unbooked bu on bu.m = mo.m
    left join public.book_months bm on bm.month = mo.m
  )
  select jsonb_build_object(
    'year', p_year,
    'rate', v_rate,
    'months', coalesce(jsonb_agg(jsonb_build_object(
      'month', to_char(m, 'YYYY-MM-DD'),
      'orders', orders, 'toys_sold', toys_sold,
      'online_sales', online_sales, 'shop_sales', shop_sales,
      'sales', online_sales + shop_sales,
      'delivery', delivery, 'income', income,
      'turnover', online_sales + shop_sales + income,
      'tax_due', round((online_sales + shop_sales + income) * v_rate / 100, 2),
      'stock', stock, 'stock_items', stock_items, 'boxes', boxes,
      'setup', setup, 'expenses', expenses, 'by_category', by_category,
      'to_check', to_check, 'no_receipt', no_receipt, 'entries', entries,
      'closed', coalesce(closed, false), 'tax_paid', tax_paid, 'tax_paid_on', tax_paid_on,
      'tax_ref', tax_ref, 'notes', notes
    ) order by m), '[]'::jsonb)
  ) into v_out
  from per_month;
  return v_out;
end;
$$;
$sql$;
  end if;
end
$do$;

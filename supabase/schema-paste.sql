-- All Seazons Play database. Paste all of this into Supabase SQL Editor and press Run.
create extension if not exists pgcrypto;
create table if not exists public.staff (
email text primary key,
name text,
created_at timestamptz not null default now()
);
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
select exists (
select 1 from public.staff
where lower(email) = lower(coalesce(auth.jwt()->>'email', ''))
);
$$;
create table if not exists public.settings (
id int primary key default 1 check (id = 1),
shop_name text not null default 'All Seazons Play',
whatsapp_number text not null default '260970000000',
hold_minutes int not null default 120 check (hold_minutes between 10 and 10080),
medium_from int not null default 2 check (medium_from >= 2),
large_from int not null default 5 check (large_from >= 3),
pickup_note text not null default 'We will send you the pickup location on WhatsApp.',
yango_note text not null default 'The Yango delivery fee is paid to the driver.',
courier_note text not null default 'You collect the parcel from the courier office in your town.',
announcement text,
weekly_goal int not null default 2000,
updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;
create table if not exists public.price_tiers (
price int primary key check (price > 0)
);
insert into public.price_tiers (price)
values (50), (75), (100), (150), (200), (250), (300)
on conflict do nothing;
create table if not exists public.categories (
name text primary key,
sort int not null default 0
);
insert into public.categories (name, sort) values
('Dolls & Accessories', 1), ('Cars & Vehicles', 2), ('Building & Blocks', 3),
('Soft Toys', 4), ('Baby & Toddler', 5), ('Puzzles & Games', 6),
('Action Figures', 7), ('Pretend Play', 8), ('Learning Toys', 9),
('Outdoor & Sports', 10), ('Books', 11), ('Other', 99)
on conflict do nothing;
create table if not exists public.towns (
id serial primary key,
name text not null unique,
courier text,
fee_small int check (fee_small >= 0),
fee_medium int check (fee_medium >= 0),
fee_large int check (fee_large >= 0),
active boolean not null default true
);
insert into public.towns (name) values
('Kitwe'), ('Ndola'), ('Kabwe'), ('Livingstone'), ('Chipata'), ('Solwezi'),
('Chingola'), ('Mufulira'), ('Kasama'), ('Mansa'), ('Choma'), ('Mongu')
on conflict do nothing;
create table if not exists public.boxes (
id text primary key,
purchased_on date,
supplier text,
cost numeric(12,2) not null default 0,
delivery numeric(12,2) not null default 0,
other numeric(12,2) not null default 0,
expected_count int,
notes text,
created_at timestamptz not null default now()
);
create sequence if not exists public.toy_code_seq start 1;
create table if not exists public.toys (
id uuid primary key default gen_random_uuid(),
code text not null unique default ('AS-' || lpad(nextval('public.toy_code_seq')::text, 4, '0')),
name text not null default 'New toy',
audience text not null default 'neutral' check (audience in ('boys', 'girls', 'neutral')),
condition text not null default 'used' check (condition in ('used', 'new')),
category text,
age_range text,
brand text,
description text,
price int not null default 50 check (price >= 0),
sale_price int check (sale_price >= 0),
is_special boolean not null default false,
quantity int not null default 1 check (quantity >= 0),
status text not null default 'review'
check (status in ('review', 'available', 'reserved', 'sold', 'damaged', 'hidden')),
box_id text references public.boxes(id) on update cascade on delete set null,
raw_path text,
image_path text,
ai_labels jsonb,
needs_attention boolean not null default false,
legacy_id text,
sold_count int not null default 0,
created_at timestamptz not null default now(),
approved_at timestamptz,
sold_at timestamptz,
updated_at timestamptz not null default now()
);
create index if not exists toys_status_idx on public.toys (status);
create index if not exists toys_box_idx on public.toys (box_id);
alter table public.toys add column if not exists legacy_id text;
create sequence if not exists public.order_code_seq start 1001;
create table if not exists public.orders (
id uuid primary key default gen_random_uuid(),
code text not null unique default ('ORD-' || nextval('public.order_code_seq')::text),
link_key text not null default encode(gen_random_bytes(5), 'hex'),
channel text not null default 'online' check (channel in ('online', 'shop')),
status text not null default 'held'
check (status in ('held', 'confirmed', 'paid', 'packed', 'sent', 'delivered', 'cancelled', 'expired')),
customer_name text not null,
phone text,
location text check (location in ('lusaka', 'out_of_town', 'shop')),
town text,
courier text,
delivery_method text check (delivery_method in ('pickup', 'yango', 'courier', 'walk_in')),
address text,
note text,
parcel_size text check (parcel_size in ('small', 'medium', 'large')),
item_count int not null default 0,
subtotal int not null default 0,
delivery_fee int,
total int not null default 0,
staff_note text,
hold_until timestamptz,
created_at timestamptz not null default now(),
paid_at timestamptz,
packed_at timestamptz,
sent_at timestamptz,
delivered_at timestamptz,
updated_at timestamptz not null default now()
);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_phone_idx on public.orders (phone);
create table if not exists public.order_items (
id bigserial primary key,
order_id uuid not null references public.orders(id) on delete cascade,
toy_id uuid references public.toys(id) on delete set null,
toy_code text,
name text not null,
condition text,
price int not null,
qty int not null default 1 check (qty > 0),
image_path text
);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_toy_idx on public.order_items (toy_id);
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
new.updated_at := now();
return new;
end;
$$;
drop trigger if exists toys_touch on public.toys;
create trigger toys_touch before update on public.toys
for each row execute function public.touch_updated_at();
drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders
for each row execute function public.touch_updated_at();
create or replace function public.parcel_size(p_count int) returns text
language sql stable set search_path = public as $$
select case
when p_count >= s.large_from then 'large'
when p_count >= s.medium_from then 'medium'
else 'small'
end
from public.settings s where s.id = 1;
$$;
create or replace function public._reserve_order(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
r record;
v_missing text[] := '{}';
v_missing_ids text[] := '{}';
begin
for r in
select oi.toy_id, sum(oi.qty)::int as qty, max(oi.name) as name
from public.order_items oi
where oi.order_id = p_order
group by oi.toy_id
order by oi.toy_id
loop
perform 1 from public.toys t
where t.id = r.toy_id and t.status = 'available' and t.quantity >= r.qty
for update;
if not found then
v_missing := v_missing || r.name;
v_missing_ids := v_missing_ids || coalesce(r.toy_id::text, '');
end if;
end loop;
if array_length(v_missing, 1) > 0 then
raise exception 'Sorry, % just sold or went on hold: %',
case when array_length(v_missing, 1) = 1 then 'this toy' else 'these toys' end,
array_to_string(v_missing, ', ')
using errcode = 'P0001', hint = 'unavailable', detail = array_to_string(v_missing_ids, ',');
end if;
update public.toys t
set quantity = t.quantity - x.qty,
status = case when t.quantity - x.qty = 0 then 'reserved' else t.status end
from (
select toy_id, sum(qty)::int as qty from public.order_items
where order_id = p_order group by toy_id
) x
where t.id = x.toy_id;
end;
$$;
create or replace function public._restock_order(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
update public.toys t
set quantity = t.quantity + x.qty,
status = case when t.status in ('reserved', 'sold') then 'available' else t.status end,
sold_at = case when t.status = 'sold' then null else t.sold_at end
from (
select toy_id, sum(qty)::int as qty from public.order_items
where order_id = p_order and toy_id is not null group by toy_id
) x
where t.id = x.toy_id;
end;
$$;
create or replace function public._mark_sold(p_order uuid, p_sign int default 1) returns void
language plpgsql security definer set search_path = public as $$
begin
update public.toys t
set sold_count = greatest(t.sold_count + p_sign * x.qty, 0),
status = case
when p_sign > 0 and t.quantity = 0 and t.status in ('reserved', 'available') and not exists (
select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
where oi.toy_id = t.id and o.id <> p_order and o.status in ('held', 'confirmed')
) then 'sold'
else t.status
end,
sold_at = case when p_sign > 0 then now() else t.sold_at end
from (
select toy_id, sum(qty)::int as qty from public.order_items
where order_id = p_order and toy_id is not null group by toy_id
) x
where t.id = x.toy_id;
end;
$$;
create or replace function public.release_expired_holds() returns int
language plpgsql security definer set search_path = public as $$
declare
r record;
n int := 0;
begin
for r in
select id from public.orders
where status = 'held' and hold_until < now()
order by created_at
for update skip locked
loop
perform public._restock_order(r.id);
update public.orders set status = 'expired' where id = r.id;
n := n + 1;
end loop;
return n;
end;
$$;
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
v_size text;
v_fee int;
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
select v_order.id, t.id, t.code, t.name, t.condition, coalesce(t.sale_price, t.price), x.qty, t.image_path
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
v_size := public.parcel_size(v_count);
v_fee := case
when v_method = 'courier' then
case v_size when 'small' then v_town.fee_small when 'medium' then v_town.fee_medium else v_town.fee_large end
else 0
end;
update public.orders
set item_count = v_count, subtotal = v_subtotal, parcel_size = v_size,
delivery_fee = v_fee, total = v_subtotal + coalesce(v_fee, 0)
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
create or replace function public._require_staff() returns void
language plpgsql stable security definer set search_path = public as $$
begin
if not public.is_staff() then
raise exception 'Staff only.' using errcode = '42501';
end if;
end;
$$;
create or replace function public.approve_toys(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
perform public._require_staff();
update public.toys
set status = 'available', approved_at = now(), needs_attention = false
where id = any(p_ids) and status = 'review' and image_path is not null and quantity > 0;
get diagnostics n = row_count;
return n;
end;
$$;
create or replace function public.set_order_status(p_order uuid, p_status text) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
o public.orders;
v_holding boolean;
v_sold boolean;
v_was_sold boolean;
begin
perform public._require_staff();
select * into o from public.orders where id = p_order for update;
if not found then
raise exception 'Order not found.' using errcode = 'P0001';
end if;
if o.status = p_status then
return o;
end if;
v_holding := o.status in ('held', 'confirmed');
v_was_sold := o.status in ('paid', 'packed', 'sent', 'delivered');
if p_status in ('held', 'confirmed', 'paid') and o.status in ('cancelled', 'expired') then
perform public._reserve_order(o.id);
v_holding := true;
end if;
case p_status
when 'held' then
if v_was_sold then raise exception 'A paid order cannot go back to held.' using errcode = 'P0001'; end if;
update public.orders set status = 'held',
hold_until = now() + make_interval(mins => (select hold_minutes from public.settings where id = 1))
where id = o.id returning * into o;
when 'confirmed' then
if v_was_sold then raise exception 'This order is already paid.' using errcode = 'P0001'; end if;
update public.orders set status = 'confirmed', hold_until = null where id = o.id returning * into o;
when 'paid' then
if not v_was_sold then
perform public._mark_sold(o.id, 1);
end if;
update public.orders set status = 'paid', hold_until = null, paid_at = coalesce(paid_at, now())
where id = o.id returning * into o;
when 'packed', 'sent', 'delivered' then
if not v_was_sold then
raise exception 'Mark the order as paid first.' using errcode = 'P0001';
end if;
update public.orders set status = p_status,
packed_at = case when p_status = 'packed' then now() else packed_at end,
sent_at = case when p_status = 'sent' then now() else sent_at end,
delivered_at = case when p_status = 'delivered' then now() else delivered_at end
where id = o.id returning * into o;
when 'cancelled' then
if v_was_sold then
perform public._mark_sold(o.id, -1);
end if;
if v_holding or v_was_sold then
perform public._restock_order(o.id);
end if;
update public.orders set status = 'cancelled', hold_until = null where id = o.id returning * into o;
else
raise exception 'Unknown status %.', p_status using errcode = 'P0001';
end case;
return o;
end;
$$;
create or replace function public.shop_sale(p_items jsonb, p_customer_name text default null,
p_phone text default null) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
o public.orders;
begin
perform public._require_staff();
if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
raise exception 'Pick at least one toy.' using errcode = 'P0001';
end if;
insert into public.orders (channel, status, customer_name, phone, location, delivery_method)
values ('shop', 'held', coalesce(nullif(btrim(p_customer_name), ''), 'Walk-in customer'),
nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), ''), 'shop', 'walk_in')
returning * into o;
insert into public.order_items (order_id, toy_id, toy_code, name, condition, price, qty, image_path)
select o.id, t.id, t.code, t.name, t.condition,
coalesce(nullif(x.price, 0), t.sale_price, t.price), x.qty, t.image_path
from (
select (e->>'toy_id')::uuid as toy_id,
sum(greatest(coalesce((e->>'qty')::int, 1), 1))::int as qty,
max((e->>'price')::int) as price
from jsonb_array_elements(p_items) e group by 1
) x
join public.toys t on t.id = x.toy_id;
perform public._reserve_order(o.id);
perform public._mark_sold(o.id, 1);
update public.orders o2
set status = 'paid', paid_at = now(), delivered_at = now(),
item_count = x.cnt, subtotal = x.sub, total = x.sub, delivery_fee = 0
from (select coalesce(sum(qty), 0)::int cnt, coalesce(sum(price * qty), 0)::int sub
from public.order_items where order_id = o.id) x
where o2.id = o.id
returning o2.* into o;
return o;
end;
$$;
alter table public.staff enable row level security;
alter table public.settings enable row level security;
alter table public.price_tiers enable row level security;
alter table public.categories enable row level security;
alter table public.towns enable row level security;
alter table public.boxes enable row level security;
alter table public.toys enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
drop policy if exists "staff manage staff" on public.staff;
create policy "staff manage staff" on public.staff for all to authenticated
using (public.is_staff()) with check (public.is_staff());
drop policy if exists "anyone reads settings" on public.settings;
create policy "anyone reads settings" on public.settings for select to anon, authenticated using (true);
drop policy if exists "staff edit settings" on public.settings;
create policy "staff edit settings" on public.settings for update to authenticated
using (public.is_staff()) with check (public.is_staff());
drop policy if exists "anyone reads price tiers" on public.price_tiers;
create policy "anyone reads price tiers" on public.price_tiers for select to anon, authenticated using (true);
drop policy if exists "staff edit price tiers" on public.price_tiers;
create policy "staff edit price tiers" on public.price_tiers for all to authenticated
using (public.is_staff()) with check (public.is_staff());
drop policy if exists "anyone reads categories" on public.categories;
create policy "anyone reads categories" on public.categories for select to anon, authenticated using (true);
drop policy if exists "staff edit categories" on public.categories;
create policy "staff edit categories" on public.categories for all to authenticated
using (public.is_staff()) with check (public.is_staff());
drop policy if exists "anyone reads towns" on public.towns;
create policy "anyone reads towns" on public.towns for select to anon, authenticated using (true);
drop policy if exists "staff edit towns" on public.towns;
create policy "staff edit towns" on public.towns for all to authenticated
using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff manage boxes" on public.boxes;
create policy "staff manage boxes" on public.boxes for all to authenticated
using (public.is_staff()) with check (public.is_staff());
drop policy if exists "anyone reads shop toys" on public.toys;
create policy "anyone reads shop toys" on public.toys for select to anon, authenticated
using (status in ('available', 'reserved', 'sold'));
drop policy if exists "staff manage toys" on public.toys;
create policy "staff manage toys" on public.toys for all to authenticated
using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff manage orders" on public.orders;
create policy "staff manage orders" on public.orders for all to authenticated
using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff manage order items" on public.order_items;
create policy "staff manage order items" on public.order_items for all to authenticated
using (public.is_staff()) with check (public.is_staff());
revoke insert, update, delete, truncate on all tables in schema public from anon;
revoke execute on function public._reserve_order(uuid) from public, anon, authenticated;
revoke execute on function public._restock_order(uuid) from public, anon, authenticated;
revoke execute on function public._mark_sold(uuid, int) from public, anon, authenticated;
revoke execute on function public._require_staff() from public, anon;
revoke execute on function public.approve_toys(uuid[]) from public, anon;
revoke execute on function public.set_order_status(uuid, text) from public, anon;
revoke execute on function public.shop_sale(jsonb, text, text) from public, anon;
grant execute on function public.place_order(jsonb, jsonb) to anon, authenticated;
grant execute on function public.get_order_public(text, text) to anon, authenticated;
grant execute on function public.release_expired_holds() to anon, authenticated;
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.parcel_size(int) to anon, authenticated;
insert into storage.buckets (id, name, public) values ('toys', 'toys', true)
on conflict (id) do update set public = true;
insert into storage.buckets (id, name, public) values ('raw', 'raw', false)
on conflict (id) do nothing;
drop policy if exists "staff manage toy photos" on storage.objects;
create policy "staff manage toy photos" on storage.objects for all to authenticated
using (bucket_id in ('toys', 'raw') and public.is_staff())
with check (bucket_id in ('toys', 'raw') and public.is_staff());
do $$
begin
if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
and not exists (select 1 from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'toys') then
alter publication supabase_realtime add table public.toys;
end if;
end $$;

-- =====================================================================
-- All Seazons Play: the Books (bookkeeping).
-- Paste all of this into Supabase SQL Editor and press Run. Safe to run
-- again. It only adds things; nothing in the shop changes.
--
-- What it adds:
--   book_entries  every expense, stock purchase or other income, with its
--                 receipt photo (private "receipts" storage)
--   book_months   one row per month: tax paid, month closed
--   books_report  sales, stock, expenses, profit and turnover tax per month
--
-- Only owners (the directors) can see the books. Anyone on staff can hand
-- in a receipt; it waits under "To check" until an owner checks it.
-- =====================================================================

-- Turnover tax rate (per cent of sales) and the day of the month the
-- "prepare the books" reminder starts showing.
alter table public.settings add column if not exists turnover_tax_rate numeric(5,2) not null default 5;
alter table public.settings add column if not exists books_reminder_day int not null default 25;
alter table public.settings drop constraint if exists settings_books_reminder_day_check;
alter table public.settings add constraint settings_books_reminder_day_check check (books_reminder_day between 1 and 28);

create table if not exists public.book_entries (
  id uuid primary key default gen_random_uuid(),
  -- expense: money out (stock, rent, transport...). income: money in that
  -- is not a sale in this app (sales from before the app, a market day...).
  kind text not null default 'expense' check (kind in ('expense', 'income')),
  category text not null default 'other',
  -- The date on the receipt (backdating is fine).
  spent_on date not null default ((now() at time zone 'Africa/Lusaka')::date),
  supplier text,
  description text,
  amount numeric(12,2) not null check (amount >= 0),
  pay_method text check (pay_method in ('cash', 'mtn', 'airtel', 'bank', 'card', 'other')),
  -- Paid by the business, or by a director from their own pocket
  -- (the business owes it back).
  paid_by text not null default 'business' check (paid_by in ('business', 'director')),
  -- Stock: how many toys (or items) it bought, and the box they are in.
  items int check (items >= 0),
  box_id text references public.boxes(id) on update cascade on delete set null,
  receipt_path text,
  -- What the phone read on the receipt, so receipts can be searched.
  receipt_text text,
  -- ok = checked by an owner. check = handed in by staff, not checked yet.
  status text not null default 'ok' check (status in ('ok', 'check')),
  added_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists book_entries_date_idx on public.book_entries (spent_on desc);
create index if not exists book_entries_box_idx on public.book_entries (box_id);

create table if not exists public.book_months (
  month date primary key check (extract(day from month) = 1),
  closed boolean not null default false,
  tax_paid numeric(12,2),
  tax_paid_on date,
  tax_ref text,
  tax_receipt_path text,
  notes text,
  updated_at timestamptz not null default now()
);

-- Who added it; staff who are not owners can only hand in receipts "to check".
create or replace function public._book_entry_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.added_by := coalesce(nullif(public._my_email(), ''), new.added_by);
  end if;
  -- (Rows typed straight into the SQL Editor have no signed-in person.)
  if public._my_email() <> '' and not public.has_role('owner') then
    new.status := 'check';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists book_entries_stamp on public.book_entries;
create trigger book_entries_stamp before insert or update on public.book_entries
  for each row execute function public._book_entry_stamp();
drop trigger if exists book_months_touch on public.book_months;
create trigger book_months_touch before update on public.book_months
  for each row execute function public.touch_updated_at();

alter table public.book_entries enable row level security;
alter table public.book_months enable row level security;

drop policy if exists "owners keep the books" on public.book_entries;
create policy "owners keep the books" on public.book_entries for all to authenticated
  using (public.has_role('owner')) with check (public.has_role('owner'));
drop policy if exists "staff hand in receipts" on public.book_entries;
create policy "staff hand in receipts" on public.book_entries for insert to authenticated
  with check (public.is_staff());
drop policy if exists "owners keep the months" on public.book_months;
create policy "owners keep the months" on public.book_months for all to authenticated
  using (public.has_role('owner')) with check (public.has_role('owner'));
revoke all on public.book_entries, public.book_months from anon;
grant select, insert, update, delete on public.book_entries, public.book_months to authenticated;

-- ---------------------------------------------------------------------
-- The report: twelve months of one year (Lusaka time).
--   sales       paid orders (website + shop), toys only
--   delivery    courier and packaging fees customers paid. Shown for
--               information only: this money is passed straight on to
--               Platinum and the riders, so it is NOT a sale, NOT money
--               in and NOT taxed.
--   income      other money in (book_entries kind income)
--   stock       stock bought: book entries in the stock category, plus
--               boxes from the Boxes page that no book entry points to
--   setup       one-off costs of setting up a shop
--   expenses    everything else, by category
--   turnover    sales + income  (turnover tax is on this)
-- ---------------------------------------------------------------------
create or replace function public.books_report(p_year int) returns jsonb
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
revoke execute on function public.books_report(int) from public, anon;
grant execute on function public.books_report(int) to authenticated;

-- ---------------------------------------------------------------------
-- Receipt photos: private. Staff can put a receipt in; only owners can
-- look at, replace or delete them.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
on conflict (id) do update set public = false;
drop policy if exists "staff hand in receipt photos" on storage.objects;
create policy "staff hand in receipt photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_staff());
drop policy if exists "owners see receipt photos" on storage.objects;
create policy "owners see receipt photos" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.has_role('owner'));
drop policy if exists "owners change receipt photos" on storage.objects;
create policy "owners change receipt photos" on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and public.has_role('owner'))
  with check (bucket_id = 'receipts' and public.has_role('owner'));
drop policy if exists "owners delete receipt photos" on storage.objects;
create policy "owners delete receipt photos" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.has_role('owner'));

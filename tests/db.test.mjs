// Database logic tests: run against a local Postgres with the Supabase stub.
//   PGURL=postgres://postgres@localhost:54329/astest node --test tests/db.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const url = process.env.PGURL || 'postgres://postgres@%2Ftmp:54329/postgres';
const admin = new pg.Client({ connectionString: url });
let db;
const DBNAME = 'as_dbtest';

async function as(role, email, fn) {
  await db.query('begin');
  try {
    await db.query(`set local role ${role}`);
    await db.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify(email ? { email, role } : { role })]);
    const out = await fn();
    await db.query('commit');
    return out;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}
const anon = (fn) => as('anon', null, fn);
const staff = (fn) => as('authenticated', 'owner@allseazons.test', fn);
const stranger = (fn) => as('authenticated', 'someone@else.test', fn);

async function addToy(fields = {}) {
  const f = { name: 'Toy', price: 50, status: 'available', image_path: 'x.jpg', ...fields };
  const cols = Object.keys(f);
  const { rows } = await db.query(
    `insert into toys (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`,
    Object.values(f));
  return rows[0];
}
const toy = async (id) => (await db.query('select * from toys where id=$1', [id])).rows[0];
const order = async (code) => (await db.query('select * from orders where code=$1', [code])).rows[0];
const lusakaPickup = { name: 'Jane Banda', phone: '0977 123 456', location: 'lusaka', delivery_method: 'pickup' };
let phoneSeq = 0;
const freshPhone = () => '0971' + String(100000 + ++phoneSeq);
const place = (items, customer = { ...lusakaPickup, phone: freshPhone() }) =>
  anon(async () => (await db.query('select place_order($1,$2) as r', [JSON.stringify(items), JSON.stringify(customer)])).rows[0].r);

before(async () => {
  await admin.connect();
  await admin.query(`drop database if exists ${DBNAME}`);
  await admin.query(`create database ${DBNAME}`);
  db = new pg.Client({ connectionString: url.replace(/\/[^/]*$/, '/' + DBNAME) });
  await db.connect();
  await db.query(readFileSync(new URL('./fixtures/supabase-stub.sql', import.meta.url), 'utf8'));
  await db.query(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.query(`insert into staff(email, roles) values ('owner@allseazons.test', '{owner}')`);
  await db.query(`update towns set courier='Mazhandu', fee_small=60, fee_medium=90, fee_large=150 where name='Kitwe'`);
});
after(async () => {
  await db?.end();
  await admin.query(`drop database if exists ${DBNAME}`);
  await admin.end();
});

test('the public sees shop toys but not ones waiting for review or hidden', async () => {
  const a = await addToy({ name: 'Visible' });
  const b = await addToy({ name: 'In review', status: 'review' });
  const c = await addToy({ name: 'Hidden', status: 'hidden' });
  const seen = await anon(async () => (await db.query('select id from toys')).rows.map((r) => r.id));
  assert.ok(seen.includes(a.id));
  assert.ok(!seen.includes(b.id));
  assert.ok(!seen.includes(c.id));
  const all = await staff(async () => (await db.query('select id from toys')).rows.map((r) => r.id));
  assert.ok(all.includes(b.id) && all.includes(c.id));
});

test('the public and non-staff accounts cannot change stock or read orders', async () => {
  const t = await addToy();
  await assert.rejects(anon(() => db.query(`update toys set price=1 where id=$1`, [t.id])));
  const changed = await stranger(async () => (await db.query(`update toys set price=1 where id=$1`, [t.id])).rowCount);
  assert.equal(changed, 0);
  await place([{ toy_id: t.id }]);
  assert.equal(await anon(async () => (await db.query('select * from orders')).rowCount), 0);
  assert.equal(await stranger(async () => (await db.query('select * from orders')).rowCount), 0);
  await assert.rejects(stranger(() => db.query(`select approve_toys(array[$1::uuid])`, [t.id])), /Staff only/);
  await assert.rejects(anon(() => db.query(`select _reserve_order(gen_random_uuid())`)), /permission denied/);
});

test('checkout holds the toys and returns the order summary', async () => {
  const a = await addToy({ name: 'Barbie Camper', price: 100, condition: 'used' });
  const b = await addToy({ name: 'Duplo Train', price: 80, sale_price: 60, is_special: true });
  const r = await place([{ toy_id: a.id }, { toy_id: b.id }], { ...lusakaPickup });
  assert.match(r.code, /^ORD-\d+$/);
  assert.equal(r.subtotal, 160);
  assert.equal(r.total, 160);
  assert.equal(r.item_count, 2);
  assert.equal(r.parcel_size, 'medium');
  assert.equal(r.phone, '0977123456');
  assert.deepEqual(r.items.map((i) => i.name), ['Barbie Camper', 'Duplo Train']);
  assert.equal((await toy(a.id)).status, 'reserved');
  assert.equal((await toy(a.id)).quantity, 0);
  await assert.rejects(place([{ toy_id: a.id }]), /just sold or went on hold: Barbie Camper/);
});

test('an unavailable toy error names it and lists its id for the cart', async () => {
  const a = await addToy({ name: 'Taken' });
  const b = await addToy({ name: 'Free' });
  await place([{ toy_id: a.id }]);
  try {
    await place([{ toy_id: a.id }, { toy_id: b.id }]);
    assert.fail('should have failed');
  } catch (e) {
    assert.equal(e.hint, 'unavailable');
    assert.equal(e.detail, a.id);
  }
  assert.equal((await toy(b.id)).status, 'available', 'the failed order must not hold other toys');
});

test('out-of-town orders pick the courier fee by parcel size', async () => {
  const kitwe = (await db.query(`select id from towns where name='Kitwe'`)).rows[0].id;
  const toys = [];
  for (let i = 0; i < 5; i++) toys.push(await addToy({ name: 'Bulk ' + i, price: 50 }));
  const c = { name: 'Mwila', phone: '0966000111', location: 'out_of_town', town_id: kitwe, address: 'Mazhandu Kitwe branch' };
  const one = await place([{ toy_id: toys[0].id }], c);
  assert.equal(one.parcel_size, 'small');
  // Courier K60 plus the K40 packaging fee.
  assert.equal(one.delivery_fee, 100);
  assert.equal(one.total, 150);
  assert.equal(one.delivery_method, 'courier');
  assert.equal(one.town, 'Kitwe');
  assert.equal(one.courier, 'Mazhandu');
  const four = await place(toys.slice(1, 5).map((t) => ({ toy_id: t.id })), { ...c, phone: '0966000222' });
  assert.equal(four.parcel_size, 'medium');
  assert.equal(four.delivery_fee, 130);
  const ndola = (await db.query(`select id from towns where name='Ndola'`)).rows[0].id;
  const t = await addToy();
  const unpriced = await place([{ toy_id: t.id }], { ...c, town_id: ndola, phone: '0966000333' });
  assert.equal(unpriced.delivery_fee, null, 'a town without fees is confirmed on WhatsApp');
  assert.equal(unpriced.total, 50);
});

test('checkout validates the customer details', async () => {
  const t = await addToy();
  const c = () => ({ ...lusakaPickup, phone: freshPhone() });
  await assert.rejects(place([{ toy_id: t.id }], { ...c(), name: '' }), /your name/);
  await assert.rejects(place([{ toy_id: t.id }], { ...c(), phone: '12' }), /phone/);
  await assert.rejects(place([{ toy_id: t.id }], { ...c(), delivery_method: 'yango' }), /address/);
  await assert.rejects(place([{ toy_id: t.id }], { ...c(), location: 'out_of_town' }), /town/);
  await assert.rejects(place([], c()), /cart is empty/);
  assert.equal((await toy(t.id)).status, 'available');
});

test('a customer can only have 3 orders waiting at once', async () => {
  const c = { ...lusakaPickup, phone: '0955555555' };
  for (let i = 0; i < 3; i++) await place([{ toy_id: (await addToy()).id }], c);
  await assert.rejects(place([{ toy_id: (await addToy()).id }], c), /3 orders waiting/);
});

test('expired holds put toys back on sale', async () => {
  const t = await addToy({ name: 'Short hold' });
  const r = await place([{ toy_id: t.id }], { ...lusakaPickup, phone: '0944444444' });
  await db.query(`update orders set hold_until = now() - interval '1 minute' where code=$1`, [r.code]);
  const n = await anon(async () => (await db.query('select release_expired_holds() n')).rows[0].n);
  assert.ok(n >= 1);
  assert.equal((await order(r.code)).status, 'expired');
  assert.equal((await toy(t.id)).status, 'available');
  assert.equal((await toy(t.id)).quantity, 1);
});

test('staff move an order through paid, packed and sent; sold toys stay visible', async () => {
  const t = await addToy({ name: 'Fire Truck', price: 120 });
  const r = await place([{ toy_id: t.id }], { ...lusakaPickup, phone: '0933333333' });
  const o = await order(r.code);
  await assert.rejects(staff(() => db.query('select set_order_status($1,$2)', [o.id, 'packed'])), /paid first/);
  await staff(() => db.query('select set_order_status($1,$2)', [o.id, 'confirmed']));
  assert.equal((await order(r.code)).hold_until, null);
  await staff(() => db.query('select set_order_status($1,$2)', [o.id, 'paid']));
  const sold = await toy(t.id);
  assert.equal(sold.status, 'sold');
  assert.equal(sold.sold_count, 1);
  assert.ok(sold.sold_at);
  await staff(() => db.query('select set_order_status($1,$2)', [o.id, 'packed']));
  await staff(() => db.query('select set_order_status($1,$2)', [o.id, 'sent']));
  assert.equal((await order(r.code)).status, 'sent');
  const publicView = await anon(async () => (await db.query('select status from toys where id=$1', [t.id])).rows[0]);
  assert.equal(publicView.status, 'sold');
});

test('cancelling a paid order puts the toy back and undoes the sale count', async () => {
  const t = await addToy({ name: 'Puzzle' });
  const r = await place([{ toy_id: t.id }], { ...lusakaPickup, phone: '0922222222' });
  const o = await order(r.code);
  await staff(() => db.query('select set_order_status($1,$2)', [o.id, 'paid']));
  await staff(() => db.query('select set_order_status($1,$2)', [o.id, 'cancelled']));
  const back = await toy(t.id);
  assert.equal(back.status, 'available');
  assert.equal(back.quantity, 1);
  assert.equal(back.sold_count, 0);
});

test('an expired order can still be marked paid if its toys are free', async () => {
  const t = await addToy({ name: 'Late payer' });
  const r = await place([{ toy_id: t.id }], { ...lusakaPickup, phone: '0911111111' });
  await db.query(`update orders set hold_until = now() - interval '1 minute' where code=$1`, [r.code]);
  await anon(() => db.query('select release_expired_holds()'));
  const o = await order(r.code);
  await staff(() => db.query('select set_order_status($1,$2)', [o.id, 'paid']));
  assert.equal((await toy(t.id)).status, 'sold');
});

test('new toys with several units stay on sale until the last one goes', async () => {
  const t = await addToy({ name: 'New Ball', condition: 'new', quantity: 2 });
  const r1 = await place([{ toy_id: t.id }], { ...lusakaPickup, phone: '0900000001' });
  assert.equal((await toy(t.id)).status, 'available');
  const r2 = await place([{ toy_id: t.id }], { ...lusakaPickup, phone: '0900000002' });
  assert.equal((await toy(t.id)).status, 'reserved');
  await staff(async () => db.query('select set_order_status($1,$2)', [(await order(r1.code)).id, 'paid']));
  assert.equal((await toy(t.id)).status, 'reserved', 'still held by the second order');
  await staff(async () => db.query('select set_order_status($1,$2)', [(await order(r2.code)).id, 'paid']));
  const done = await toy(t.id);
  assert.equal(done.status, 'sold');
  assert.equal(done.sold_count, 2);
});

test('a shop sale records a paid walk-in order', async () => {
  const t = await addToy({ name: 'Counter sale', price: 75 });
  const o = await staff(async () =>
    (await db.query('select * from shop_sale($1)', [JSON.stringify([{ toy_id: t.id }])])).rows[0]);
  assert.equal(o.status, 'paid');
  assert.equal(o.channel, 'shop');
  assert.equal(o.total, 75);
  assert.equal((await toy(t.id)).status, 'sold');
});

test('approving moves reviewed toys into the shop', async () => {
  const t = await addToy({ status: 'review' });
  const noPic = await addToy({ status: 'review', image_path: null });
  const n = await staff(async () =>
    (await db.query('select approve_toys($1::uuid[]) n', [[t.id, noPic.id]])).rows[0].n);
  assert.equal(n, 1);
  assert.equal((await toy(t.id)).status, 'available');
  assert.equal((await toy(noPic.id)).status, 'review');
});

test('the public order page shows toys and totals but no personal details', async () => {
  const t = await addToy({ name: 'Lego Set', image_path: 'lego.jpg' });
  const r = await place([{ toy_id: t.id }], { ...lusakaPickup, phone: '0988888888', delivery_method: 'yango', address: 'Plot 5, Kabulonga' });
  const pub = await anon(async () =>
    (await db.query('select get_order_public($1,$2) p', [r.code.toLowerCase(), r.link_key])).rows[0].p);
  assert.equal(pub.items[0].name, 'Lego Set');
  assert.equal(pub.items[0].image_path, 'lego.jpg');
  const text = JSON.stringify(pub);
  assert.ok(!text.includes('Jane') && !text.includes('Kabulonga') && !text.includes('0988'));
  const wrongKey = await anon(async () =>
    (await db.query('select get_order_public($1,$2) p', [r.code, 'nope'])).rows[0].p);
  assert.equal(wrongKey, null);
});

// ------------------------------------------------------------------ staff roles
const asEmail = (email) => (fn) => as('authenticated', email, fn);
const call = (who, sql, args = []) => who(async () => (await db.query(sql, args)).rows[0]);

test('the owner adds staff with a sign-in name, password and jobs', async () => {
  const r = await call(staff, `select * from staff_add('Mutale', 'Sales1', 'secret1', '{sales}')`);
  assert.equal(r.email, 'sales1@staff.allseazons.shop');
  assert.equal(r.login, 'sales1');
  assert.deepEqual(r.roles, ['sales']);
  const u = (await db.query(`select * from auth.users where email = $1`, [r.email])).rows[0];
  assert.ok(u, 'a sign-in account was made');
  assert.equal((await db.query(`select crypt('secret1', $1) = $1 as ok`, [u.encrypted_password])).rows[0].ok, true);
  assert.equal(u.confirmation_token, '', 'empty tokens, or Supabase sign-in breaks');
  assert.equal((await db.query(`select count(*)::int n from auth.identities where user_id = $1`, [u.id])).rows[0].n, 1);
  await assert.rejects(call(staff, `select staff_add('Again', 'sales1', 'secret1', '{sales}')`), /already signs in/);
  await assert.rejects(call(staff, `select staff_add('Short', 'x2', '123', '{sales}')`), /at least 6/);
  await assert.rejects(call(staff, `select staff_add('No job', 'x3', 'secret1', '{}')`), /at least one job/);
  await assert.rejects(call(asEmail('sales1@staff.allseazons.shop'), `select staff_add('Sneaky', 'x4', 'secret1', '{owner}')`), /Only the owner/);
});

test('each job can only do its own work', async () => {
  await call(staff, `select staff_add('Bwalya', 'stock1', 'secret1', '{stock}')`);
  await call(staff, `select staff_add('Chanda', 'till1', 'secret1', '{sales}')`);
  const stockP = asEmail('stock1@staff.allseazons.shop');
  const salesP = asEmail('till1@staff.allseazons.shop');
  const t = await addToy({ status: 'review', price: 70 });
  // Sales cannot change prices or approve; Stock can.
  assert.equal(await salesP(async () => (await db.query(`update toys set price=1 where id=$1`, [t.id])).rowCount), 0);
  await assert.rejects(call(salesP, `select approve_toys(array[$1::uuid])`, [t.id]), /Only Stock/);
  assert.equal(await stockP(async () => (await db.query(`update toys set price=100 where id=$1`, [t.id])).rowCount), 1);
  assert.equal((await call(stockP, `select approve_toys(array[$1::uuid]) n`, [t.id])).n, 1);
  // Stock cannot sell; Sales can. Both can see the stock.
  await assert.rejects(call(stockP, `select shop_sale($1)`, [JSON.stringify([{ toy_id: t.id }])]), /Only Sales/);
  const sale = await call(salesP, `select * from shop_sale($1)`, [JSON.stringify([{ toy_id: t.id }])]);
  assert.equal(sale.status, 'paid');
  assert.ok((await stockP(async () => (await db.query('select id from toys')).rowCount)) > 0);
  // A refund (cancelling a paid order) is for the owner only.
  await assert.rejects(call(salesP, `select set_order_status($1,'cancelled')`, [sale.id]), /Only the owner/);
  await call(staff, `select set_order_status($1,'cancelled')`, [sale.id]);
  // Settings are for the owner only.
  assert.equal(await salesP(async () => (await db.query(`update settings set hold_minutes=30`)).rowCount), 0);
  // The log says who did what; only the owner can read it.
  const log = (await db.query(`select actor, actor_name, action from activity where toy_id = $1 or order_id = $2 order by id`, [t.id, sale.id])).rows;
  assert.ok(log.some((l) => l.action === 'toy_approved' && l.actor_name === 'Bwalya'));
  assert.ok(log.some((l) => l.action === 'toy_price' && l.actor === 'stock1@staff.allseazons.shop'));
  assert.ok(log.some((l) => l.action === 'shop_sale' && l.actor_name === 'Chanda'));
  assert.ok(log.some((l) => l.action === 'order_cancelled' && l.actor === 'owner@allseazons.test'));
  assert.equal(await salesP(async () => (await db.query('select * from activity')).rowCount), 0);
  assert.ok(await staff(async () => (await db.query('select * from activity')).rowCount) > 0);
});

test('switching someone off locks them out, and there is always an owner', async () => {
  await call(staff, `select staff_add('Lost Phone', 'lost1', 'secret1', '{stock,sales}')`);
  const lost = asEmail('lost1@staff.allseazons.shop');
  assert.equal((await call(lost, `select is_staff() ok`)).ok, true);
  await call(staff, `select staff_update('lost1@staff.allseazons.shop', p_active => false)`);
  assert.equal((await call(lost, `select is_staff() ok`)).ok, false);
  assert.ok((await db.query(`select banned_until from auth.users where email='lost1@staff.allseazons.shop'`)).rows[0].banned_until);
  await call(staff, `select staff_update('lost1@staff.allseazons.shop', p_active => true)`);
  assert.equal((await db.query(`select banned_until from auth.users where email='lost1@staff.allseazons.shop'`)).rows[0].banned_until, null);
  await assert.rejects(call(staff, `select staff_update('owner@allseazons.test', p_roles => '{sales}')`), /always be at least one owner/);
  await assert.rejects(call(staff, `select staff_remove('owner@allseazons.test')`), /always be at least one owner/);
  await call(staff, `select staff_set_password('lost1@staff.allseazons.shop', 'newpass1')`);
  const pw = (await db.query(`select crypt('newpass1', encrypted_password) = encrypted_password ok from auth.users where email='lost1@staff.allseazons.shop'`)).rows[0];
  assert.equal(pw.ok, true);
  await call(staff, `select staff_remove('lost1@staff.allseazons.shop')`);
  assert.equal((await call(lost, `select is_staff() ok`)).ok, false);
});

test('running the database file again keeps staff and their jobs', async () => {
  await db.query(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  const r = (await db.query(`select roles from staff where email='owner@allseazons.test'`)).rows[0];
  assert.deepEqual(r.roles, ['owner']);
});

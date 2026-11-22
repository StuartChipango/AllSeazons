// Sale alerts: the database side (who rings, who may subscribe) and the
// hand-made Web Push crypto in the sale-alert edge function.
//   needs the same local Postgres as db.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createECDH, randomBytes } from 'node:crypto';
import pg from 'pg';

const push = await import('../supabase/functions/sale-alert/index.ts');

// ---------- crypto ----------
test('a push message decrypts on the phone side (RFC 8291 aes128gcm)', async () => {
  const ece = (await import('http_ece')).default;
  const phone = createECDH('prime256v1');
  phone.generateKeys();
  const auth = randomBytes(16);
  const text = JSON.stringify({ title: 'Cha-ching! New order K350', body: 'ORD-1001 · Jane' });
  const body = await push.encryptPayload(text, push.b64u(phone.getPublicKey()), push.b64u(auth));
  const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: phone, authSecret: auth });
  assert.equal(plain.toString(), text);
});

test('the VAPID header is a valid ES256 token for the push service', async () => {
  const vapid = await push.makeVapidKeys();
  assert.equal(push.unb64u(vapid.publicKey).length, 65);
  const h = await push.vapidHeader('https://fcm.googleapis.com/fcm/send/abc', vapid, Date.UTC(2026, 10, 22));
  const m = h.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m, h);
  const claims = JSON.parse(Buffer.from(push.unb64u(m[2])).toString());
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.match(claims.sub, /^https:/);
  assert.equal(m[4], vapid.publicKey);
  const key = await crypto.subtle.importKey('raw', push.unb64u(m[4]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, push.unb64u(m[3]),
    new TextEncoder().encode(`${m[1]}.${m[2]}`));
  assert.ok(ok);
});

// ---------- database ----------
const url = process.env.PGURL || 'postgres://postgres@%2Ftmp:54329/postgres';
const admin = new pg.Client({ connectionString: url });
const DBNAME = 'as_alerttest';
let db;

async function as(role, email, fn) {
  await db.query('begin');
  try {
    await db.query(`set local role ${role}`);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(email ? { email, role } : { role })]);
    const out = await fn();
    await db.query('commit');
    return out;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}
const calls = async () => (await db.query('select body from net.calls order by id')).rows.map((r) => r.body);
let n = 0;
const customer = () => ({ name: 'Jane Banda', phone: '0971' + String(200000 + ++n), location: 'lusaka', delivery_method: 'pickup' });

before(async () => {
  await admin.connect();
  await admin.query(`drop database if exists ${DBNAME}`);
  await admin.query(`create database ${DBNAME}`);
  db = new pg.Client({ connectionString: url.replace(/\/[^/]*$/, '/' + DBNAME) });
  await db.connect();
  await db.query(readFileSync(new URL('./fixtures/supabase-stub.sql', import.meta.url), 'utf8'));
  // Stand-in for pg_net: remember what would have been sent.
  await db.query(`
    create schema net;
    create table net.calls (id serial primary key, url text, body jsonb);
    create function net.http_post(url text, body jsonb, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
      returns bigint language sql security definer as $$ insert into net.calls (url, body) values (url, body) returning id::bigint $$;
    grant usage on schema net to anon, authenticated;`);
  await db.query(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  const alerts = readFileSync(new URL('../supabase/sale-alerts.sql', import.meta.url), 'utf8');
  await db.query(alerts);
  await db.query(alerts); // safe to run twice
  await db.query(`insert into staff(email, roles) values ('owner@allseazons.test', '{owner}')`);
});
after(async () => {
  await db?.end();
  await admin.query(`drop database if exists ${DBNAME}`);
  await admin.end();
});

test('a customer website order asks the edge function to ring, once', async () => {
  const { rows: [t] } = await db.query(`insert into toys (name, price, status, image_path) values ('Bear', 50, 'available', 'x.jpg') returning id`);
  await db.query('truncate net.calls');
  const r = await as('anon', null, async () => (await db.query('select place_order($1,$2) as r',
    [JSON.stringify([{ toy_id: t.id }]), JSON.stringify(customer())])).rows[0].r);
  const sent = await calls();
  assert.equal(sent.length, 1);
  const { rows: [o] } = await db.query('select id from orders where code=$1', [r.code]);
  assert.equal(sent[0].order_id, o.id);
  const { rows: [u] } = await db.query('select url from net.calls');
  assert.match(u.url, /\/functions\/v1\/sale-alert$/);
});

test('a failed checkout and staff-typed orders do not ring', async () => {
  await db.query('truncate net.calls');
  await assert.rejects(as('anon', null, () => db.query('select place_order($1,$2)',
    [JSON.stringify([{ toy_id: '00000000-0000-0000-0000-000000000000' }]), JSON.stringify(customer())])));
  const { rows: [t] } = await db.query(`insert into toys (name, price, status, image_path) values ('Car', 40, 'available', 'x.jpg') returning id`);
  await as('authenticated', 'owner@allseazons.test', () => db.query('select place_order($1,$2)',
    [JSON.stringify([{ toy_id: t.id }]), JSON.stringify(customer())]));
  await as('authenticated', 'owner@allseazons.test', () => db.query('select shop_sale($1)', [JSON.stringify([{ toy_id: t.id }])]).catch(() => {}));
  assert.deepEqual(await calls(), []);
});

test('only staff can save a phone for alerts, and nobody can read the keys', async () => {
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/x1', keys: { p256dh: 'BPk', auth: 'au' } };
  await assert.rejects(as('anon', null, () => db.query('select push_subscribe($1)', [JSON.stringify(sub)])));
  await assert.rejects(as('authenticated', 'someone@else.test', () => db.query('select push_subscribe($1)', [JSON.stringify(sub)])), /Staff only/);
  await as('authenticated', 'owner@allseazons.test', () => db.query('select push_subscribe($1, $2)', [JSON.stringify(sub), 'Pixel (app)']));
  await as('authenticated', 'owner@allseazons.test', () => db.query('select push_subscribe($1, $2)', [JSON.stringify(sub), 'Pixel (app)']));
  const { rows } = await db.query('select staff_email, device from push_subscriptions');
  assert.deepEqual(rows, [{ staff_email: 'owner@allseazons.test', device: 'Pixel (app)' }]);
  await db.query(`insert into push_keys (public_key, private_jwk) values ('pub', '{}')`);
  await assert.rejects(as('authenticated', 'owner@allseazons.test', () => db.query('select * from push_keys')));
  const peek = await as('anon', null, () => db.query('select * from push_subscriptions').then((r) => r.rows, () => []));
  assert.deepEqual(peek, []);
  await as('authenticated', 'owner@allseazons.test', () => db.query('select push_unsubscribe($1)', [sub.endpoint]));
  assert.equal((await db.query('select count(*)::int c from push_subscriptions')).rows[0].c, 0);
});

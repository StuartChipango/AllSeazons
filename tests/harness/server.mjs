// Local stand-in for Supabase, for development and end-to-end tests.
// Real Postgres + real PostgREST, plus small fakes for sign-in, photo
// storage and the AI labelling function.
//
//   PGURL=postgres://postgres@%2Ftmp:54329/postgres PGRST_BIN=/path/to/postgrest node tests/harness/server.mjs
//
// Then open http://localhost:8787/ (shop) and /staff/ (staff app).
// Staff sign-in: owner@allseazons.test / test-password
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, statSync, createReadStream } from 'node:fs';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8787);
const PGRST_PORT = Number(process.env.PGRST_PORT || 3077);
const SECRET = 'local-test-secret-local-test-secret-123456';
const BASE_URL = process.env.PGURL || 'postgres://postgres@%2Ftmp:54329/postgres';
const DBNAME = process.env.DBNAME || 'as_e2e';
const DB_URL = BASE_URL.replace(/\/[^/]*$/, '/' + DBNAME);
const STORE = join(ROOT, 'tests', '.storage');
const STAFF = { email: 'owner@allseazons.test', password: 'test-password', id: '11111111-1111-1111-1111-111111111111' };

export const ANON_KEY = jwt.sign({ role: 'anon', iss: 'supabase' }, SECRET);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

export async function resetDatabase({ seed = true } = {}) {
  const admin = new pg.Client({ connectionString: BASE_URL });
  await admin.connect();
  await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [DBNAME]);
  await admin.query(`drop database if exists ${DBNAME}`);
  await admin.query(`create database ${DBNAME}`);
  await admin.end();
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  await db.query(readFileSync(join(ROOT, 'tests/fixtures/supabase-stub.sql'), 'utf8'));
  await db.query(readFileSync(join(ROOT, 'supabase/schema.sql'), 'utf8'));
  await db.query(`alter role authenticator with login password 'authenticator'`);
  if (seed) {
    await db.query(`insert into staff (email, name) values ($1, 'Owner')`, [STAFF.email]);
    await db.query(`update settings set whatsapp_number = '260977000111', announcement = 'Free pickup in Lusaka every day'`);
    await db.query(`update towns set courier = 'Mazhandu', fee_small = 60, fee_medium = 90, fee_large = 150 where name in ('Kitwe', 'Ndola')`);
  }
  await db.end();
  rmSync(STORE, { recursive: true, force: true });
  mkdirSync(STORE, { recursive: true });
}

function startPostgrest() {
  const bin = process.env.PGRST_BIN || '/tmp/claude-0/postgrest';
  const u = new URL(DB_URL);
  const dbUri = `postgres://authenticator:authenticator@localhost:${u.port || 5432}/${DBNAME}?host=${decodeURIComponent(u.hostname)}`;
  const child = spawn(bin, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: dbUri,
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: SECRET,
      PGRST_SERVER_PORT: String(PGRST_PORT),
      PGRST_DB_CHANNEL_ENABLED: 'false',
      PGRST_LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return child;
}

async function waitForPostgrest() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://localhost:${PGRST_PORT}/settings`, { headers: { Authorization: `Bearer ${ANON_KEY}` } });
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('PostgREST did not start');
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Profile',
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { ...cors, ...(isJson ? { 'Content-Type': 'application/json' } : {}), ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function session() {
  const now = Math.floor(Date.now() / 1000);
  const user = { id: STAFF.id, aud: 'authenticated', role: 'authenticated', email: STAFF.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const access = jwt.sign({ sub: STAFF.id, email: STAFF.email, role: 'authenticated', aud: 'authenticated', exp: now + 3600 }, SECRET);
  return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'refresh-' + now, user };
}

function bearerClaims(req) {
  const h = req.headers.authorization || '';
  try { return jwt.verify(h.replace(/^Bearer\s+/i, ''), SECRET); } catch { return null; }
}

let labelCount = 0;
const LABELS = [
  { name: 'Teddy Bear', brand: '', audience: 'neutral', condition: 'used', category: 'Soft Toys', age_range: '0-2', description: 'A soft, cuddly bear for little hands.', confidence: 'high' },
  { name: 'Red Race Car', brand: 'Hot Wheels', audience: 'boys', condition: 'used', category: 'Cars & Vehicles', age_range: '3-5', description: 'A shiny red car ready to race.', confidence: 'high' },
  { name: 'Stacking Blocks Set', brand: '', audience: 'neutral', condition: 'new', category: 'Building & Blocks', age_range: '0-2', description: 'Bright blocks to stack and sort.', confidence: 'medium' },
];

async function handle(req, res, url) {
  const p = url.pathname;
  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (p === '/assets/js/config.js') {
    return send(res, 200, `export const SUPABASE_URL = 'http://localhost:${PORT}';\nexport const SUPABASE_ANON_KEY = '${ANON_KEY}';\n`, { 'Content-Type': 'text/javascript' });
  }

  if (p.startsWith('/rest/v1/')) {
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    delete headers['accept-encoding'];
    const r = await fetch(`http://localhost:${PGRST_PORT}${p.slice(8)}${url.search}`, { method: req.method, headers, body });
    const out = Buffer.from(await r.arrayBuffer());
    const h = {};
    for (const k of ['content-type', 'content-range', 'preference-applied']) if (r.headers.get(k)) h[k] = r.headers.get(k);
    return send(res, r.status, out, h);
  }

  if (p === '/auth/v1/token') {
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password' && (body.email !== STAFF.email || body.password !== STAFF.password)) {
      return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' });
    }
    return send(res, 200, session());
  }
  if (p === '/auth/v1/user') return bearerClaims(req) ? send(res, 200, session().user) : send(res, 401, { msg: 'no session' });
  if (p === '/auth/v1/logout') return send(res, 204, '');
  if (p === '/auth/v1/recover') return send(res, 200, {});

  if (p.startsWith('/storage/v1/object/')) {
    let rest = decodeURIComponent(p.slice('/storage/v1/object/'.length));
    if (rest.startsWith('public/')) {
      rest = rest.slice(7);
      const file = join(STORE, normalize(rest));
      if (!rest.startsWith('toys/') || !existsSync(file)) return send(res, 404, { message: 'Not found' });
      res.writeHead(200, { ...cors, 'Content-Type': 'image/jpeg' });
      return createReadStream(file).pipe(res);
    }
    const claims = bearerClaims(req);
    if (!claims || claims.role !== 'authenticated') return send(res, 403, { message: 'Unauthorized', statusCode: '403' });
    if (req.method === 'DELETE') {
      const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || '{}');
      for (const name of prefixes) rmSync(join(STORE, rest, normalize(name)), { force: true });
      return send(res, 200, prefixes.map((name) => ({ name })));
    }
    const file = join(STORE, normalize(rest));
    if (req.method === 'GET') {
      if (!existsSync(file)) return send(res, 404, { message: 'Not found' });
      res.writeHead(200, { ...cors, 'Content-Type': 'image/jpeg' });
      return createReadStream(file).pipe(res);
    }
    let data = await readBody(req);
    const type = req.headers['content-type'] || '';
    if (type.startsWith('multipart/form-data')) {
      // The browser client sends Blobs as a form with one file field, like real Supabase accepts.
      const form = await new Response(data, { headers: { 'content-type': type } }).formData();
      const filePart = [...form.values()].find((v) => typeof v !== 'string');
      data = Buffer.from(await filePart.arrayBuffer());
    }
    if (req.method === 'POST' && existsSync(file) && req.headers['x-upsert'] !== 'true') {
      return send(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
    return send(res, 200, { Key: rest, Id: rest });
  }

  if (p === '/functions/v1/label-toy') {
    const claims = bearerClaims(req);
    if (!claims || claims.role !== 'authenticated') return send(res, 403, { error: 'Staff only.' });
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    if (!body.image) return send(res, 400, { error: 'Send an image.' });
    if (process.env.LABEL_FAIL) return send(res, 500, { error: 'ANTHROPIC_API_KEY is not set in Supabase secrets.' });
    const labels = { ...LABELS[labelCount++ % LABELS.length] };
    return send(res, 200, { labels });
  }

  if (p.startsWith('/realtime/')) return send(res, 404, { message: 'Realtime is not available locally' });

  // Static files.
  let file = join(ROOT, normalize(p));
  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
}

export async function startHarness({ reset = true } = {}) {
  if (reset) await resetDatabase();
  const pgrst = startPostgrest();
  await waitForPostgrest();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    handle(req, res, url).catch((e) => {
      console.error(e);
      if (!res.headersSent) send(res, 500, { message: e.message });
    });
  });
  await new Promise((r) => server.listen(PORT, r));
  return {
    url: `http://localhost:${PORT}`,
    dbUrl: DB_URL,
    staff: STAFF,
    async stop() {
      server.close();
      pgrst.kill();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const h = await startHarness({ reset: !process.env.KEEP_DB });
  console.log(`Shop:  ${h.url}/\nStaff: ${h.url}/staff/  (${STAFF.email} / ${STAFF.password})`);
}

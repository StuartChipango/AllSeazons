// Supabase Edge Function: sale-alert
//
// Rings every staff phone that turned on sale alerts ("Cha-ching! New
// order") when a customer places an order on the website.
//
// Called by:
//   - the database, right after a website order is saved (supabase/sale-alerts.sql)
//       body {"order_id": "..."}
//   - the staff app, to get the shop's push key and to send a test alert
//       body {"action": "key"} or {"action": "test", "endpoint": "..."}
//
// Needs no secrets and no paid service. The first time it runs it makes the
// shop's own push keys and keeps them in the push_keys table.
// Deploy with "Verify JWT" OFF (the database calls it without a sign-in).
//
// Web Push is done by hand with the built-in WebCrypto (RFC 8291 message
// encryption + RFC 8292 VAPID), so there is nothing to install.

// Loaded when first needed (the tests import this file without it).
const supabaseJs = () => import("npm:@supabase/supabase-js@2.45.4");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Who the push services can contact about these messages.
const CONTACT = "https://allseazons.shop";
// An order older than this never rings (stops old orders being replayed).
const MAX_AGE_MIN = 30;

// ---------------------------------------------------------------------
// Web Push, by hand.
// ---------------------------------------------------------------------
const enc = new TextEncoder();

export function b64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

export type Vapid = { publicKey: string; privateJwk: JsonWebKey };

export async function makeVapidKeys(): Promise<Vapid> {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return { publicKey: b64u(raw), privateJwk };
}

// The "Authorization: vapid ..." header that proves the message is from us.
export async function vapidHeader(endpoint: string, vapid: Vapid, now = Date.now()): Promise<string> {
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: CONTACT,
  })));
  const key = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${vapid.publicKey}`;
}

// Encrypt one message for one phone (RFC 8291, aes128gcm).
export async function encryptPayload(text: string, p256dh: string, auth: string): Promise<Uint8Array> {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));

  const prkKey = await hmac(authSecret, ecdh);
  const ikm = await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, enc.encode("Content-Encoding: aes128gcm\0\x01"))).slice(0, 16);
  const nonce = (await hmac(prk, enc.encode("Content-Encoding: nonce\0\x01"))).slice(0, 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const body = concat(enc.encode(text), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, body));

  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

type Sub = { endpoint: string; p256dh: string; auth: string };

// Send one message. Returns the push service's HTTP status.
export async function sendPush(sub: Sub, message: unknown, vapid: Vapid): Promise<number> {
  const body = await encryptPayload(JSON.stringify(message), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidHeader(sub.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(24 * 3600),
      Urgency: "high",
    },
    body,
  });
  await res.body?.cancel();
  return res.status;
}

// ---------------------------------------------------------------------
// The function.
// ---------------------------------------------------------------------
const kwacha = (n: number) => "K" + Number(n || 0).toLocaleString("en-US");

type Db = Awaited<ReturnType<typeof admin>>;
async function admin() {
  const { createClient } = await supabaseJs();
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

async function getKeys(db: Db): Promise<Vapid> {
  const { data } = await db.from("push_keys").select("public_key, private_jwk").eq("id", 1).maybeSingle();
  if (data) return { publicKey: data.public_key, privateJwk: data.private_jwk };
  const made = await makeVapidKeys();
  const { error } = await db.from("push_keys")
    .upsert({ id: 1, public_key: made.publicKey, private_jwk: made.privateJwk }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error("Run supabase/sale-alerts.sql first: " + error.message);
  // Two phones asking at once: keep whichever keys were saved first.
  const again = await db.from("push_keys").select("public_key, private_jwk").eq("id", 1).single();
  return { publicKey: again.data!.public_key, privateJwk: again.data!.private_jwk };
}

async function sendToAll(db: Db, vapid: Vapid, message: unknown, onlyEndpoint?: string) {
  let q = db.from("push_subscriptions").select("endpoint, p256dh, auth");
  if (onlyEndpoint) q = q.eq("endpoint", onlyEndpoint);
  const { data: subs } = await q;
  let sent = 0, failed = 0;
  await Promise.all((subs || []).map(async (s: Sub) => {
    try {
      const status = await sendPush(s, message, vapid);
      if (status >= 200 && status < 300) {
        sent++;
        await db.from("push_subscriptions").update({ last_sent_at: new Date().toISOString() }).eq("endpoint", s.endpoint);
      } else {
        failed++;
        // 404/410: the phone turned alerts off or the app was removed.
        if (status === 404 || status === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        else console.error("push failed", status, new URL(s.endpoint).host);
      }
    } catch (e) {
      failed++;
      console.error("push error", e);
    }
  }));
  return { sent, failed, phones: subs?.length || 0 };
}

async function orderMessage(db: Db, orderId: string) {
  // Claim the order so it only ever rings once.
  const since = new Date(Date.now() - MAX_AGE_MIN * 60_000).toISOString();
  const { data: o } = await db.from("orders")
    .update({ alerted_at: new Date().toISOString() })
    .eq("id", orderId).eq("channel", "online").is("alerted_at", null).gte("created_at", since)
    .select("id, code, customer_name, location, town, delivery_method, item_count, subtotal")
    .maybeSingle();
  if (!o) return null;
  const { data: items } = await db.from("order_items").select("name, qty").eq("order_id", o.id).order("id").limit(2);
  const shown = (items || []) as { name: string; qty: number }[];
  const rest = o.item_count - shown.reduce((n, i) => n + (i.qty || 1), 0);
  const toys = shown.map((i) => (i.qty > 1 ? `${i.qty} × ${i.name}` : i.name)).join(", ") + (rest > 0 ? ` +${rest} more` : "");
  const where = o.location === "out_of_town" ? `${o.town} courier`
    : o.delivery_method === "yango" ? "Yango delivery" : "pickup";
  const first = String(o.customer_name || "").split(/\s+/)[0];
  return {
    title: `Cha-ching! New order ${kwacha(o.subtotal)}`,
    body: `${o.code} · ${first} · ${o.item_count} toy${o.item_count === 1 ? "" : "s"} · ${where}` + (toys ? `\n${toys}` : ""),
    tag: o.code,
    url: "#orders",
    order_id: o.id,
  };
}

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const body = await req.json().catch(() => ({}));
  const db = await admin();
  try {
    if (body.action === "key") {
      const vapid = await getKeys(db);
      return json({ publicKey: vapid.publicKey });
    }

    if (body.action === "test") {
      // Only signed-in staff may send a test.
      const { createClient } = await supabaseJs();
      const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      });
      const { data: isStaff } = await user.rpc("is_staff");
      if (isStaff !== true) return json({ error: "Staff only." }, 403);
      const vapid = await getKeys(db);
      const out = await sendToAll(db, vapid, {
        title: "Cha-ching! This is a test",
        body: "Sale alerts work on this phone. Real ones look like this when a customer orders on the website.",
        tag: "test",
        url: "#orders",
      }, body.endpoint || undefined);
      return json(out);
    }

    if (body.order_id) {
      const message = await orderMessage(db, String(body.order_id));
      if (!message) return json({ skipped: true });
      const vapid = await getKeys(db);
      return json(await sendToAll(db, vapid, message));
    }

    return json({ error: "Nothing to do." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

// Supabase runs this file with Deno; the tests import it with Node.
(globalThis as { Deno?: { serve: (h: typeof handle) => void } }).Deno?.serve(handle);

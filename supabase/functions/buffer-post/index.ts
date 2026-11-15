// Supabase Edge Function: buffer-post
//
// Sends pictures and a caption from the staff app to Buffer, which posts
// them on the shop's Facebook Page, Instagram and TikTok. Buffer is
// already approved by Meta and TikTok, so no app review is needed.
//
// Needs one secret (Supabase > Edge Functions > Secrets):
//   BUFFER_API_KEY   from https://publish.buffer.com/settings/api (free plan has one)
// The key stays here on the server; the website never sees it.
//
// POST { action: "channels" }
//   -> { channels: [{ id, name, service, avatar }] }
// POST { action: "post", channelIds: [...], text, images: [public urls],
//        when: "now" | "queue" | "at", dueAt?: ISO time }
//   -> { results: [{ channelId, ok, error?, postId? }] }

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const API = Deno.env.get("BUFFER_API_URL") || "https://api.buffer.com";

type GqlResult = { data?: Record<string, any>; errors?: { message: string; extensions?: { code?: string } }[] };

async function gql(key: string, query: string, variables: Record<string, unknown> = {}): Promise<GqlResult> {
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 429) throw new Error("Buffer is busy (too many posts at once). Wait 15 minutes and try again.");
  if (res.status === 401) throw new Error("Buffer did not accept the key. Make a new API key in Buffer and save it again in Supabase.");
  const out = (await res.json().catch(() => ({}))) as GqlResult;
  if (!res.ok && !out.errors) throw new Error(`Buffer answered ${res.status}.`);
  return out;
}

const firstError = (r: GqlResult) => r.errors?.[0]?.message;

async function channels(key: string) {
  const orgs = await gql(key, `query { account { organizations { id name } } }`);
  if (firstError(orgs)) throw new Error(firstError(orgs));
  const list: { id: string; name: string; service: string; avatar?: string }[] = [];
  for (const o of orgs.data?.account?.organizations ?? []) {
    const ch = await gql(key, `query { channels(input: { organizationId: ${JSON.stringify(String(o.id))} }) { id name displayName service avatar } }`);
    if (firstError(ch)) throw new Error(firstError(ch));
    for (const c of ch.data?.channels ?? []) {
      list.push({ id: c.id, name: c.displayName || c.name, service: String(c.service || "").toLowerCase(), avatar: c.avatar });
    }
  }
  return list;
}

const CREATE = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess { post { id } }
    ... on MutationError { message }
  }
}`;

// Buffer's API is young and a few input fields are not fully documented,
// so if Buffer says a field is unknown or a mode is not allowed, try the
// next safest form instead of failing the post.
async function createPost(key: string, input: Record<string, unknown>) {
  const tries: Record<string, unknown>[] = [input];
  const noApproval = { ...input };
  delete noApproval.needsApproval;
  tries.push(noApproval);
  if (input.mode === "shareNow") {
    // "Post now" fallback: schedule two minutes from now.
    const soon = { ...noApproval, mode: "customScheduled", dueAt: new Date(Date.now() + 2 * 60_000).toISOString() };
    tries.push(soon);
  }
  let last = "Buffer did not take the post.";
  for (const t of tries) {
    const r = await gql(key, CREATE, { input: t });
    const res = r.data?.createPost;
    if (res?.post?.id) return { ok: true, postId: res.post.id as string };
    if (res?.message) return { ok: false, error: String(res.message) }; // a real answer from Buffer: do not retry
    last = firstError(r) || last;
    // Only retry on input-shape problems.
    if (!/needsApproval|ShareMode|mode|Unknown|not defined|Expected/i.test(last)) break;
  }
  return { ok: false, error: last };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: isStaff } = await supabase.rpc("is_staff");
  if (isStaff !== true) return json({ error: "Staff only." }, 403);

  const key = Deno.env.get("BUFFER_API_KEY");
  if (!key) return json({ error: "Buffer is not linked yet. Add the BUFFER_API_KEY secret in Supabase (Edge Functions > Secrets).", setup: true }, 400);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Send JSON." }, 400); }

  try {
    if (body.action === "channels") return json({ channels: await channels(key) });

    if (body.action === "post") {
      const ids: string[] = Array.isArray(body.channelIds) ? body.channelIds.slice(0, 10) : [];
      const images: string[] = (Array.isArray(body.images) ? body.images : []).filter((u: unknown) => typeof u === "string" && /^(https:\/\/|http:\/\/localhost[:/])/.test(u)).slice(0, 10);
      const text = String(body.text ?? "").slice(0, 2200);
      if (!ids.length) return json({ error: "Pick at least one page to post on." }, 400);
      if (!images.length) return json({ error: "No pictures to post." }, 400);
      const known = await channels(key);
      const when = body.when === "queue" ? "addToQueue" : body.when === "at" ? "customScheduled" : "shareNow";
      if (when === "customScheduled" && !(body.dueAt && Date.parse(body.dueAt) > Date.now())) {
        return json({ error: "Pick a time in the future." }, 400);
      }
      const results = [];
      for (const id of ids) {
        const ch = known.find((c) => c.id === id);
        if (!ch) { results.push({ channelId: id, ok: false, error: "This page is no longer linked in Buffer." }); continue; }
        const input: Record<string, unknown> = {
          channelId: id,
          text,
          schedulingType: "automatic",
          mode: when,
          needsApproval: false,
          assets: images.map((url) => ({ image: { url } })),
        };
        if (when === "customScheduled") input.dueAt = new Date(body.dueAt).toISOString();
        if (ch.service.includes("instagram")) {
          input.metadata = { instagram: { type: images.length > 1 ? "carousel" : "post", shouldShareToFeed: true } };
        } else if (ch.service.includes("tiktok")) {
          input.metadata = { tiktok: { title: text.split("\n")[0].slice(0, 90) || "All Seazons" } };
        }
        let r = await createPost(key, input);
        // Instagram may want "post" even for several pictures.
        if (!r.ok && ch.service.includes("instagram") && images.length > 1 && /type|carousel/i.test(r.error || "")) {
          r = await createPost(key, { ...input, metadata: { instagram: { type: "post", shouldShareToFeed: true } } });
        }
        results.push({ channelId: id, name: ch.name, service: ch.service, ...r });
      }
      return json({ results });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

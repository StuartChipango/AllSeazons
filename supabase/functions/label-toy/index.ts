// Supabase Edge Function: label-toy
//
// The staff app sends one toy photo; this asks an AI to name the toy and
// suggest its group (boys, girls or neutral), condition, category and age.
// Everything it suggests is checked by a person on the Review page.
//
// Needs one secret (Supabase > Edge Functions > Secrets):
//   GEMINI_API_KEY    free key from https://aistudio.google.com/apikey, or
//   ANTHROPIC_API_KEY to use Claude instead (paid).
// Optional secret LABEL_MODEL to use a different model.

import Anthropic from "npm:@anthropic-ai/sdk@0.132.1";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const AGES = ["0-2", "3-5", "6-8", "9+"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  // Only signed-in staff may use this.
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: isStaff } = await supabase.rpc("is_staff");
  if (isStaff !== true) return json({ error: "Staff only." }, 403);

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!geminiKey && !apiKey) return json({ error: "Add the GEMINI_API_KEY secret in Supabase (Edge Functions > Secrets)." }, 500);

  let body: { image?: string; media_type?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send JSON with an image." }, 400);
  }
  const image = body.image?.replace(/^data:[^,]+,/, "");
  const mediaType = body.media_type ?? "image/jpeg";
  if (!image || !["image/jpeg", "image/png", "image/webp"].includes(mediaType)) {
    return json({ error: "Send a JPEG, PNG or WebP image as base64." }, 400);
  }

  const { data: cats } = await supabase.from("categories").select("name").order("sort");
  const categories: string[] = (cats ?? []).map((c: { name: string }) => c.name);
  if (!categories.includes("Other")) categories.push("Other");

  const schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      tagline: { type: "string" },
      focus: { type: "array", items: { type: "number" } },
      brand: { type: "string" },
      audience: { type: "string", enum: ["boys", "girls", "neutral"] },
      condition: { type: "string", enum: ["used", "new"] },
      category: { type: "string", enum: categories },
      age_range: { type: "string", enum: AGES },
      description: { type: "string" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["name", "tagline", "focus", "brand", "audience", "condition", "category", "age_range", "description", "confidence"],
    additionalProperties: false,
  };

  const prompt = `You label toys for All Seazons Play, a toy shop in Zambia that sells mostly pre-loved (second-hand) toys and some new ones. Look at the photo and describe the main toy.

- name: what a parent would search for, at most 32 characters, in Title Case. Include the brand or character when you can see it (for example "Barbie Camper Van", "Paw Patrol Chase", "Lego Duplo Train", "Wooden Shape Sorter"). If several pieces are a set, name the set.
- tagline: an optional short line (at most 20 characters) shown small above the name, for a detail that does not fit in it, e.g. "Big & Small" over "Barbie Set", "Soft" over "Baby Plushy", "Pencil Set & Ball" over "Star Wars Set". Use "" when nothing useful.
- focus: [left, top, right, bottom] of the box around every part of the toy, as fractions (0 to 1) of the photo width and height, a little generous rather than tight.
- brand: the brand if visible or obvious, else "".
- audience: "girls" or "boys" if the toy is clearly marketed that way in a typical toy shop, otherwise "neutral" (most blocks, puzzles, baby toys, educational and outdoor toys are neutral).
- condition: "new" only if it is sealed or in its original unopened packaging; otherwise "used".
- category: the closest one from the list.
- age_range: the age group it suits best.
- description: one short friendly sentence for parents (no price, no condition claims you cannot see).
- confidence: how sure you are of the name.`;

  const tidy = (labels: Record<string, unknown>) => {
    labels.name = String(labels.name ?? "").trim().slice(0, 40) || "Unnamed toy";
    labels.tagline = String(labels.tagline ?? "").trim().slice(0, 30);
    return json({ labels });
  };

  if (geminiKey) {
    const result = await askGemini(geminiKey, image, mediaType, prompt, schema);
    return "labels" in result ? tidy(result.labels) : json({ error: result.error }, result.status);
  }

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.beta.messages.create({
      model: Deno.env.get("LABEL_MODEL") || "claude-opus-5-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg", data: image } },
          { type: "text", text: prompt },
        ],
      }],
    });

    if (response.stop_reason === "refusal") {
      return json({ error: "Claude could not label this photo. Fill it in on the Review page." }, 422);
    }
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return json({ error: "No label came back." }, 502);
    return tidy(JSON.parse(text.text));
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Too many photos at once. Try again in a minute." }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "The Anthropic API key is not valid." }, 500);
    if (err instanceof Anthropic.APIError) return json({ error: `Claude error: ${err.message}` }, 502);
    return json({ error: "Could not label this photo." }, 500);
  }
});

// Google Gemini (free tier).
async function askGemini(
  key: string, image: string, mediaType: string, prompt: string, schema: Record<string, unknown>,
): Promise<{ labels: Record<string, unknown> } | { error: string; status: number }> {
  // Gemini's own schema format: upper-case types, no additionalProperties.
  const convert = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(convert);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "additionalProperties") continue;
      out[k] = k === "type" && typeof v === "string" ? v.toUpperCase() : k === "enum" ? v : convert(v);
    }
    return out;
  };
  const responseSchema = convert(schema);
  const body = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: mediaType, data: image } }, { text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0.2 },
  });
  // Try the chosen model, then Google's current Flash model.
  const models = [Deno.env.get("LABEL_MODEL"), "gemini-flash-latest", "gemini-2.5-flash"].filter(Boolean) as string[];
  let last = { error: "Could not label this photo.", status: 502 };
  for (const model of [...new Set(models)]) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body,
    });
    if (res.status === 404) continue;
    if (res.status === 429) return { error: "Too many photos at once for the free AI. Try again in a minute.", status: 429 };
    if (res.status === 400 || res.status === 403) {
      const detail = await res.json().catch(() => null);
      const msg = detail?.error?.message ?? "";
      if (/API key/i.test(msg)) return { error: "The Gemini API key is not valid.", status: 500 };
      last = { error: `Gemini error: ${msg || res.status}`, status: 502 };
      continue;
    }
    if (!res.ok) {
      last = { error: `Gemini error ${res.status}`, status: 502 };
      continue;
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
    if (!text) return { error: "The AI could not label this photo. Fill it in on the Review page.", status: 422 };
    try {
      return { labels: JSON.parse(text) };
    } catch {
      return { error: "The AI answer could not be read.", status: 502 };
    }
  }
  return last;
}

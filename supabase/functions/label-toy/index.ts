// Supabase Edge Function: label-toy
//
// The staff app sends one toy photo; this asks Claude to name the toy and
// suggest its group (boys, girls or neutral), condition, category and age.
// Everything it suggests is checked by a person on the Review page.
//
// Needs the secret ANTHROPIC_API_KEY (Supabase > Edge Functions > Secrets).
// Optional secret LABEL_MODEL to use a different Claude model.

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

  // Only signed-in staff may use this (it costs money per photo).
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: isStaff } = await supabase.rpc("is_staff");
  if (isStaff !== true) return json({ error: "Staff only." }, 403);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set in Supabase secrets." }, 500);

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
      brand: { type: "string" },
      audience: { type: "string", enum: ["boys", "girls", "neutral"] },
      condition: { type: "string", enum: ["used", "new"] },
      category: { type: "string", enum: categories },
      age_range: { type: "string", enum: AGES },
      description: { type: "string" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["name", "brand", "audience", "condition", "category", "age_range", "description", "confidence"],
    additionalProperties: false,
  };

  const prompt = `You label toys for All Seazons Play, a toy shop in Zambia that sells mostly pre-loved (second-hand) toys and some new ones. Look at the photo and describe the main toy.

- name: what a parent would search for, at most 32 characters, in Title Case. Include the brand or character when you can see it (for example "Barbie Camper Van", "Paw Patrol Chase", "Lego Duplo Train", "Wooden Shape Sorter"). If several pieces are a set, name the set.
- brand: the brand if visible or obvious, else "".
- audience: "girls" or "boys" if the toy is clearly marketed that way in a typical toy shop, otherwise "neutral" (most blocks, puzzles, baby toys, educational and outdoor toys are neutral).
- condition: "new" only if it is sealed or in its original unopened packaging; otherwise "used".
- category: the closest one from the list.
- age_range: the age group it suits best.
- description: one short friendly sentence for parents (no price, no condition claims you cannot see).
- confidence: how sure you are of the name.`;

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
    const labels = JSON.parse(text.text);
    labels.name = String(labels.name ?? "").trim().slice(0, 40) || "Unnamed toy";
    return json({ labels });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Too many photos at once. Try again in a minute." }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "The Anthropic API key is not valid." }, 500);
    if (err instanceof Anthropic.APIError) return json({ error: `Claude error: ${err.message}` }, 502);
    return json({ error: "Could not label this photo." }, 500);
  }
});

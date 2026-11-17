// story-summary: returns the in-app summary for one published story.
// If an auto-collected story has no key points yet, it reads the article once, saves the
// summary to the story (so everyone else gets it instantly via realtime), and returns it.
// Each story is only fetched from its source once; admin-written stories are never touched.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { summarizeStory, hasPoints } from "./summarize.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const rest = (path: string, init: RequestInit = {}) => fetch(`${SB_URL}/rest/v1/${path}`, {
  ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id && req.method === "POST") { try { id = (await req.json()).id ?? ""; } catch { /* none */ } }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bad id" }, 400);

  const r = await rest(`stories?select=id,title,source_url,summary,image_url,auto,status&id=eq.${id}`);
  const s = (r.ok ? await r.json() : [])[0];
  if (!s || s.status !== "published") return json({ error: "not found" }, 404);
  if (!s.auto || hasPoints(s.summary)) return json({ summary: s.summary ?? "", image_url: s.image_url ?? "" });

  // one attempt per story, shared with fetch-news
  const tr = await rest(`settings?select=value&key=eq.summary_tried`);
  const tried: string[] = JSON.parse(((tr.ok ? await tr.json() : [])[0]?.value) || "[]");
  if (tried.includes(id)) return json({ summary: s.summary ?? "", image_url: s.image_url ?? "" });
  tried.push(id);
  await rest("settings?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: "summary_tried", value: JSON.stringify(tried.slice(-500)) }) });

  const res = await summarizeStory(s.source_url, s.title);
  if (!res) return json({ summary: s.summary ?? "", image_url: s.image_url ?? "" });
  const patch: Record<string, string> = { summary: res.text };
  if (!s.image_url && res.image) patch.image_url = res.image;
  await rest(`stories?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
  return json({ summary: res.text, image_url: patch.image_url ?? s.image_url ?? "" });
});

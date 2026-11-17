// fetch-news: collects Johor / Malaysia / Singapore badminton, pickleball and tennis headlines
// (Bing News RSS, with Google News RSS when it answers) and adds new ones to public.stories.
// Each run also:
//   - re-checks recent auto-collected stories against the rules and hides any that fail
//   - hides duplicates (the same story from another outlet), keeping the first one published
//   - writes a short summary + key points for up to 10 stories that don't have them yet
// Runs every 20 minutes (pg_cron) and on demand from the admin app.
// Public calls are throttled to one run per 5 minutes; admins can refresh every 30 seconds.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { tokens, similar, canonicalUrl, clean, summarizeStory, hasPoints } from "./summarize.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

type Cat = "bad" | "pickleball" | "tennis";
const QUERIES: { cat: Cat; q: string }[] = [
  { cat: "bad", q: "badminton Johor" },
  { cat: "bad", q: "badminton Johor Bahru" },
  { cat: "bad", q: "badminton Malaysia" },
  { cat: "bad", q: "Malaysian shuttlers" },
  { cat: "bad", q: "BAM badminton" },
  { cat: "bad", q: "badminton Singapore" },
  { cat: "bad", q: "badminton Kuala Lumpur" },
  { cat: "pickleball", q: "pickleball Johor" },
  { cat: "pickleball", q: "pickleball Malaysia" },
  { cat: "pickleball", q: "pickleball Singapore" },
  { cat: "pickleball", q: "pickleball Kuala Lumpur" },
  { cat: "tennis", q: "tennis Johor" },
  { cat: "tennis", q: "tennis Malaysia" },
  { cat: "tennis", q: "Malaysian tennis player" },
  { cat: "tennis", q: "tennis Singapore" },
];
const SPORT: Record<Cat, RegExp> = {
  bad: /badminton|shuttler|\bBWF\b|\bBAM\b|bulu tangkis/i,
  pickleball: /pickleball/i,
  tennis: /tennis|\bATP\b|\bWTA\b|\bITF\b|Davis Cup|Billie Jean King Cup|tenis/i,
};
const NOT_SPORT: Partial<Record<Cat, RegExp>> = { tennis: /table[ -]tennis|ping[ -]?pong|pingpong|tenis meja|padel/i };
const JOHOR = /johor|\bJB\b|iskandar|muar|batu pahat|kluang|kulai|pasir gudang|skudai|mount austin|segamat|pontian|kota tinggi|nusajaya|medini|tebrau|bukit indah|senai/i;
const LOCAL = /malaysia|malaysian|m['’]sian|johor|\bJB\b|kuala lumpur|\bKL\b|selangor|penang|pulau pinang|perak|kedah|kelantan|terengganu|pahang|negeri sembilan|melaka|malacca|sabah|sarawak|putrajaya|singapore|singaporean|\bSG\b|SEA Games|Sukan SEA|Asean|\bBAM\b|\bMPA\b|Harimau|Lee Zii Jia|Aaron Chia|Soh Wooi Yik|Pearly Tan|Thinaah|Goh Jin Wei|Ng Tze Yong|Leong Jun Hao|Man Wei Chong|Tee Kai Wun|Loh Kean Yew|Chen Tang Jie|Toh Ee Wei|Goh Soon Huat|Lai Shevon|Wee Kiong|Sze Fei|Izzuddin/i;
const LOCAL_SOURCE = /star|malay mail|new straits|\bNST\b|bernama|thesun|the sun|berita harian|harian metro|free malaysia today|\bFMT\b|malaysiakini|sinar|utusan|kosmo|astro|stadium|says|rakyat post|\bRTM\b|sin chew|china press|oriental daily|kwong wah|the edge|malaysia gazette|twentytwo13|scoop|vibes|mstar|straits times|\bCNA\b|channel newsasia|asiaone|mothership|today online|yahoo news singapore|yahoo malaysia|8world|zaobao|lianhe|nanyang/i;
const BLOCK = /police|arrest|court|lawsuit|sued|abuse|assault|threat|barricad|scandal|explicit|outburst|divorce|girlfriend|boyfriend|dating|affair|nude|sex|drug|doping|died|dies|death|killed|murder|crash|gambl|betting|match[- ]fixing|bikini|racist|slur/i;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// One rulebook, used for new stories and for re-checking old ones
function verdict(cat: string, title: string, source: string): string {
  const c = (cat in SPORT ? cat : "bad") as Cat;
  if (!title) return "empty";
  if (!SPORT[c].test(title)) return "off-sport";
  if (NOT_SPORT[c]?.test(title)) return "other sport";
  if (BLOCK.test(title)) return "not friendly";
  if (!(LOCAL.test(title) || LOCAL_SOURCE.test(source))) return "not local";
  return "";
}

async function rest(path: string, init: RequestInit = {}) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}
async function callerIsAdmin(auth: string): Promise<boolean> {
  if (!auth || !ANON || auth === `Bearer ${ANON}`) return false;
  const r = await fetch(`${SB_URL}/rest/v1/rpc/is_admin`, { method: "POST", headers: { apikey: ANON, Authorization: auth, "Content-Type": "application/json" }, body: "{}" });
  return r.ok && (await r.json()) === true;
}
async function setting(k: string): Promise<string | null> {
  const r = await rest(`settings?select=value&key=eq.${encodeURIComponent(k)}`);
  const rows = r.ok ? await r.json() : [];
  return rows[0]?.value ?? null;
}
async function putSetting(k: string, v: string) {
  await rest("settings?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: k, value: v }) });
}

type Item = { cat: Cat; title: string; link: string; source: string; at: Date; johor: boolean; desc: string };
type Diag = { feed: string; q: string; status: number; items: number; kept: number; dropped?: string[] };
type Row = { id: string; title: string; source: string; source_url: string; cat: string; status: string; auto: boolean; is_lead: boolean; summary: string; image_url: string; news_at: string; created_at: string };

function parseItems(xml: string, cat: Cat, kind: "google" | "bing"): { all: number; kept: Item[]; dropped: string[] } {
  const chunks = xml.split(/<item>|<item [^>]*>/).slice(1);
  const kept: Item[] = []; const dropped: string[] = [];
  for (const chunk of chunks) {
    const get = (tag: string) => { const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(chunk); return m ? clean(m[1]) : ""; };
    let title = get("title");
    let link = get("link");
    let source = kind === "google" ? get("source") : (get("News:Source") || get("news:source"));
    if (kind === "bing") {
      try { const u = new URL(link); const real = u.searchParams.get("url"); if (real) link = real; } catch { /* keep */ }
      if (!source) { try { source = new URL(link).hostname.replace(/^www\./, ""); } catch { /* none */ } }
    }
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3)).trim();
    const at = new Date(get("pubDate") || Date.now());
    let why = !link ? "empty" : verdict(cat, title, source);
    if (!why && (isNaN(at.getTime()) || Date.now() - at.getTime() > 7 * 864e5)) why = "old";
    if (why) { if (dropped.length < 4 && title) dropped.push(`${why}: ${title.slice(0, 60)}`); continue; }
    let desc = kind === "bing" ? get("description") : "";
    if (desc.length < 60 || similar(tokens(desc), tokens(title))) desc = "";
    kept.push({ cat, title: title.slice(0, 200), link, source: source.slice(0, 80), at, johor: JOHOR.test(title), desc: desc.slice(0, 400) });
  }
  return { all: chunks.length, kept, dropped };
}

async function readFeed(kind: "google" | "bing", cat: Cat, q: string, diag: Diag[]): Promise<Item[]> {
  const url = kind === "google"
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:7d")}&hl=en-MY&gl=MY&ceid=MY:en`
    : `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=en-MY&cc=MY&qft=interval%3d%228%22`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml", "Accept-Language": "en-MY,en;q=0.9" } });
    const xml = await r.text();
    const { all, kept, dropped } = r.ok ? parseItems(xml, cat, kind) : { all: 0, kept: [], dropped: [] };
    diag.push({ feed: kind, q, status: r.status, items: all, kept: kept.length, dropped });
    return kept;
  } catch (e) {
    diag.push({ feed: kind, q, status: 0, items: 0, kept: 0, dropped: [String(e).slice(0, 80)] });
    return [];
  } finally { clearTimeout(t); }
}

async function hide(ids: string[]) {
  for (let i = 0; i < ids.length; i += 80) {
    await rest(`stories?id=in.(${ids.slice(i, i + 80).join(",")})`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "skipped" }) });
  }
}

// Write summaries + key points for stories that don't have them yet
async function enrich(limit: number): Promise<number> {
  const tried: string[] = JSON.parse((await setting("summary_tried")) || "[]");
  const triedSet = new Set(tried);
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const r = await rest(`stories?select=id,title,source_url,summary,image_url&status=eq.published&auto=eq.true&news_at=gte.${encodeURIComponent(since)}&order=news_at.desc&limit=80`);
  const rows: Row[] = r.ok ? await r.json() : [];
  const todo = rows.filter((s) => !hasPoints(s.summary) && !triedSet.has(s.id)).slice(0, limit);
  let done = 0;
  const work = async (s: Row) => {
    const res = await summarizeStory(s.source_url, s.title);
    tried.push(s.id);
    if (!res) return;
    const patch: Record<string, string> = { summary: res.text };
    if (!s.image_url && res.image) patch.image_url = res.image;
    const u = await rest(`stories?id=eq.${s.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
    if (u.ok) done++;
  };
  for (let i = 0; i < todo.length; i += 4) await Promise.all(todo.slice(i, i + 4).map(work));
  if (todo.length) await putSetting("summary_tried", JSON.stringify(tried.slice(-500)));
  return done;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const admin = await callerIsAdmin(req.headers.get("Authorization") ?? "");
  const debug = url.searchParams.get("debug") === "1";

  const last = Number((await setting("news_last_run")) ?? 0);
  const gap = Date.now() - last;
  const minGap = admin || debug ? 30_000 : 5 * 60_000;
  if (gap < minGap) return json({ skipped: true, reason: "ran recently", next_in_s: Math.ceil((minGap - gap) / 1000) });
  await putSetting("news_last_run", String(Date.now()));

  const autoPublish = ((await setting("auto_publish")) ?? "true") !== "false";
  const since = new Date(Date.now() - 21 * 864e5).toISOString();
  const er = await rest(`stories?select=id,title,source,source_url,cat,status,auto,is_lead,summary,image_url,news_at,created_at&news_at=gte.${encodeURIComponent(since)}&order=created_at.asc&limit=3000`);
  const existing: Row[] = er.ok ? await er.json() : [];

  // 1) Re-check auto-collected stories that are still showing, and hide those that break the rules
  const bad = new Set(existing.filter((s) => s.auto && !s.is_lead && s.status !== "skipped" && verdict(s.cat, s.title, s.source)).map((s) => s.id));

  // 2) Hide duplicates among what's showing: keep admin stories, the lead, then whichever was published first
  const showing = existing.filter((s) => s.status !== "skipped" && !bad.has(s.id))
    .sort((a, b) => (Number(b.auto === false) - Number(a.auto === false)) || (Number(b.is_lead) - Number(a.is_lead)) || (a.created_at < b.created_at ? -1 : 1));
  // same story = same link, or a near-identical headline within 3 days of each other
  const near = (a: number, b: number) => Math.abs(a - b) <= 3 * 864e5;
  const keep: { t: Set<string>; u: string; at: number }[] = [];
  const dupes: string[] = [];
  for (const s of showing) {
    const t = tokens(s.title), u = canonicalUrl(s.source_url), at = new Date(s.news_at || s.created_at).getTime();
    const dup = keep.some((k) => (u && k.u === u) || (near(k.at, at) && similar(k.t, t)));
    if (dup && s.auto && !s.is_lead) { dupes.push(s.id); continue; }
    keep.push({ t, u, at });
  }
  await hide([...bad, ...dupes]);

  // 3) Collect new ones, skipping anything we already have (any status) or that repeats another new item
  const seenUrl = new Set(existing.map((e) => canonicalUrl(e.source_url)).filter(Boolean));
  const seenTok = existing.map((e) => ({ t: tokens(e.title), at: new Date(e.news_at || e.created_at).getTime() }));
  const diag: Diag[] = [];
  const lists = await Promise.all(QUERIES.flatMap((x) => [readFeed("bing", x.cat, x.q, diag), readFeed("google", x.cat, x.q, diag)]));
  const all = lists.flat().sort((a, b) => (Number(b.johor) - Number(a.johor)) || (b.at.getTime() - a.at.getTime()));
  const fresh: Item[] = [];
  for (const it of all) {
    const u = canonicalUrl(it.link), t = tokens(it.title);
    if (seenUrl.has(u) || seenTok.some((x) => near(x.at, it.at.getTime()) && similar(x.t, t))) continue;
    seenUrl.add(u); seenTok.push({ t, at: it.at.getTime() });
    fresh.push(it);
  }
  const batch = fresh.slice(0, 40);

  let inserted = 0;
  const errors: string[] = [];
  const feedLines: { cat: string; text: string }[] = [];
  for (const it of batch) {
    const r = await rest("stories", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        cat: it.cat, title: it.title, summary: it.desc, source: it.source || "News", source_url: it.link,
        show_to: "Everyone", status: autoPublish ? "published" : "pending", auto: true, is_johor: it.johor,
        news_at: it.at.toISOString(),
      }),
    });
    if (r.ok) {
      inserted++;
      if (it.johor && autoPublish && feedLines.length < 3) feedLines.push({ cat: it.cat, text: `Johor: ${it.title}`.slice(0, 200) });
    } else if (errors.length < 3) errors.push((await r.text()).slice(0, 160));
  }
  if (feedLines.length) await rest("feed", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(feedLines) });

  // 4) Summaries + key points for the newest stories that lack them
  const summarized = await enrich(admin || debug ? 14 : 10);

  // 5) Tidy: drop auto stories older than 45 days that aren't the lead
  const old = new Date(Date.now() - 45 * 864e5).toISOString();
  await rest(`stories?auto=eq.true&is_lead=eq.false&news_at=lt.${encodeURIComponent(old)}`, { method: "DELETE" });

  const out: Record<string, unknown> = { ok: true, hidden: bad.size, duplicates: dupes.length, found: all.length, new: fresh.length, inserted, summarized, auto_publish: autoPublish, admin };
  if (debug) { out.diag = diag.filter((d) => d.feed === "bing"); out.google = diag.filter((d) => d.feed === "google").map((d) => d.status); out.errors = errors; }
  return json(out);
});

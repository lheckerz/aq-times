// Shared by fetch-news and story-summary.
// 1) Duplicate detection for headlines (same story from different outlets).
// 2) Short extractive summary + key points from a news article page, credited to its source.
//    Stored in stories.summary as: lead paragraph, blank line, then "• point" lines.

const STOP = new Set(("a an and are as at be been but by for from has have he her his in into is it its of on or our "
  + "over she so than that the their them they this to up was were will with after before about against amid "
  + "says said say new news latest today vs v how why what who when where which win wins won beat beats into "
  + "out off more most first second final finals open title round match matches game games set sets").split(" "));

export function tokens(title: string): Set<string> {
  const out = new Set<string>();
  for (let w of (title || "").toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/)) {
    if (!w || STOP.has(w)) continue;
    if (w.length < 3 && !/\d/.test(w)) continue;
    if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    out.add(w);
  }
  return out;
}

export function similar(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const min = Math.min(a.size, b.size);
  const union = a.size + b.size - inter;
  return (min >= 3 && inter / min >= 0.7) || inter / union >= 0.5;
}

export function canonicalUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ocid|cmp|ref|src)/i.test(k)) x.searchParams.delete(k);
    return (x.hostname.replace(/^(www|m|amp)\./, "") + x.pathname.replace(/\/amp\/?$/, "").replace(/\/$/, "") + (x.search || "")).toLowerCase();
  } catch { return (u || "").toLowerCase(); }
}

const ENT: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };
export const clean = (s: string) => (s || "")
  .replace(/<!\[CDATA\[|\]\]>/g, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
  .replace(/\s+/g, " ").trim();

const BOILER = /subscribe|sign ?up|newsletter|cookie|copyright|all rights reserved|advertis|follow us|download (the|our)|whatsapp channel|telegram channel|join our|read more|click here|terms of (use|service)|privacy policy|©|log ?in|register now|share this|related (stories|articles)|also read|you may also like|comments? (are|is) closed|photo:|pic:|image:|file pic|getty images|reuters photo/i;

function meta(html: string, key: string): string {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0] ?? "";
  return clean(/content=(["'])([\s\S]*?)\1/i.exec(tag)?.[2] ?? "");
}

function shorten(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).replace(/[,;:\-–— ]+$/, "") + "…";
}

const ABBR = /(?:\b(?:No|Nos|Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|Datuk|Dato|Tan Sri|Prof|Capt|Lt|Gen|Sgt|Inc|Ltd|Bhd|Sdn|U\.S|e\.g|i\.e)|\b[A-Z])\.$/;
const quotes = (s: string) => (s.match(/["“”]/g) || []).length;
function sentences(p: string): string[] {
  const parts = p.split(/(?<=[.!?]["”’)]?)\s+(?=["“‘(]?[A-Z0-9])/);
  const out: string[] = [];
  let cur = "";
  for (const part of parts) {
    cur = cur ? cur + " " + part : part;
    if (ABBR.test(cur) || quotes(cur) % 2 === 1) continue; // keep "No. 9" and quoted speech together
    out.push(cur.trim()); cur = "";
  }
  if (cur) out.push(cur.trim());
  return out.filter((s) => s.length >= 40);
}

export type Summary = { text: string; image: string };

export function summarizeHtml(html: string, title: string): Summary | null {
  const ogDesc = meta(html, "og:description") || meta(html, "description") || meta(html, "twitter:description");
  let image = meta(html, "og:image") || meta(html, "twitter:image");
  if (image && !/^https:\/\//i.test(image)) image = "";

  let body = html.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|figure|figcaption|iframe|button)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const arts = body.match(/<article[\s\S]*?<\/article>/gi);
  if (arts && arts.length) body = arts.sort((a, b) => b.length - a.length)[0];

  const seen = new Set<string>();
  const paras: string[] = [];
  for (const m of body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const t = clean(m[1]);
    if (t.length < 60 || t.length > 900 || BOILER.test(t) || seen.has(t)) continue;
    seen.add(t); paras.push(t);
    if (paras.length >= 30) break;
  }
  if (paras.length < 2 && ogDesc.length < 60) return null;

  // lead: publisher's own description when it is a real sentence, else the opening of the article
  const titleT = tokens(title);
  let lead = ogDesc.length >= 60 && !BOILER.test(ogDesc) ? ogDesc : sentences(paras[0] || "").slice(0, 2).join(" ");
  lead = shorten(lead, 300);

  // key points: score sentences by how central their words are, favour facts (numbers, names)
  const sents: { s: string; i: number; score: number }[] = [];
  const freq = new Map<string, number>();
  const all: string[] = [];
  paras.forEach((p) => sentences(p).forEach((s) => all.push(s)));
  for (const s of all) for (const w of tokens(s)) freq.set(w, (freq.get(w) ?? 0) + 1);
  all.forEach((s, i) => {
    const ws = [...tokens(s)];
    if (ws.length < 5) return;
    let score = ws.reduce((t, w) => t + (freq.get(w) ?? 0), 0) / Math.pow(ws.length, 0.6);
    if (/\d/.test(s)) score *= 1.25;
    if (ws.some((w) => titleT.has(w))) score *= 1.3;
    if (i < 6) score *= 1.15;
    if (/^["“]/.test(s) && s.length > 160) score *= 0.7; // long quotes read badly out of context
    sents.push({ s, i, score });
  });
  const leadT = tokens(lead);
  const picked: typeof sents = [];
  for (const c of sents.sort((a, b) => b.score - a.score)) {
    const t = tokens(c.s);
    if (similar(t, leadT) || picked.some((p) => similar(tokens(p.s), t))) continue;
    picked.push(c);
    if (picked.length >= 4) break;
  }
  const points = picked.sort((a, b) => a.i - b.i).map((p) => shorten(p.s, 200));
  if (!lead && !points.length) return null;
  const text = [lead, points.map((p) => "• " + p).join("\n")].filter(Boolean).join("\n\n");
  return { text, image };
}

const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

export async function summarizeUrl(url: string, title: string): Promise<Summary | null> {
  if (!/^https:\/\//i.test(url || "")) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-MY,en;q=0.9" } });
    if (!r.ok || !/html/i.test(r.headers.get("content-type") ?? "")) return null;
    const html = (await r.text()).slice(0, 1_500_000);
    return summarizeHtml(html, title);
  } catch { return null; } finally { clearTimeout(t); }
}

// A summary is "full" once it carries key points; admin-written stories are always left alone.
export const hasPoints = (s: string) => /(^|\n)• /.test(s || "");

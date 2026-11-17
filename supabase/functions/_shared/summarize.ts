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
  .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "")
  .replace(/\s+/g, " ")
  .replace(/ ([.,;:!?)])/g, "$1")
  .trim();

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

  const page = html.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|figure|figcaption|iframe|button)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const grab = (body: string) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
      const t = clean(m[1]);
      if (t.length < 60 || t.length > 900 || BOILER.test(t) || seen.has(t)) continue;
      seen.add(t); out.push(t);
      if (out.length >= 30) break;
    }
    return out;
  };
  // the article box when it holds the story, otherwise the whole page
  const arts = page.match(/<article[\s\S]*?<\/article>/gi);
  let paras = arts && arts.length ? grab(arts.sort((a, b) => b.length - a.length)[0]) : [];
  if (paras.length < 3) paras = grab(page);
  if (paras.length < 2 && ogDesc.length < 60) return null;

  // lead: publisher's own description when it is a real sentence, else the opening of the article
  const titleT = tokens(title);
  const opening = sentences(paras[0] || "").slice(0, 2).join(" ");
  const descOk = ogDesc.length >= 60 && !BOILER.test(ogDesc) && !(/(\.\.\.|…)$/.test(ogDesc) && opening.length >= 60);
  let lead = descOk ? ogDesc : opening || ogDesc;
  lead = shorten(lead, 260);

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
    if (/^["“]/.test(s) && !/\b(said|says|added|told)\b/i.test(s)) return; // a bare quote reads badly out of context
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
  const points = picked.sort((a, b) => a.i - b.i).map((p) => shorten(p.s, 170));
  if (!lead && !points.length) return null;
  // stories.summary holds at most 800 characters: drop the weakest-placed points until it fits
  const build = () => [lead, points.map((p) => "• " + p).join("\n")].filter(Boolean).join("\n\n");
  let text = build();
  while (text.length > 790 && points.length > 1) { points.pop(); text = build(); }
  text = text.slice(0, 790);
  return { text, image };
}

// Bing serves its RSS to desktop browsers; phone browsers get a different page
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

export async function summarizeUrl(url: string, title: string, log?: string[]): Promise<Summary | null> {
  if (!/^https:\/\//i.test(url || "")) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-MY,en;q=0.9" } });
    if (!r.ok || !/html/i.test(r.headers.get("content-type") ?? "")) { log?.push(`page ${r.status}`); return null; }
    const html = (await r.text()).slice(0, 1_500_000);
    const res = summarizeHtml(html, title);
    log?.push(res ? "page ok" : `page unreadable (${html.length}b)`);
    return res;
  } catch (e) { log?.push(`page error ${String(e).slice(0, 40)}`); return null; } finally { clearTimeout(t); }
}

// Find this headline on Bing News: gives the real article link (for Google News redirect links)
// and the search snippet (fallback summary when the article page can't be read)
export async function bingLookup(title: string): Promise<{ link: string; desc: string } | null> {
  const want = tokens(title);
  for (const q of [`"${title.slice(0, 110)}"`, title.slice(0, 140)]) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=en-MY&cc=MY`, { signal: ctrl.signal, headers: { "User-Agent": DESKTOP_UA, Accept: "application/rss+xml, text/xml" } });
      if (!r.ok) continue;
      for (const chunk of (await r.text()).split(/<item>|<item [^>]*>/).slice(1)) {
        const get = (tag: string) => clean(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(chunk)?.[1] ?? "");
        if (!similar(tokens(get("title")), want)) continue;
        let link = get("link");
        try { const real = new URL(link).searchParams.get("url"); if (real) link = real; } catch { link = ""; }
        let desc = get("description");
        if (desc.length < 60) desc = "";
        return { link: /^https:\/\//i.test(link) && !/bing\.com|google\./i.test(link) ? link : "", desc };
      }
    } catch { /* try next */ } finally { clearTimeout(t); }
  }
  return null;
}

export const isRedirectLink = (u: string) => /^https?:\/\/news\.google\.com\//i.test(u || "");

// Page summary first, then the search snippet (summary only, no key points).
// `url` is set when the real article address was found for a redirect link.
export async function summarizeStory(url: string, title: string, log?: string[]): Promise<(Summary & { url?: string }) | null> {
  let target = url;
  let hit: { link: string; desc: string } | null = null;
  if (isRedirectLink(url)) { hit = await bingLookup(title); target = hit?.link ?? ""; log?.push(hit ? `bing ${hit.link ? "link" : "no-link"}` : "bing miss"); }
  const found = target && target !== url ? target : undefined;
  const page = target ? await summarizeUrl(target, title, log) : null;
  if (page) return { ...page, url: found };
  if (!hit) { hit = await bingLookup(title); log?.push(hit ? `bing ${hit.desc ? "snippet" : "no-snippet"}` : "bing miss"); }
  return hit?.desc ? { text: shorten(hit.desc, 400), image: "", url: found ?? (hit.link || undefined) } : null;
}

// A summary is "full" once it carries key points; admin-written stories are always left alone.
export const hasPoints = (s: string) => /(^|\n)• /.test(s || "");

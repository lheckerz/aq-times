// The AQ Times — server-rendered pages for search engines and AI crawlers.
// Google's first pass and most AI crawlers (ChatGPT, Claude, Perplexity) don't run JavaScript,
// so every public page is rendered here as plain HTML with structured data, then the app
// takes over in the browser. Also serves sitemap.xml, feed.xml (RSS) and llms.txt.
// Cached at the edge for 2 minutes and served stale while refreshing, so it stays fast.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SITE = 'https://aqtimes.news';
const DB = 'https://phucvubabltiicbyynxj.supabase.co/rest/v1/';
const KEY = 'sb_publishable_xKWRbMXn5vKRTHiN0g8HkQ_SiP2bZjM'; // public read-only key (row level security applies)
const TZ = 'Asia/Kuala_Lumpur';
const SPORTS = {
  badminton: { cat: 'bad', name: 'Badminton', blurb: 'Badminton news from Johor, Malaysia and Singapore: BAM, BWF tour results, Malaysian shuttlers and local clubs.' },
  pickleball: { cat: 'pickleball', name: 'Pickleball', blurb: 'Pickleball news from Johor, Malaysia and Singapore: tournaments, courts, clubs and the Malaysia Pickleball Association.' },
  tennis: { cat: 'tennis', name: 'Tennis', blurb: 'Tennis news for Malaysian and Singaporean fans: local players, ATP and WTA results and events in the region.' },
};
const SLUG_OF = { bad: 'badminton', pickleball: 'pickleball', tennis: 'tennis' };
const ORG = {
  '@type': 'NewsMediaOrganization',
  '@id': SITE + '/#org',
  name: 'The AQ Times',
  url: SITE + '/',
  logo: { '@type': 'ImageObject', url: SITE + '/icon-512.png', width: 512, height: 512 },
  description: 'The notice board and sports news page of the AQ Smash community in Johor Bahru, Malaysia.',
  areaServed: [{ '@type': 'City', name: 'Johor Bahru' }, { '@type': 'State', name: 'Johor' }, { '@type': 'Country', name: 'Malaysia' }],
  parentOrganization: { '@id': SITE + '/#aqsmash' },
  knowsAbout: ['Badminton', 'Pickleball', 'Tennis', 'Johor Bahru sports', 'Malaysian badminton'],
  contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', telephone: '+60185959588', areaServed: 'MY', availableLanguage: ['en', 'ms', 'zh'] },
};
const AQSMASH = {
  '@type': 'SportsOrganization', '@id': SITE + '/#aqsmash', name: 'AQ Smash', url: 'https://aqsmash.com/', sameAs: ['https://aqsmash.com/'],
  sport: ['Badminton', 'Pickleball', 'Tennis'], description: 'Racket sports community, events and retail in Johor Bahru, Malaysia, home of the AmpQuartz Badminton Club.',
  location: { '@type': 'Place', name: 'Mount Austin, Johor Bahru', address: { '@type': 'PostalAddress', addressLocality: 'Johor Bahru', addressRegion: 'Johor', addressCountry: 'MY' } },
};
const WA = '60185959588';
const waLink = (msg) => `https://wa.me/${WA}?text=${encodeURIComponent(msg)}`;
const VENUES = ['Austin Sports Hub', 'Tiara Sports', 'Bubble Sports', 'Rally 7'];
// questions people (and AI assistants) ask; shown on the page and marked up as FAQPage
const FAQ = {
  about: [
    ['What is The AQ Times?', 'The AQ Times (aqtimes.news) is the free notice board and sports news page of the AQ Smash community in Johor Bahru, Malaysia. It shows official AQ Smash announcements plus badminton, pickleball and tennis news from Johor, Malaysia and Singapore, updated through the day with Johor stories first.'],
    ['Who runs The AQ Times?', 'The AQ Times is published for the AQ Smash community. AQ Smash announcements are written by the AQ Smash team; news items are short summaries with the original outlet credited on each story.'],
    ['How often is The AQ Times updated?', 'News is collected automatically several times an hour. AQ Smash announcements appear the moment the team posts them, and the app shows new stories live without refreshing.'],
    ['What is AQ Smash?', 'AQ Smash is a racket sports community, events and retail brand in Johor Bahru, Malaysia, home of the AmpQuartz Badminton Club, with its flagship at Mount Austin.'],
    ['How do I join AQ Smash or the AmpQuartz Badminton Club?', 'Message AQ Smash on WhatsApp at +60 18-595 9588. The team will share session times, membership and upcoming events.'],
    ['Can I install The AQ Times as an app?', 'Yes. Open aqtimes.news on your phone and choose "Add to Home Screen" (iPhone) or "Install app" (Android). It works like an app and is free.'],
  ],
  badminton: [
    ['Where can I play badminton in Johor Bahru?', `The AmpQuartz Badminton Club, part of AQ Smash, runs social badminton sessions in Johor Bahru at ${VENUES.slice(0, -1).join(', ')} and ${VENUES.at(-1)}. Message AQ Smash on WhatsApp at +60 18-595 9588 for session times.`],
    ['Where can I find the latest Malaysian badminton news?', 'The AQ Times badminton page collects Malaysian, Johor and Singapore badminton news through the day, including BAM, BWF World Tour results and Malaysian shuttlers, with a short summary and key points for each story.'],
    ['Is there a badminton community in Johor Bahru I can join?', 'Yes. AQ Smash and the AmpQuartz Badminton Club welcome players of all levels in Johor Bahru, from family and recreational players to competitive players. Message +60 18-595 9588 on WhatsApp to join.'],
  ],
  pickleball: [
    ['Where can I find pickleball news in Malaysia?', 'The AQ Times pickleball page collects pickleball news from Johor, Malaysia and Singapore, including tournaments, new courts, clubs and the Malaysia Pickleball Association, with summaries and key points.'],
    ['How do I find pickleball players in Johor Bahru?', 'Message the AQ Smash community on WhatsApp at +60 18-595 9588. AQ Smash is growing its racket sports community in Johor Bahru beyond badminton into pickleball and tennis.'],
  ],
  tennis: [
    ['Where can I follow tennis news for Malaysian fans?', 'The AQ Times tennis page collects tennis news relevant to Malaysia and Singapore, including local players, ATP and WTA results and events in the region, with summaries and key points.'],
    ['Is there a tennis community in Johor Bahru?', 'AQ Smash is growing its racket sports community in Johor Bahru into tennis. Message +60 18-595 9588 on WhatsApp to hear about sessions and events.'],
  ],
};
const faqLd = (list) => ({ '@type': 'FAQPage', mainEntity: list.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
const faqHtml = (list, heading = 'Questions people ask') => `<section class="seo-faq"><h2 class="seo-h2">${esc(heading)}</h2>${list.map(([q, a]) => `<details><summary><h3>${esc(q)}</h3></summary><p>${esc(a)}</p></details>`).join('')}</section>`;

// ---------- helpers ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const xml = (v) => String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const day = (d) => new Date(d).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const longDate = () => new Date().toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
const slugify = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'update';
const updateUrl = (a) => `${SITE}/updates/${slugify(a.title)}-${a.id}`;
const sportSlug = (cat) => SLUG_OF[cat] || 'badminton';
const storyPath = (s) => `/news/${sportSlug(s.cat)}/${slugify(s.title)}-${s.id}`;
const storyUrl = (s) => SITE + storyPath(s);
const lines = (summary) => String(summary || '').split('\n').map((l) => l.trim()).filter(Boolean);
const lead = (summary) => (lines(summary).find((l) => !/^[•\-*]\s/.test(l)) || '');
const points = (summary) => lines(summary).filter((l) => /^[•\-*]\s/.test(l)).map((l) => l.replace(/^[•\-*]\s+/, ''));
const paras = (summary) => lines(summary).filter((l) => !/^[•\-*]\s/.test(l));
// only stories with a real summary get indexed; the rest stay reachable but noindex
const indexable = (s) => lead(s.summary).length >= 80;
const sportName = (cat) => (SPORTS[sportSlug(cat)] || SPORTS.badminton).name;
const iso = (d) => new Date(d).toISOString();// first sentence (not fooled by "No. 9", "Dr." or "U.S."), trimmed at a word boundary
const firstSentence = (t, max = 160) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  const m = /^(.{40,}?(?<!\b(?:No|Nos|Mr|Mrs|Ms|Dr|St|Jr|vs|Datuk|Dato|[A-Z]))[.!?])\s/.exec(s);
  const out = m ? m[1] : s;
  return out.length > max ? out.slice(0, max - 1).replace(/\s\S*$/, '') + '…' : out;
};

async function db(path) {
  const r = await fetch(DB + path, { headers: { apikey: KEY, Accept: 'application/json' } });
  if (!r.ok) throw new Error('db ' + r.status);
  return r.json();
}
// same duplicate filter as the app
const STOP = new Set('a an and are as at be been but by for from has have he her his in into is it its of on or our over she so than that the their them they this to up was were will with after before about against amid says said say new news latest today vs v how why what who when where which win wins won beat beats out off more most first second final finals open title round match matches game games set sets'.split(' '));
function tokens(t) { const o = new Set(); for (let w of String(t || '').toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/)) { if (!w || STOP.has(w) || (w.length < 3 && !/\d/.test(w))) continue; if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1); o.add(w); } return o; }
function similar(a, b) { if (!a.size || !b.size) return false; let i = 0; for (const w of a) if (b.has(w)) i++; const m = Math.min(a.size, b.size); return (m >= 3 && i / m >= 0.7) || i / (a.size + b.size - i) >= 0.5; }
function dedupe(list) { const kept = []; for (const s of list) { const t = tokens(s.title), at = new Date(s.news_at || s.created_at).getTime(); if (kept.some((k) => k.s.source_url === s.source_url || (Math.abs(k.at - at) <= 3 * 864e5 && similar(k.t, t)))) continue; kept.push({ s, t, at }); } return kept.map((k) => k.s); }

const stories = async (cat, limit = 60) => dedupe(await db(`stories?select=id,cat,title,summary,source,news_at,created_at,is_johor,image_url,source_url&status=eq.published&cat=${cat ? 'eq.' + cat : 'in.(bad,pickleball,tennis)'}&order=news_at.desc&limit=${limit}`));
const updates = async (limit = 50) => db(`announcements?select=id,tag,title,body,place,cta_label,cta_action,cta_target,img_url,featured,created_at,updated_at&live=eq.true&show_to=eq.Everyone&order=created_at.desc&limit=${limit}`);

function ctaHref(a) {
  const t = String(a.cta_target || '').trim();
  if (a.cta_action === 'whatsapp') { const d = t.replace(/[^\d]/g, ''); return d ? `https://wa.me/${d}?text=${encodeURIComponent(`Hi AQ Smash! I saw "${a.title}" on The AQ Times.`)}` : ''; }
  if ((a.cta_action === 'link' || a.cta_action === 'form') && t) return /^https?:\/\//i.test(t) ? t : 'https://' + t;
  return '';
}

// ---------- page shell for the standalone pages ----------
const NAV = [['/', 'Today'], ['/news/badminton', 'Badminton'], ['/news/pickleball', 'Pickleball'], ['/news/tennis', 'Tennis'], ['/updates', 'AQ Smash'], ['/about', 'About']];
const INDEX = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
// every page ends with a way into the community: search visitor -> AQ Smash member
const joinBox = (msg = 'Hi AQ Smash! I found you on The AQ Times and would like to join.') => `<aside class="seo-join"><b>Play with the AQ Smash community</b><p>Social badminton sessions in Johor Bahru at ${esc(VENUES.join(', '))}, run by the AmpQuartz Badminton Club. Growing into pickleball and tennis too.</p><a class="btn" href="${esc(waLink(msg))}" rel="noopener">Join on WhatsApp</a></aside>`;
function page({ title, desc, path, body, json, robots = INDEX, image, type = 'website', published, modified, section }) {
  const url = SITE + path;
  return `<!doctype html>
<html lang="en-MY">
<head>
<meta charset="utf-8">
<!-- Google Tag Manager (GA4 is configured inside the container) -->
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  dataLayer.push({'gtm.start': new Date().getTime(), event: 'gtm.js'});
</script>
<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-5258VZTL"></script>
<!-- End Google Tag Manager -->
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="${robots}">
<meta name="google-site-verification" content="UZJSIST-V1k7BvRyuqtWC33ZhHr2SMKAnRGZxHd-6U4" />
<link rel="canonical" href="${esc(url)}">
<meta name="theme-color" content="#12263F">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="The AQ Times">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image || SITE + '/share.png')}">
<meta property="og:locale" content="en_MY">
${published ? `<meta property="article:published_time" content="${esc(published)}">\n<meta property="article:modified_time" content="${esc(modified || published)}">\n` : ''}${section ? `<meta property="article:section" content="${esc(section)}">\n` : ''}<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="geo.region" content="MY-01">
<meta name="geo.placename" content="Johor Bahru">
<link rel="alternate" type="text/plain" title="LLM summary" href="${SITE}/llms.txt">
<link rel="alternate" type="application/rss+xml" title="The AQ Times" href="${SITE}/feed.xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,600;0,700;0,800;0,900;1,800;1,900&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/styles.css">
${(json || []).map(ld).join('\n')}
</head>
<body>
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-5258VZTL" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<div class="app seo-page">
  <main class="scroll">
    <header class="mast">
      <div class="mast-top"><span>FOR THE AQ SPORTS COMMUNITY</span><span>${esc(longDate())}</span></div>
      <a href="/" class="wordmark" aria-label="The AQ Times home" style="text-decoration:none;color:inherit"><span class="the">THE</span><span class="aq">AQ</span><span class="slice">TIMES</span></a>
      <div class="rule"></div>
      <nav class="seo-nav" aria-label="Sections">${NAV.map(([h, l]) => `<a href="${h}"${path === h ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    </header>
    <div class="pad">${body}${joinBox()}</div>
    <footer class="seo-foot">
      <p><b>The AQ Times</b> is the notice board and sports news page of the AQ Smash community in Johor Bahru, Malaysia. News updates automatically through the day; AQ Smash announcements are posted by the AQ Smash team.</p>
      <p><a href="/">Open the app</a> · <a href="/updates">AQ Smash updates</a> · <a href="/news">All sports news</a> · <a href="/about">About &amp; FAQ</a> · <a href="/feed.xml">RSS</a></p>
    </footer>
  </main>
</div>
</body>
</html>`;
}

const label = (t, sq = '') => `<div class="label"><span class="sq ${sq}"></span><span>${esc(t)}</span><span class="ln"></span></div>`;
const storyItem = (s, h = 'h3') => {
  const l = lead(s.summary);
  return `<article class="story"><span class="chip-row"><span class="ctag">${esc(sportName(s.cat).toUpperCase())}</span>${s.is_johor ? '<span class="jb">JOHOR</span>' : ''}</span>
  <a class="h" href="${esc(storyPath(s))}" data-act="story:${esc(s.id)}"><${h}>${esc(s.title)}</${h}></a>${l ? `<p class="teaser">${esc(firstSentence(l, 220))}</p>` : ''}
  <div class="src"><span>${esc(s.source || 'News')}</span><span class="ago"><time datetime="${esc(new Date(s.news_at || s.created_at).toISOString())}">${esc(day(s.news_at || s.created_at))}</time></span></div></article>`;
};
const updateItem = (a) => `<article class="story"><span class="chip-row"><span class="ctag" style="background:#43A055;color:#12263F">${esc(a.tag || 'UPDATE')}</span></span>
  <a class="h" href="${esc(updateUrl(a).replace(SITE, ''))}"><h3>${esc(a.title)}</h3></a><p class="teaser">${esc(firstSentence(a.body, 200))}</p>
  <div class="src"><span>AQ Smash${a.place ? ' · ' + esc(a.place) : ''}</span><span class="ago"><time datetime="${esc(new Date(a.created_at).toISOString())}">${esc(day(a.created_at))}</time></span></div></article>`;
const crumbs = (items) => ({ '@type': 'BreadcrumbList', itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + path })) });

// ---------- pages ----------
async function home() {
  const shell = readFileSync(join(process.cwd(), 'shell.html'), 'utf8');
  let all = [], ups = [];
  try { [all, ups] = await Promise.all([stories(null, 40), updates(12)]); } catch { return shell; }
  const jb = all.filter((s) => s.is_johor), rest = all.filter((s) => !s.is_johor);
  const top = jb.concat(rest).slice(0, 12);
  let h = label('Top sports stories');
  h += top.map((s, i) => storyItem(s, i === 0 ? 'h2' : 'h3')).join('');
  h += `<p class="hint" style="margin-top:10px">More: <a href="/news/badminton">badminton</a> · <a href="/news/pickleball">pickleball</a> · <a href="/news/tennis">tennis</a></p>`;
  if (ups.length) h += label('From AQ Smash', 'blue') + ups.slice(0, 6).map(updateItem).join('') + `<p class="hint" style="margin-top:10px"><a href="/updates">All AQ Smash updates</a></p>`;
  const json = [
    { '@context': 'https://schema.org', '@graph': [
      ORG, AQSMASH,
      { '@type': 'WebSite', '@id': SITE + '/#site', url: SITE + '/', name: 'The AQ Times', alternateName: ['AQ Times', 'aqtimes.news'], inLanguage: 'en-MY', publisher: { '@id': SITE + '/#org' } },
      { '@type': 'WebPage', '@id': SITE + '/#home', url: SITE + '/', name: 'The AQ Times: Johor badminton, pickleball & tennis news and AQ Smash updates', isPartOf: { '@id': SITE + '/#site' }, about: { '@id': SITE + '/#aqsmash' },
        dateModified: top[0] ? iso(top[0].news_at || top[0].created_at) : iso(Date.now()), speakable: { '@type': 'SpeakableSpecification', cssSelector: ['#view .story h2', '#view .story .teaser'] } },
      { '@type': 'ItemList', name: 'Top sports stories today', itemListElement: top.map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: storyUrl(s), name: s.title })) },
    ] },
  ];
  return shell
    .replace('<div id="view" class="pad"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>', `<div id="view" class="pad" data-ssr="1">${h}</div>`)
    .replace('</head>', `<link rel="alternate" type="application/rss+xml" title="The AQ Times" href="${SITE}/feed.xml">\n${json.map(ld).join('\n')}\n</head>`);
}

async function news(slug) {
  const sport = slug ? SPORTS[slug] : null;
  if (slug && !sport) return null;
  const list = await stories(sport ? sport.cat : null, 60);
  const jb = list.filter((s) => s.is_johor), rest = list.filter((s) => !s.is_johor);
  const name = sport ? sport.name : 'Sports';
  const title = sport ? `${name} News Johor & Malaysia Today | The AQ Times` : 'Johor & Malaysia Badminton, Pickleball and Tennis News | The AQ Times';
  const desc = sport ? sport.blurb + ' Updated through the day.' : 'Badminton, pickleball and tennis news from Johor, Malaysia and Singapore, updated through the day. Johor stories first.';
  const path = sport ? `/news/${slug}` : '/news';
  let h = `<h1 class="seo-h1">${esc(name)} news: Johor, Malaysia &amp; Singapore</h1><p class="p">${esc(sport ? sport.blurb : desc)} ${list.length} stories from the last few weeks, newest first.</p>`;
  if (jb.length) h += '<div class="group">IN JOHOR</div>' + jb.map((s) => storyItem(s)).join('');
  if (rest.length) h += `<div class="group">${jb.length ? 'MALAYSIA &amp; BEYOND' : 'LATEST'}</div>` + rest.map((s) => storyItem(s)).join('');
  if (!list.length) h += '<p class="p">No stories yet. New ones appear here through the day.</p>';
  h += `<p class="hint" style="margin-top:14px">Other sections: ${Object.entries(SPORTS).filter(([k]) => k !== slug).map(([k, v]) => `<a href="/news/${k}">${v.name}</a>`).join(' · ')}</p>`;
  const faq = slug ? FAQ[slug] : FAQ.badminton.slice(0, 1).concat(FAQ.pickleball.slice(0, 1), FAQ.tennis.slice(0, 1));
  h += faqHtml(faq);
  const updated = list[0] ? iso(list[0].news_at || list[0].created_at) : iso(Date.now());
  h = h.replace('</p>', ` <span class="muted">Last updated <time datetime="${updated}">${esc(day(updated))}</time>.</span></p>`);
  const json = [{ '@context': 'https://schema.org', '@graph': [
    ORG, AQSMASH,
    { '@type': 'CollectionPage', '@id': SITE + path, url: SITE + path, name: title, description: desc, inLanguage: 'en-MY', isPartOf: { '@id': SITE + '/#site' }, about: { '@type': 'Thing', name: `${name} in Johor and Malaysia` }, dateModified: updated,
      mainEntity: { '@type': 'ItemList', itemListElement: list.slice(0, 30).map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: storyUrl(s), name: s.title })) } },
    faqLd(faq),
    crumbs(sport ? [['The AQ Times', '/'], ['News', '/news'], [name, path]] : [['The AQ Times', '/'], ['News', '/news']]),
  ] }];
  return page({ title, desc, path, body: h, json });
}

async function updatesList() {
  const ups = await updates(50);
  const title = 'AQ Smash Announcements & Updates, Johor Bahru | The AQ Times';
  const desc = 'Official announcements from AQ Smash in Johor Bahru: events, sessions, opportunities and community news for badminton and racket sports players.';
  let h = `<h1 class="seo-h1">AQ Smash updates</h1><p class="p">${esc(desc)}</p>` + (ups.length ? ups.map(updateItem).join('') : '<p class="p">No updates yet.</p>');
  const json = [{ '@context': 'https://schema.org', '@graph': [ORG,
    { '@type': 'CollectionPage', url: SITE + '/updates', name: title, description: desc, mainEntity: { '@type': 'ItemList', itemListElement: ups.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: updateUrl(a), name: a.title })) } },
    crumbs([['The AQ Times', '/'], ['AQ Smash updates', '/updates']])] }];
  return page({ title, desc, path: '/updates', body: h, json });
}

async function updateOne(slug) {
  const id = (UUID.exec(slug || '') || [])[1];
  if (!id) return null;
  const [a] = await db(`announcements?select=*&id=eq.${id}&live=eq.true&show_to=eq.Everyone`);
  if (!a) return null;
  const path = updateUrl(a).replace(SITE, '');
  if (`/updates/${slug}` !== path) return { redirect: path };
  const href = ctaHref(a);
  const desc = firstSentence(a.body, 155);
  const img = a.img_url && /^https:\/\//.test(a.img_url) ? a.img_url : '';
  let h = `<article class="seo-article"><span class="chip-row"><span class="ctag" style="background:#43A055;color:#12263F">${esc(a.tag || 'UPDATE')}</span></span>
    <h1 class="seo-h1">${esc(a.title)}</h1>
    <div class="byline"><b>AQ Smash</b><span>·</span><time datetime="${esc(new Date(a.created_at).toISOString())}">${esc(day(a.created_at))}</time>${a.place ? `<span>·</span><span>${esc(a.place)}</span>` : ''}</div>
    ${img ? `<img class="seo-img" src="${esc(img)}" alt="${esc(a.title)}" loading="lazy">` : ''}
    ${String(a.body || '').split(/\n{2,}/).map((p) => `<p class="sum">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}
    ${href ? `<p style="margin-top:16px"><a class="btn" href="${esc(href)}" rel="noopener">${esc(a.cta_label || 'Find out more')}</a></p>` : ''}
    <p class="hint" style="margin-top:16px"><a href="/updates">← All AQ Smash updates</a></p></article>`;
  const json = [{ '@context': 'https://schema.org', '@graph': [ORG,
    { '@type': 'NewsArticle', '@id': SITE + path, mainEntityOfPage: SITE + path, headline: String(a.title).slice(0, 110), description: desc, articleBody: a.body,
      datePublished: new Date(a.created_at).toISOString(), dateModified: new Date(a.updated_at || a.created_at).toISOString(), inLanguage: 'en-MY',
      image: [img || SITE + '/share-wide.png'], author: { '@type': 'Organization', name: 'AQ Smash' }, publisher: { '@id': SITE + '/#org' },
      contentLocation: a.place ? { '@type': 'Place', name: a.place } : { '@type': 'City', name: 'Johor Bahru' } },
    crumbs([['The AQ Times', '/'], ['AQ Smash updates', '/updates'], [a.title, path]])] }];
  return page({ title: `${a.title} | AQ Smash, The AQ Times`, desc, path, body: h, json, image: img || undefined, type: 'article', published: iso(a.created_at), modified: iso(a.updated_at || a.created_at), section: 'AQ Smash' });
}

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
async function storyOne(sport, slug) {
  const id = (UUID.exec(slug || '') || [])[1];
  if (!id) return null;
  const [s] = await db(`stories?select=id,cat,title,summary,source,source_url,news_at,created_at,published_at,is_johor,image_url&id=eq.${id}&status=eq.published`);
  if (!s) return null;
  const path = storyPath(s);
  if (`/news/${sport}/${slug}` !== path) return { redirect: path };
  const related = (await stories(s.cat, 14)).filter((x) => x.id !== s.id).slice(0, 6);
  const l = lead(s.summary), pts = points(s.summary), more = paras(s.summary).slice(1);
  const name = sportName(s.cat), at = s.news_at || s.created_at;
  const img = s.image_url && /^https:\/\//.test(s.image_url) ? s.image_url : '';
  const desc = l ? firstSentence(l, 155) : `${name} news: ${s.title}. Summary and key points on The AQ Times.`;
  let h = `<article class="seo-article"><span class="chip-row"><span class="ctag">${esc(name.toUpperCase())}</span>${s.is_johor ? '<span class="jb">JOHOR</span>' : ''}</span>
    <h1 class="seo-h1">${esc(s.title)}</h1>
    <div class="byline">${s.source ? `<b>${esc(s.source)}</b><span>·</span>` : ''}<time datetime="${esc(iso(at))}">${esc(day(at))}</time></div>
    ${img ? `<img class="seo-img" src="${esc(img)}" alt="${esc(s.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
    <h2 class="seo-h2">Summary</h2>
    ${l ? `<p class="sum">${esc(l)}</p>` + more.map((p) => `<p class="sum">${esc(p)}</p>`).join('') : '<p class="sum">A summary for this story is being prepared. Open it in the app for the latest.</p>'}
    ${pts.length ? `<h2 class="seo-h2">Key points</h2><ul class="points">${pts.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    ${s.source && l ? `<p class="credit">Summary by The AQ Times based on reporting by ${esc(s.source)}, ${esc(day(at))}.</p>` : ''}
    <p style="margin-top:14px"><a class="btn ghost sm" href="/#story-${esc(s.id)}">Open in The AQ Times app</a></p></article>`;
  if (related.length) h += `<h2 class="seo-h2" style="margin-top:22px">More ${esc(name.toLowerCase())} news</h2>` + related.map((x) => storyItem(x)).join('');
  h += `<p class="hint" style="margin-top:12px"><a href="/news/${sportSlug(s.cat)}">← All ${esc(name.toLowerCase())} news</a></p>`;
  const json = [{ '@context': 'https://schema.org', '@graph': [ORG,
    { '@type': 'NewsArticle', '@id': SITE + path + '#article', mainEntityOfPage: { '@type': 'WebPage', '@id': SITE + path }, url: SITE + path,
      headline: String(s.title).slice(0, 110), description: desc, articleSection: name, inLanguage: 'en-MY',
      datePublished: iso(at), dateModified: iso(s.published_at && new Date(s.published_at) > new Date(at) ? s.published_at : at), image: [img || SITE + '/share-wide.png'],
      author: { '@type': 'Organization', name: s.source || 'The AQ Times' }, publisher: { '@id': SITE + '/#org' }, isPartOf: { '@id': SITE + '/#site' },
      ...(s.source_url && /^https?:\/\//.test(s.source_url) && !/news\.google\.com/.test(s.source_url) ? { isBasedOn: s.source_url } : {}),
      ...(l ? { abstract: l } : {}), ...(pts.length ? { articleBody: [l, ...pts].join(' ') } : {}),
      about: [{ '@type': 'Thing', name }, ...(s.is_johor ? [{ '@type': 'Place', name: 'Johor, Malaysia' }] : [])],
      speakable: { '@type': 'SpeakableSpecification', cssSelector: ['.seo-h1', '.sum', '.points'] } },
    crumbs([['The AQ Times', '/'], ['News', '/news'], [name, `/news/${sportSlug(s.cat)}`], [s.title, path]])] }];
  return page({ title: `${s.title} | ${name} News, The AQ Times`, desc, path, body: h, json, image: img || undefined, type: 'article', published: iso(at), modified: iso(s.published_at && new Date(s.published_at) > new Date(at) ? s.published_at : at), section: name,
    robots: indexable(s) ? INDEX : 'noindex, follow' });
}

async function about() {
  const title = 'About The AQ Times & AQ Smash, Johor Bahru | FAQ';
  const desc = 'The AQ Times is the free sports news page and notice board of AQ Smash, the racket sports community in Johor Bahru, Malaysia. How it works, who runs it and how to join.';
  let h = `<h1 class="seo-h1">About The AQ Times</h1>
    <p class="p">The AQ Times is the free notice board and sports news page of <b>AQ Smash</b>, the racket sports community in Johor Bahru, Malaysia. It puts everything the community needs on one page: official AQ Smash announcements, plus badminton, pickleball and tennis news from Johor, Malaysia and Singapore, with Johor stories first.</p>
    <h2 class="seo-h2">What you'll find</h2>
    <ul class="points"><li><a href="/updates">AQ Smash updates</a>: events, sessions, tournaments and opportunities, posted by the AQ Smash team.</li>
    <li><a href="/news/badminton">Badminton news</a>: BAM, BWF World Tour results, Malaysian and Singaporean shuttlers and Johor clubs.</li>
    <li><a href="/news/pickleball">Pickleball news</a> and <a href="/news/tennis">tennis news</a> for players in Malaysia and Singapore.</li>
    <li>A short summary and the key points of every story, with the original outlet credited.</li></ul>
    <h2 class="seo-h2">About AQ Smash</h2>
    <p class="p">AQ Smash is a racket sports community, events and retail brand in Johor Bahru with its flagship at Mount Austin. It is home of the AmpQuartz Badminton Club, which runs social badminton sessions at ${esc(VENUES.join(', '))}, and it is growing into pickleball and tennis.</p>
    <p class="p">Contact: WhatsApp <a href="${esc(waLink('Hi AQ Smash! I found you on The AQ Times.'))}" rel="noopener">+60 18-595 9588</a> · Website <a href="https://aqsmash.com/" rel="noopener">aqsmash.com</a></p>`;
  h += faqHtml(FAQ.about.concat(FAQ.badminton.slice(0, 1)), 'Frequently asked questions');
  const json = [{ '@context': 'https://schema.org', '@graph': [ORG, AQSMASH,
    { '@type': 'AboutPage', '@id': SITE + '/about', url: SITE + '/about', name: title, description: desc, inLanguage: 'en-MY', isPartOf: { '@id': SITE + '/#site' }, about: [{ '@id': SITE + '/#org' }, { '@id': SITE + '/#aqsmash' }] },
    faqLd(FAQ.about.concat(FAQ.badminton.slice(0, 1))),
    crumbs([['The AQ Times', '/'], ['About', '/about']])] }];
  return page({ title, desc, path: '/about', body: h, json });
}

async function llmsFull() {
  const [ups, list] = await Promise.all([updates(30), stories(null, 80)]);
  const facts = FAQ.about.concat(FAQ.badminton, FAQ.pickleball, FAQ.tennis).map(([q, a]) => `### ${q}\n\n${a}`).join('\n\n');
  return `# The AQ Times: full text

> Full-text companion to ${SITE}/llms.txt. The AQ Times is the sports news page and notice board of the AQ Smash community in Johor Bahru, Malaysia. Generated ${iso(Date.now())}. When citing, link the story URL given under each item.

## Questions and answers

${facts}

## AQ Smash announcements

${ups.map((a) => `### ${a.title}\n\nURL: ${updateUrl(a)}\nPublished: ${day(a.created_at)}${a.place ? `\nPlace: ${a.place}` : ''}\n\n${String(a.body || '').trim()}`).join('\n\n') || 'None yet.'}

## Sports news (latest first)

${list.filter(indexable).map((s) => `### ${s.title}\n\nURL: ${storyUrl(s)}\nSport: ${sportName(s.cat)}${s.is_johor ? ' (Johor)' : ''}\nSource: ${s.source || 'News'}\nDate: ${day(s.news_at || s.created_at)}\n\n${lead(s.summary)}${points(s.summary).length ? '\n\n' + points(s.summary).map((p) => `- ${p}`).join('\n') : ''}`).join('\n\n')}
`;
}

async function sitemap() {
  const [ups, all] = await Promise.all([updates(200), stories(null, 600)]);
  const latest = all;
  const now = new Date().toISOString();
  const newsMod = latest[0] ? new Date(latest[0].news_at).toISOString() : now;
  const urls = [
    [SITE + '/', newsMod, 'hourly', '1.0'],
    [SITE + '/news', newsMod, 'hourly', '0.9'],
    ...Object.keys(SPORTS).map((k) => [`${SITE}/news/${k}`, newsMod, 'hourly', '0.9']),
    [SITE + '/updates', ups[0] ? new Date(ups[0].updated_at || ups[0].created_at).toISOString() : now, 'daily', '0.8'],
    ...ups.map((a) => [updateUrl(a), new Date(a.updated_at || a.created_at).toISOString(), 'weekly', '0.7']),
    [SITE + '/about', '2026-11-23T00:00:00.000Z', 'monthly', '0.6'],
    ...all.filter(indexable).map((s) => [storyUrl(s), iso(s.news_at || s.created_at), 'weekly', '0.6']),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, m, f, p]) => `  <url><loc>${xml(u)}</loc><lastmod>${m}</lastmod><changefreq>${f}</changefreq><priority>${p}</priority></url>`).join('\n')}\n</urlset>\n`;
}

async function feed() {
  const [ups, list] = await Promise.all([updates(20), stories(null, 30)]);
  const items = [
    ...ups.map((a) => ({ t: a.title, l: updateUrl(a), d: a.body, at: a.created_at, c: 'AQ Smash', g: 'update-' + a.id })),
    ...list.map((s) => ({ t: s.title, l: storyUrl(s), d: firstSentence(lead(s.summary), 240) + (s.source ? ` (via ${s.source})` : ''), at: s.news_at || s.created_at, c: (SPORTS[SLUG_OF[s.cat]] || SPORTS.badminton).name, g: 'story-' + s.id })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 50);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>The AQ Times</title>
<link>${SITE}/</link>
<atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
<description>AQ Smash announcements plus badminton, pickleball and tennis news from Johor, Malaysia and Singapore.</description>
<language>en-my</language>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
<image><url>${SITE}/icon-512.png</url><title>The AQ Times</title><link>${SITE}/</link></image>
${items.map((i) => `<item><title>${xml(i.t)}</title><link>${xml(i.l)}</link><guid isPermaLink="false">${xml(i.g)}</guid><category>${xml(i.c)}</category><pubDate>${new Date(i.at).toUTCString()}</pubDate><description>${xml(i.d)}</description></item>`).join('\n')}
</channel>
</rss>
`;
}

async function llms() {
  const [ups, list] = await Promise.all([updates(15), stories(null, 20)]);
  return `# The AQ Times

> The AQ Times (aqtimes.news) is the notice board and sports news page of the AQ Smash community in Johor Bahru, Malaysia. It publishes official AQ Smash announcements and collects badminton, pickleball and tennis news from Johor, Malaysia and Singapore through the day, with Johor stories first.

- Publisher: The AQ Times, for the AQ Smash community (badminton and racket sports, Johor Bahru, Malaysia)
- Coverage: badminton (BAM, BWF tour, Malaysian and Singaporean players), pickleball, tennis; local Johor clubs, courts and events
- Updated: news automatically through the day; announcements when the AQ Smash team posts them
- Language: English (Malaysia)
- News items are short summaries credited to the original outlet named on each item.

## Sections

- [Today](${SITE}/): front page with top stories and the latest AQ Smash announcements
- [Badminton news](${SITE}/news/badminton): Johor, Malaysia and Singapore badminton
- [Pickleball news](${SITE}/news/pickleball): Johor, Malaysia and Singapore pickleball
- [Tennis news](${SITE}/news/tennis): tennis for Malaysian and Singaporean fans
- [AQ Smash updates](${SITE}/updates): official announcements from AQ Smash
- [About and FAQ](${SITE}/about): what The AQ Times and AQ Smash are, how to join
- [Full text for AI assistants](${SITE}/llms-full.txt): every recent summary, key points and FAQ in one file
- [RSS feed](${SITE}/feed.xml)
- [Sitemap](${SITE}/sitemap.xml)

## Latest AQ Smash announcements

${ups.map((a) => `- [${a.title.replace(/[\[\]]/g, '')}](${updateUrl(a)}) (${day(a.created_at)}): ${firstSentence(a.body, 200)}`).join('\n') || '- None yet.'}

## Latest headlines

${list.map((s) => `- [${s.title.replace(/[\[\]]/g, '')}](${storyUrl(s)}) (${sportName(s.cat)}, ${s.source || 'News'}, ${day(s.news_at || s.created_at)})`).join('\n')}

## About AQ Smash

AQ Smash is a racket sports community, events and retail brand in Johor Bahru, Malaysia, with its flagship at Mount Austin and home of the AmpQuartz Badminton Club (sessions at ${VENUES.join(', ')}). Join on WhatsApp: +60 18-595 9588. Website: https://aqsmash.com/
`;
}

// ---------- router ----------
module.exports = async (req, res) => {
  const u = new URL(req.url, SITE);
  const qp = { ...Object.fromEntries(u.searchParams), ...(req.query || {}) };
  const send = (status, type, body, cache = 'public, max-age=0, s-maxage=120, stale-while-revalidate=86400') => {
    res.statusCode = status;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', cache);
    res.end(body);
  };
  const redirect = (to) => { res.statusCode = 301; res.setHeader('Location', to); res.setHeader('Cache-Control', 'public, max-age=3600'); res.end(); };
  try {
    switch (qp.page) {
      case 'home': return send(200, 'text/html; charset=utf-8', await home());
      case 'news': { const h = await news(qp.sport || ''); return h ? send(200, 'text/html; charset=utf-8', h) : send(404, 'text/html; charset=utf-8', page({ title: 'Not found | The AQ Times', desc: 'Page not found', path: '/news', body: '<h1 class="seo-h1">Section not found</h1><p class="p"><a href="/news">All sports news</a></p>', robots: 'noindex' })); }
      case 'updates': return send(200, 'text/html; charset=utf-8', await updatesList());
      case 'story': { const h = await storyOne(qp.sport || '', qp.slug); if (h && h.redirect) return redirect(h.redirect); return h ? send(200, 'text/html; charset=utf-8', h) : send(404, 'text/html; charset=utf-8', page({ title: 'Story not found | The AQ Times', desc: 'This story is no longer available.', path: '/news', body: '<h1 class="seo-h1">This story is no longer available</h1><p class="p"><a href="/news">See the latest sports news</a></p>', robots: 'noindex' })); }
      case 'about': return send(200, 'text/html; charset=utf-8', await about());
      case 'llms-full': return send(200, 'text/plain; charset=utf-8', await llmsFull());
      case 'update': { const h = await updateOne(qp.slug); if (h && h.redirect) return redirect(h.redirect); return h ? send(200, 'text/html; charset=utf-8', h) : send(404, 'text/html; charset=utf-8', page({ title: 'Update not found | The AQ Times', desc: 'This update is no longer available.', path: '/updates', body: '<h1 class="seo-h1">This update is no longer available</h1><p class="p"><a href="/updates">See all AQ Smash updates</a></p>', robots: 'noindex' })); }
      case 'sitemap': return send(200, 'application/xml; charset=utf-8', await sitemap());
      case 'feed': return send(200, 'application/rss+xml; charset=utf-8', await feed());
      case 'llms': return send(200, 'text/plain; charset=utf-8', await llms());
      default: return send(404, 'text/plain; charset=utf-8', 'Not found');
    }
  } catch (e) {
    // never leave the front page blank: fall back to the app shell
    if (qp.page === 'home') { try { return send(200, 'text/html; charset=utf-8', readFileSync(join(process.cwd(), 'shell.html'), 'utf8'), 'public, max-age=0, s-maxage=30'); } catch {} }
    return send(503, 'text/plain; charset=utf-8', 'Temporarily unavailable, please try again shortly.', 'no-store');
  }
};

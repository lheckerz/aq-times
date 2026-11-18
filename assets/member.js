// The AQ Times — member app
import { sb, esc, $, BADGES, CATS, AREAS, visibleTo, fmtDateLong, sinceLabel, feedWhen, ctaHref, hasButton, coverHTML, thumbHTML, ICONS, registerSW, timeAgo, dedupeStories, parseSummary } from './common.js';

const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

const state = {
  tab: 'today', seg: 'all', area: LS.get('aq.area', 'Johor Bahru'), seen: LS.get('aq.seen', {}), open: {},
  anns: [], stories: [], ticker: [], feed: [], settings: {}, wx: null, newFeedId: null, newStories: new Set(), tick: 0, loaded: false,
  story: null, storyLoading: false,
};

// ---------- data ----------
async function loadAnns() { const { data } = await sb.from('announcements').select('*').eq('live', true).order('created_at', { ascending: false }); state.anns = data || []; }
async function loadStories() { const { data } = await sb.from('stories').select('*').eq('status', 'published').neq('cat', 'johor').order('news_at', { ascending: false }).limit(120); state.stories = dedupeStories(data || []); }
async function loadTicker() { const { data } = await sb.from('ticker').select('*').order('sort').order('created_at'); state.ticker = data || []; }
async function loadFeed() { const { data } = await sb.from('feed').select('*').order('created_at', { ascending: false }).limit(20); state.feed = data || []; }
async function loadSettings() { const { data } = await sb.from('settings').select('*'); state.settings = Object.fromEntries((data || []).map((r) => [r.key, r.value])); }

const WX = (code) => {
  if (code === 0) return ['Clear skies', 'sun'];
  if (code <= 2) return ['Partly cloudy', 'cloud'];
  if (code === 3) return ['Cloudy', 'cloud'];
  if (code === 45 || code === 48) return ['Foggy', 'cloud'];
  if (code >= 51 && code <= 57) return ['Drizzle', 'rain'];
  if (code === 65 || code === 82) return ['Heavy rain', 'rain'];
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ['Rain', 'rain'];
  if (code >= 95) return ['Thunderstorms', 'storm'];
  return ['Mixed', 'cloud'];
};
async function loadWeather() {
  const a = AREAS[state.area] || AREAS['Johor Bahru'];
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${a.lat}&longitude=${a.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=Asia%2FSingapore&forecast_days=7`;
    const r = await fetch(url);
    const j = await r.json();
    const d = j.daily;
    const DN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    state.wx = {
      place: a.place,
      now: Math.round(j.current.temperature_2m), code: j.current.weather_code,
      high: Math.round(d.temperature_2m_max[0]), low: Math.round(d.temperature_2m_min[0]), rain: d.precipitation_probability_max[0],
      days: d.time.slice(1, 7).map((t, i) => ({ d: DN[new Date(t + 'T12:00:00+08:00').getUTCDay()], hi: Math.round(d.temperature_2m_max[i + 1]), rain: d.precipitation_probability_max[i + 1] })),
      tmr: { hi: Math.round(d.temperature_2m_max[1]), lo: Math.round(d.temperature_2m_min[1]), rain: d.precipitation_probability_max[1], code: d.weather_code[1] },
    };
  } catch { state.wx = null; }
}

// ---------- pieces ----------
const label = (txt, sq = '') => `<div class="label"><span class="sq ${sq}"></span><span>${esc(txt)}</span><span class="ln"></span></div>`;
const wxIcon = (kind) => ({
  sun: '<svg width="34" height="34" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="9" fill="#43A055"/><g stroke="#21558A" stroke-width="3" stroke-linecap="round"><path d="M24 4v6M24 38v6M4 24h6M38 24h6M10 10l4 4M34 34l4 4M10 38l4-4M34 14l4-4"/></g></svg>',
  cloud: '<svg width="34" height="34" viewBox="0 0 48 48" aria-hidden="true"><path d="M14 36a9 9 0 0 1 1-18 12 12 0 0 1 22 4 7 7 0 0 1 0 14z" fill="#21558A"/></svg>',
  rain: '<svg width="34" height="34" viewBox="0 0 48 48" aria-hidden="true"><path d="M14 30a9 9 0 0 1 1-18 12 12 0 0 1 22 4 7 7 0 0 1 0 14z" fill="#21558A"/><g stroke="#43A055" stroke-width="3" stroke-linecap="round"><path d="M16 35l-3 7M25 35l-3 7M34 35l-3 7"/></g></svg>',
  storm: '<svg width="34" height="34" viewBox="0 0 48 48" aria-hidden="true"><path d="M14 30a9 9 0 0 1 1-18 12 12 0 0 1 22 4 7 7 0 0 1 0 14z" fill="#12263F"/><path d="M26 30l-5 8h5l-3 8 9-11h-5l3-5z" fill="#43A055"/></svg>',
}[kind] || '');

function weatherCard() {
  const w = state.wx;
  if (!w) return `<aside class="wx" aria-label="Weather"><div class="wx-cond">Weather is loading…</div></aside>`;
  const [cond, kind] = WX(w.code);
  const [tc] = WX(w.tmr.code);
  return `<aside class="wx" aria-label="Weather in ${esc(w.place)}">
    <div class="wx-now">${wxIcon(kind)}<div><div class="wx-temp">${w.now}°<small> / ${w.low}°</small></div><div class="wx-cond">${esc(cond)}</div></div></div>
    <div class="wx-place">${esc(w.place)}</div>
    <div class="wx-days">${w.days.map((x) => `<div><div class="d">${x.d}</div><div class="h">${x.hi}°</div><div class="r">${x.rain ?? 0}%</div></div>`).join('')}</div>
    <div class="wx-meta"><span>Rain ${w.rain ?? 0}%</span><span>High ${w.high}°</span></div>
    <div class="wx-tmr"><div class="k">TOMORROW</div><div class="v">${w.tmr.hi}° / ${w.tmr.lo}° · ${esc(tc.toLowerCase())} (${w.tmr.rain ?? 0}%)</div></div>
  </aside>`;
}

function ctaButton(a, cls = 'btn') {
  if (!hasButton(a)) return '';
  const href = ctaHref(a);
  if (href) return `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener">${esc(a.cta_label)}</a>`;
  return `<button type="button" class="${cls}" data-act="app:${esc(a.cta_target)}">${esc(a.cta_label)}</button>`;
}
const badge = (a) => { const b = BADGES[a.tag] || BADGES.UPDATE; return `<span class="badge" style="background:${b.bg};color:${b.fg}">${b.label}</span>`; };
const catTag = (c) => { const t = CATS[c] || CATS.bad; return `<span class="ctag" style="background:${t.bg};color:${t.fg}">${t.label}</span>`; };
const srcLine = (s) => `<div class="src">${s.source ? `<span>${esc(s.source)}</span>` : ''}<span class="ago">${timeAgo(s.news_at || s.published_at || s.created_at)}</span></div>`;
const chips = (s) => `<span class="chip-row">${catTag(s.cat)}${s.is_johor ? '<span class="jb">JOHOR</span>' : ''}${state.newStories.has(s.id) ? '<span class="new">● NEW</span>' : ''}</span>`;
// Headlines open the in-app story page (summary + key points), never the outside site
const headline = (s, tag = 'h3') => `<a class="h" href="#story-${esc(s.id)}" data-act="story:${esc(s.id)}"><${tag}>${esc(s.title)}</${tag}></a>`;
const teaser = (s) => { const l = parseSummary(s.summary).lead; return l ? `<p class="teaser">${esc(l)}</p>` : ''; };
const img = (s) => s.image_url ? `<img src="${esc(s.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';

// ---------- views ----------
function views() {
  const area = state.area;
  const anns = state.anns.filter((a) => visibleTo(a.show_to, area));
  const feat = anns.find((a) => a.featured) || anns.find((a) => a.tag !== 'OPPORTUNITY') || null;
  const board = anns.filter((a) => a !== feat);
  const stories = state.stories.filter((s) => visibleTo(s.show_to, area));
  const fresh = (s) => Date.now() - new Date(s.published_at || s.news_at || s.created_at).getTime() < 864e5;
  const lead = stories.find((s) => s.is_lead && fresh(s)) || stories.find((s) => s.is_johor) || stories[0];
  const others = stories.filter((s) => s !== lead);
  const rest = others.filter((s) => s.is_johor).concat(others.filter((s) => !s.is_johor));
  return { anns, feat, board, stories, lead, rest };
}

function todayView() {
  const { feat, board, lead, rest } = views();
  const seconds = rest.slice(0, 2), more = rest.slice(2, 10);
  let h = '<div class="row-a">';
  h += '<article class="lead">' + label('Top sports stories');
  if (lead) {
    h += `<div style="margin-top:8px">${chips(lead)}</div>${headline(lead, 'h2')}${img(lead)}${teaser(lead)}${srcLine(lead)}<button type="button" class="more-link" data-act="story:${esc(lead.id)}">Read summary ›</button>`;
  } else h += '<p>No stories yet today.</p>';
  h += '</article>' + weatherCard() + '</div>';
  if (seconds.length) {
    h += '<div class="row-b">' + seconds.map((s, i) => `<article class="story" style="padding:0;border:0"><div class="no">NO. ${i + 2}${s.is_johor ? ' · JOHOR' : ''}</div>${headline(s)}${teaser(s)}${srcLine(s)}</article>`).join('') + '</div>';
  }
  if (feat) {
    h += label('From AQ Smash', 'blue');
    h += `<article class="feat">${coverHTML(feat, { featured: true, height: 140 })}<div class="in">
      <div class="meta">${badge(feat)}<span class="place">${esc(feat.place)}</span></div>
      <h3>${esc(feat.title)}</h3><p>${esc(feat.body)}</p>
      ${hasButton(feat) ? `<div style="margin-top:10px">${ctaButton(feat, 'btn on-dark')}</div>` : ''}</div></article>`;
  }
  h += '<div class="row-d" style="margin-top:4px"><section>' + label(`AQ Board · ${board.length}`);
  h += board.length ? board.map(boardItem).join('') : '<p class="p">Nothing else on the board right now.</p>';
  h += '</section><div style="padding-top:18px">';
  h += `<div class="quote"><div class="q">“</div><div class="w">${esc(state.settings.quote || '')}</div><div class="by">${esc(state.settings.quote_by || 'AQ SMASH')}</div></div>`;
  h += `<div class="one"><div class="k"><i></i>TODAY'S ONE THING</div><div class="v">${esc(state.settings.one_thing || '')}</div></div>`;
  h += '</div></div>';
  if (more.length) {
    h += label('More sports news', 'navy');
    h += more.map((s, i) => `<article class="num story" style="padding:10px 0"><span class="n">${i + 1}</span><div style="min-width:0">${chips(s)}${headline(s)}${srcLine(s)}</div></article>`).join('');
    h += `<button type="button" class="btn ghost sm" style="margin-top:12px" data-act="tab:news">See all sports news</button>`;
  }
  return h + '<div style="height:18px"></div>';
}

function boardItem(a) {
  const open = !!state.open[a.id];
  const b = BADGES[a.tag] || BADGES.UPDATE;
  return `<div class="item"><button type="button" data-act="open:${a.id}" aria-expanded="${open}">
    <span class="box" style="border-color:${b.bg === '#DDF1E2' ? '#1F5E2D' : b.bg};background:${state.seen[a.id] ? (b.bg === '#DDF1E2' ? '#1F5E2D' : b.bg) : 'transparent'}" aria-hidden="true"></span>
    <span style="flex:1;min-width:0"><span class="t">${esc(a.title)}</span><span class="sub">${badge(a)}<span class="since">${sinceLabel(a.created_at)}</span></span></span></button>
    ${open ? `<div class="more"><p>${esc(a.body)}</p>${ctaButton(a, 'btn sm')}</div>` : ''}</div>`;
}

function updatesView() {
  const { anns } = views();
  let h = label('All updates from AQ Smash');
  if (!anns.length) return h + '<p class="p">No updates yet.</p>';
  h += anns.map((a) => {
    const open = !!state.open[a.id];
    return `<div class="row"><button type="button" data-act="open:${a.id}" aria-expanded="${open}">${thumbHTML(a)}
      <span style="flex:1;min-width:0"><span class="sub" style="display:flex;gap:6px;align-items:center">${badge(a)}<span class="since">${sinceLabel(a.created_at)}</span>${a.featured ? '<span class="since">★ featured</span>' : ''}</span><span class="t">${esc(a.title)}</span></span>
      <span class="plus" aria-hidden="true">${open ? '–' : '+'}</span></button>
      ${open ? `<div class="more"><p>${esc(a.body)}</p>${ctaButton(a, 'btn')}</div>` : ''}</div>`;
  }).join('');
  return h + '<div style="height:18px"></div>';
}

function newsView() {
  const list = views().stories.filter((s) => state.seg === 'all' || s.cat === state.seg);
  const jb = list.filter((s) => s.is_johor), rest = list.filter((s) => !s.is_johor);
  const card = (s) => `<article class="story">${chips(s)}${headline(s)}${img(s)}${teaser(s)}${srcLine(s)}</article>`;
  let h = `<div class="seg" role="tablist">${[['all', 'All'], ['bad', 'Badminton'], ['pickleball', 'Pickleball'], ['tennis', 'Tennis']].map(([k, l]) => `<button type="button" role="tab" aria-selected="${state.seg === k}" data-act="seg:${k}">${l}</button>`).join('')}</div>`;
  h += `<p class="hint" style="margin:8px 0 0">Updates automatically, all day. ${list.length} stories from the last week.</p>`;
  if (!list.length) h += '<p class="p">No stories in this section yet. New ones appear here as soon as they\u2019re published.</p>';
  if (jb.length) h += '<div class="group">IN JOHOR</div>' + jb.map(card).join('');
  if (rest.length) h += `<div class="group">${jb.length ? 'MALAYSIA &amp; BEYOND' : 'LATEST'}</div>` + rest.map(card).join('');
  h += label('Live feed');
  h += state.feed.map((f) => { const t = CATS[f.cat] || CATS.aq; return `<div class="feed ${f.id === state.newFeedId ? 'fade' : ''}"><span class="w">${feedWhen(f.created_at)}</span><div style="flex:1;min-width:0"><span class="ctag" style="background:${t.bg};color:${t.fg}">${t.label}</span>${f.id === state.newFeedId ? '<span class="new">● NEW</span>' : ''}<div class="x">${esc(f.text)}</div></div></div>`; }).join('');
  return h + '<div style="height:18px"></div>';
}

function meView() {
  return `<div style="display:flex;flex-direction:column;gap:14px;padding-top:14px">
    <label class="card field">Your area
      <select data-act="area">${Object.keys(AREAS).map((k) => `<option value="${k}" ${k === state.area ? 'selected' : ''}>${k === 'Johor' ? 'Elsewhere in Johor' : k === 'Malaysia' ? 'Elsewhere in Malaysia' : k}</option>`).join('')}</select>
      <span class="hint">Weather, local stories and announcements follow your area.</span></label>
    <div class="card"><div style="font:800 14px var(--sans)">Put The AQ Times on your home screen</div>
      <p class="hint" style="margin:6px 0 0">iPhone: tap Share, then “Add to Home Screen”. Android: tap the ⋮ menu, then “Install app”. It opens full screen like a normal app.</p></div>
    <a class="btn ghost" href="/admin">AQ Smash team? Sign in</a>
  </div>`;
}

// ---------- render ----------
function render() {
  $('#dateLong').textContent = fmtDateLong();
  const { feat, board } = views();
  const w = state.wx;
  const today = state.stories.filter((s) => Date.now() - new Date(s.news_at || s.created_at).getTime() < 864e5).length;
  $('#glance').textContent = [`${today} NEW STORIES`, feat ? '1 FEATURED' : null, w ? `HIGH ${w.high}°` : null, w ? `RAIN ${w.rain ?? 0}%` : null].filter(Boolean).join(' · ');
  const v = state.tab === 'today' ? todayView() : state.tab === 'ann' ? updatesView() : state.tab === 'news' ? newsView() : meView();
  // the server already rendered the front page for search engines; keep it until live data arrives
  if (state.loaded || !$('#view').dataset.ssr || state.tab !== 'today') { $('#view').innerHTML = v; delete $('#view').dataset.ssr; }
  $('#tabs').innerHTML = [['today', 'Today'], ['ann', 'Updates'], ['news', 'News'], ['me', 'Me']].map(([k, l]) => `<button type="button" data-act="tab:${k}" aria-current="${state.tab === k ? 'page' : 'false'}"><span class="ic">${ICONS[k]}</span>${l}</button>`).join('');
  renderTicker();
}
function renderTicker() {
  const t = state.ticker;
  const el = $('#ticker');
  if (!t.length) { el.textContent = ''; return; }
  const item = t[state.tick % t.length];
  el.textContent = item.text;
  el.classList.remove('fade'); void el.offsetWidth; el.classList.add('fade');
}


// ---------- story page (in-app summary; no outside links) ----------
const hasPoints = (s) => parseSummary(s && s.summary).points.length > 0;
const findStory = (id) => state.stories.find((x) => x.id === id) || (state.storyCache && state.storyCache.id === id ? state.storyCache : null);

function storyHTML(s) {
  const { lead, more, points } = parseSummary(s.summary);
  const loading = state.storyLoading && !points.length;
  let h = `<header class="sheet-bar"><button type="button" class="back" data-act="close-story" aria-label="Back">‹ Back</button>
    <span class="sheet-wm" aria-hidden="true"><i>THE</i><b>AQ</b><em>TIMES</em></span><span style="width:64px"></span></header><div class="sheet-body" id="sheetBody">`;
  h += `<div>${chips(s)}</div><h1 id="sheetTitle">${esc(s.title)}</h1>`;
  h += `<div class="byline">${s.source ? `<b>${esc(s.source)}</b><span>·</span>` : ''}<span>${timeAgo(s.news_at || s.published_at || s.created_at)}</span></div>`;
  h += img(s);
  h += label('Summary');
  if (lead) h += `<p class="sum">${esc(lead)}</p>` + more.map((p) => `<p class="sum">${esc(p)}</p>`).join('');
  else if (loading) h += '<div class="skeleton"></div><div class="skeleton" style="width:80%"></div>';
  if (points.length) h += label('Key points', 'blue') + `<ul class="points">${points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
  else if (loading) h += label('Key points', 'blue') + '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton" style="width:70%"></div><p class="hint">Preparing the key points…</p>';
  if (!lead && !points.length && !loading) h += '<p class="sum muted">A summary isn’t available for this story yet. Check back shortly.</p>';
  if (s.auto && s.source) h += `<p class="credit">Summary based on reporting by ${esc(s.source)}.</p>`;
  const rel = state.stories.filter((x) => x.id !== s.id && x.cat === s.cat).slice(0, 4);
  if (rel.length) h += label(`More ${(CATS[s.cat] || CATS.bad).name.toLowerCase()} news`, 'navy') + rel.map((x) => `<article class="story">${chips(x)}${headline(x)}${srcLine(x)}</article>`).join('');
  return h + '<button type="button" class="btn ghost sm" style="margin-top:16px" data-act="close-story">Back to The AQ Times</button><div style="height:calc(24px + var(--safe-b))"></div></div>';
}

function renderSheet() {
  const el = $('#sheet');
  const s = state.story && findStory(state.story);
  if (!s) { el.hidden = true; el.innerHTML = ''; return; }
  const prev = $('#sheetBody');
  const top = prev && prev.dataset.id === s.id ? prev.scrollTop : 0;
  el.innerHTML = storyHTML(s);
  el.hidden = false;
  const body = $('#sheetBody'); body.dataset.id = s.id; body.scrollTop = top;
}

async function openStory(id, push = true) {
  if (!findStory(id)) {
    const { data } = await sb.from('stories').select('*').eq('id', id).eq('status', 'published').maybeSingle();
    if (!data) { if (push === false) history.replaceState(null, '', location.pathname); return; }
    state.storyCache = data;
  }
  const first = state.story !== id;
  state.story = id;
  if (push) history.pushState({ story: id }, '', '#story-' + id);
  if (first) { const st = findStory(id); try { (window.dataLayer = window.dataLayer || []).push({ event: 'story_view', story_id: id, story_title: st && st.title, story_sport: st && st.cat, story_source: st && st.source }); } catch {} }
  state.storyLoading = false;
  renderSheet();
  if (first) { const b = $('#sheetBody'); if (b) { b.scrollTop = 0; } const back = $('#sheet .back'); if (back) back.focus({ preventScroll: true }); }
  const s = findStory(id);
  if (s && s.auto && !hasPoints(s)) {
    state.storyLoading = true; renderSheet();
    try {
      const { data } = await sb.functions.invoke('story-summary', { body: { id } });
      if (data && data.summary) { s.summary = data.summary; if (data.image_url && !s.image_url) s.image_url = data.image_url; }
    } catch {}
    state.storyLoading = false;
    if (state.story === id) renderSheet();
    render();
  }
}
function closeStory() {
  if (history.state && history.state.story) history.back();
  else { state.story = null; history.replaceState(null, '', location.pathname); renderSheet(); }
}
window.addEventListener('popstate', () => {
  const m = /^#story-([0-9a-f-]{36})$/i.exec(location.hash);
  if (m) openStory(m[1], false); else { state.story = null; renderSheet(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.story) closeStory(); });

// ---------- events ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT') return;
  const [act, val] = el.dataset.act.split(/:(.*)/s);
  if (act === 'story') { e.preventDefault(); openStory(val); return; }
  if (act === 'close-story') { closeStory(); return; }
  if (act === 'tab') { state.tab = val; render(); $('#scroll').scrollTop = 0; }
  else if (act === 'open') {
    state.open[val] = !state.open[val];
    state.seen[val] = true; LS.set('aq.seen', state.seen); render();
  } else if (act === 'seg') { state.seg = val; render(); }
  else if (act === 'app') {
    const k = (val || '').toLowerCase();
    state.tab = k.includes('news') ? 'news' : k.includes('update') ? 'ann' : 'ann'; render();
  }
});
document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-act="area"]');
  if (!el) return;
  state.area = el.value; LS.set('aq.area', state.area);
  render(); await loadWeather(); render();
});

// ---------- realtime ----------
function subscribe() {
  sb.channel('aq-times-public')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, async () => { await loadAnns(); render(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stories' }, async (p) => { if (p.eventType === 'INSERT' || (p.eventType === 'UPDATE' && p.old && 'status' in p.old && p.old.status !== 'published' && p.new.status === 'published')) state.newStories.add(p.new.id); await loadStories(); render(); if (state.story) renderSheet(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ticker' }, async () => { await loadTicker(); renderTicker(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, async () => { await loadSettings(); render(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'feed' }, async (p) => { await loadFeed(); if (p.eventType === 'INSERT') state.newFeedId = p.new.id; render(); })
    .subscribe();
}

async function checkAdmin() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  const name = (session.user.user_metadata && session.user.user_metadata.name) || session.user.email.split('@')[0];
  $('#printedFor').textContent = 'PRINTED FOR ' + String(name).toUpperCase();
  const { data } = await sb.rpc('is_admin');
  $('#adminBar').hidden = data !== true;
}

(async function start() {
  render();
  await Promise.all([loadAnns(), loadStories(), loadTicker(), loadFeed(), loadSettings()]);
  state.loaded = true; render();
  { const m = /^#story-([0-9a-f-]{36})$/i.exec(location.hash); if (m) openStory(m[1], false); }
  loadWeather().then(render);
  subscribe();
  checkAdmin();
  setInterval(() => { state.tick++; renderTicker(); }, 4500);
  setInterval(() => { $('#dateLong').textContent = fmtDateLong(); }, 60000);
  setInterval(() => { loadStories().then(() => { render(); if (state.story) renderSheet(); }); }, 5 * 60000); // backup refresh if live updates drop
  setInterval(() => loadWeather().then(render), 30 * 60000);
  registerSW();
})();

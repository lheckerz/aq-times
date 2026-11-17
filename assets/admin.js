// The AQ Times — admin app
import { sb, esc, $, COVERS, BADGES, CATS, AREAS, visibleTo, fmtDay, feedWhen, sinceLabel, ctaHref, coverHTML, ICONS, registerSW, timeAgo } from './common.js';

const blankDraft = () => ({ featured: false, tag: 'UPDATE', title: '', body: '', place: '', show_to: 'Everyone', cta_label: '', cta_action: 'whatsapp', cta_target: '', img_src: 'auto', img_url: '', img_checked: false, cover_word: '', cover_color: 'blue', also_feed: true });
const blankStory = () => ({ link: '', cat: 'bad', title: '', summary: '', source: '', source_url: '', image_url: '', show_to: 'Everyone', is_lead: false });

const S = {
  codeEmail: '', resendAt: 0, resendTimer: null, pwMode: false, signOk: false,
  session: null, admin: false, tab: 'home', loc: 'Johor Bahru',
  anns: [], stories: [], ticker: [], feed: [], settings: {}, admins: [], learn: [],
  draft: blankDraft(), editingId: null, imgNote: '', busy: false,
  storyEdit: null, storyDraft: null, newStory: blankStory(), newStoryOpen: false,
  recovery: false,
};

// ---------- utils ----------
let toastTimer;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}
const fail = (error, fallback = 'Something went wrong') => { if (error) { toast(error.message || fallback); return true; } return false; };
async function learn(kind, ref = '') { await sb.from('learn_events').insert({ kind, ref }); S.learn.unshift({ kind, ref, created_at: new Date().toISOString() }); }
const domainOf = (u) => { try { return new URL(/^https?:/i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const realLink = (u) => !!u && !/[\[\]]/.test(u) && /\.[a-z]{2,}/i.test(u);

async function linkPreview(url) {
  const { data, error } = await sb.functions.invoke('link-preview', { body: { url } });
  if (error) {
    let msg = 'Couldn’t read that link';
    try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return data;
}

// ---------- data ----------
async function loadAll() {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const [a, s, t, f, st, ad, le] = await Promise.all([
    sb.from('announcements').select('*').order('featured', { ascending: false }).order('created_at', { ascending: false }),
    sb.from('stories').select('*').neq('cat', 'johor').order('news_at', { ascending: false }).limit(150),
    sb.from('ticker').select('*').order('sort').order('created_at'),
    sb.from('feed').select('*').order('created_at', { ascending: false }).limit(15),
    sb.from('settings').select('*'),
    sb.from('admins').select('*').order('added_at'),
    sb.from('learn_events').select('kind,ref,created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(500),
  ]);
  S.anns = a.data || []; S.stories = s.data || []; S.ticker = t.data || []; S.feed = f.data || [];
  S.settings = Object.fromEntries((st.data || []).map((r) => [r.key, r.value]));
  S.admins = ad.data || []; S.learn = le.data || [];
}

// ---------- AQ suggests ----------
function suggestions() {
  const week = Date.now() - 7 * 864e5;
  const dismissed = new Set(S.learn.filter((l) => l.kind === 'dismiss' && new Date(l.created_at).getTime() > week).map((l) => l.ref));
  const kindSkips = {};
  S.learn.filter((l) => l.kind === 'dismiss').forEach((l) => { const k = l.ref.split(':')[0]; kindSkips[k] = (kindSkips[k] || 0) + 1; });
  const out = [];
  const live = S.anns.filter((a) => a.live);
  const feat = live.find((a) => a.featured);
  const loc = S.loc;

  S.stories.filter((s) => s.status === 'pending' && visibleTo(s.show_to, loc)).slice(0, 3).forEach((s) => out.push({
    key: `pub:${s.id}`, kind: 'PUBLISH', title: `Publish “${s.title}”`,
    why: `It’s been waiting in the news desk since ${fmtDay(s.created_at)}${s.show_to !== 'Everyone' ? `, aimed at readers in ${s.show_to}` : ''}.`,
    use: 'Publish', run: () => setStory(s.id, { status: 'published' }, 'Story published ✓', 'publish'),
  }));
  if (!feat && live.length) {
    const pick = live.find((a) => a.tag !== 'OPPORTUNITY') || live[0];
    out.push({ key: 'feat:none', kind: 'FEATURE', title: `Feature “${pick.title}”`, why: 'The top of the front page is empty without a featured card.', use: 'Feature it', run: () => featureAnn(pick.id) });
  }
  if (feat) {
    const days = Math.floor((Date.now() - new Date(feat.updated_at || feat.created_at).getTime()) / 864e5);
    const newer = live.filter((a) => a.id !== feat.id && a.tag !== 'OPPORTUNITY' && new Date(a.created_at) > new Date(feat.created_at))[0];
    if (days >= 7 && newer) out.push({ key: `stale:${feat.id}`, kind: 'FEATURE', title: `Feature “${newer.title}” instead`, why: `“${feat.title}” has been the featured card for ${days} days. Fresh cards get more taps.`, use: 'Swap it', run: () => featureAnn(newer.id) });
  }
  live.filter((a) => (a.cta_action === 'link' || a.cta_action === 'form') && realLink(a.cta_target) && a.img_src === 'cover').slice(0, 2).forEach((a) => out.push({
    key: `img:${a.id}`, kind: 'IMAGE', title: `Pull a photo for “${a.title}” from its link`,
    why: `Its button goes to ${domainOf(a.cta_target)}. A real image usually gets more taps than a text cover, and you check it before members see it.`,
    use: 'Pull image', run: () => pullForAnn(a),
  }));
  S.anns.filter((a) => a.img_url && !a.img_checked).forEach((a) => out.push({
    key: `check:${a.id}`, kind: 'CHECK', title: `Check the image on “${a.title}”`, why: 'Members see the branded cover until an admin confirms the image is right.', use: 'Check it', run: () => editAnn(a.id),
  }));
  live.filter((a) => a.cta_action !== 'none' && a.cta_action !== 'app' && !ctaHref(a)).forEach((a) => out.push({
    key: `btn:${a.id}`, kind: 'BUTTON', title: `“${a.title}” has a button that goes nowhere`, why: 'Members won’t see the button until it has a link or WhatsApp number.', use: 'Fix it', run: () => editAnn(a.id),
  }));
  if ((loc === 'Singapore') && !live.some((a) => a.show_to === 'Singapore')) out.push({
    key: 'local:sg', kind: 'LOCAL ANGLE', title: 'Draft a call-out just for Singapore readers', why: 'Nothing on the board is aimed at Singapore yet.', use: 'Draft it',
    run: () => { S.draft = Object.assign(blankDraft(), { tag: 'OPPORTUNITY', title: 'Singapore players: come play in JB', body: 'Message us to set up an SG–JB pair challenge or a session in Johor Bahru.', place: 'Johor Bahru', show_to: 'Singapore', cta_label: 'Talk to us on WhatsApp', cta_action: 'whatsapp', cta_target: (live.find((a) => a.cta_action === 'whatsapp') || {}).cta_target || '', img_src: 'cover', img_checked: true, cover_word: 'SG ⇄ JB', cover_color: 'green' }); S.editingId = null; go('post'); toast('Draft ready. Review and publish'); },
  });
  const lead = S.stories.find((s) => s.status === 'published' && s.is_lead);
  if (lead && !S.ticker.some((t) => t.text.toLowerCase().includes(lead.title.toLowerCase().slice(0, 18)))) out.push({
    key: `tick:${lead.id}`, kind: 'TICKER', title: `Add today’s lead to the ticker: “${lead.title}”`, why: 'The lead story isn’t in the rotating line at the bottom of the app.', use: 'Add it',
    run: async () => { const { error } = await sb.from('ticker').insert({ text: lead.title.slice(0, 140), sort: 0 }); if (!fail(error)) { await learn('apply', `tick:${lead.id}`); await refresh(); toast('Added to ticker ✓'); } },
  });
  return out.filter((g) => !dismissed.has(g.key))
    .map((g) => Object.assign(g, { often: (kindSkips[g.key.split(':')[0]] || 0) >= 3 }))
    .sort((a, b) => a.often - b.often);
}

// ---------- actions ----------
async function refresh() { await loadAll(); render(); }
function go(tab) { S.tab = tab; render(); $('#scroll').scrollTop = 0; }

async function featureAnn(id) {
  const { error } = await sb.from('announcements').update({ featured: true, live: true }).eq('id', id);
  if (!fail(error)) { await learn('apply', `feat:${id}`); await refresh(); toast('★ Now featured'); }
}
function editAnn(id) {
  const a = S.anns.find((x) => x.id === id); if (!a) return;
  S.editingId = id; S.imgNote = '';
  S.draft = { featured: a.featured, tag: a.tag, title: a.title, body: a.body, place: a.place, show_to: a.show_to, cta_label: a.cta_label, cta_action: a.cta_action, cta_target: a.cta_target, img_src: a.img_src, img_url: a.img_url, img_checked: a.img_checked, cover_word: a.cover_word, cover_color: a.cover_color, also_feed: false };
  go('post');
}
async function pullForAnn(a) {
  toast('Reading ' + domainOf(a.cta_target) + '…');
  try {
    const p = await linkPreview(a.cta_target);
    if (!p.image) { toast('No share image on that page. Upload one instead.'); return; }
    const { error } = await sb.from('announcements').update({ img_src: 'auto', img_url: p.image, img_checked: false }).eq('id', a.id);
    if (!fail(error)) { await learn('apply', `img:${a.id}`); await refresh(); editAnn(a.id); toast('Image pulled. Check it, then save'); }
  } catch (e) { toast(e.message); }
}
async function setStory(id, patch, msg, kind = 'edit') {
  const { error } = await sb.from('stories').update(patch).eq('id', id);
  if (!fail(error)) { await learn(kind, `story:${id}`); await refresh(); toast(msg); }
}

async function autoPull() {
  const d = S.draft;
  const link = (d.cta_action === 'link' || d.cta_action === 'form') ? d.cta_target.trim() : '';
  if (!realLink(link)) { S.imgNote = link ? 'Add the real link in the button settings and AQ will pull its image. Until then, members see a branded cover.' : 'This button has no web link to pull from, so members see a branded cover. Upload a photo for something better.'; d.img_url = ''; render(); return; }
  S.imgNote = 'Reading ' + domainOf(link) + '…'; render();
  try {
    const p = await linkPreview(link);
    if (p.image) { d.img_url = p.image; d.img_checked = false; S.imgNote = `Found the main image on ${p.site || domainOf(link)}. Check it’s the right one before publishing.`; }
    else { d.img_url = ''; S.imgNote = 'That page has no share image. Upload a photo or use a branded cover.'; }
  } catch (e) { d.img_url = ''; S.imgNote = e.message + '. Members will see a branded cover.'; }
  render();
}
async function uploadFile(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('That photo is over 5 MB. Pick a smaller one.'); return; }
  S.imgNote = 'Uploading…'; render();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `announcements/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from('images').upload(path, file, { contentType: file.type, upsert: false });
  if (error) { S.imgNote = 'Upload failed: ' + error.message; render(); return; }
  const { data } = sb.storage.from('images').getPublicUrl(path);
  S.draft.img_url = data.publicUrl; S.draft.img_checked = true; S.imgNote = 'Uploaded ✓';
  render();
}

async function publish() {
  const d = S.draft;
  if (!d.title.trim()) return toast('Add a headline first');
  if (d.cta_action !== 'none' && !d.cta_label.trim()) return toast('Add the button text, or choose “No button”');
  const usesImage = d.img_src !== 'cover' && !!d.img_url;
  if (usesImage && !d.img_checked) return toast('Check the image first: tap “Looks right” or change it');
  const row = {
    featured: d.featured, tag: d.tag, title: d.title.trim(), body: d.body.trim(), place: d.place.trim(), show_to: d.show_to,
    cta_label: d.cta_action === 'none' ? '' : d.cta_label.trim(), cta_action: d.cta_action, cta_target: d.cta_target.trim(),
    img_src: usesImage ? d.img_src : 'cover', img_url: usesImage ? d.img_url : '', img_checked: true,
    cover_word: (d.cover_word || d.title.split(':')[0]).trim().toUpperCase().slice(0, 40), cover_color: d.cover_color, live: true,
  };
  S.busy = true; render();
  let error;
  if (S.editingId) ({ error } = await sb.from('announcements').update(row).eq('id', S.editingId));
  else ({ error } = await sb.from('announcements').insert(row));
  S.busy = false;
  if (fail(error)) { render(); return; }
  if (!S.editingId && d.also_feed) await sb.from('feed').insert({ cat: d.tag === 'OPPORTUNITY' ? 'opp' : 'aq', text: 'New: ' + row.title });
  await learn(S.editingId ? 'edit' : 'publish', 'ann');
  const msg = S.editingId ? 'Saved ✓ Live in the app' : (row.featured ? 'Published as featured ✓' : 'Published ✓');
  S.draft = blankDraft(); S.editingId = null; S.imgNote = '';
  await loadAll(); go('manage'); toast(msg + (usesImage ? '' : ' (branded cover)'));
}

// ---------- views ----------
const sel = (name, value, opts) => `<select data-bind="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const SHOW = [['Everyone', 'Everyone'], ['Johor Bahru', 'Johor Bahru'], ['Johor', 'All of Johor'], ['Singapore', 'Singapore'], ['Malaysia', 'All of Malaysia']];
const tagBadge = (t) => { const b = BADGES[t] || BADGES.UPDATE; return `<span class="badge" style="background:${b.bg};color:${b.fg};border:1.5px solid var(--navy)">${esc(t)}</span>`; };

function homeView() {
  const live = S.anns.filter((a) => a.live);
  const toCheck = S.anns.filter((a) => a.img_url && !a.img_checked).length;
  const pending = S.stories.filter((s) => s.status === 'pending').length;
  const feat = live.find((a) => a.featured);
  const g = suggestions();
  SUGS = g;
  const c30 = (k) => S.learn.filter((l) => l.kind === k).length;
  const name = (S.session.user.user_metadata && S.session.user.user_metadata.name) || S.session.user.email.split('@')[0];
  return `<div><h1 class="h1">Hi ${esc(name)}</h1><p class="hint" style="margin:4px 0 0">Featured now: <b style="color:var(--navy)">${feat ? esc(feat.title) : 'nothing yet'}</b></p></div>
  <div class="stats">
    <button type="button" class="stat" data-act="go:manage"><div class="k">LIVE IN APP</div><div class="v">${live.length}</div><div class="h">announcements</div></button>
    <button type="button" class="stat" data-act="go:manage"><div class="k">IMAGES TO CHECK</div><div class="v" style="color:${toCheck ? 'var(--blue)' : 'var(--green-ink)'}">${toCheck}</div><div class="h">${toCheck ? 'tap to review' : 'all clear'}</div></button>
    <button type="button" class="stat" data-act="go:news"><div class="k">STORIES TO REVIEW</div><div class="v" style="color:${pending ? 'var(--blue)' : 'var(--navy)'}">${pending}</div><div class="h">in the news desk</div></button>
    <button type="button" class="stat" data-act="go:more"><div class="k">TICKER</div><div class="v">${S.ticker.length}</div><div class="h">headlines rotating</div></button>
  </div>
  <button type="button" class="btn" data-act="new" style="min-height:52px;box-shadow:3px 3px 0 var(--navy)">+ New announcement</button>
  <section class="sugg">
    <div style="display:flex;align-items:center;gap:10px"><span class="bub">AQ</span><div><h2 class="h2">AQ suggests</h2><div style="font:500 12px var(--sans);color:#BDC8D6">From your content, location and what you publish or skip</div></div></div>
    <label style="margin-top:12px">Readers in
      <select data-bind="loc">${Object.keys(AREAS).map((k) => `<option ${k === S.loc ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
      ${g.length ? g.map((s, i) => `<div class="sg"><span class="kind">${esc(s.kind)}</span>${s.often ? '<span style="font:600 11px var(--sans);color:#BDC8D6;margin-left:8px">you often skip these</span>' : ''}
        <div class="tt">${esc(s.title)}</div><div class="why">Why: ${esc(s.why)}</div>
        <div class="acts"><button type="button" class="btn sm" data-act="sug:${i}">${esc(s.use)}</button><button type="button" class="btn sm" data-act="dis:${i}">Not now</button></div></div>`).join('')
        : `<div class="empty" style="color:#BDC8D6;border-color:#36506F">All caught up for ${esc(S.loc)}.</div>`}
    </div>
    <div class="learn" style="margin-top:12px">↻ AQ learns from what you publish, edit and skip. Last 30 days: ${c30('publish')} published · ${c30('edit')} edited · ${c30('dismiss') + c30('skip')} skipped.</div>
  </section>`;
}

function previewHTML() {
  const d = S.draft;
  const showImg = d.img_src !== 'cover' && d.img_url;
  const a = Object.assign({}, d, { img_url: showImg ? d.img_url : '', img_checked: true, cover_word: d.cover_word || d.title.split(':')[0] || 'AQ SMASH', title: d.title || 'Your headline' });
  const btnTxt = d.cta_action === 'none' ? '' : (d.cta_label || 'Button text');
  if (d.featured) {
    return `<article class="feat" style="margin:0">${coverHTML(a, { featured: true, height: 140 })}<div class="in">
      <div class="meta">${tagBadge(d.tag)}<span class="place">${esc(d.place || (d.show_to === 'Everyone' ? 'All readers' : d.show_to))}</span></div>
      <h3>${esc(d.title || 'Your headline appears here')}</h3><p>${esc(d.body || 'Your details show up here, exactly as members will read them.')}</p>
      ${btnTxt ? `<div class="btn on-dark" style="margin-top:10px">${esc(btnTxt)}</div>` : ''}</div></article>`;
  }
  const c = COVERS[d.cover_color] || COVERS.blue;
  return `<div style="background:#fff;border:1.5px solid var(--navy);padding:10px;display:flex;gap:12px;align-items:center">
    <span class="thumb" style="background:${showImg ? '#DCE4EE' : c.bg}">${showImg ? `<img src="${esc(d.img_url)}" alt="">` : coverHTML(a, { small: true })}</span>
    <span style="flex:1;min-width:0">${tagBadge(d.tag)}<span style="display:block;font:700 14px/1.3 var(--sans);margin-top:4px">${esc(d.title || 'Your headline appears here')}</span></span>
    <span class="plus" aria-hidden="true">+</span></div>`;
}

function postView() {
  const d = S.draft;
  const showImg = d.img_src !== 'cover' && d.img_url;
  const linkish = d.cta_action === 'link' || d.cta_action === 'form';
  const targetLabel = { whatsapp: 'WhatsApp number', link: 'Link', form: 'Form link', app: 'App page (Updates or News)', none: '' }[d.cta_action];
  const targetHint = { whatsapp: '+60 1X-XXX XXXX', link: 'https://…', form: 'https://forms…', app: 'News', none: '' }[d.cta_action];
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h1 class="h1" style="font-size:24px">${S.editingId ? 'Edit announcement' : 'New announcement'}</h1>
    ${S.editingId ? '<button type="button" class="btn ghost sm" style="width:auto" data-act="cancel-edit">Cancel edit</button>' : ''}</div>
  <div><div class="cap" style="font:800 10px var(--display);letter-spacing:.12em;color:var(--muted);margin-bottom:6px">${d.featured ? 'PREVIEW · FEATURED CARD' : 'PREVIEW · IN THE BOARD LIST'}</div>
    <div id="preview">${previewHTML()}</div>
    <p class="hint" style="margin:8px 0 0">${d.featured ? 'Big card on the front page.' : 'Small row; members tap to read more.'} Shown to ${d.show_to === 'Everyone' ? 'everyone' : 'readers in ' + esc(d.show_to)}.</p></div>
  <button type="button" class="switch" role="switch" aria-checked="${d.featured}" data-act="toggle:featured" style="border:1.5px solid var(--navy);padding:10px 12px;background:${d.featured ? '#EEF6F0' : '#fff'}">
    <span><span style="display:block">★ Featured announcement</span><span class="hint" style="font-size:12px">One at a time. Replaces the current featured card.</span></span><span class="tr"></span></button>
  <div class="box2"><div class="cap">THE MESSAGE</div>
    <label class="field">Headline<input data-bind="title" value="${esc(d.title)}" maxlength="160" placeholder="e.g. Grand opening this Saturday"></label>
    <label class="field">Details<textarea data-bind="body" rows="3" maxlength="1200" placeholder="Two or three short lines.">${esc(d.body)}</textarea></label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <label class="field">Type${sel('tag', d.tag, [['UPDATE', 'Update'], ['PINNED', 'Pinned'], ['URGENT', 'Urgent'], ['EVENT', 'Event'], ['COMING SOON', 'Coming soon'], ['OPPORTUNITY', 'Opportunity']])}</label>
      <label class="field">Show to${sel('show_to', d.show_to, SHOW)}</label></div>
    <label class="field">Place label<input data-bind="place" value="${esc(d.place)}" placeholder="e.g. Mount Austin, JB"></label></div>
  <div class="box2"><div class="cap">BUTTON (CALL TO ACTION)</div>
    <label class="field">When tapped${sel('cta_action', d.cta_action, [['whatsapp', 'Open WhatsApp chat'], ['link', 'Open a link'], ['form', 'Open a sign-up form'], ['app', 'Go to a page in the app'], ['none', 'No button']])}</label>
    ${d.cta_action !== 'none' ? `<label class="field">Button text<input data-bind="cta_label" value="${esc(d.cta_label)}" placeholder="e.g. Register now"></label>
    <label class="field">${targetLabel}<input data-bind="cta_target" value="${esc(d.cta_target)}" placeholder="${targetHint}" ${d.cta_action === 'whatsapp' ? 'inputmode="tel"' : 'inputmode="url"'}></label>` : ''}</div>
  <div class="box2"><div class="cap">IMAGE</div>
    <div class="choices">${[['auto', 'Auto from link'], ['upload', 'Upload photo'], ['url', 'Image link'], ['cover', 'Branded cover']].map(([k, l]) => `<button type="button" data-act="img:${k}" aria-pressed="${d.img_src === k}">${l}</button>`).join('')}</div>
    ${S.imgNote ? `<div class="hint">${esc(S.imgNote)}</div>` : d.img_src === 'cover' ? '<div class="hint">A clean AQ-branded cover made from your text. No checking needed.</div>' : ''}
    ${d.img_src === 'auto' ? `<button type="button" class="btn ghost sm" data-act="pull" ${linkish ? '' : 'disabled'}>${linkish ? 'Pull image from the button link' : 'Needs a link or form button'}</button>` : ''}
    ${d.img_src === 'upload' ? '<label class="btn ghost" style="border-style:dashed">Choose from photos or camera<input type="file" accept="image/*" data-act="file" class="sr"></label>' : ''}
    ${d.img_src === 'url' ? `<label class="field">Image link<input data-bind="img_url" value="${esc(d.img_url)}" placeholder="https://…/photo.jpg" inputmode="url"></label>` : ''}
    ${(d.img_src === 'cover' || !showImg) ? `<label class="field">Cover text<input data-bind="cover_word" value="${esc(d.cover_word)}" placeholder="${esc((d.title.split(':')[0] || 'AQ SMASH').toUpperCase())}"></label>
      <div style="display:flex;align-items:center;gap:8px"><span style="flex:1;font:700 13px var(--sans)">Cover colour</span><div class="swatches">${Object.entries(COVERS).map(([k, c]) => `<button type="button" aria-label="${c.label}" aria-pressed="${d.cover_color === k}" data-act="color:${k}" style="background:${c.bg}"></button>`).join('')}</div></div>` : ''}
    ${showImg && !d.img_checked ? '<div class="checkimg">Is this the right image? Check the preview at the top first.<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button type="button" class="btn sm" data-act="img-ok">Looks right ✓</button><button type="button" class="btn ghost sm" data-act="img:upload">Change</button></div></div>' : ''}
    ${showImg && d.img_checked ? '<div class="ok">✓ Image checked by an admin</div>' : ''}</div>
  ${S.editingId ? '' : `<button type="button" class="switch" role="switch" aria-checked="${d.also_feed}" data-act="toggle:also_feed" style="border:1.5px solid var(--navy);padding:10px 12px;background:#fff"><span>Also post a line to the live feed</span><span class="tr"></span></button>`}
  <button type="button" class="btn" data-act="publish" style="min-height:54px;font-size:16px;box-shadow:3px 3px 0 var(--navy)" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Saving…' : S.editingId ? 'Save changes' : 'Publish now'}</button>`;
}

function manageView() {
  if (!S.anns.length) return '<h1 class="h1" style="font-size:24px">In the app now</h1><div class="empty">No announcements yet.</div>';
  return `<h1 class="h1" style="font-size:24px">In the app now</h1><p class="hint" style="margin:-6px 0 0">Tap Edit to change the words, button or image.</p>` + S.anns.map((a) => {
    const c = COVERS[a.cover_color] || COVERS.blue;
    const imgState = a.img_url ? (a.img_checked ? 'photo ✓' : 'photo, needs check') : 'branded cover';
    const btn = a.cta_action === 'none' ? 'none' : `“${a.cta_label}” → ${a.cta_action}${ctaHref(a) || a.cta_action === 'app' ? '' : ' (no link yet)'}`;
    return `<article class="acard ${a.featured ? 'featured' : ''}"><div class="top">
      <span class="thumb" style="flex:0 0 52px;height:52px;background:${a.img_url ? '#DCE4EE' : c.bg}">${a.img_url ? `<img src="${esc(a.img_url)}" alt="">` : coverHTML(a, { small: true })}</span>
      <div style="flex:1;min-width:0"><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${tagBadge(a.tag)}${a.featured ? '<span class="badge" style="background:var(--navy);color:var(--green)">★ FEATURED</span>' : ''}<span class="status" style="color:${a.live ? 'var(--green-ink)' : 'var(--muted)'}">${a.live ? '● Live' : '○ Hidden'}</span></div>
      <div class="tt">${esc(a.title)}</div><div class="mm">Button: <b style="color:var(--navy)">${esc(btn)}</b><br>Image: <b style="color:${a.img_url && !a.img_checked ? 'var(--blue)' : 'var(--muted)'}">${imgState}</b> · ${esc(a.show_to)} · ${sinceLabel(a.created_at)}</div></div></div>
      <div class="acts">${!a.featured && a.live ? `<button type="button" class="btn ghost sm" data-act="feature:${a.id}">★ Feature</button>` : ''}
      <button type="button" class="btn blue sm" data-act="edit:${a.id}">Edit</button>
      <button type="button" class="btn ghost sm" data-act="live:${a.id}">${a.live ? 'Hide' : 'Show'}</button>
      <button type="button" class="btn ghost sm" data-act="del:${a.id}" aria-label="Delete">×</button></div></article>`;
  }).join('');
}

function storyFields(d, prefix) {
  return `<label class="field">Headline<textarea data-bind="${prefix}.title" rows="2" maxlength="200">${esc(d.title)}</textarea></label>
    <label class="field">Summary<textarea data-bind="${prefix}.summary" rows="7" maxlength="800">${esc(d.summary)}</textarea><span class="hint">Shown when members tap the headline. First paragraph is the summary; start a line with • for each key point.</span></label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <label class="field">Show to${sel(prefix + '.show_to', d.show_to, SHOW)}</label>
      <label class="field">Section${sel(prefix + '.cat', d.cat, [['bad', 'Badminton'], ['pickleball', 'Pickleball'], ['tennis', 'Tennis'], ['aq', 'AQ Smash'], ['opp', 'Opportunity']])}</label></div>
    <label class="field">Source name<input data-bind="${prefix}.source" value="${esc(d.source)}" placeholder="e.g. New Straits Times"></label>
    <label class="field">Image link (optional)<input data-bind="${prefix}.image_url" value="${esc(d.image_url)}" inputmode="url"></label>
    ${d.image_url ? `<img src="${esc(d.image_url)}" alt="" style="width:100%;aspect-ratio:16/9;object-fit:cover;border:1.5px solid var(--navy)">` : ''}
    <button type="button" class="switch" role="switch" aria-checked="${d.is_lead}" data-act="toggle:${prefix}.is_lead"><span>Make this the lead story</span><span class="tr"></span></button>`;
}

function newsView() {
  const n = S.newStory;
  const auto = (S.settings.auto_publish ?? 'true') !== 'false';
  const lastRun = Number(S.settings.news_last_run || 0);
  let h = `<h1 class="h1" style="font-size:24px">News desk</h1><p class="hint" style="margin:-6px 0 0">AQ collects Johor and Malaysia badminton, pickleball and tennis news every 20 minutes. Edit, unpublish or skip anything.</p>`;
  h += `<div class="box2"><div class="cap">AUTO NEWS</div>
    <button type="button" class="switch" role="switch" aria-checked="${auto}" data-act="auto-toggle" style="border-top:0"><span><span style="display:block">Publish new stories automatically</span><span class="hint" style="font-size:12px">${auto ? 'New stories go live straight away.' : 'New stories wait here for you to publish.'}</span></span><span class="tr"></span></button>
    <button type="button" class="btn blue" data-act="fetch-now" ${S.fetching ? 'disabled' : ''}>${S.fetching ? 'Checking…' : 'Check for news now'}</button>
    <div class="hint">${lastRun ? 'Last checked ' + timeAgo(lastRun) + '.' : 'Not checked yet.'}</div></div>`;
  h += `<div class="box2"><div class="cap">ADD A STORY FROM A LINK</div>
    <div style="display:grid;grid-template-columns:1fr auto;gap:8px"><label class="field"><span class="sr">Article link</span><input data-bind="newStory.link" value="${esc(n.link)}" placeholder="Paste a news link" inputmode="url"></label>
    <button type="button" class="btn blue sm" style="width:auto;min-height:48px" data-act="read-link">Read it</button></div>
    ${S.newStoryOpen ? storyFields(n, 'newStory') + `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button type="button" class="btn ghost" data-act="story-save:pending">Save for later</button><button type="button" class="btn" data-act="story-save:published">Publish now</button></div>` : '<button type="button" class="btn ghost sm" data-act="story-blank">Or write one yourself</button>'}</div>`;
  h += S.stories.map((s) => {
    const t = CATS[s.cat] || CATS.bad;
    if (S.storyEdit === s.id) return `<article class="acard"><div class="cap" style="font:800 11px var(--display);letter-spacing:.14em;color:var(--blue)">EDITING STORY</div><div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">${storyFields(S.storyDraft, 'storyDraft')}
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px"><button type="button" class="btn" data-act="story-update">Save</button><button type="button" class="btn ghost" data-act="story-cancel">Cancel</button></div></div></article>`;
    const pend = s.status === 'pending', pub = s.status === 'published';
    return `<article class="acard"><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="ctag" style="background:${t.bg};color:${t.fg}">${t.label}</span>
      ${s.is_johor ? '<span class="badge" style="background:var(--green);color:var(--navy);border:1.5px solid var(--navy)">JOHOR</span>' : ''}${s.auto ? '<span class="badge" style="background:var(--paper);color:var(--muted);border:1.5px solid var(--line)">AUTO</span>' : ''}
      <span class="status" style="color:${pend ? 'var(--blue)' : pub ? 'var(--green-ink)' : 'var(--muted)'}">${pend ? '● Waiting for review' : pub ? '● Live in app' : '○ Skipped'}</span>${s.is_lead ? '<span class="badge" style="background:var(--navy);color:var(--green)">LEAD</span>' : ''}<span class="hint" style="font-size:11px">${timeAgo(s.news_at || s.created_at)}</span></div>
      <div class="tt">${esc(s.title)}</div>${s.summary ? `<div class="mm">${esc(s.summary.split('\n')[0].slice(0, 180))}${/(^|\n)• /.test(s.summary) ? ' · <b>key points ✓</b>' : ''}</div>` : '<div class="mm">No summary yet</div>'}<div class="mm">${s.source_url ? `<a href="${esc(s.source_url)}" target="_blank" rel="noopener">${esc(s.source || 'Source')} ↗</a>` : esc(s.source || 'No source')} · Shown to <b style="color:var(--navy)">${esc(s.show_to)}</b></div>
      <div class="acts"><button type="button" class="btn blue sm" data-act="story-edit:${s.id}">Edit</button>
      <button type="button" class="btn ${pend ? '' : 'ghost'} sm" data-act="story-status:${s.id}:${pend ? 'published' : pub ? 'pending' : 'pending'}">${pend ? 'Publish' : pub ? 'Unpublish' : 'Restore'}</button>
      ${pub && !s.is_lead ? `<button type="button" class="btn ghost sm" data-act="story-lead:${s.id}">Make lead</button>` : ''}
      ${pend ? `<button type="button" class="btn ghost sm" data-act="story-status:${s.id}:skipped">Skip</button>` : ''}
      <button type="button" class="btn ghost sm" data-act="story-del:${s.id}" aria-label="Delete story">×</button></div></article>`;
  }).join('');
  return h;
}

function moreView() {
  return `<section class="box2"><h2 class="h2">Breaking ticker</h2><p class="hint" style="margin:-8px 0 0">Rotates in the band at the bottom of the app.</p>
    ${S.ticker.map((t, i) => `<div style="display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line);padding-bottom:8px"><span style="font:900 13px var(--display);color:var(--blue)">${i + 1}</span><span style="flex:1;font:600 13.5px/1.35 var(--sans)">${esc(t.text)}</span><button type="button" class="btn ghost sm" style="width:44px" data-act="tick-del:${t.id}" aria-label="Remove headline">×</button></div>`).join('') || '<div class="empty">No headlines yet.</div>'}
    <label class="field"><span class="sr">New headline</span><input id="tickIn" maxlength="140" placeholder="Add a breaking headline"></label>
    <button type="button" class="btn blue" data-act="tick-add">Add to ticker</button></section>
  <section class="box2"><h2 class="h2">Live feed</h2><p class="hint" style="margin:-8px 0 0">Quick one-liners. They pop in with a NEW badge.</p>
    <label class="field"><span class="sr">Feed update</span><input id="feedIn" maxlength="200" placeholder="e.g. Doors open at 10am tomorrow"></label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><label class="field"><span class="sr">Section</span><select id="feedCat">${Object.entries(CATS).map(([k, c]) => `<option value="${k}">${c.name}</option>`).join('')}</select></label><button type="button" class="btn" data-act="feed-add">Push live</button></div>
    ${S.feed.slice(0, 6).map((f) => `<div style="display:flex;gap:8px;align-items:flex-start;border-bottom:1px solid var(--line);padding-bottom:8px"><span style="flex:0 0 46px;font:700 11px var(--sans);color:var(--muted)">${feedWhen(f.created_at)}</span><span style="flex:1;font:600 13px/1.35 var(--sans)">${esc(f.text)}</span><button type="button" class="btn ghost sm" style="width:44px" data-act="feed-del:${f.id}" aria-label="Delete">×</button></div>`).join('')}</section>
  <section class="box2"><h2 class="h2">Front page corner</h2>
    <label class="field">Quote<textarea id="setQuote" rows="2" maxlength="160">${esc(S.settings.quote || '')}</textarea></label>
    <label class="field">Quote by<input id="setQuoteBy" maxlength="40" value="${esc(S.settings.quote_by || '')}"></label>
    <label class="field">Today's one thing<textarea id="setOne" rows="2" maxlength="160">${esc(S.settings.one_thing || '')}</textarea></label>
    <button type="button" class="btn" data-act="settings-save">Save</button></section>
  <section class="box2"><h2 class="h2">Admins</h2><p class="hint" style="margin:-8px 0 0">People who can post. They sign in here with their own email and password.</p>
    ${S.admins.map((a) => `<div style="display:flex;align-items:center;gap:10px"><span style="flex:1;font:600 13.5px var(--sans);word-break:break-all">${esc(a.email)}</span>${a.email === S.session.user.email.toLowerCase() ? '<span class="hint">you</span>' : `<button type="button" class="btn ghost sm" style="width:auto" data-act="admin-del:${esc(a.email)}">Remove</button>`}</div>`).join('')}
    <label class="field"><span class="sr">New admin email</span><input id="adminIn" type="email" placeholder="name@example.com" autocomplete="off"></label>
    <button type="button" class="btn blue" data-act="admin-add">Add admin</button></section>
  <section class="box2"><h2 class="h2">Your account</h2><p class="hint" style="margin:-8px 0 0">${esc(S.session.user.email)}</p>
    <label class="field">New password<input id="pwIn" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters"></label>
    <button type="button" class="btn ghost" data-act="pw">Change password</button>
    <button type="button" class="btn dark" data-act="signout">Sign out</button></section>`;
}

function signInView(msg = '') {
  $('#tabs').hidden = true; $('#avatar').hidden = true;
  if (S.recovery) return `<div class="signin"><h1 class="h1">Set a new password</h1>
    <label class="field">New password<input id="pwNew" type="password" autocomplete="new-password" minlength="8"></label>
    <button type="button" class="btn" data-act="pw-recover">Save password</button>${msg ? `<div class="err">${esc(msg)}</div>` : ''}</div>`;
  const head = `<div><h1 class="h1">Admin sign in</h1><p class="hint" style="margin:6px 0 0">For the AQ Smash team. Members don’t need an account.</p></div>`;
  const note = msg ? `<div class="${S.signOk ? 'ok' : 'err'}" role="alert">${esc(msg)}</div>` : '';
  // password sign-in, kept as a fallback
  if (S.pwMode) return `<div class="signin">${head}
    <form id="signin" style="display:flex;flex-direction:column;gap:12px">
      <label class="field">Email<input id="em" type="email" autocomplete="username" value="${esc(S.codeEmail || lastEmail())}" required></label>
      <label class="field">Password<input id="pw" type="password" autocomplete="current-password" required></label>
      <button class="btn" type="submit" style="min-height:52px">Sign in</button></form>
    <button type="button" class="btn ghost sm" data-act="forgot">Forgot password?</button>
    <button type="button" class="linkbtn" data-act="code-mode">Email me a sign-in code instead</button>${note}</div>`;
  // step 2: type the code from the email
  if (S.codeEmail) {
    const wait = Math.max(0, Math.ceil((S.resendAt - Date.now()) / 1000));
    return `<div class="signin">${head}
    <form id="verify-code" style="display:flex;flex-direction:column;gap:12px">
      <p class="hint" style="margin:0">We emailed a sign-in code to <b style="color:var(--navy)">${esc(S.codeEmail)}</b>. It works once and expires in an hour. Check spam if it’s not there in a minute.</p>
      <label class="field">Sign-in code<input id="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" placeholder="6-digit code" style="font:800 24px var(--sans);letter-spacing:.3em;text-align:center" required></label>
      <button class="btn" type="submit" style="min-height:52px">Sign in</button></form>
    <p class="hint" style="margin:0">Got a link instead of a code? Just tap the link in the email on this phone.</p>
    <button type="button" class="btn ghost sm" data-act="code-resend" ${wait ? 'disabled' : ''}>${wait ? `Send a new code in ${wait}s` : 'Send a new code'}</button>
    <button type="button" class="linkbtn" data-act="code-reset">Use a different email</button>${note}</div>`;
  }
  // step 1: email only
  return `<div class="signin">${head}
    <form id="signin-code" style="display:flex;flex-direction:column;gap:12px">
      <label class="field">Email<input id="em" type="email" autocomplete="username" inputmode="email" value="${esc(lastEmail())}" required></label>
      <button class="btn" type="submit" style="min-height:52px">Email me a sign-in code</button></form>
    <p class="hint" style="margin:0">No password needed. We’ll send a one-time code to your email.</p>
    <button type="button" class="linkbtn" data-act="pw-mode">Sign in with a password instead</button>${note}</div>`;
}

function render() {
  const view = $('#view');
  if (!S.session || !S.admin) { view.className = ''; view.style.cssText = 'height:100%;display:flex'; view.innerHTML = signInView(S.signMsg || ''); return; }
  view.className = 'page'; view.style.cssText = '';
  $('#avatar').hidden = false; $('#avatar').textContent = (S.session.user.email || '?')[0];
  view.innerHTML = S.tab === 'home' ? homeView() : S.tab === 'post' ? postView() : S.tab === 'manage' ? manageView() : S.tab === 'news' ? newsView() : moreView();
  const toCheck = S.anns.filter((a) => a.img_url && !a.img_checked).length;
  const pending = S.stories.filter((s) => s.status === 'pending').length;
  const tabs = [['home', 'Home', 0], ['post', 'Post', 0], ['manage', 'Manage', toCheck], ['news', 'News', pending], ['more', 'More', 0]];
  const nav = $('#tabs'); nav.hidden = false;
  nav.innerHTML = tabs.map(([k, l, n]) => `<button type="button" data-act="go:${k}" aria-current="${S.tab === k ? 'page' : 'false'}"><span class="ic">${ICONS[k === 'manage' ? 'ann' : k] || ICONS.home}</span>${l}${n ? `<span class="cnt" aria-label="${n} to review">${n}</span>` : ''}</button>`).join('');
}

// ---------- events ----------
function setPath(path, value) {
  const parts = path.split('.');
  if (parts.length === 1) { if (path === 'loc') S.loc = value; else S.draft[path] = value; return; }
  S[parts[0]][parts[1]] = value;
}
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-bind]'); if (!el || el.tagName === 'SELECT') return;
  setPath(el.dataset.bind, el.value);
  if (el.dataset.bind === 'img_url') S.draft.img_checked = false;
  if (el.dataset.bind === 'cta_target') S.draft.img_checked = false;
  const p = $('#preview'); if (p) p.innerHTML = previewHTML();
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.matches('[data-bind]') && el.tagName === 'SELECT') { setPath(el.dataset.bind, el.value); render(); }
  if (el.matches('[data-act="file"]')) uploadFile(el.files && el.files[0]);
});
// ---------- email code sign-in ----------
const lastEmail = () => { try { return localStorage.getItem('aq.adminEmail') || ''; } catch { return ''; } };
async function sendCode(email) {
  S.signOk = false;
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + '/admin' } });
  if (error) {
    const m = String(error.message || '');
    S.signMsg = /rate|seconds|too many/i.test(m) ? 'Too many codes requested. Please wait a minute, then try again.'
      : /signups not allowed|not found|invalid/i.test(m) ? 'That email isn’t an AQ Times admin account.'
      : 'Couldn’t send the code. Please try again.';
    render(); return false;
  }
  try { localStorage.setItem('aq.adminEmail', email); } catch {}
  S.codeEmail = email; S.resendAt = Date.now() + 60000; S.signMsg = ''; render();
  setTimeout(() => $('#otp') && $('#otp').focus(), 50);
  clearInterval(S.resendTimer);
  // count down on the resend button only, so a half-typed code is never wiped
  S.resendTimer = setInterval(() => {
    const b = document.querySelector('[data-act="code-resend"]');
    if (!S.codeEmail || S.session || !b) return clearInterval(S.resendTimer);
    const wait = Math.max(0, Math.ceil((S.resendAt - Date.now()) / 1000));
    b.disabled = wait > 0; b.textContent = wait ? `Send a new code in ${wait}s` : 'Send a new code';
    if (!wait) clearInterval(S.resendTimer);
  }, 1000);
  return true;
}
document.addEventListener('submit', async (e) => {
  if (e.target.id === 'signin-code') {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Sending…';
    await sendCode($('#em').value.trim().toLowerCase());
    return;
  }
  if (e.target.id === 'verify-code') {
    e.preventDefault();
    const token = $('#otp').value.replace(/\D/g, '');
    if (token.length < 6) { S.signOk = false; S.signMsg = 'Type the code from the email.'; render(); return; }
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Checking…';
    const { error } = await sb.auth.verifyOtp({ email: S.codeEmail, token, type: 'email' });
    if (error) { S.signOk = false; S.signMsg = /expired/i.test(error.message) ? 'That code has expired. Send a new one.' : 'That code didn’t work. Check it and try again.'; render(); }
    return;
  }
  if (e.target.id !== 'signin') return;
  e.preventDefault();
  const email = $('#em').value.trim(), password = $('#pw').value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { S.signMsg = 'That email and password didn’t match.'; render(); }
});

let SUGS = [];
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el || el.matches('input,select')) return;
  const [act, a1, a2] = el.dataset.act.split(':');
  const id = a1;
  switch (act) {
    case 'go': go(a1); break;
    case 'new': S.draft = blankDraft(); S.editingId = null; S.imgNote = ''; go('post'); break;
    case 'cancel-edit': S.draft = blankDraft(); S.editingId = null; S.imgNote = ''; go('manage'); break;
    case 'toggle': { const path = el.dataset.act.slice(7); const parts = path.split('.'); if (parts.length === 1) S.draft[path] = !S.draft[path]; else S[parts[0]][parts[1]] = !S[parts[0]][parts[1]]; render(); break; }
    case 'img': S.draft.img_src = a1; S.imgNote = ''; if (a1 === 'cover') { S.draft.img_url = ''; S.draft.img_checked = true; } else if (a1 === 'auto') { S.draft.img_checked = false; autoPull(); return; } else { S.draft.img_url = ''; S.draft.img_checked = false; } render(); break;
    case 'pull': autoPull(); break;
    case 'img-ok': S.draft.img_checked = true; render(); break;
    case 'color': S.draft.cover_color = a1; render(); break;
    case 'publish': publish(); break;
    case 'feature': featureAnn(id); break;
    case 'edit': editAnn(id); break;
    case 'live': { const a = S.anns.find((x) => x.id === id); const { error } = await sb.from('announcements').update({ live: !a.live, featured: a.live ? false : a.featured }).eq('id', id); if (!fail(error)) { await refresh(); toast(a.live ? 'Hidden from app' : 'Live in app ✓'); } break; }
    case 'del': if (confirm('Delete this announcement for good?')) { const { error } = await sb.from('announcements').delete().eq('id', id); if (!fail(error)) { await refresh(); toast('Deleted'); } } break;
    case 'sug': { const s = SUGS[Number(a1)]; if (s) { await learn('apply', s.key); await s.run(); } break; }
    case 'dis': { const s = SUGS[Number(a1)]; if (s) { await learn('dismiss', s.key); render(); toast('Noted. AQ will suggest fewer like this.'); } break; }
    case 'read-link': {
      const link = S.newStory.link.trim(); if (!link) return toast('Paste a link first');
      toast('Reading ' + domainOf(link) + '…');
      try { const p = await linkPreview(link); Object.assign(S.newStory, { title: p.title || '', summary: p.description || '', source: p.site || domainOf(link), source_url: p.url || link, image_url: p.image || '' }); S.newStoryOpen = true; render(); toast('Filled in from the page. Check and edit it.'); }
      catch (err) { toast(err.message); }
      break;
    }
    case 'story-blank': S.newStoryOpen = true; render(); break;
    case 'story-save': {
      const n = S.newStory; if (!n.title.trim()) return toast('Add a headline first');
      const row = { cat: n.cat, title: n.title.trim(), summary: n.summary.trim(), source: n.source.trim(), source_url: n.source_url || n.link.trim(), image_url: n.image_url.trim(), show_to: n.show_to, is_lead: !!n.is_lead, status: a1 };
      const { error } = await sb.from('stories').insert(row);
      if (!fail(error)) { await learn(a1 === 'published' ? 'publish' : 'edit', 'story'); S.newStory = blankStory(); S.newStoryOpen = false; await refresh(); toast(a1 === 'published' ? 'Story published ✓' : 'Saved for review'); }
      break;
    }
    case 'story-edit': S.storyEdit = id; S.storyDraft = Object.assign({}, S.stories.find((s) => s.id === id)); render(); break;
    case 'story-cancel': S.storyEdit = null; S.storyDraft = null; render(); break;
    case 'story-update': { const d = S.storyDraft; const { error } = await sb.from('stories').update({ title: d.title, summary: d.summary, show_to: d.show_to, cat: d.cat, source: d.source, image_url: d.image_url, is_lead: !!d.is_lead }).eq('id', S.storyEdit); if (!fail(error)) { await learn('edit', 'story:' + S.storyEdit); S.storyEdit = null; S.storyDraft = null; await refresh(); toast('Story updated ✓'); } break; }
    case 'story-status': setStory(id, { status: a2 }, a2 === 'published' ? 'Story published ✓' : a2 === 'skipped' ? 'Story skipped' : 'Back in review', a2 === 'published' ? 'publish' : a2 === 'skipped' ? 'skip' : 'edit'); break;
    case 'story-lead': setStory(id, { is_lead: true }, 'Now the lead story ✓', 'edit'); break;
    case 'auto-toggle': {
      const next = (S.settings.auto_publish ?? 'true') === 'false' ? 'true' : 'false';
      const { error } = await sb.from('settings').upsert({ key: 'auto_publish', value: next });
      if (!fail(error)) { await refresh(); toast(next === 'true' ? 'New stories will go live automatically' : 'New stories will wait for you'); }
      break;
    }
    case 'fetch-now': {
      S.fetching = true; render();
      const { data, error } = await sb.functions.invoke('fetch-news', { body: {} });
      S.fetching = false;
      if (error || !data) { toast('Couldn’t check right now'); render(); break; }
      await refresh();
      toast(data.skipped ? 'Checked moments ago. Try again in ' + data.next_in_s + 's' : (data.inserted ? data.inserted + ' new stor' + (data.inserted === 1 ? 'y' : 'ies') + ' added ✓' : 'No new stories right now'));
      break;
    }
    case 'story-del': if (confirm('Delete this story?')) { const { error } = await sb.from('stories').delete().eq('id', id); if (!fail(error)) { await refresh(); toast('Story deleted'); } } break;
    case 'tick-add': { const v = $('#tickIn').value.trim(); if (!v) return toast('Type a headline first'); const { error } = await sb.from('ticker').insert({ text: v, sort: S.ticker.length + 1 }); if (!fail(error)) { await refresh(); toast('Added to ticker ✓'); } break; }
    case 'tick-del': { const { error } = await sb.from('ticker').delete().eq('id', id); if (!fail(error)) { await refresh(); toast('Headline removed'); } break; }
    case 'feed-add': { const v = $('#feedIn').value.trim(); if (!v) return toast('Type an update first'); const { error } = await sb.from('feed').insert({ text: v, cat: $('#feedCat').value }); if (!fail(error)) { await refresh(); toast('Pushed to the live feed ✓'); } break; }
    case 'feed-del': { const { error } = await sb.from('feed').delete().eq('id', id); if (!fail(error)) { await refresh(); toast('Removed'); } break; }
    case 'settings-save': {
      const rows = [{ key: 'quote', value: $('#setQuote').value.trim() }, { key: 'quote_by', value: $('#setQuoteBy').value.trim() }, { key: 'one_thing', value: $('#setOne').value.trim() }];
      const { error } = await sb.from('settings').upsert(rows); if (!fail(error)) { await refresh(); toast('Saved ✓'); } break;
    }
    case 'admin-add': { const v = $('#adminIn').value.trim().toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(v)) return toast('Enter a valid email'); const { error } = await sb.from('admins').insert({ email: v }); if (!fail(error)) { await refresh(); toast('Added. They can now sign in or reset a password with that email.'); } break; }
    case 'admin-del': { const email = el.dataset.act.slice('admin-del:'.length); if (confirm(`Remove ${email} as an admin?`)) { const { error } = await sb.from('admins').delete().eq('email', email); if (!fail(error)) { await refresh(); toast('Removed'); } } break; }
    case 'pw': { const v = $('#pwIn').value; if (v.length < 8) return toast('Use at least 8 characters'); const { error } = await sb.auth.updateUser({ password: v }); if (!fail(error)) { $('#pwIn').value = ''; toast('Password changed ✓'); } break; }
    case 'pw-recover': { const v = $('#pwNew').value; if (v.length < 8) { S.signMsg = 'Use at least 8 characters'; render(); return; } const { error } = await sb.auth.updateUser({ password: v }); if (error) { S.signMsg = error.message; render(); } else { S.recovery = false; history.replaceState(null, '', '/admin'); await boot(); toast('Password saved ✓'); } break; }
    case 'forgot': { const email = ($('#em') && $('#em').value.trim()) || ''; if (!email) { S.signMsg = 'Type your email above first.'; render(); return; } await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/admin' }); S.signMsg = 'If that email is an admin account, a reset link is on its way.'; render(); break; }
    case 'signout': await sb.auth.signOut(); S.session = null; S.admin = false; S.codeEmail = ''; render(); break;
    case 'pw-mode': S.pwMode = true; S.signMsg = ''; render(); break;
    case 'code-mode': S.pwMode = false; S.signMsg = ''; render(); break;
    case 'code-reset': S.codeEmail = ''; S.signMsg = ''; render(); break;
    case 'code-resend': if (S.codeEmail && Date.now() >= S.resendAt) { if (await sendCode(S.codeEmail)) { S.signOk = true; S.signMsg = 'New code sent.'; render(); } } break;
    default: break;
  }
});

// ---------- boot ----------
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  S.session = session;
  if (!session) { S.admin = false; render(); return; }
  const { data } = await sb.rpc('is_admin');
  S.admin = data === true;
  if (!S.admin) { S.signMsg = `${session.user.email} isn’t an AQ Times admin. Ask an admin to add you.`; await sb.auth.signOut(); S.session = null; render(); return; }
  S.signMsg = ''; S.codeEmail = ''; S.pwMode = false;
  await loadAll(); render();
}
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') { S.recovery = true; S.session = null; render(); return; }
  if (event === 'SIGNED_IN' && !S.recovery) { boot(); }
});
sb.channel('aq-times-admin')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => { if (S.admin && S.tab !== 'post') refresh(); })
  .on('postgres_changes', { event: '*', schema: 'public', table: 'stories' }, () => { if (S.admin && !S.storyEdit && !S.newStoryOpen) refresh(); })
  .subscribe();
boot();
registerSW();

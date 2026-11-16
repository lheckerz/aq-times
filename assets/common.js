// Shared helpers for The AQ Times
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

export const SUPABASE_URL = 'https://phucvubabltiicbyynxj.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_xKWRbMXn5vKRTHiN0g8HkQ_SiP2bZjM';
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);

export const COVERS = {
  blue: { bg: '#21558A', fg: '#FFFFFF', accent: '#8FD69D', line: 'rgba(255,255,255,0.18)', label: 'AQ Blue' },
  green: { bg: '#43A055', fg: '#12263F', accent: '#FFFFFF', line: 'rgba(18,38,63,0.18)', label: 'Smash Green' },
  navy: { bg: '#12263F', fg: '#FFFFFF', accent: '#43A055', line: 'rgba(255,255,255,0.14)', label: 'Navy' },
  mint: { bg: '#DDF1E2', fg: '#1F5E2D', accent: '#1F5E2D', line: 'rgba(31,94,45,0.15)', label: 'Mint' },
};
export const BADGES = {
  'COMING SOON': { bg: '#21558A', fg: '#FFFFFF', label: 'SOON' },
  UPDATE: { bg: '#43A055', fg: '#12263F', label: 'UPDATE' },
  PINNED: { bg: '#12263F', fg: '#FFFFFF', label: 'PINNED' },
  URGENT: { bg: '#B42318', fg: '#FFFFFF', label: 'URGENT' },
  EVENT: { bg: '#21558A', fg: '#FFFFFF', label: 'EVENT' },
  OPPORTUNITY: { bg: '#DDF1E2', fg: '#1F5E2D', label: 'OPP' },
};
export const CATS = {
  aq: { label: 'AQ SMASH', bg: '#43A055', fg: '#12263F', name: 'AQ Smash' },
  bad: { label: 'BADMINTON', bg: '#12263F', fg: '#FFFFFF', name: 'Badminton' },
  johor: { label: 'JOHOR', bg: '#FFFFFF', fg: '#12263F', name: 'Johor' },
  opp: { label: 'OPPORTUNITY', bg: '#DDF1E2', fg: '#1F5E2D', name: 'Opportunity' },
};
export const AREAS = {
  'Johor Bahru': { lat: 1.4927, lon: 103.7414, place: 'Johor Bahru' },
  Johor: { lat: 2.0301, lon: 103.3185, place: 'Kluang, Johor' },
  Singapore: { lat: 1.3521, lon: 103.8198, place: 'Singapore' },
  Malaysia: { lat: 3.139, lon: 101.6869, place: 'Kuala Lumpur' },
};

// Who sees a piece of content: "Johor" includes Johor Bahru; "Malaysia" includes all of Johor.
export function visibleTo(showTo, area) {
  if (!showTo || showTo === 'Everyone') return true;
  if (showTo === area) return true;
  if (showTo === 'Johor' && area === 'Johor Bahru') return true;
  if (showTo === 'Malaysia' && (area === 'Johor Bahru' || area === 'Johor')) return true;
  return false;
}

const KL = 'Asia/Kuala_Lumpur';
export const fmtDateLong = (d = new Date()) => d.toLocaleDateString('en-GB', { timeZone: KL, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase().replace(',', ',');
export const fmtTime = (d) => new Date(d).toLocaleTimeString('en-GB', { timeZone: KL, hour: '2-digit', minute: '2-digit' });
export const fmtDay = (d) => new Date(d).toLocaleDateString('en-GB', { timeZone: KL, day: 'numeric', month: 'short' });
export function sinceLabel(d) {
  const t = new Date(d);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: KL });
  const that = t.toLocaleDateString('en-CA', { timeZone: KL });
  if (today === that) return 'today';
  return 'since ' + t.toLocaleDateString('en-US', { timeZone: KL, month: 'short', day: 'numeric' });
}
export function feedWhen(d) {
  const t = new Date(d);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: KL });
  return t.toLocaleDateString('en-CA', { timeZone: KL }) === today ? fmtTime(t) : fmtDay(t);
}

// Where a call-to-action button goes
export function ctaHref(a) {
  const target = (a.cta_target || '').trim();
  if (a.cta_action === 'whatsapp') {
    const digits = target.replace(/[^\d]/g, '');
    if (!digits) return '';
    const msg = encodeURIComponent(`Hi AQ Smash! I saw "${a.title}" on The AQ Times.`);
    return `https://wa.me/${digits}?text=${msg}`;
  }
  if (a.cta_action === 'link' || a.cta_action === 'form') {
    if (!target) return '';
    return /^https?:\/\//i.test(target) ? target : 'https://' + target;
  }
  return '';
}
export const hasButton = (a) => a.cta_action !== 'none' && a.cta_label && (a.cta_action === 'app' || !!ctaHref(a));

export function coverHTML(a, { height = 150, featured = false, small = false } = {}) {
  const c = COVERS[a.cover_color] || COVERS.blue;
  if (a.img_url && a.img_checked) {
    return `<div class="cover" style="height:${height}px"><img src="${esc(a.img_url)}" alt="${esc(a.title)}" loading="lazy">${featured ? '<span class="fbadge">★ FEATURED</span>' : ''}</div>`;
  }
  const word = a.cover_word || (a.title || '').split(':')[0];
  if (small) return `<span style="position:absolute;left:5px;bottom:4px;right:3px;font:italic 900 9.5px/1 var(--display);color:${c.fg}">${esc(word.toUpperCase().slice(0, 16))}</span>`;
  return `<div class="cover" role="img" aria-label="${esc(word)}" style="height:${height}px;background:${c.bg}">
    <svg class="lines" viewBox="0 0 350 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g fill="none" stroke="${c.line}" stroke-width="2"><path d="M150 -10 L350 34 L350 180 L90 140 Z"/><path d="M170 24 L350 62"/><path d="M245 10 L218 160"/></g></svg>
    ${featured ? '<span class="fbadge">★ FEATURED</span>' : ''}
    <div class="cw"><div class="kick" style="color:${c.accent}">${esc(a.place || a.tag)}</div><div class="word" style="color:${c.fg}">${esc(word.toUpperCase())}</div></div></div>`;
}
export function thumbHTML(a) {
  const c = COVERS[a.cover_color] || COVERS.blue;
  if (a.img_url && a.img_checked) return `<span class="thumb" aria-hidden="true"><img src="${esc(a.img_url)}" alt="" loading="lazy"></span>`;
  return `<span class="thumb" aria-hidden="true" style="background:${c.bg}">${coverHTML(a, { small: true })}</span>`;
}

export const ICONS = {
  today: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/></svg>',
  ann: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10v4h4l6 4V6L7 10H3z"/><path d="M17 9a4 4 0 0 1 0 6"/></svg>',
  news: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V5h11l5 5v9z"/><path d="M8 13h8M8 16h5"/></svg>',
  me: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  post: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/></svg>',
  more: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
};

export function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

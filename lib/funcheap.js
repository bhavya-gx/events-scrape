// Second live source, broader than Luma's tech feed: SF Funcheap runs on
// WordPress and exposes its posts through the standard public wp-json REST
// API, no key needed. Date/cost aren't structured fields there, they're
// written into the post body ("Date: 09/26/2026", "Cost: FREE"), so this
// pulls them out with a couple of regexes rather than an AI parse. Covers
// come from the featured-image media records, then og:image as a fallback.

const POSTS_URL = "https://sf.funcheap.com/wp-json/wp/v2/posts?per_page=12";
const MEDIA_URL = "https://sf.funcheap.com/wp-json/wp/v2/media";
const CACHE_MS = 10 * 60 * 1000;
const FORCE_FLOOR_MS = 60 * 1000;
const UA = { "User-Agent": "Mozilla/5.0 (compatible; sf-perks-sweep demo)" };

let cache = { at: 0, posts: [] };

function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8217;|&#8216;/g, "'")
    .replace(/&#8211;|&#8212;/g, "-")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// Keeps line breaks (block tags -> \n) before stripping the rest, since the
// Date:/Cost: labels only parse reliably when each is on its own line.
function toLines(html) {
  return decodeEntities(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function firstImage(html) {
  const m = String(html ?? "").match(/<img[^>]+src="([^"]+)"/);
  return m ? m[1] : null;
}

function field(lines, label) {
  const re = new RegExp(`^${label}:\\s*(.+)$`, "i");
  for (const line of lines) {
    const m = line.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i;
// A weekday right before the month is a strong signal it is the event date
// ("Friday, September 25"), unlike a bare "July 31st" in an early-bird line.
const WEEKDAY_DATE_RE = /\b(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\.?,?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i;

function nextOccurrence(month, day) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  let d = new Date(Date.UTC(now.getFullYear(), month, day));
  if (d < today - 7 * 86400000) d = new Date(Date.UTC(now.getFullYear() + 1, month, day));
  return d.toISOString().slice(0, 10);
}
const monthIndex = (abbr) => MONTHS.findIndex((m) => m.startsWith(abbr.toLowerCase()));

// Trusts: a labeled Date/When line, a full MM/DD/YYYY anywhere, or a
// weekday + month + day anywhere. Most Funcheap posts keep their date in
// event metadata the public API does not expose, so many stay undated on
// purpose rather than guessed from stray month names in the body.
function dateISO(lines, dateText) {
  const all = lines.join("\n");
  const labeled = [dateText, field(lines, "When"), field(lines, "Dates")].filter(Boolean).join(" | ");
  const full = (labeled + "\n" + all).match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (full) return `${full[3]}-${full[1].padStart(2, "0")}-${full[2].padStart(2, "0")}`;
  const named = labeled.match(MONTH_RE);
  if (named) return nextOccurrence(monthIndex(named[1]), Number(named[2]));
  const wd = all.match(WEEKDAY_DATE_RE);
  if (wd) return nextOccurrence(monthIndex(wd[1]), Number(wd[2]));
  return null;
}

// Funcheap titles end with a parenthetical: usually the area ("... Coloring
// Party (SF)"), sometimes a date range ("... Pop-Up (Sept. 26-27)").
function splitTitle(raw) {
  const m = raw.match(/^(.*?)\s*\(([^()]{2,40})\)\s*$/);
  if (!m) return { name: raw, area: null, titleDate: null };
  const inner = m[2].trim();
  if (MONTH_RE.test(inner) || /^\d{1,2}\/\d{1,2}/.test(inner)) return { name: m[1].trim(), area: null, titleDate: inner };
  return { name: m[1].trim(), area: inner === "SF" ? "San Francisco" : inner, titleDate: null };
}

function toPost(p) {
  const lines = toLines(p.content?.rendered);
  const { name, area, titleDate } = splitTitle(decodeEntities(p.title?.rendered).replace(/<[^>]+>/g, ""));
  const date = field(lines, "Date") || titleDate;
  const excerpt = toLines(p.excerpt?.rendered).join(" ");
  const bodyLead = lines.filter((l) => !/^(date|time|cost|location|where|when):/i.test(l)).join(" ");
  return {
    id: p.id,
    name,
    url: p.link,
    image: firstImage(p.content?.rendered),
    featuredMedia: p.featured_media || 0,
    date,
    dateISO: dateISO(lines, date),
    time: field(lines, "Time"),
    cost: field(lines, "Cost"),
    place: field(lines, "Location") || field(lines, "Where") || area,
    excerpt: (excerpt || bodyLead).slice(0, 160),
    publishedAt: p.date,
  };
}

async function ogImage(url) {
  try {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 60000);
    const m = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
    const src = m ? m[1] : null;
    return src && !/funcheap-?logo|default|placeholder/i.test(src) ? src : null;
  } catch {
    return null;
  }
}

async function fetchLive() {
  const res = await fetch(POSTS_URL, { headers: UA });
  if (!res.ok) throw new Error(`Funcheap responded ${res.status}`);
  const raw = await res.json();
  // Funcheap re-posts recurring events (same title, new post id); keep one,
  // preferring whichever copy actually has a cover.
  const byKey = new Map();
  for (const p of raw.map(toPost)) {
    const key = p.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const kept = byKey.get(key);
    if (!kept || (!(kept.image || kept.featuredMedia) && (p.image || p.featuredMedia))) byKey.set(key, p);
  }
  const posts = [...byKey.values()];

  const ids = posts.filter((p) => !p.image && p.featuredMedia).map((p) => p.featuredMedia);
  if (ids.length) {
    try {
      const m = await fetch(`${MEDIA_URL}?include=${ids.join(",")}&per_page=${ids.length}&_fields=id,source_url,media_details.sizes.medium_large.source_url,media_details.sizes.large.source_url`, { headers: UA });
      if (m.ok) {
        const media = await m.json();
        const byId = new Map(media.map((x) => [x.id, x.media_details?.sizes?.medium_large?.source_url || x.media_details?.sizes?.large?.source_url || x.source_url]));
        for (const p of posts) if (!p.image && byId.get(p.featuredMedia)) p.image = byId.get(p.featuredMedia);
      }
    } catch {
      // covers are nice to have; the post list still stands without them
    }
  }
  // Last resort for the few posts with no media record at all: the page's og:image.
  await Promise.all(posts.filter((p) => !p.image).slice(0, 4).map(async (p) => { p.image = await ogImage(p.url); }));
  return posts.map(({ featuredMedia, ...rest }) => rest);
}

async function getFuncheap({ force = false } = {}) {
  const age = Date.now() - cache.at;
  const stale = age > CACHE_MS;
  const canForce = force && age > FORCE_FLOOR_MS;
  if (!stale && !canForce && cache.posts.length) {
    return { posts: cache.posts, updatedAt: cache.at, fromCache: true };
  }
  const posts = await fetchLive();
  cache = { at: Date.now(), posts };
  return { posts, updatedAt: cache.at, fromCache: false };
}

module.exports = { getFuncheap };

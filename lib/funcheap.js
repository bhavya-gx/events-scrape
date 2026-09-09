// Second live source, broader than Luma's tech feed: SF Funcheap runs on
// WordPress and exposes its posts through the standard public wp-json REST
// API, no key needed. Date/cost aren't structured fields there, they're
// written into the post body ("Date: 09/26/2026", "Cost: FREE"), so this
// pulls them out with a couple of regexes rather than an AI parse. Covers
// come from the featured-image media records (one extra request).

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
    .replace(/<\/(p|div|li)>/gi, "\n")
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

// Best-effort ISO date from the body: "09/26/2026" wins, then "September 26"
// resolved to the next occurrence on or after today. Null when unsure.
const MONTH_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i;

function nextOccurrence(month, day) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  let d = new Date(Date.UTC(now.getFullYear(), month, day));
  if (d < today - 7 * 86400000) d = new Date(Date.UTC(now.getFullYear() + 1, month, day));
  return d.toISOString().slice(0, 10);
}

// Only trusts labeled lines ("Date: ...", "When: ...") plus a full
// MM/DD/YYYY anywhere. Most Funcheap posts keep their date in event
// metadata the public API does not expose, so many stay undated on
// purpose; scanning the whole body for month names produced false hits
// (an "early bird July 31st" line dated an Oktoberfest to July).
function dateISO(lines, dateText) {
  const labeled = [dateText, field(lines, "When"), field(lines, "Dates")].filter(Boolean).join(" | ");
  const full = (labeled + "\n" + lines.join("\n")).match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (full) return `${full[3]}-${full[1].padStart(2, "0")}-${full[2].padStart(2, "0")}`;
  const named = labeled.match(MONTH_RE);
  if (named) {
    const month = MONTHS.findIndex((m) => m.startsWith(named[1].toLowerCase()));
    return nextOccurrence(month, Number(named[2]));
  }
  return null;
}

function toPost(p) {
  const lines = toLines(p.content?.rendered);
  const date = field(lines, "Date");
  return {
    id: p.id,
    name: decodeEntities(p.title?.rendered).replace(/<[^>]+>/g, ""),
    url: p.link,
    image: firstImage(p.content?.rendered),
    featuredMedia: p.featured_media || 0,
    date,
    dateISO: dateISO(lines, date),
    time: field(lines, "Time"),
    cost: field(lines, "Cost"),
    place: field(lines, "Location") || field(lines, "Where"),
    excerpt: toLines(p.excerpt?.rendered).join(" ").slice(0, 160),
    publishedAt: p.date,
  };
}

async function fetchLive() {
  const res = await fetch(POSTS_URL, { headers: UA });
  if (!res.ok) throw new Error(`Funcheap responded ${res.status}`);
  const raw = await res.json();
  // Funcheap re-posts recurring events (same title, new post id); keep one.
  const seen = new Set();
  const posts = raw.map(toPost).filter((p) => {
    const key = p.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

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

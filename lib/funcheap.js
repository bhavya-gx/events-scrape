// Second live source, broader than Luma's AI-only feed: SF Funcheap runs on
// WordPress and exposes its posts through the standard public wp-json REST
// API, no key needed. Date/cost aren't structured fields there, they're
// written into the post body ("Date: 09/26/2026", "Cost: FREE"), so this
// pulls them out with a couple of regexes rather than an AI parse.

const POSTS_URL = "https://sf.funcheap.com/wp-json/wp/v2/posts?per_page=12";
const CACHE_MS = 10 * 60 * 1000;
const FORCE_FLOOR_MS = 60 * 1000;

let cache = { at: 0, posts: [] };

function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;|&#8212;/g, "-")
    .replace(/&amp;/g, "&")
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

function toPost(p) {
  const lines = toLines(p.content?.rendered);
  return {
    id: p.id,
    name: decodeEntities(p.title?.rendered).replace(/<[^>]+>/g, ""),
    url: p.link,
    image: firstImage(p.content?.rendered),
    date: field(lines, "Date"),
    cost: field(lines, "Cost"),
    excerpt: toLines(p.excerpt?.rendered).join(" ").slice(0, 160),
    publishedAt: p.date,
  };
}

async function fetchLive() {
  const res = await fetch(POSTS_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; sf-perks-sweep demo)" },
  });
  if (!res.ok) throw new Error(`Funcheap responded ${res.status}`);
  const raw = await res.json();
  return raw.map(toPost);
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

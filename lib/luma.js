// Reads Luma's public SF discover pages and pulls the same structured data
// their own frontend renders from (a __NEXT_DATA__ JSON blob embedded in the
// HTML). No API key: this is a plain GET on a public page, not an API Luma
// publishes, so the shape can change without notice.
//
// Luma doesn't have a single "all categories" page that embeds this data the
// same way (/discover/sf loads its list client-side instead, no static
// blob to read). Per-category pages do embed it, but most category slugs
// 404, only a handful exist for SF. These are the ones that actually work:
const CATEGORY_SLUGS = ["ai", "tech"];
const CACHE_MS = 5 * 60 * 1000; // shared across every visitor, caps how often we hit Luma
const FORCE_FLOOR_MS = 60 * 1000; // a manual "refresh" click can't beat this, even if requested
const WINDOW_DAYS = 30;

let cache = { at: 0, events: [] };

function extractNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("Luma page layout changed, could not find its data blob");
  return JSON.parse(m[1]);
}

function formatPrice(price) {
  if (!price || typeof price.cents !== "number") return null;
  const amount = (price.cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: price.cents % 100 === 0 ? 0 : 2,
  });
  const symbol = price.currency === "usd" ? "$" : `${price.currency?.toUpperCase() ?? ""} `;
  return `${symbol}${amount}`;
}

function toEvent(item) {
  const e = item.event ?? {};
  const t = item.ticket_info ?? {};
  return {
    id: item.api_id,
    name: e.name ?? "Untitled event",
    startAt: e.start_at ?? null,
    endAt: e.end_at ?? null,
    url: e.url ? `https://luma.com/${e.url}` : null,
    coverUrl: e.cover_url ?? null,
    neighborhood: e.geo_address_info?.sublocality ?? null,
    city: e.geo_address_info?.city ?? "San Francisco",
    isFree: t.is_free ?? null,
    price: formatPrice(t.price),
    isSoldOut: Boolean(t.is_sold_out),
    isNearCapacity: Boolean(t.is_near_capacity),
    spotsRemaining: typeof t.spots_remaining === "number" ? t.spots_remaining : null,
    requireApproval: Boolean(t.require_approval),
    guestCount: item.guest_count ?? null,
    hostAvatars: (item.hosts ?? [])
      .map((h) => h.avatar_url)
      .filter(Boolean)
      .slice(0, 3),
  };
}

async function fetchCategory(slug) {
  const res = await fetch(`https://luma.com/discover/sf/${slug}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; sf-perks-sweep demo)" },
  });
  if (!res.ok) throw new Error(`Luma responded ${res.status} for category "${slug}"`);
  const html = await res.text();
  const data = extractNextData(html);
  return data?.props?.pageProps?.initialEvents ?? [];
}

async function fetchLive() {
  const perCategory = await Promise.all(CATEGORY_SLUGS.map(fetchCategory));
  const byId = new Map();
  for (const raw of perCategory.flat()) {
    if (!byId.has(raw.api_id)) byId.set(raw.api_id, raw);
  }
  const now = Date.now();
  const windowEnd = now + WINDOW_DAYS * 24 * 3600 * 1000;
  return [...byId.values()]
    .map(toEvent)
    .filter((e) => e.startAt) // starts_at required to place it on the list at all
    .filter((e) => {
      const t = new Date(e.startAt).getTime();
      return t >= now - 3 * 3600 * 1000 && t <= windowEnd;
    })
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
}

/** Returns { events, updatedAt, fromCache }. Only hits Luma when the shared cache is stale. */
async function getEvents({ force = false } = {}) {
  const age = Date.now() - cache.at;
  const stale = age > CACHE_MS;
  const canForce = force && age > FORCE_FLOOR_MS;
  if (!stale && !canForce && cache.events.length) {
    return { events: cache.events, updatedAt: cache.at, fromCache: true };
  }
  const events = await fetchLive();
  cache = { at: Date.now(), events };
  return { events, updatedAt: cache.at, fromCache: false };
}

module.exports = { getEvents };

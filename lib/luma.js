// Reads Luma's public SF/AI discover page and pulls the same structured data
// its own frontend renders from (a __NEXT_DATA__ JSON blob embedded in the
// HTML). No API key: this is a plain GET on a public page, not an API Luma
// publishes, so the shape can change without notice.

const DISCOVER_URL = "https://luma.com/discover/sf/ai";
const CACHE_MS = 5 * 60 * 1000; // shared across every visitor, caps how often we hit Luma
const FORCE_FLOOR_MS = 60 * 1000; // a manual "refresh" click can't beat this, even if requested

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
    neighborhood: e.geo_address_info?.sublocality ?? null,
    city: e.geo_address_info?.city ?? "San Francisco",
    isFree: t.is_free ?? null,
    price: formatPrice(t.price),
    isSoldOut: Boolean(t.is_sold_out),
    isNearCapacity: Boolean(t.is_near_capacity),
    spotsRemaining: typeof t.spots_remaining === "number" ? t.spots_remaining : null,
    requireApproval: Boolean(t.require_approval),
    guestCount: item.guest_count ?? null,
  };
}

async function fetchLive() {
  const res = await fetch(DISCOVER_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; sf-perks-sweep demo)" },
  });
  if (!res.ok) throw new Error(`Luma responded ${res.status}`);
  const html = await res.text();
  const data = extractNextData(html);
  const raw = data?.props?.pageProps?.initialEvents ?? [];
  const now = Date.now();
  return raw
    .map(toEvent)
    .filter((e) => e.startAt && new Date(e.startAt).getTime() >= now - 3 * 3600 * 1000)
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

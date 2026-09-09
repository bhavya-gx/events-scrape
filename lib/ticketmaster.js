// Ticketmaster's Discovery API: a real, documented, free-tier search API
// (unlike Luma's page-reading trick), so this covers the lane Luma and
// Funcheap don't: ticketed concerts, sports, theater. City + date-range
// search, genuine pagination. https://developer.ticketmaster.com/

const BASE_URL = "https://app.ticketmaster.com/discovery/v2/events.json";
const CACHE_MS = 15 * 60 * 1000; // shared across every visitor, caps how often we spend API quota
const FORCE_FLOOR_MS = 60 * 1000;
const WINDOW_DAYS = 30;

let cache = { at: 0, events: [] };

function isoNoMillis(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function formatPrice(ranges) {
  const r = ranges?.[0];
  if (!r) return null;
  if (r.min === 0 && r.max === 0) return "Free";
  return r.min === r.max ? `$${r.min}` : `$${r.min}-${r.max}`;
}

function toEvent(ev) {
  const venue = ev._embedded?.venues?.[0];
  const image = ev.images?.find((i) => i.ratio === "16_9" && i.width >= 400) ?? ev.images?.[0];
  return {
    id: ev.id,
    name: ev.name,
    startAt: ev.dates?.start?.dateTime ?? (ev.dates?.start?.localDate ? `${ev.dates.start.localDate}T00:00:00Z` : null),
    url: ev.url ?? null,
    imageUrl: image?.url ?? null,
    venue: venue?.name ?? null,
    neighborhood: venue?.city?.name ?? null,
    classification: ev.classifications?.[0]?.segment?.name ?? null,
    price: formatPrice(ev.priceRanges),
    isTimed: ev.dates?.start?.dateTBA !== true && ev.dates?.start?.dateTBD !== true,
  };
}

async function fetchLive(apiKey) {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + WINDOW_DAYS * 24 * 3600 * 1000);
  const url = new URL(BASE_URL);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("city", "San Francisco");
  url.searchParams.set("stateCode", "CA");
  url.searchParams.set("startDateTime", isoNoMillis(now));
  url.searchParams.set("endDateTime", isoNoMillis(windowEnd));
  url.searchParams.set("sort", "date,asc");
  url.searchParams.set("size", "50");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ticketmaster responded ${res.status}`);
  const json = await res.json();
  const raw = json._embedded?.events ?? [];
  return raw.map(toEvent).filter((e) => e.startAt);
}

/** Returns { events, updatedAt, fromCache, configured }. No-ops cleanly with no key set. */
async function getTicketmasterEvents({ force = false } = {}) {
  const apiKey = process.env["TICKETMASTER_API_KEY"];
  if (!apiKey) return { events: [], updatedAt: 0, fromCache: false, configured: false };

  const age = Date.now() - cache.at;
  const stale = age > CACHE_MS;
  const canForce = force && age > FORCE_FLOOR_MS;
  if (!stale && !canForce && cache.events.length) {
    return { events: cache.events, updatedAt: cache.at, fromCache: true, configured: true };
  }
  const events = await fetchLive(apiKey);
  cache = { at: Date.now(), events };
  return { events, updatedAt: cache.at, fromCache: false, configured: true };
}

module.exports = { getTicketmasterEvents };

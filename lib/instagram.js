// Instagram via Apify's instagram-scraper actor (scraping, not an API
// Instagram publishes: more fragile than the other sources, keep expectations
// accordingly). Account-scoped: it reads a fixed list of SF "things to do"
// publishers, it cannot search all of Instagram.
//
// A live scrape takes 1-2 minutes, far too slow to block a page load (and it
// would exceed a serverless timeout). So reads come from the actor's LAST
// SUCCESSFUL RUN dataset (instant), and a fresh run is kicked off in the
// background when the last one is older than RUN_EVERY_MS. New posts appear
// on the next load after the run finishes.
//
// Captions are free text, not events. If GEMINI_API_KEY is set, one Gemini
// call per new dataset turns them into dated events; raw posts are the
// fallback either way.

const ACCOUNTS = ["mustdosf", "sfstandard", "millielai", "mikayla.winestyle", "fionaparkss"];
const ACTOR = "apify~instagram-scraper";
const API = "https://api.apify.com/v2";
const POSTS_PER_ACCOUNT = 6;
const LOOKBACK_DAYS = 30;
const RUN_EVERY_MS = 6 * 3600 * 1000;
const READ_CACHE_MS = 15 * 60 * 1000;
const FORCE_FLOOR_MS = 10 * 60 * 1000;
const AI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

let cache = { at: 0, runId: null, posts: [], events: [], extractedForRun: null };
let lastStartedAt = 0;

function toPost(item) {
  return {
    id: item.id ?? item.shortCode,
    handle: item.ownerUsername ?? null,
    url: item.url ?? null,
    imageUrl: item.displayUrl ?? null,
    caption: (item.caption ?? "").trim(),
    location: item.locationName ?? null,
    likes: item.likesCount ?? null,
    postedAt: item.timestamp ?? null,
  };
}

async function lastRun(token) {
  const res = await fetch(`${API}/acts/${ACTOR}/runs/last?token=${token}&status=SUCCEEDED`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Apify runs/last responded ${res.status}`);
  const json = await res.json();
  return json.data ?? null;
}

async function lastDataset(token) {
  const res = await fetch(`${API}/acts/${ACTOR}/runs/last/dataset/items?token=${token}&status=SUCCEEDED`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Apify dataset responded ${res.status}`);
  return res.json();
}

async function startRun(token) {
  const res = await fetch(`${API}/acts/${ACTOR}/runs?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directUrls: ACCOUNTS.map((h) => `https://www.instagram.com/${h}/`),
      resultsType: "posts",
      resultsLimit: POSTS_PER_ACCOUNT,
      onlyPostsNewerThan: `${LOOKBACK_DAYS} days`,
    }),
  });
  if (!res.ok) console.error(`Apify start run failed [${res.status}]: ${(await res.text()).slice(0, 200)}`);
  lastStartedAt = Date.now();
}

const SYSTEM = `You extract San Francisco events from Instagram captions written by local "things to do" accounts.
Rules:
- Only real, attendable events (openings, festivals, markets, shows, pop-ups, free days). Skip news, rankings, reviews, and recipes with no event.
- start_date is ISO YYYY-MM-DD, resolved against the post date given for each caption. A bare weekday means the next such weekday after the post date. Drop anything you cannot date.
- start_time is 24h "HH:MM" or null. cost is the printed price ("Free", "$20") or null. venue is the named place or null.
- one_line is a single plain sentence saying what it is, no hashtags, no emojis, no em dashes.
- Return JSON: {"events": [{"post_id": string, "name": string, "start_date": string, "start_time": string|null, "venue": string|null, "cost": string|null, "one_line": string}]}. At most 20 events. Empty array if none.`;

// Returns an array on success (possibly empty: genuinely no events), or null
// when the call itself failed, so the caller can retry on the next request
// instead of remembering "nothing found" for a run that was never parsed.
async function extractEvents(posts) {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) return [];
  if (!posts.length) return [];
  const today = new Date().toISOString().slice(0, 10);
  const body = posts
    .map((p) => `POST ${p.id} by @${p.handle} on ${(p.postedAt ?? "").slice(0, 10)}${p.location ? ` at ${p.location}` : ""}\n${p.caption.slice(0, 1200)}`)
    .join("\n\n---\n\n");
  const payload = JSON.stringify({
    model: "gemini-3.6-flash",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Today is ${today}.\n\n${body}` },
    ],
    response_format: { type: "json_object" },
  });

  let res = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetch(AI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: payload,
    });
    if (res.ok) break;
    const text = (await res.text()).slice(0, 200);
    console.error(`Gemini extract failed [${res.status}]${attempt === 0 ? ", retrying once" : ""}: ${text}`);
    if (![429, 500, 502, 503, 504].includes(res.status) || attempt === 1) return null;
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!res || !res.ok) return null;
  const json = await res.json();
  let parsed;
  try {
    parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
  } catch {
    console.error("Gemini returned non-JSON content");
    return null;
  }
  const byId = new Map(posts.map((p) => [String(p.id), p]));
  return (parsed.events ?? [])
    .filter((e) => e?.name && e?.start_date && e.start_date >= today)
    .map((e, i) => {
      const src = byId.get(String(e.post_id));
      return {
        id: `ig-${e.post_id}-${i}`,
        name: e.name,
        startDate: e.start_date,
        startTime: e.start_time ?? null,
        venue: e.venue ?? null,
        cost: e.cost ?? null,
        oneLine: e.one_line ?? "",
        handle: src?.handle ?? null,
        sourceUrl: src?.url ?? null,
        imageUrl: src?.imageUrl ?? null,
      };
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** Returns { configured, posts, events, updatedAt, fromCache, refreshing }. */
async function getInstagram({ force = false } = {}) {
  const token = process.env["APIFY_API_KEY"];
  if (!token) return { configured: false, posts: [], events: [], updatedAt: 0, fromCache: false, refreshing: false };

  const age = Date.now() - cache.at;
  const extractionSettled = cache.extractedForRun !== null || !cache.posts.length;
  if (age < READ_CACHE_MS && cache.posts.length && extractionSettled && !force) {
    return { configured: true, posts: cache.posts, events: cache.events, updatedAt: cache.at, fromCache: true, refreshing: false };
  }

  const run = await lastRun(token);
  const runAge = run?.startedAt ? Date.now() - new Date(run.startedAt).getTime() : Infinity;
  const sinceStart = Date.now() - lastStartedAt;
  let refreshing = false;
  if ((runAge > RUN_EVERY_MS && sinceStart > FORCE_FLOOR_MS) || (force && sinceStart > FORCE_FLOOR_MS && runAge > FORCE_FLOOR_MS)) {
    await startRun(token);
    refreshing = true;
  }

  const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000;
  const items = run ? await lastDataset(token) : [];
  const posts = items
    .map(toPost)
    .filter((p) => p.postedAt && new Date(p.postedAt).getTime() >= cutoff)
    .sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));

  const runId = run?.id ?? null;
  let events = cache.events;
  let extractedForRun = cache.extractedForRun;
  if (!(runId && runId === cache.extractedForRun)) {
    const extracted = await extractEvents(posts);
    if (extracted !== null) {
      events = extracted;
      extractedForRun = runId;
    } else {
      // Gemini was unavailable: keep whatever we had, and leave the run
      // unmarked so the next request tries the extraction again.
      events = cache.events;
      extractedForRun = null;
    }
  }
  cache = { at: Date.now(), runId, posts, events, extractedForRun };
  return { configured: true, posts, events, updatedAt: cache.at, fromCache: false, refreshing };
}

module.exports = { getInstagram, ACCOUNTS };

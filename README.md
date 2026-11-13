# SF perks + events sweep

A public, no-login page that shows what's on in San Francisco right now: live events with real spots remaining, free things to do, and hand-checked free perks. One feed, three sources, no source labels.

## Sources

- **Luma** (`lib/luma.js`): reads the structured data embedded in Luma's public SF discover pages (AI + tech categories). No key.
- **Funcheap** (`lib/funcheap.js`): the public WordPress REST API for sf.funcheap.com, with covers from the media endpoint. No key.
- **Instagram** (`lib/instagram.js`): a fixed list of SF "things to do" accounts, scraped with Apify's `instagram-scraper`, with captions turned into dated events by Gemini. Loads only when a visitor taps "Find more" or runs a sweep, never on page load. Needs `APIFY_API_KEY` and `GEMINI_API_KEY`.
- **Perks** (`lib/perks.js`): hand-curated, dated `verifiedOn`.

Every source is cached server-side (shared across visitors) so traffic never multiplies upstream calls.

## Run locally

```bash
npm install
npm start          # http://localhost:4640
```

Copy `.env.example` to `.env` for the Instagram lane; the rest works with no keys.

## Deploy (Vercel)

Import the repo. `api/*.js` become serverless functions, `public/` is served static. Set `APIFY_API_KEY` and `GEMINI_API_KEY` in Project Settings → Environment Variables. `vercel.json` gives the Instagram route a 60s budget for the first extraction after a new scrape (later loads are cached in an Apify key-value store).

## Tools

- `node tools/shots.mjs` writes QA screenshots of every section at iPhone size to `tools/out/shots/`.
- `node tools/record.mjs` renders the iPhone mockup video to `tools/out/mockup.mp4` (needs Chrome; ffmpeg comes from `pip install imageio-ffmpeg`).

## Live

https://events-scrape.vercel.app

## License

MIT.

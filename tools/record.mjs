// Renders the iPhone mockup video: serves tools/stage.html on a small proxy
// (so the stage and the app share an origin and the stage can script the app),
// screencasts headless Chrome at 2x while driving a timed sequence of headline
// beats, scrolls and taps, then assembles the frames with ffmpeg.
// Usage: node tools/record.mjs [appUrl]   ->  tools/out/mockup.mp4
import http from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { launch, sleep } from "./cdp.mjs";

const APP = process.argv[2] || "http://localhost:4640";
const PORT = 4641;
const OUT = new URL("./out/", import.meta.url).pathname;
const FRAMES = OUT + "frames/";
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

// --- same-origin proxy: /stage.html from disk, everything else from the app ---
const stageHtml = readFileSync(new URL("./stage.html", import.meta.url));
const proxy = http.createServer(async (req, res) => {
  if (req.url === "/stage.html") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(stageHtml); }
  try {
    const up = await fetch(APP + req.url, { headers: { accept: req.headers.accept ?? "*/*" } });
    const body = Buffer.from(await up.arrayBuffer());
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/octet-stream" });
    res.end(body);
  } catch (e) { res.writeHead(502); res.end(String(e)); }
});
await new Promise((r) => proxy.listen(PORT, r));

const W = 1080, H = 1920, SCALE = 2;
const page = await launch({ width: W, height: H, scale: SCALE, mobile: false });
const frames = [];
let recording = false;
page.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  if (recording) {
    const i = frames.length;
    writeFileSync(`${FRAMES}f${String(i).padStart(5, "0")}.jpg`, Buffer.from(data, "base64"));
    frames.push(metadata.timestamp);
  }
  try { await page.send("Page.screencastFrameAck", { sessionId }); } catch {}
});

const ev = (expr) => page.evaluate(expr);
const at = (ms) => sleep(ms);

try {
  await page.goto(`http://127.0.0.1:${PORT}/stage.html`);
  for (let i = 0; i < 60; i++) { if (await ev("window.appReady()")) break; await sleep(250); }
  await sleep(1200); // fonts + first images

  await page.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: W * SCALE, maxHeight: H * SCALE, everyNthFrame: 1 });
  recording = true;
  const t0 = Date.now();
  const until = async (ms) => { const d = t0 + ms - Date.now(); if (d > 0) await sleep(d); };

  // Beats are cut to the ElevenLabs voiceover in tools/audio/voice.mp3.
  // Each headline is called ~0.5s before its line starts, because setCopy
  // spends 360ms fading the previous line out first.

  // "Here's what's on in San Francisco right now."  (0.00 - 2.20)
  await ev(`setCopy('What\\'s on in <span class="hl">SF</span>', 'Live events, free finds, hand-checked perks.'); phoneIn(); 'ok'`);
  await until(2360);

  // "Every event shows real spots left, straight from the organizers."  (2.86 - 6.58)
  await ev(`setCopy('Real spots <span class="hl">remaining</span>', 'Not guesses. Pulled live from the organizers.'); 'ok'`);
  await ev(`scrollApp(appTop('near') + 360, 1500)`);
  await until(6500);

  // "Free things to do, ongoing and drop-in."  (7.01 - 9.40)
  await ev(`setCopy('Free things <span class="hl">to do</span>', 'Ongoing and drop-in, no ticket needed.'); 'ok'`);
  await ev(`scrollApp(appTop('anytime'), 1500)`);
  await until(9300);

  // "The next forty-eight hours, at a glance."  (9.79 - 11.79)
  await ev(`setCopy('Happening <span class="hl">soon</span>', 'The next 48 hours, at a glance.'); 'ok'`);
  await ev(`scrollApp(appTop('soon'), 1300)`);
  await until(10700);
  await ev(`scrollRail(230, 1200)`);
  await until(11750);

  // "Everything this month, soonest first. One feed, no tabs."  (12.23 - 16.21)
  await ev(`setCopy('Everything <span class="hl">this month</span>', 'Soonest first, one feed, no tabs.'); 'ok'`);
  await ev(`scrollApp(appTop('month') + 90, 1600)`);
  await until(16100);

  // "And the gardens and museums on their free days, checked by hand."  (16.61 - 19.92)
  await ev(`setCopy('Hand-checked <span class="hl">perks</span>', 'Gardens and museums on their free days.'); 'ok'`);
  await ev(`scrollApp(appTop('perks'), 1700)`);
  await until(20000);

  // "One tap refreshes it all. No account. Just go."  (20.52 - 23.84)
  await ev(`setCopy('One tap to <span class="hl">refresh</span>', 'No account needed.'); 'ok'`);
  await ev(`scrollApp(0, 1400)`);
  await until(21300);
  await ev(`tapEl('#sweep')`);
  await until(22400);
  await ev(`badgeIn(); 'ok'`);
  await until(25000);

  recording = false;
  await page.send("Page.stopScreencast");
} finally {
  page.close();
  proxy.close();
}

// --- assemble: variable frame timing -> constant 30fps H.264 ---
const list = frames.map((ts, i) => {
  const next = frames[i + 1] ?? ts + 1 / 30;
  return `file '${FRAMES}f${String(i).padStart(5, "0")}.jpg'\nduration ${Math.max(0.005, next - ts).toFixed(4)}`;
}).join("\n") + `\nfile '${FRAMES}f${String(frames.length - 1).padStart(5, "0")}.jpg'\n`;
writeFileSync(OUT + "frames.txt", list);
const ffmpeg = execFileSync("python3", ["-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"]).toString().trim();
const VOICE = new URL("./audio/voice.mp3", import.meta.url).pathname;
const hasVoice = existsSync(VOICE);
execFileSync(ffmpeg, [
  "-y", "-f", "concat", "-safe", "0", "-i", OUT + "frames.txt",
  ...(hasVoice ? ["-i", VOICE] : []),
  "-vf", `scale=${W}:${H}:flags=lanczos,format=yuv420p`,
  "-fps_mode", "cfr", "-r", "30", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-movflags", "+faststart",
  // -shortest would cut the tail if the voice runs past the last frame, so the
  // video is recorded a beat longer than the read instead.
  ...(hasVoice ? ["-c:a", "aac", "-b:a", "192k", "-af", "afade=t=out:st=23.6:d=0.5"] : []),
  OUT + "mockup.mp4",
], { stdio: "inherit" });
console.log(`frames: ${frames.length}, duration ~${(frames.at(-1) - frames[0]).toFixed(1)}s, voice: ${hasVoice} -> ${OUT}mockup.mp4`);

// QA screenshots of every section at iPhone size, written to tools/out/shots.
// Usage: node tools/shots.mjs [baseUrl]
import { mkdirSync } from "node:fs";
import { launch, sleep } from "./cdp.mjs";

const base = process.argv[2] || "http://localhost:4640";
const out = new URL("./out/shots/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const page = await launch({ width: 390, height: 844, scale: 2 });
try {
  await page.goto(base + "/");
  await sleep(6500); // live fetches + image loads
  await page.shot(out + "00-top.png");

  for (const id of ["near", "anytime", "soon", "month", "perks", "sold"]) {
    await page.evaluate(`document.getElementById("${id}").scrollIntoView({block:"start"}); "ok"`);
    await sleep(1200);
    await page.shot(out + `10-${id}.png`);
  }

  await page.evaluate(`document.querySelector("#sold summary").click(); document.getElementById("sold").scrollIntoView({block:"start"}); "ok"`);
  await sleep(1000);
  await page.shot(out + "20-sold-open.png");

  await page.evaluate(`document.getElementById("month").scrollIntoView({block:"start"}); "ok"`);
  await sleep(600);
  await page.evaluate(`document.getElementById("findMore").scrollIntoView({block:"center"}); document.getElementById("findMore").click(); "ok"`);
  await sleep(9000);
  await page.shot(out + "30-after-find-more.png");
  const summary = await page.evaluate(`JSON.stringify({near: $("nearCount").textContent, anytime: $("anytimeCount").textContent, month: $("monthCount").textContent, perks: $("perksCount").textContent, toast: $("toast").textContent, brokenImgs: [...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.src.startsWith("http")).length, imgs: document.images.length})`);
  console.log("summary:", summary);

  await page.shot(out + "40-full.png", { fullPage: true });
  console.log("wrote", out);
} finally {
  page.close();
}

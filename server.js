require("./lib/env");
const express = require("express");
const path = require("path");
const { getEvents } = require("./lib/luma");
const { getFuncheap } = require("./lib/funcheap");
const { getTicketmasterEvents } = require("./lib/ticketmaster");
const { getInstagram, ACCOUNTS } = require("./lib/instagram");
const perks = require("./lib/perks");

const app = express();
const PORT = Number(process.env.PORT) || 4640;

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/perks", (_req, res) => {
  res.json(perks);
});

app.get("/api/events", async (req, res) => {
  try {
    const force = req.query.refresh === "1";
    const { events, updatedAt, fromCache } = await getEvents({ force });
    res.json({ events, updatedAt, fromCache });
  } catch (err) {
    res.status(502).json({ error: "Could not reach Luma right now, try again shortly." });
  }
});

app.get("/api/funcheap", async (req, res) => {
  try {
    const force = req.query.refresh === "1";
    const { posts, updatedAt, fromCache } = await getFuncheap({ force });
    res.json({ posts, updatedAt, fromCache });
  } catch (err) {
    res.status(502).json({ error: "Could not reach Funcheap right now, try again shortly." });
  }
});

app.get("/api/ticketmaster", async (req, res) => {
  try {
    const force = req.query.refresh === "1";
    const { events, updatedAt, fromCache, configured } = await getTicketmasterEvents({ force });
    res.json({ events, updatedAt, fromCache, configured });
  } catch (err) {
    res.status(502).json({ error: "Could not reach Ticketmaster right now, try again shortly." });
  }
});

app.get("/api/instagram", async (req, res) => {
  try {
    const force = req.query.refresh === "1";
    const data = await getInstagram({ force });
    res.json({ ...data, accounts: ACCOUNTS });
  } catch (err) {
    res.status(502).json({ error: "Could not reach Instagram right now, try again shortly." });
  }
});

app.listen(PORT, () => {
  console.log(`sf-perks-sweep demo on http://localhost:${PORT}`);
});

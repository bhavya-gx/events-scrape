const express = require("express");
const path = require("path");
const { getEvents } = require("./lib/luma");
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

app.listen(PORT, () => {
  console.log(`sf-perks-sweep demo on http://localhost:${PORT}`);
});

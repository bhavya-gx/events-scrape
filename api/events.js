const { getEvents } = require("../lib/luma");

module.exports = async (req, res) => {
  try {
    const force = req.query.refresh === "1";
    const { events, updatedAt, fromCache } = await getEvents({ force });
    res.status(200).json({ events, updatedAt, fromCache });
  } catch (err) {
    res.status(502).json({ error: "Could not reach Luma right now, try again shortly." });
  }
};

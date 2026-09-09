const { getTicketmasterEvents } = require("../lib/ticketmaster");

module.exports = async (req, res) => {
  try {
    const force = req.query.refresh === "1";
    const { events, updatedAt, fromCache, configured } = await getTicketmasterEvents({ force });
    res.status(200).json({ events, updatedAt, fromCache, configured });
  } catch (err) {
    res.status(502).json({ error: "Could not reach Ticketmaster right now, try again shortly." });
  }
};

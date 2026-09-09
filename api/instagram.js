const { getInstagram, ACCOUNTS } = require("../lib/instagram");

module.exports = async (req, res) => {
  try {
    const force = req.query.refresh === "1";
    const data = await getInstagram({ force });
    res.status(200).json({ ...data, accounts: ACCOUNTS });
  } catch (err) {
    res.status(502).json({ error: "Could not reach Instagram right now, try again shortly." });
  }
};

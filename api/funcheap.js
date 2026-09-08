const { getFuncheap } = require("../lib/funcheap");

module.exports = async (req, res) => {
  try {
    const force = req.query.refresh === "1";
    const { posts, updatedAt, fromCache } = await getFuncheap({ force });
    res.status(200).json({ posts, updatedAt, fromCache });
  } catch (err) {
    res.status(502).json({ error: "Could not reach Funcheap right now, try again shortly." });
  }
};

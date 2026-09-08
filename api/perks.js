const perks = require("../lib/perks");

module.exports = (req, res) => {
  res.status(200).json(perks);
};

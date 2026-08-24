const express = require("express");
const router = express.Router();

// No auth required — this must be reachable before login,
// on any client's server (private or public).
router.get("/", (req, res) => {
  res.status(200).json({ status: "ok" });
});

module.exports = router;
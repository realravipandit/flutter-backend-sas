const express = require("express");
const router = express.Router();
const { getDashboardSummary } = require("../controllers/dashboardController");

// This naturally maps to /api/dashboard/summary in index.js
router.get("/", getDashboardSummary);

module.exports = router;
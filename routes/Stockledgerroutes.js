const express = require("express");
const router = express.Router();
const { postStockLedgerReport } = require("../controllers/stockLedgerController");
const authenticate = require("../middlewares/auth");

// POST /api/stock-ledger/report
router.post("/report", authenticate, postStockLedgerReport);

module.exports = router;

// In your main app/server file, mount this the same way "ledgers/report" is mounted, e.g.:
//   const stockLedgerRoutes = require("./routes/stockLedgerRoutes");
//   app.use("/api/stock-ledger", stockLedgerRoutes);
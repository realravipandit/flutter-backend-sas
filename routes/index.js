const express = require("express");
const router = express.Router();

const authenticateToken = require("../middlewares/auth");

// Import all route modules
const authRoutes = require("./authRoutes");
const salesRoutes = require("./salesRoutes");
const purchaseRoutes = require("./purchaseRoutes");
const inventoryRoutes = require("./inventoryRoutes");
const outstandingRoutes = require("./outstandingRoutes");
const companyRoutes = require("./companyRoutes");
const dashboardRoutes = require("./dashboardRoutes");
const financeController = require('../controllers/financeController');
const ageingRoutes = require("./ageingRoutes");
const ledgerRoutes = require('./ledgerRoutes');
const itemRoutes = require("./itemRoutes");
const cashBankRoutes = require('./cashBankRoutes');
const voucherRoutes = require('./voucherRoutes');
const documentRoutes = require('./documentRoutes');

// 1. PUBLIC ROUTES (No token required)
router.use("/", authRoutes);

// 2. PROTECTED ROUTES (Everything below requires a valid token)
router.use(authenticateToken); 

router.use("/", companyRoutes);
router.use("/", salesRoutes);             // Handles /sales and /sales-order
router.use("/", purchaseRoutes);
router.use("/", inventoryRoutes);
router.use("/", outstandingRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/ageing", ageingRoutes);
router.use('/ledgers', ledgerRoutes);
router.use("/items", itemRoutes);
router.use('/cash-bank', cashBankRoutes);
router.use('/vouchers', voucherRoutes);

// Receivables and Payables (Supporting both singular & plural to prevent 404s)
router.get("/receivables", financeController.getReceivables);
router.get("/receivable", financeController.getReceivables);  // ✅ Added singular alias

router.get("/payables", financeController.getPayables);
router.get("/payable", financeController.getPayables);      // ✅ Added singular alias

// Document routes
router.use('/documents', documentRoutes);

module.exports = router;
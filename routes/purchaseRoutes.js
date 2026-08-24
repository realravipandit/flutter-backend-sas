const express = require("express");
const router = express.Router();

const {
    // Purchase History / Reports
    getPurchaseSummary,
    getPurchaseDetails,

    // Purchase Entry
    getVendors,
    getNextVoucher,
    submitPurchase,
    getPurchaseTermMasters
} = require("../controllers/purchaseController");

// Get purchase records
// Supports: period, startDate, endDate, search, sortBy, sortOrder, page, limit
router.get("/purchase", getPurchaseSummary);

// Get individual purchase details
// Example: /purchase/details?voucherId=123
router.get("/purchase/details", getPurchaseDetails);

// =========================================
// PURCHASE ENTRY
// =========================================
router.get("/purchase/vendors", getVendors);
router.get("/purchase/next-voucher", getNextVoucher);
router.post("/purchase/submit", submitPurchase);
router.get("/purchase/term-masters", getPurchaseTermMasters);

module.exports = router;
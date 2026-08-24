const salesService = require("../services/salesService");
const salesReportService = require("../services/reports/salesReportService");
const salesOrderService = require("../services/salesOrderService"); // ✅ Imported properly

// ─────────────────────────────────────────────────────────────
// SALES REPORTS & LISTS
// ─────────────────────────────────────────────────────────────
const getSalesSummary = async (req, res) => {
    try {
        const result = await salesReportService.getSalesSummary(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getSalesSummary:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const getSalesList = async (req, res) => {
    try {
        const result = await salesReportService.getSalesList(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getSalesList:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const getSalesDetails = async (req, res) => {
    try {
        const result = await salesReportService.getSalesDetails(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getSalesDetails:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────
// SALES INVOICE (SB) ENTRY
// ─────────────────────────────────────────────────────────────
const createSale = async (req, res) => {
    try {
        if (process.env.NODE_ENV !== "production") {
            console.log("══════════════════════════════════════════");
            console.log("NEW SALE REQUEST");
            console.log("Company :", req.headers["x-company-code"]);
            console.log("Body :", JSON.stringify(req.body, null, 2));
            console.log("══════════════════════════════════════════");
        }
        const result = await salesService.createSale(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("createSale:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const getNextInvoiceNumber = async (req, res) => {
    try {
        const result = await salesService.getNextInvoiceNumber(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getNextInvoiceNumber:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const getTermMasters = async (req, res) => {
    try {
        const result = await salesService.getTermMasters(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getTermMasters:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────
// SALES ORDER (SO) ENTRY & VOUCHER GENERATION
// ─────────────────────────────────────────────────────────────
const getNextSalesOrderNumber = async (req, res) => {
    try {
        const result = await salesOrderService.getNextSalesOrderNumber(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getNextSalesOrderNumber:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const createSalesOrder = async (req, res) => {
    try {
        if (process.env.NODE_ENV !== "production") {
            console.log("══════════════════════════════════════════");
            console.log("NEW SALES ORDER REQUEST");
            console.log("Company :", req.headers["x-company-code"]);
            console.log("Body :", JSON.stringify(req.body, null, 2));
            console.log("══════════════════════════════════════════");
        }
        const result = await salesOrderService.createSalesOrder(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("createSalesOrder:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

module.exports = {
    getSalesSummary,
    getSalesList,
    getSalesDetails,
    createSale,
    getNextInvoiceNumber,
    getTermMasters,
    getNextSalesOrderNumber,
    createSalesOrder
};
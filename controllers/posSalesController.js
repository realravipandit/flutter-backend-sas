const posSalesService = require("../services/posSalesService");
const { getPool } = require("../db"); // Ensure this points to your database config file

// ─────────────────────────────────────────────────────────────
// POS (COUNTER SALES) CONTROLLER
// ─────────────────────────────────────────────────────────────

const createPosSale = async (req, res) => {
    try {
        if (process.env.NODE_ENV !== "production") {
            console.log("══════════════════════════════════════════");
            console.log("NEW POS SALE REQUEST");
            console.log("Company :", req.headers["x-company-code"]);
            console.log("Body :", JSON.stringify(req.body, null, 2));
            console.log("══════════════════════════════════════════");
        }
        const { billing } = req.body;
        if (billing && billing.tenderAmount < billing.grandTotal && billing.paymentMethod !== 'Credit') {
            return res.status(400).json({ success: false, error: "Tender amount must cover the grand total for POS sales." });
        }
        const result = await posSalesService.createPosSale(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("createPosSale error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const getNextPosInvoiceNumber = async (req, res) => {
    try {
        const result = await posSalesService.getNextPosInvoiceNumber(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getNextPosInvoiceNumber error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const getClasses = async (req, res) => {
    try {
        const companyCode = req.headers["x-company-code"];
        if (!companyCode) {
            return res.status(400).json({ success: false, error: "Company code required" });
        }
        const pool = await getPool(companyCode);
        const result = await pool.request().query(`
            SELECT ClassID, ClassName, ClassCode
            FROM tblClass
            ORDER BY ClassID ASC
        `);
        res.status(200).json(result.recordset);
    } catch (err) {
        console.error("getClasses error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

module.exports = {
    createPosSale,
    getNextPosInvoiceNumber,
    getClasses
};
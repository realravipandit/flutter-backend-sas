const purchaseReportService = require('../services/reports/purchaseReportService');
const purchaseEntryService = require('../services/purchaseEntryService');
const { getPool } = require('../db');
const voucherSequence = require('../utils/voucherSequence');

// Reports & History Endpoints
const getPurchaseSummary = async (req, res) => {
  try {
    const result = await purchaseReportService.getPurchaseSummary(req);
    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching purchase summary:", error);
    res.status(error.message.includes("No company") ? 400 : 500).json({ error: error.message || "Internal server error" });
  }
};

const getPurchaseDetails = async (req, res) => {
  try {
    const result = await purchaseReportService.getPurchaseDetails(req);
    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching purchase details:", error);
    res.status(error.message.includes("No company") ? 400 : 500).json({ error: error.message || "Internal server error" });
  }
};

// Entry & Transaction Endpoints
const getVendors = async (req, res) => {
    try {
        const companyCode = req.headers['x-company-code'];
        const pool = await getPool(companyCode);
        
        const result = await pool.request().query(`
            SELECT LedgerID, LedgerName, LedgerCode, LedgerType 
            FROM tblLedger 
            WHERE LedgerType IN ('VE', 'BO') 
            ORDER BY LedgerName ASC
        `);
        
        res.json({ success: true, data: result.recordset });
    } catch (error) {
        console.error("Vendor Fetch Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getNextVoucher = async (req, res) => {
    try {
        const companyCode = req.headers['x-company-code'];
        const pool = await getPool(companyCode); 
        
        const voucherData = await voucherSequence.getNextVoucher(pool, 'PB'); 
        
        res.json({ success: true, voucherNo: voucherData.voucherId }); 
    } catch (error) {
        console.error("Next Voucher Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getPurchaseTermMasters = async (req, res) => {
    try {
        const result = await purchaseEntryService.getPurchaseTermMasters(req);
        res.status(200).json(result);
    } catch (error) {
        console.error("Error fetching purchase terms:", error);
        res.status(error.message.includes("No company") ? 400 : 500).json({ error: error.message || "Internal server error" });
    }
};

const submitPurchase = async (req, res) => {
    try {
        const result = await purchaseEntryService.createPurchase(req);
        res.status(200).json(result);
    } catch (error) {
        console.error("Purchase Submit Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
  getPurchaseSummary,
  getPurchaseDetails,
  getVendors,
  getNextVoucher,
  submitPurchase,
  getPurchaseTermMasters
};
const cashBankService = require('../services/cashBankService');

// ==========================================
// 1. Get Cash/Bank Summary List
// ==========================================
exports.getCashBankSummary = async (req, res) => {
    try {
        const result = await cashBankService.getCashBankSummary(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getCashBankSummary error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ==========================================
// 2. Get Single Voucher Details & Line Items
// ==========================================
exports.getCashBankDetails = async (req, res) => {
    try {
        const result = await cashBankService.getCashBankDetails(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getCashBankDetails error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ==========================================
// 3. Create Cash/Bank Voucher Entry
// ==========================================
exports.createCashBankVoucher = async (req, res) => {
    try {
        const result = await cashBankService.createCashBankVoucher(req);
        res.status(201).json(result);
    } catch (err) {
        console.error("createCashBankVoucher error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ==========================================
// 4. Get Cash/Bank Filtered Ledgers
// ==========================================
exports.getCashBankLedgers = async (req, res) => {
    try {
        const result = await cashBankService.getCashBankLedgers(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getCashBankLedgers error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ==========================================
// 5. Get Voucher Sequences
// ==========================================
exports.getVoucherSequences = async (req, res) => {
    try {
        const result = await cashBankService.getVoucherSequences(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getVoucherSequences error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ==========================================
// 6. Get Full Voucher Ledger List
// ==========================================
exports.getVoucherLedgers = async (req, res) => {
    try {
        const result = await cashBankService.getVoucherLedgers(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getVoucherLedgers error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};
const { getStockLedgerReport } = require("../services/reports/stockLedgerDetailsReportService");

// POST /stock-ledger/report
// Body: { fromDate, toDate, itemCode?, withValue?, chkMiti? }
// Returns: raw row array (same shape LedgerReportPage._fetchLedgerRows expects)
const postStockLedgerReport = async (req, res) => {
    try {
        const rows = await getStockLedgerReport(req);
        res.status(200).json(rows);
    } catch (error) {
        console.error("Stock ledger report error:", error);
        res.status(400).json({ message: error.message || "Failed to load stock ledger report." });
    }
};

module.exports = {
    postStockLedgerReport
};
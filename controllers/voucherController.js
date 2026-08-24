const { getPool } = require('../db');
const { getVoucherSequences } = require('../utils/voucherSequence');

exports.getVoucherSequencesEndpoint = async (req, res) => {
    try {
        const companyCode = req.headers['x-company-code'];
        if (!companyCode) {
            return res.status(400).json({ success: false, error: "No company selected." });
        }

        const pool = await getPool(companyCode);
        if (!pool) {
            return res.status(500).json({ success: false, error: "Database unavailable." });
        }

        const { module } = req.query; // e.g., 'CB', 'PB', 'SB'
        if (!module) {
            return res.status(400).json({ success: false, error: "Module query parameter is required." });
        }

        const branchId = req.headers['branch-id'] || null;
        const userId = req.user?.userId || null;

        const sequences = await getVoucherSequences(pool, module, branchId, userId);
        res.status(200).json(sequences);
    } catch (err) {
        console.error("getVoucherSequencesEndpoint error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};
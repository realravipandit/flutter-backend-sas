const express = require('express');
const router = express.Router();
const ledgerController = require('../controllers/ledgerController');
const cashBankController = require('../controllers/cashBankController'); // 🌟 Required to map cash/bank ledgers under ledgers API if needed
const verifyToken = require('../middlewares/auth');

// Priority routes must go before any parameters
router.get('/account-groups', ledgerController.getAccountGroups);
router.get('/next-code', ledgerController.getNextLedgerCode);
router.get('/check-name', ledgerController.checkLedgerName);

// 🌟 Added this so Flutter's getCashBankLedgers() call to /api/ledgers/cash-banks succeeds
router.get('/cash-banks', cashBankController.getCashBankLedgers);

// 🌟 Ledger statement report (sp_SMLedgerReports / sp_SMLedgerCashSalesReports)
router.post('/report', verifyToken, ledgerController.getLedgerReport);
// Add this line where your routes are defined
router.get('/master', ledgerController.getAllLedgers);

router.post('/', ledgerController.createLedger);
router.get('/', ledgerController.getLedgers);
router.get('/voucher-ledgers', ledgerController.getVoucherLedgers);

module.exports = router;
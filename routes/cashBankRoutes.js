const express = require('express');
const router = express.Router();
const cashBankController = require('../controllers/cashBankController');

router.get('/summary', cashBankController.getCashBankSummary);
router.get('/details', cashBankController.getCashBankDetails);
router.get('/cash-banks', cashBankController.getCashBankLedgers); // legacy, if used elsewhere
router.get('/ledgers', cashBankController.getCashBankLedgers);    // matches Flutter's getCashBankLedgers()
router.post('/submit', cashBankController.createCashBankVoucher);
router.get('/voucher-sequences', cashBankController.getVoucherSequences);
router.get('/voucher-ledgers', cashBankController.getVoucherLedgers);

module.exports = router;
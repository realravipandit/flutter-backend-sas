const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucherController');

// This handles: GET /api/vouchers/sequences?module=CB
router.get('/sequences', voucherController.getVoucherSequencesEndpoint);

module.exports = router;
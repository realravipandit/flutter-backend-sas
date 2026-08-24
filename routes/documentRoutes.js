const express = require('express');
const router = express.Router();
const { getDocumentNumbering, getNextInvoiceNumber } = require('../controllers/documentController');
const authenticateToken = require('../middlewares/auth');

router.use(authenticateToken);

router.get('/numbering', getDocumentNumbering);
router.get('/next-invoice', getNextInvoiceNumber);

module.exports = router;
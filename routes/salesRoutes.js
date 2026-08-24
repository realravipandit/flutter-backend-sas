const express = require('express');
const router = express.Router();
const {
    getSalesSummary,
    getSalesList,
    getSalesDetails,
    createSale,
    getNextInvoiceNumber,
    getTermMasters,
    getNextSalesOrderNumber,
    createSalesOrder
} = require('../controllers/salesController');

// ── Sales Invoice Routes ────────────────────────────────────────────────
router.get('/sales/summary', getSalesSummary);       
router.get('/sales', getSalesList);                     
router.get('/sales/details', getSalesDetails);           
router.get('/sales/next-voucher', getNextInvoiceNumber); 
router.get('/sales/term-masters', getTermMasters);       
router.post('/sales', createSale);                      

// ── Sales Order Routes ──────────────────────────────────────────────────
router.get('/sales-order/next-voucher', getNextSalesOrderNumber); 
router.post('/sales-order/create', createSalesOrder);             

module.exports = router;
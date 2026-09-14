const express = require('express');
const router = express.Router();

const salesController = require('../controllers/salesController');
const posSalesController = require('../controllers/posSalesController');

// ── Standard Sales Invoice Routes ───────────────────────────────────────
router.get('/sales/summary', salesController.getSalesSummary);       
router.get('/sales', salesController.getSalesList);                    
router.get('/sales/details', salesController.getSalesDetails);          
router.get('/sales/next-voucher', salesController.getNextInvoiceNumber); 
router.get('/sales/term-masters', salesController.getTermMasters);      
router.post('/sales', salesController.createSale);                     

// ── POS (Counter Sales) Routes ──────────────────────────────────────────
router.get('/sales/pos/next-voucher', posSalesController.getNextPosInvoiceNumber); 
router.post('/sales/pos', posSalesController.createPosSale); 
router.get('/sales/pos/classes', posSalesController.getClasses); // Maps to /api/sales/classes depending on app mount

// ── Sales Order Routes ──────────────────────────────────────────────────
router.get('/sales-order/next-voucher', salesController.getNextSalesOrderNumber); 
router.post('/sales-order/create', salesController.createSalesOrder);             

module.exports = router;
const express = require('express');
const router = express.Router();
const salesOrderController = require('../controllers/salesOrderController');

// ── Sales Order Routes ──────────────────────────────────────────────────

router.get('/sales-order', salesOrderController.getSalesOrders);              // list (?page, ?pageSize, ?search)
router.get('/sales-order/next-voucher', salesOrderController.getNextSalesOrderNumber);
router.get('/sales-order/:orderId', salesOrderController.getSalesOrderById);   // detail
router.post('/sales-order/create', salesOrderController.createSalesOrder);

module.exports = router;
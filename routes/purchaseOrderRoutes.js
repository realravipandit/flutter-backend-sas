const express = require('express');
const router = express.Router();
const purchaseOrderController = require('../controllers/purchaseOrderController');

// ── Purchase Order Routes ───────────────────────────────────────────────

router.get('/purchase-order', purchaseOrderController.getPurchaseOrders);              // list (?page, ?pageSize, ?search)
router.get('/purchase-order/next-voucher', purchaseOrderController.getNextPurchaseOrderNumber);
router.get('/purchase-order/term-masters', purchaseOrderController.getPiTermMasters);
router.get('/purchase-order/vendors', purchaseOrderController.getVendors);
router.get('/purchase-order/:orderId', purchaseOrderController.getPurchaseOrderById);  // detail
router.post('/purchase-order/create', purchaseOrderController.createPurchaseOrder);

module.exports = router;
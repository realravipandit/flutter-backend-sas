const purchaseOrderService = require("../services/purchaseOrderService");

const getNextPurchaseOrderNumber = async (req, res) => {
    try {
        const result = await purchaseOrderService.getNextPurchaseOrderNumber(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getNextPurchaseOrderNumber:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const createPurchaseOrder = async (req, res) => {
    try {
        const result = await purchaseOrderService.createPurchaseOrder(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("createPurchaseOrder:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const getPurchaseOrders = async (req, res) => {
    try {
        const result = await purchaseOrderService.getPurchaseOrders(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getPurchaseOrders:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const getPurchaseOrderById = async (req, res) => {
    try {
        const result = await purchaseOrderService.getPurchaseOrderById(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getPurchaseOrderById:", err);
        const status = /not found/i.test(err.message) ? 404 : 500;
        res.status(status).json({ success: false, error: err.message });
    }
};

const getPiTermMasters = async (req, res) => {
    try {
        const result = await purchaseOrderService.getPiTermMasters(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getPiTermMasters:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const getVendors = async (req, res) => {
    try {
        const result = await purchaseOrderService.getVendors(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getVendors:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

module.exports = {
    getNextPurchaseOrderNumber,
    createPurchaseOrder,
    getPurchaseOrders,
    getPurchaseOrderById,
    getPiTermMasters,
    getVendors
};
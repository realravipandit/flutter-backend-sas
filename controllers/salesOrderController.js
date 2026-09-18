const salesOrderService = require("../services/salesOrderService");

const getNextSalesOrderNumber = async (req, res) => {
    try {
        const result = await salesOrderService.getNextSalesOrderNumber(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getNextSalesOrderNumber:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const createSalesOrder = async (req, res) => {
    try {
        const result = await salesOrderService.createSalesOrder(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("createSalesOrder:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const getSalesOrders = async (req, res) => {
    try {
        const result = await salesOrderService.getSalesOrders(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getSalesOrders:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const getSalesOrderById = async (req, res) => {
    try {
        const result = await salesOrderService.getSalesOrderById(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getSalesOrderById:", err);
        const status = /not found/i.test(err.message) ? 404 : 500;
        res.status(status).json({ success: false, error: err.message });
    }
};

module.exports = {
    getNextSalesOrderNumber,
    createSalesOrder,
    getSalesOrders,
    getSalesOrderById
};
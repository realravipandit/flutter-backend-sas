const salesService = require("../services/salesService");
const salesReportService = require("../services/reports/salesReportService");

const getSalesSummary = async (req, res) => {
    try {
        const result = await salesReportService.getSalesSummary(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getSalesSummary:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const getSalesList = async (req, res) => {
    try {
        const result = await salesReportService.getSalesList(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getSalesList:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const getSalesDetails = async (req, res) => {
    try {
        const result = await salesReportService.getSalesDetails(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getSalesDetails:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const createSale = async (req, res) => {
    try {
        const result = await salesService.createSale(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("createSale:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const getNextInvoiceNumber = async (req, res) => {
    try {
        const result = await salesService.getNextInvoiceNumber(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getNextInvoiceNumber:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const getTermMasters = async (req, res) => {
    try {
        const result = await salesService.getTermMasters(req);
        res.status(200).json(result);
    } catch (err) {
        console.error("getTermMasters:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

module.exports = {
    getSalesSummary,
    getSalesList,
    getSalesDetails,
    createSale,
    getNextInvoiceNumber,
    getTermMasters
};
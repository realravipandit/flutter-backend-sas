const express = require("express");
const router = express.Router();
const companyController = require("../controllers/companyController");
const authenticateToken = require("../middlewares/auth"); // 👉 Import your auth middleware

// Existing route: Protect the route so req.user.centralDatabase is available
router.get("/companies", authenticateToken, companyController.getCompanies);

// NEW ROUTE: Fetch active company profile (Address, Phone, PAN/VAT) for the PDF header
router.get("/company/profile", authenticateToken, companyController.getActiveCompanyProfile);

module.exports = router;
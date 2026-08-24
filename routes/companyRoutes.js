const express = require("express");
const router = express.Router();
const companyController = require("../controllers/companyController");
const authenticateToken = require("../middlewares/auth"); // 👉 Import your auth middleware

// Protect the route so req.user.centralDatabase is available
router.get("/companies", authenticateToken, companyController.getCompanies);

module.exports = router;
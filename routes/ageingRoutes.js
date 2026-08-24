// routes/agingRoutes.js

const express = require("express");
const router = express.Router();

const ageingController = require("../controllers/ageingController");

router.get("/", ageingController.getAgeingReport);

// router.post("/", ageingController.createAgeing);

module.exports = router;
const express = require("express");
const router = express.Router();
const outstandingController = require("../controllers/outstandingController");

router.get("/outstanding", outstandingController.getOutstanding);

module.exports = router;
const express = require("express");
const router = express.Router();
const inventoryController = require("../controllers/inventoryController");

router.get("/inventory", inventoryController.getInventory);

module.exports = router;

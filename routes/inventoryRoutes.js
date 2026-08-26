const express = require("express");
const router = express.Router();
const inventoryController = require("../controllers/inventoryController");

router.get("/inventory", inventoryController.getInventory);
router.get("/inventory/item-options", inventoryController.getItemOptions);

module.exports = router;
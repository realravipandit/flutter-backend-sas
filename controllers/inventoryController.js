const { getPool, sql } = require("../db");

exports.getInventory = async (req, res) => {
  try {
    const companyCode = req.headers['x-company-code'];
    if (!companyCode) {
      return res.status(400).json({ error: "No company selected." });
    }

    const pool = await getPool(companyCode);
    if (!pool) {
      return res.status(503).json({ error: "Database unavailable" });
    }

    // 1. Fetch Master Inventory Summaries per Item
    const masterResult = await pool.request().query(`
      SELECT 
        tblInvTransaction.ItemID AS id,
        tblItems.ItemName AS itemName,
        SUM(StockQty) AS stockQty,      
        SUM(StockValue) AS totalValue 
      FROM tblInvTransaction
      LEFT OUTER JOIN tblItems ON tblInvTransaction.ItemID = tblItems.ItemID
      WHERE StockQty > 0
      GROUP BY tblInvTransaction.ItemID, tblItems.ItemName
    `);

    // 2. Fetch Detail/Transaction rows for each item
    const detailResult = await pool.request().query(`
      SELECT 
        ItemID AS itemId,
        VoucherID AS voucherId,
        StockQty AS qty,
        StockValue AS value
      FROM tblInvTransaction
      WHERE StockQty > 0
    `);

    // 3. Group details by itemId
    const detailsMap = {};
    detailResult.recordset.forEach(row => {
      if (!detailsMap[row.itemId]) {
        detailsMap[row.itemId] = [];
      }
      detailsMap[row.itemId].push({
        voucherId: row.voucherId,
        qty: row.qty,
        value: row.value
      });
    });

    // 4. Merge into nested structure
    const inventoryData = masterResult.recordset.map(master => ({
      ...master,
      details: detailsMap[master.id] || []
    }));

    res.json(inventoryData);
  } catch (error) {
    console.error("Error fetching inventory:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
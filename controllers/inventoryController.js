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

// =========================================
// GET ITEM OPTIONS (lightweight picker list)
// -----------------------------------------
// Used by pickers like the Stock Ledger Report's item selector.
// Deliberately returns ALL items from tblItems, not just ones with
// current stock (getInventory filters on StockQty > 0) — a ledger
// report can span a date range where an item had movement in the
// past but sits at zero now, and it still needs to show up as a
// selectable option.
//
// IMPORTANT: Sp_SMStockLedgerDetailsReports filters its @Pcode
// parameter against tblItems.ItemCode (not ItemID) — so itemCode
// here MUST be the actual ItemCode column, or item filtering in the
// report will silently match nothing. Unit comes from a join to
// tblItemsUnit via UnitID (UnitCode is the display text), not a
// plain column on tblItems. Also scoped to ItemType='PO' to match
// what the SP itself considers — otherwise the picker could offer
// items the report will never return rows for.
// =========================================
exports.getItemOptions = async (req, res) => {
  try {
    const companyCode = req.headers['x-company-code'];
    if (!companyCode) {
      return res.status(400).json({ error: "No company selected." });
    }

    const pool = await getPool(companyCode);
    if (!pool) {
      return res.status(503).json({ error: "Database unavailable" });
    }

    const result = await pool.request().query(`
      SELECT
        it.ItemCode AS itemCode,
        it.ItemName AS itemName,
        IU.UnitCode AS unit
      FROM tblItems it
      LEFT OUTER JOIN tblItemsUnit IU ON it.UnitID = IU.UnitID
      WHERE it.ItemType = 'PO'
      ORDER BY it.ItemName
    `);

    res.json(result.recordset);
  } catch (error) {
    console.error("Error fetching item options:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
const { getPool, sql } = require("../db");

exports.getOutstanding = async (req, res) => {
  try {
    const companyCode = req.headers['x-company-code'];
    if (!companyCode) {
        return res.status(400).json({ error: "No company selected." });
    }

    const pool = await getPool(companyCode); 
    if (!pool) {
      return res.status(503).json({ error: "Database unavailable" });
    }

    // 1. Fetch Master Totals (Aggregated Outstanding Balances)
    const masterResult = await pool.request().query(`
      SELECT 
        c.LedgerID AS id,
        c.LedgerName AS name,
        SUM(s.NetAmount) AS outstandingAmount,
        'customer' AS type
      FROM tblLedger c
      JOIN tblSIMaster s ON c.LedgerID = s.LedgerID
      WHERE s.NetAmount > 0
      GROUP BY c.LedgerID, c.LedgerName
      
      UNION ALL
      
      SELECT 
        v.LedgerID AS id,
        v.LedgerName AS name,
        SUM(p.NetAmount) AS outstandingAmount,
        'vendor' AS type
      FROM tblLedger v
      JOIN tblPIMaster p ON v.LedgerID = p.LedgerID
      WHERE p.NetAmount > 0
      GROUP BY v.LedgerID, v.LedgerName
    `);

    // 2. Fetch Detail Records (The individual unpaid invoices)
    const detailResult = await pool.request().query(`
      SELECT 
        LedgerID AS ledgerId, 
        VoucherID AS invoiceNumber, 
        VoucherDate AS date, 
        NetAmount AS amount 
      FROM tblSIMaster 
      WHERE NetAmount > 0
      
      UNION ALL
      
      SELECT 
        LedgerID AS ledgerId, 
        PartyBillID AS invoiceNumber, 
        VoucherDate AS date, 
        NetAmount AS amount 
      FROM tblPIMaster 
      WHERE NetAmount > 0
    `);

    // 3. Group the invoices by LedgerID
    const invoicesMap = {};
    detailResult.recordset.forEach(row => {
      if (!invoicesMap[row.ledgerId]) {
        invoicesMap[row.ledgerId] = [];
      }
      invoicesMap[row.ledgerId].push({
        invoiceNumber: row.invoiceNumber,
        date: row.date,
        amount: row.amount
      });
    });

    // 4. Merge the nested arrays into the master records
    const outstandingData = masterResult.recordset.map(master => ({
      ...master,
      invoices: invoicesMap[master.id] || []
    }));

    res.json(outstandingData);
  } catch (error) {
    console.error("Error fetching outstanding:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
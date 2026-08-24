const { getPool, sql } = require("../db");

// ==========================================
// 1. RECEIVABLES (CashBankType = 'R')
// ==========================================
exports.getReceivables = async (req, res) => {
  try {
    const companyCode = req.headers['x-company-code'];
    if (!companyCode) return res.status(400).json({ error: "No company selected." });

    const pool = await getPool(companyCode); 
    if (!pool) return res.status(503).json({ error: "Database unavailable" });

    // 1. Fetch Master Totals (Aggregated Receivable Balances)
    const masterResult = await pool.request().query(`
      SELECT 
        l.LedgerID AS id,
        l.LedgerName AS customerName,
        SUM(cb.Amount) AS receivableAmount
      FROM tblCBDetails cb
      LEFT OUTER JOIN tblLedger l ON cb.LedgerID = l.LedgerID
      WHERE cb.CashBankType = 'R' 
      GROUP BY l.LedgerID, l.LedgerName
    `);

    // 2. Fetch Detail Records (Individual transactions)
    const detailResult = await pool.request().query(`
      SELECT 
        LedgerID AS ledgerId, 
        CashBankID AS voucherId, 
        Amount AS amount 
      FROM tblCBDetails 
      WHERE CashBankType = 'R'
    `);

    // 3. Group the transactions by LedgerID
    const transactionsMap = {};
    detailResult.recordset.forEach(row => {
      if (!transactionsMap[row.ledgerId]) {
        transactionsMap[row.ledgerId] = [];
      }
      transactionsMap[row.ledgerId].push({
        voucherId: row.voucherId,
        amount: row.amount
      });
    });

    // 4. Merge the nested arrays into the master records
    const receivablesData = masterResult.recordset.map(master => ({
      ...master,
      transactions: transactionsMap[master.id] || []
    }));

    res.json({ records: receivablesData });
  } catch (error) {
    console.error("Error fetching receivables:", error);
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// 2. PAYABLES (CashBankType = 'P' or 'p')
// ==========================================
exports.getPayables = async (req, res) => {
  try {
    const companyCode = req.headers['x-company-code'];
    if (!companyCode) return res.status(400).json({ error: "No company selected." });

    const pool = await getPool(companyCode); 
    if (!pool) return res.status(503).json({ error: "Database unavailable" });

    // 1. Fetch Master Totals (Aggregated Payable Balances)
    const masterResult = await pool.request().query(`
      SELECT 
        l.LedgerID AS id,
        l.LedgerName AS vendorName,
        SUM(cb.Amount) AS payableAmount
      FROM tblCBDetails cb
      LEFT OUTER JOIN tblLedger l ON cb.LedgerID = l.LedgerID
      WHERE cb.CashBankType IN ('P', 'p') 
      GROUP BY l.LedgerID, l.LedgerName
    `);

    // 2. Fetch Detail Records
    const detailResult = await pool.request().query(`
      SELECT 
        LedgerID AS ledgerId, 
        CashBankID AS voucherId, 
        Amount AS amount 
      FROM tblCBDetails 
      WHERE CashBankType IN ('P', 'p')
    `);

    // 3. Group the transactions by LedgerID
    const transactionsMap = {};
    detailResult.recordset.forEach(row => {
      if (!transactionsMap[row.ledgerId]) {
        transactionsMap[row.ledgerId] = [];
      }
      transactionsMap[row.ledgerId].push({
        voucherId: row.voucherId,
        amount: row.amount
      });
    });

    // 4. Merge the nested arrays into the master records
    const payablesData = masterResult.recordset.map(master => ({
      ...master,
      transactions: transactionsMap[master.id] || []
    }));

    res.json({ records: payablesData });
  } catch (error) {
    console.error("Error fetching payables:", error);
    res.status(500).json({ error: error.message });
  }
};
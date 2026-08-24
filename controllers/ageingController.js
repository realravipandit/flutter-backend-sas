const { getPool, sql } = require("../db");

exports.getAgeingReport = async (req, res) => {
  try {
    const companyCode = req.headers['x-company-code'];
    if (!companyCode) {
      return res.status(400).json({ error: "No company selected." });
    }

    const pool = await getPool(companyCode);
    if (!pool) {
      return res.status(503).json({ error: "Database unavailable" });
    }

    // 1. Customer Ageing Data
    const customerResult = await pool.request().query(`
      SELECT 
        l.LedgerID AS id,
        l.LedgerName AS name,
        s.VoucherID AS invoiceNumber,
        s.VoucherDate AS date,
        s.NetAmount AS amount,
        DATEDIFF(day, s.VoucherDate, GETDATE()) AS daysOverdue,
        'customer' AS type
      FROM tblSIMaster s
      JOIN tblLedger l ON s.LedgerID = l.LedgerID
      WHERE s.NetAmount > 0
    `);

    // 2. Vendor Ageing Data
    const vendorResult = await pool.request().query(`
      SELECT 
        v.LedgerID AS id,
        v.LedgerName AS name,
        p.PartyBillID AS invoiceNumber,
        p.VoucherDate AS date,
        p.NetAmount AS amount,
        DATEDIFF(day, p.VoucherDate, GETDATE()) AS daysOverdue,
        'vendor' AS type
      FROM tblPIMaster p
      JOIN tblLedger v ON p.LedgerID = v.LedgerID
      WHERE p.NetAmount > 0
    `);

    // 3. Aggregate into Buckets
    const accountsMap = {};
    const allRecords = [...customerResult.recordset, ...vendorResult.recordset];

    allRecords.forEach(row => {
      const key = `${row.type}_${row.id}`;
      if (!accountsMap[key]) {
        accountsMap[key] = {
          id: row.id?.toString(),
          name: row.name,
          type: row.type,
          totalAmount: 0,
          bucket0_30: 0,
          bucket31_60: 0,
          bucket61_90: 0,
          bucket90_plus: 0,
          invoices: []
        };
      }

      const days = row.daysOverdue || 0;
      const amt = row.amount || 0;
      accountsMap[key].totalAmount += amt;

      if (days <= 30) {
        accountsMap[key].bucket0_30 += amt;
      } else if (days <= 60) {
        accountsMap[key].bucket31_60 += amt;
      } else if (days <= 90) {
        accountsMap[key].bucket61_90 += amt;
      } else {
        accountsMap[key].bucket90_plus += amt;
      }

      accountsMap[key].invoices.push({
        invoiceNumber: row.invoiceNumber?.toString(),
        date: row.date,
        amount: amt,
        daysOverdue: days
      });
    });

    res.json(Object.values(accountsMap));
  } catch (error) {
    console.error("Error fetching ageing report:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
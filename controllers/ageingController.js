const { getPool, sql } = require("../db");

/**
 * ============================================================================
 * MECHANISM PORTED FROM OLD SOFTWARE (Sp_SMCustomerAgeing)
 * ============================================================================
 * Old C# call (same SP reused for both customer AND vendor ageing, only
 * @PartyType changes):
 *   Exec [Sp_SMCustomerAgeing]
 *        '<FromDate>', '<ToDate>', '<ToDate>',
 *        @PartyType = 'CU,BO' / 'VE,BO',
 *        @BillorDue = 'Bill' / 'Due',
 *        @Slab = 30,
 *        @AgeingColumn = 4
 *
 * Confirmed against the actual schema (see queries/results in chat history):
 *   1. dateBasis ('bill' | 'due') -- restores @BillorDue.
 *   2. asOfDate -- restores the SP's 3rd date param for DATEDIFF, replacing
 *      the original controller's hardcoded GETDATE().
 *   3. slab -- restores @Slab as a real request param instead of a
 *      hardcoded 30/60/90 if/else chain.
 *   4. 'CU,BO' / 'VE,BO' -- CONFIRMED: tblLedger.LedgerType has real values
 *      CU (165), VE (29), BO (10), OT (75). BO ledgers belong in BOTH
 *      customer and vendor ageing. Your original controller did not filter
 *      by LedgerType at all -- fixed here.
 *   5. Amount/AdjustAmount/BalanceAmount -- CONFIRMED there is no
 *      AdjustAmount column; NetAmount is gross. The real adjustment source
 *      is tblVoucherAdjustment (Dr/Cr voucher settlement matching by
 *      Amount + LedgerID), which returned 0 rows at inspection time --
 *      structurally wired in below regardless, so it activates once
 *      settlement rows exist. (tblInvAdjustMaster/Details is a stock/
 *      inventory table, not used here.)
 *   6. BONUS FIX: tblSIMaster.TenderAmount (cash received on a POS-style
 *      sales voucher) is subtracted from the customer-side balance --
 *      sample data showed fully-tendered invoices your original query
 *      still counted as fully overdue. No equivalent on tblPIMaster.
 *
 * STILL UNVERIFIED: the Dr/Cr sign convention in tblVoucherAdjustment is
 * inferred from column names since the table is currently empty -- once
 * real settlement rows exist, confirm a known part-paid invoice's balance
 * actually drops by the settled amount.
 *
 * ============================================================================
 * MODERN ADDITIONS
 * ============================================================================
 *   - Parameterized queries instead of raw string concatenation into EXEC.
 *   - `slab` accepted as a request param instead of hardcoded, matching the
 *     old @Slab flexibility, with validation so a bad value can't break
 *     the bucket math.
 *   - Bucket boundaries computed generically off `slab` (slab, 2*slab,
 *     3*slab) instead of a fixed if/else chain, so changing the slab
 *     actually changes all four buckets consistently.
 *   - Response includes the effective params used (asOfDate, dateBasis,
 *     slab) so the Flutter AgeingScreen can show them in the UI/PDF export.
 * ============================================================================
 */

async function fetchAgeingRows(pool, { fromDate, toDate, asOfDate, dateBasis }) {
  const dateCol = dateBasis === "due" ? "DueDate" : "VoucherDate";

  const request = pool.request();
  request.input("fromDate", sql.Date, fromDate);
  request.input("toDate", sql.Date, toDate);
  request.input("asOfDate", sql.Date, asOfDate);

  const query = `
    SELECT
      l.LedgerID                                                          AS id,
      l.LedgerName                                                        AS name,
      s.VoucherID                                                         AS invoiceNumber,
      s.VoucherDate                                                       AS date,
      ISNULL(siAdj.SettledAmount, 0)                                      AS adjustAmount,
      (s.NetAmount - ISNULL(s.TenderAmount, 0) - ISNULL(siAdj.SettledAmount, 0)) AS amount,
      DATEDIFF(day, s.${dateCol}, @asOfDate)                              AS daysOverdue,
      'customer'                                                          AS type
    FROM tblSIMaster s
    JOIN tblLedger l ON s.LedgerID = l.LedgerID AND l.LedgerType IN ('CU', 'BO')
    OUTER APPLY (
      SELECT SUM(va.Amount) AS SettledAmount
      FROM tblVoucherAdjustment va
      WHERE va.LedgerID = s.LedgerID
        AND (va.DrVoucherNo = s.VoucherID OR va.CrVoucherNo = s.VoucherID)
    ) siAdj
    WHERE (s.NetAmount - ISNULL(s.TenderAmount, 0) - ISNULL(siAdj.SettledAmount, 0)) > 0
      AND s.VoucherDate BETWEEN @fromDate AND @toDate

    UNION ALL

    SELECT
      v.LedgerID,
      v.LedgerName,
      p.PartyBillID,
      p.VoucherDate,
      ISNULL(piAdj.SettledAmount, 0),
      (p.NetAmount - ISNULL(piAdj.SettledAmount, 0)),
      DATEDIFF(day, p.${dateCol}, @asOfDate),
      'vendor'
    FROM tblPIMaster p
    JOIN tblLedger v ON p.LedgerID = v.LedgerID AND v.LedgerType IN ('VE', 'BO')
    OUTER APPLY (
      SELECT SUM(va.Amount) AS SettledAmount
      FROM tblVoucherAdjustment va
      WHERE va.LedgerID = p.LedgerID
        AND (va.DrVoucherNo = p.VoucherID OR va.CrVoucherNo = p.VoucherID)
    ) piAdj
    WHERE (p.NetAmount - ISNULL(piAdj.SettledAmount, 0)) > 0
      AND p.VoucherDate BETWEEN @fromDate AND @toDate
  `;

  const result = await request.query(query);
  return result.recordset;
}

function bucketKeyFor(days, slab) {
  if (days <= slab) return "bucket0_30";
  if (days <= slab * 2) return "bucket31_60";
  if (days <= slab * 3) return "bucket61_90";
  return "bucket90_plus";
}

exports.getAgeingReport = async (req, res) => {
  try {
    const companyCode = req.headers["x-company-code"];
    if (!companyCode) {
      return res.status(400).json({ error: "No company selected." });
    }

    const pool = await getPool(companyCode);
    if (!pool) {
      return res.status(503).json({ error: "Database unavailable" });
    }

    // NOTE: param names (startDate/endDate) match the existing
    // receivable_service.dart convention used by fetchReceivables, rather
    // than introducing new fromDate/toDate names.
    const {
      startDate = "1900-01-01",
      endDate = new Date().toISOString().slice(0, 10),
      asOfDate,
      dateBasis = "bill", // 'bill' | 'due'  -- old @BillorDue
      slab = "30", // old @Slab
    } = req.query;

    const effectiveAsOfDate = asOfDate || endDate;
    const slabDays = Number.isFinite(parseInt(slab, 10)) && parseInt(slab, 10) > 0
      ? parseInt(slab, 10)
      : 30;

    const rows = await fetchAgeingRows(pool, {
      fromDate: startDate,
      toDate: endDate,
      asOfDate: effectiveAsOfDate,
      dateBasis,
    });

    const accountsMap = {};
    rows.forEach((row) => {
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
          invoices: [],
        };
      }

      const days = row.daysOverdue || 0;
      const amt = row.amount || 0; // net balance, not gross -- see header note

      accountsMap[key].totalAmount += amt;
      accountsMap[key][bucketKeyFor(days, slabDays)] += amt;

      accountsMap[key].invoices.push({
        invoiceNumber: row.invoiceNumber?.toString(),
        date: row.date,
        amount: amt,
        daysOverdue: days,
      });
    });

    res.json({
      asOfDate: effectiveAsOfDate,
      dateBasis,
      slab: slabDays,
      startDate,
      endDate,
      records: Object.values(accountsMap),
    });
  } catch (error) {
    console.error("Error fetching ageing report:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
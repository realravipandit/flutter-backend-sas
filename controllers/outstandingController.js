const { getPool, sql } = require("../db");

/**
 * ============================================================================
 * MECHANISM PORTED FROM OLD SOFTWARE (SP_SMCuVeOutstandingReports)
 * ============================================================================
 * Confirmed against the actual schema (see queries/results in chat history):
 *
 *   1. dateBasis ('bill' | 'due') -- restores rdoBillDate.Checked, toggling
 *      between VoucherDate and DueDate for filtering/ageing.
 *   2. asOfDate -- restores the SP's 3rd date param, decoupled from `endDate`
 *      so historical/period-end reports are possible.
 *   3. 'CU,BO' / 'VE,BO' -- CONFIRMED: tblLedger.LedgerType has real values
 *      CU (165), VE (29), BO (10), OT (75). BO = ledgers that appear in BOTH
 *      customer and vendor reports (branch-office-style ledgers with both
 *      receivable and payable activity). IMPORTANT: your original Node
 *      controller did not filter by LedgerType AT ALL -- it joined every
 *      ledger regardless of type. This file adds the correct filter.
 *   4. Amount/AdjustAmount/BalanceAmount -- CONFIRMED there is NO
 *      AdjustAmount column on tblSIMaster/tblPIMaster; NetAmount is the
 *      GROSS invoice amount (BasicAmount + TermAmount). The old system's
 *      "adjustment" instead lives in a separate table, tblVoucherAdjustment
 *      (Dr/Cr voucher settlement matching: DrVoucherNo, CrVoucherNo, Amount,
 *      LedgerID). BalanceAmount = NetAmount - SUM(settled Amount) from that
 *      table. NOTE: tblVoucherAdjustment returned 0 rows in your DB at
 *      inspection time -- either no settlements have been recorded yet, or
 *      this environment is a fresh/test DB. The join is structurally
 *      correct regardless; it will start reducing balances the moment rows
 *      appear there. (tblInvAdjustMaster/Details was ruled OUT -- those are
 *      inventory/stock-take tables, unrelated to invoice payments.)
 *   5. BONUS FIX (found while inspecting sample data, not previously
 *      flagged): tblSIMaster has a TenderAmount column -- cash actually
 *      received on that sales voucher (POS-style). Sample rows show
 *      invoices where TenderAmount == NetAmount are fully paid at the
 *      counter (e.g. SI-001960, SI-001958, SI-001950 in your sample) yet
 *      your original query counted them as fully outstanding. This file
 *      subtracts TenderAmount for the customer side. tblPIMaster has no
 *      equivalent column, so purchases are unaffected by this fix.
 *
 * STILL UNVERIFIED (tblVoucherAdjustment had 0 rows, so the sign convention
 * below is inferred from column names, not confirmed with real data):
 *   - Whether a settled invoice's VoucherID appears as DrVoucherNo or
 *     CrVoucherNo depends on RefType (likely differs for sales vs purchase
 *     settlements). This query matches EITHER side to stay safe, but once
 *     real settlement rows exist, spot-check that the resulting
 *     balanceAmount actually drops by the settled amount for a known paid
 *     invoice -- adjust the join if it doesn't.
 *
 * ============================================================================
 * MODERN ADDITIONS
 * ============================================================================
 *   - Parameterized queries (sql.Date inputs) instead of the old C#'s raw
 *     string concatenation into EXEC -- avoids SQL injection.
 *   - `includeInvoices` flag: master list stays lightweight; invoice-level
 *     detail is only nested in when explicitly requested (or fetch it lazily
 *     per-ledger from a separate endpoint when a user taps a row in the app).
 *   - Consistent response envelope with the params actually used, so the
 *     Flutter client can display "as of <date>, by <bill/due> date" in the UI.
 * ============================================================================
 */

async function fetchOutstandingRows(pool, { fromDate, toDate, asOfDate, dateBasis }) {
  const dateCol = dateBasis === "due" ? "DueDate" : "VoucherDate";

  const request = pool.request();
  request.input("fromDate", sql.Date, fromDate);
  request.input("toDate", sql.Date, toDate);
  request.input("asOfDate", sql.Date, asOfDate);

  // NOTE: dateCol is interpolated (not user input directly -- it's mapped from
  // an enum-like 'bill'|'due' value above), so this stays injection-safe.
  const query = `
    SELECT
      l.LedgerID                                                          AS id,
      l.LedgerName                                                        AS name,
      s.VoucherID                                                         AS invoiceNumber,
      s.VoucherDate                                                       AS date,
      s.${dateCol}                                                        AS ageingDate,
      s.NetAmount                                                         AS grossAmount,
      ISNULL(s.TenderAmount, 0)                                           AS tenderAmount,
      ISNULL(siAdj.SettledAmount, 0)                                      AS adjustAmount,
      (s.NetAmount - ISNULL(s.TenderAmount, 0) - ISNULL(siAdj.SettledAmount, 0)) AS balanceAmount,
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
      p.${dateCol},
      p.NetAmount,
      0,
      ISNULL(piAdj.SettledAmount, 0),
      (p.NetAmount - ISNULL(piAdj.SettledAmount, 0)),
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

exports.getOutstanding = async (req, res) => {
  try {
    const companyCode = req.headers["x-company-code"];
    if (!companyCode) {
      return res.status(400).json({ error: "No company selected." });
    }

    const pool = await getPool(companyCode);
    if (!pool) {
      return res.status(503).json({ error: "Database unavailable" });
    }

    // Query params mirror the old radio button (dateBasis) and date fields
    // (fromDate/toDate/asOfDate) that were hardcoded/missing in the original
    // Node controller.
    // NOTE: param names (startDate/endDate) match the existing
    // receivable_service.dart convention used by fetchReceivables/
    // fetchAgeing, rather than introducing new fromDate/toDate names.
    const {
      startDate = "1900-01-01",
      endDate = new Date().toISOString().slice(0, 10),
      asOfDate,
      dateBasis = "bill", // 'bill' | 'due'  -- old rdoBillDate.Checked toggle
      includeInvoices = "false",
    } = req.query;

    const effectiveAsOfDate = asOfDate || endDate;

    const rows = await fetchOutstandingRows(pool, {
      fromDate: startDate,
      toDate: endDate,
      asOfDate: effectiveAsOfDate,
      dateBasis,
    });

    const map = {};
    rows.forEach((r) => {
      const key = `${r.type}_${r.id}`;
      if (!map[key]) {
        map[key] = {
          id: r.id?.toString(),
          name: r.name,
          type: r.type,
          outstandingAmount: 0,
        };
        if (includeInvoices === "true") map[key].invoices = [];
      }

      map[key].outstandingAmount += r.balanceAmount || 0;

      if (includeInvoices === "true") {
        map[key].invoices.push({
          invoiceNumber: r.invoiceNumber?.toString(),
          date: r.date,
          amount: r.grossAmount,
          adjustAmount: r.adjustAmount,
          balanceAmount: r.balanceAmount,
        });
      }
    });

    res.json({
      asOfDate: effectiveAsOfDate,
      dateBasis,
      startDate,
      endDate,
      records: Object.values(map),
    });
  } catch (error) {
    console.error("Error fetching outstanding:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
const { getPool, sql } = require("../../db");

// =========================================
// GET STOCK LEDGER REPORT (Raw Rows)
// -----------------------------------------
// Mirrors the legacy Sp_SMStockLedgerDetailsReports call from the
// WinForms app. Grouping by item, running balances, item totals and
// the grand total are computed CLIENT-SIDE in Flutter (same pattern
// as the Ledger Report: this endpoint just returns raw rows and the
// buildStockLedgerReportRows() helper on the Flutter side does the
// rest). Keeping the heavy formatting logic in one place (Dart) means
// both withValue modes (qty-only vs qty+value) share one code path.
// =========================================
const getStockLedgerReport = async (req) => {
    // --- Validate Company ---
    const companyCode = req.headers["x-company-code"];
    if (!companyCode) {
        throw new Error("No company selected.");
    }

    // --- Get Database Pool ---
    const pool = await getPool(companyCode);
    if (!pool) {
        throw new Error("Database unavailable.");
    }

    // --- Request Body ---
    const {
        fromDate,
        toDate,
        itemCode = null,   // comma-separated item codes (ColDataProduct), or null/empty for all items
        withValue = 0,     // 0 = qty only, 1 = qty + value columns
        chkMiti = 0        // 0 = AD dates, 1 = BS (Miti) dates
    } = req.body;

    if (!fromDate || !toDate) {
        throw new Error("fromDate and toDate are required.");
    }

    // Legacy code stripped single quotes out of ColDataProduct before
    // building the exec string — same sanitization here, even though
    // we're using parameterized inputs (defense in depth).
    const cleanItemCode = itemCode ? String(itemCode).replace(/'/g, "") : null;
    const withValueFlag = Number(withValue) ? 1 : 0;
    const chkMitiFlag = Number(chkMiti) ? 1 : 0;

    const request = pool.request();
    request.input("FromDate", sql.Date, fromDate);
    request.input("ToDate", sql.Date, toDate);
    request.input("ItemCode", sql.VarChar(sql.MAX), cleanItemCode);
    request.input("WithValue", sql.Int, withValueFlag);
    request.input("ChkMiti", sql.Int, chkMitiFlag);

    // Legacy call:
    // Exec Sp_SMStockLedgerDetailsReports 'from','to','itemCode',null,null,null,withValue,repost,chkMiti
    // "repost" was always 0 in the legacy caller — hardcoded here too.
    const result = await request.query(`
        EXEC Sp_SMStockLedgerDetailsReports
            @FromDate, @ToDate, @ItemCode, NULL, NULL, NULL, @WithValue, 0, @ChkMiti
    `);

    // --- Normalize Rows (only the columns buildStockLedgerReportRows needs) ---
    return result.recordset.map(row => ({
        ItemName: row.ItemName,
        Unit: row.Unit,
        DisplayDate: row.DisplayDate,
        Particular: row.Particular,
        VoucherNo: row.VoucherNo,
        VoucherSources: row.VoucherSources,
        Opening: row.Opening,
        InQty: row.InQty,
        OutQty: row.OutQty,
        Amount: row.Amount
    }));
};

module.exports = {
    getStockLedgerReport
};
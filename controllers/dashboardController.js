const { getPool, sql } = require("../db");

const getDashboardSummary = async (req, res) => {
    try {
        const companyCode = req.headers['x-company-code'];
        if (!companyCode) {
            return res.status(400).json({ error: "No company selected." });
        }

        const { period, startDate, endDate } = req.query;
        const pool = await getPool(companyCode);
        if (!pool) return res.status(503).json({ error: "Database unavailable" });

        let sDate = ""; let pDate = "";
        const request = pool.request();

        if (startDate && endDate) {
            // FIX: cast voucherDate to DATE before comparing, and bind
            // startDate/endDate as sql.Date instead of sql.DateTime.
            //
            // Previously this used sql.DateTime with a plain BETWEEN on
            // voucherDate. The Flutter dashboard sends date-only strings
            // (e.g. "2026-09-16") for both startDate and endDate, which
            // sql.DateTime parses as midnight --- so the query became
            // BETWEEN '2026-09-16 00:00:00.000' AND '2026-09-16 00:00:00.000',
            // a zero-width range matching only voucherDate rows that are
            // *exactly* midnight. Any row with a legacy non-midnight
            // voucherDate (the same corruption behind the earlier
            // sort-order bug in reportSort.js) fell outside that range and
            // was silently excluded from the SUM --- disproportionately
            // affecting Purchase, which has more of those legacy rows.
            //
            // CAST(...AS DATE) + sql.Date matches the pattern already used
            // by the Sales/Purchase list screens' buildSalesFilters /
            // buildPurchaseFilters in reportFilters.js, and is robust to
            // both date-only input strings and any leftover non-midnight
            // voucherDate values.
            sDate = "WHERE CAST(s.voucherDate AS DATE) BETWEEN @startDate AND @endDate";
            pDate = "WHERE CAST(p.voucherDate AS DATE) BETWEEN @startDate AND @endDate";

            request.input("startDate", sql.Date, startDate);
            request.input("endDate", sql.Date, endDate);
        } else {
            // Fail safe instead of fail open: default to today and log
            // it so a mismatched/unrecognized period is never silently
            // unfiltered again.
            console.warn(`getDashboardSummary: no startDate/endDate provided (period="${period}") --- defaulting to today.`);
            sDate = "WHERE s.voucherDate >= CAST(GETDATE() AS DATE) AND s.voucherDate < DATEADD(day, 1, CAST(GETDATE() AS DATE))";
            pDate = "WHERE p.voucherDate >= CAST(GETDATE() AS DATE) AND p.voucherDate < DATEADD(day, 1, CAST(GETDATE() AS DATE))";
        }

        // 👉 THE MODULAR DASHBOARD QUERY
        const query = `
            -- 0. SALES (recordsets[0])
            -- salesQty comes from tblSIDetails (line-item quantities,
            -- correctly summed per line). salesAmount comes from
            -- tblSIMaster directly instead of summing tblSIDetails.NetAmount
            -- --- the detail table holds pre-tax/pre-terms line amounts,
            -- while the master's NetAmount is the actual final invoice
            -- total (matching what the Sales list screen sums). Summing
            -- the master amount via a separate subquery (rather than
            -- through the details join) avoids multiplying it once per
            -- line item.
            SELECT
                ISNULL((
                    SELECT SUM(d.Qty)
                    FROM dbo.tblSIDetails d
                    LEFT JOIN dbo.tblsimaster s ON s.voucherID = d.voucherID
 ${sDate}
                ), 0) AS salesQty,
                ISNULL((
                    SELECT SUM(s.NetAmount)
                    FROM dbo.tblsimaster s
 ${sDate}
                ), 0) AS salesAmount;

            -- 1. PURCHASES (recordsets[1])
            -- Same pattern as Sales: purchaseAmount sums
            -- tblPIMaster.NetAmount directly instead of
            -- tblPIDetails.NetAmount.
            SELECT
                ISNULL((
                    SELECT SUM(d.Qty)
                    FROM dbo.tblPIDetails d
                    LEFT JOIN dbo.tblpimaster p ON p.voucherID = d.voucherID
 ${pDate}
                ), 0) AS purchaseQty,
                ISNULL((
                    SELECT SUM(p.NetAmount)
                    FROM dbo.tblpimaster p
 ${pDate}
                ), 0) AS purchaseAmount;

            -- 2. RECEIVABLES (recordsets[2])
            SELECT ISNULL(SUM(Amount), 0) AS receivablesAmount
            FROM tblCBDetails
            WHERE CashBankType = 'R';

            -- 3. PAYABLES (recordsets[3])
            SELECT ISNULL(SUM(Amount), 0) AS payablesAmount
            FROM tblCBDetails
            WHERE CashBankType = 'p';

            -- 4. CUSTOMER OUTSTANDING (recordsets[4])
            -- FIX: this used to sum every sale's gross NetAmount with no
            -- LedgerType filter and no payment netting --- effectively
            -- "lifetime gross sales", not outstanding balance. It now
            -- mirrors outstandingController.js's fetchOutstandingRows
            -- logic: only ledgers of type CU/BO, netted against
            -- TenderAmount (cash already collected at the counter) and
            -- against settled amounts in tblVoucherAdjustment, and only
            -- counting invoices where that leaves a positive balance
            -- (a fully/over-paid invoice contributes 0, not a negative
            -- amount that would understate other customers' balances).
            -- Bounded to VoucherDate <= today, matching outstandingController.js's
            -- default endDate (today) so future-dated invoices --- if any exist
            -- in the data --- aren't counted here when the screen excludes them.
            -- No lower bound, since outstanding balance is a running total, not
            -- scoped to the dashboard's selected period.
            SELECT ISNULL(SUM(
                CASE WHEN (s.NetAmount - ISNULL(s.TenderAmount, 0) - ISNULL(siAdj.SettledAmount, 0)) > 0
                     THEN (s.NetAmount - ISNULL(s.TenderAmount, 0) - ISNULL(siAdj.SettledAmount, 0))
                     ELSE 0 END
            ), 0) AS customerOutstanding
            FROM tblSIMaster s
            JOIN tblLedger l ON s.LedgerID = l.LedgerID AND l.LedgerType IN ('CU', 'BO')
            OUTER APPLY (
                SELECT SUM(va.Amount) AS SettledAmount
                FROM tblVoucherAdjustment va
                WHERE va.LedgerID = s.LedgerID
                  AND (va.DrVoucherNo = s.VoucherID OR va.CrVoucherNo = s.VoucherID)
            ) siAdj
            WHERE s.VoucherDate <= CAST(GETDATE() AS DATE);

            -- 5. VENDOR OUTSTANDING (recordsets[5])
            -- Same fix as customer outstanding: LedgerType IN ('VE','BO'),
            -- netted against tblVoucherAdjustment settlements (tblPIMaster
            -- has no TenderAmount equivalent), only positive balances summed.
            SELECT ISNULL(SUM(
                CASE WHEN (p.NetAmount - ISNULL(piAdj.SettledAmount, 0)) > 0
                     THEN (p.NetAmount - ISNULL(piAdj.SettledAmount, 0))
                     ELSE 0 END
            ), 0) AS vendorOutstanding
            FROM tblPIMaster p
            JOIN tblLedger v ON p.LedgerID = v.LedgerID AND v.LedgerType IN ('VE', 'BO')
            OUTER APPLY (
                SELECT SUM(va.Amount) AS SettledAmount
                FROM tblVoucherAdjustment va
                WHERE va.LedgerID = p.LedgerID
                  AND (va.DrVoucherNo = p.VoucherID OR va.CrVoucherNo = p.VoucherID)
            ) piAdj
            WHERE p.VoucherDate <= CAST(GETDATE() AS DATE);

            -- 6. INVENTORY STATUS (recordsets[6])
            -- Signed by Types, matching inventoryController.js's
            -- getInventory logic exactly ('I' adds, everything else
            -- subtracts). The old plain SUM(StockQty)/SUM(StockValue)
            -- added every stock-in AND stock-out transaction together
            -- instead of netting them, inflating the widget's total
            -- versus the actual physical stock shown on the Inventory
            -- screen.
            SELECT
                ISNULL(SUM(CASE WHEN Types = 'I' THEN StockValue ELSE -StockValue END), 0) AS stockValue,
                ISNULL(SUM(CASE WHEN Types = 'I'
                                THEN ISNULL(StockQty,0) + ISNULL(FreeQty,0)
                                ELSE -(ISNULL(StockQty,0) + ISNULL(FreeQty,0))
                           END), 0) AS stockQty
            FROM tblInvTransaction;
        `;

        const result = await request.query(query);

        // Map the results cleanly
        const sales = result.recordsets[0][0] || { salesQty: 0, salesAmount: 0 };
        const purchases = result.recordsets[1][0] || { purchaseQty: 0, purchaseAmount: 0 };
        const receivables = result.recordsets[2][0] || { receivablesAmount: 0 };
        const payables = result.recordsets[3][0] || { payablesAmount: 0 };
        const custOut = result.recordsets[4][0] || { customerOutstanding: 0 };
        const vendOut = result.recordsets[5][0] || { vendorOutstanding: 0 };
        const inventory = result.recordsets[6][0] || { stockValue: 0, stockQty: 0 };

        // Ensure keys exactly match what Flutter is asking for!
        res.status(200).json({
            salesQty: sales.salesQty,
            salesAmount: sales.salesAmount,
            purchaseQty: purchases.purchaseQty,
            purchaseAmount: purchases.purchaseAmount,
            customerOutstanding: custOut.customerOutstanding,
            vendorOutstanding: vendOut.vendorOutstanding,
            receivables: receivables.receivablesAmount,
            payables: payables.payablesAmount,
            stockQty: inventory.stockQty,
            stockValue: inventory.stockValue
        });
    } catch (err) {
        console.error("Error fetching dashboard summary:", err.message);
        res.status(500).send("Error fetching dashboard summary");
    }
};

module.exports = { getDashboardSummary };
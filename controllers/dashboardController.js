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
            sDate = "WHERE s.voucherDate BETWEEN @startDate AND @endDate";
            pDate = "WHERE p.voucherDate BETWEEN @startDate AND @endDate";

            // sql.DateTime ensures it respects full timestamp ranges
            request.input("startDate", sql.DateTime, startDate);
            request.input("endDate", sql.DateTime, endDate);
        } else {
            // 👉 FIX: previously this fell through a textual period chain
            // ('Last 24 Hours', '1 Week', '1 Month', '1 Year') that never
            // matched the labels the Flutter app actually sends ('Today',
            // 'Yesterday', 'This Week', etc). When nothing matched, sDate/
            // pDate stayed empty strings, producing a query with NO WHERE
            // clause at all — an unfiltered, all-time sum labeled "Today"
            // on the client. Fail safe instead of fail open: default to
            // today and log it so a mismatched/unrecognized period is
            // never silently unfiltered again.
            console.warn(`getDashboardSummary: no startDate/endDate provided (period="${period}") — defaulting to today.`);
            sDate = "WHERE s.voucherDate >= CAST(GETDATE() AS DATE) AND s.voucherDate < DATEADD(day, 1, CAST(GETDATE() AS DATE))";
            pDate = "WHERE p.voucherDate >= CAST(GETDATE() AS DATE) AND p.voucherDate < DATEADD(day, 1, CAST(GETDATE() AS DATE))";
        }

        // 👉 THE MODULAR DASHBOARD QUERY
        const query = `
            -- 0. SALES (recordsets[0])
            SELECT
                ISNULL(SUM(d.Qty), 0) AS salesQty, ISNULL(SUM(d.NetAmount), 0) AS salesAmount
            FROM dbo.tblSIDetails d
            LEFT JOIN dbo.tblsimaster s ON s.voucherID = d.voucherID ${sDate};

            -- 1. PURCHASES (recordsets[1])
            SELECT
                ISNULL(SUM(d.Qty), 0) AS purchaseQty, ISNULL(SUM(d.NetAmount), 0) AS purchaseAmount
            FROM dbo.tblPIDetails d
            LEFT JOIN dbo.tblpimaster p ON p.voucherID = d.voucherID ${pDate};

            -- 2. RECEIVABLES (recordsets[2])
            SELECT ISNULL(SUM(Amount), 0) AS receivablesAmount
            FROM tblCBDetails
            WHERE CashBankType = 'R';

            -- 3. PAYABLES (recordsets[3])
            SELECT ISNULL(SUM(Amount), 0) AS payablesAmount
            FROM tblCBDetails
            WHERE CashBankType = 'p';

            -- 4. CUSTOMER OUTSTANDING (recordsets[4])
            SELECT ISNULL(SUM(s.NetAmount), 0) AS customerOutstanding
            FROM tblLedger c
            JOIN tblSIMaster s ON c.LedgerID = s.LedgerID
            WHERE s.NetAmount > 0;

            -- 5. VENDOR OUTSTANDING (recordsets[5])
            SELECT ISNULL(SUM(p.NetAmount), 0) AS vendorOutstanding
            FROM tblLedger v
            JOIN tblPIMaster p ON v.LedgerID = p.LedgerID
            WHERE p.NetAmount > 0;

            -- 6. INVENTORY STATUS (recordsets[6])
            SELECT
                ISNULL(SUM(StockValue), 0) AS stockValue,
                ISNULL(SUM(StockQty), 0) AS stockQty
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
        const inventory = result.recordsets[6][0] || { stockValueValue: 0, stockQty: 0 };

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
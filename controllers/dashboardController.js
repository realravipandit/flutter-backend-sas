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

        // Standardize date filters
        if (period === 'Last 24 Hours') {
            sDate = "WHERE s.voucherDate >= DATEADD(hour, -24, GETDATE())";
            pDate = "WHERE p.voucherDate >= DATEADD(hour, -24, GETDATE())";
        } else if (period === '1 Week') {
            sDate = "WHERE s.voucherDate >= DATEADD(day, -7, GETDATE())";
            pDate = "WHERE p.voucherDate >= DATEADD(day, -7, GETDATE())";
        } else if (period === '1 Month') {
            sDate = "WHERE s.voucherDate >= DATEADD(month, -1, GETDATE())";
            pDate = "WHERE p.voucherDate >= DATEADD(month, -1, GETDATE())";
        } else if (period === '1 Year') {
            sDate = "WHERE s.voucherDate >= DATEADD(year, -1, GETDATE())";
            pDate = "WHERE p.voucherDate >= DATEADD(year, -1, GETDATE())";
        } else if (period === 'Custom Date' && startDate && endDate) {
            sDate = "WHERE s.voucherDate BETWEEN @startDate AND @endDate";
            pDate = "WHERE p.voucherDate BETWEEN @startDate AND @endDate";
            request.input("startDate", sql.Date, startDate);
            request.input("endDate", sql.Date, endDate);
        }

        // 👉 THE MODULAR DASHBOARD QUERY (Now with REAL Outstanding Queries)
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

            -- 4. CUSTOMER OUTSTANDING (recordsets[4]) - REAL QUERY
            SELECT ISNULL(SUM(s.NetAmount), 0) AS customerOutstanding
            FROM tblLedger c
            JOIN tblSIMaster s ON c.LedgerID = s.LedgerID
            WHERE s.NetAmount > 0;

            -- 5. VENDOR OUTSTANDING (recordsets[5]) - REAL QUERY
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
            
            // EXACT FLUTTER KEYS:
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
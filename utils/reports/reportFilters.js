// =========================================
// PURCHASE REPORT FILTERS
// =========================================
const buildPurchaseFilters = (query, request, sql) => {
    const conditions = [];
    const { period, startDate, endDate, search, party } = query;

    // --- DATE / PERIOD FILTER ---
    if (period) {
        switch (period) {
            case "Today":
                conditions.push(`CAST(m.VoucherDate AS DATE) = CAST(GETDATE() AS DATE)`); break;
            case "Yesterday":
                conditions.push(`CAST(m.VoucherDate AS DATE) = CAST(DATEADD(DAY, -1, GETDATE()) AS DATE)`); break;
            case "Last 7 Days":
                conditions.push(`m.VoucherDate >= DATEADD(DAY, -7, GETDATE())`); break;
            case "Last 30 Days":
                conditions.push(`m.VoucherDate >= DATEADD(DAY, -30, GETDATE())`); break;
            case "This Month":
                conditions.push(`m.VoucherDate >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)`); break;
            case "Last Month":
                conditions.push(`m.VoucherDate >= DATEADD(MONTH, DATEDIFF(MONTH, 0, GETDATE()) - 1, 0) AND m.VoucherDate < DATEADD(MONTH, DATEDIFF(MONTH, 0, GETDATE()), 0)`); break;
        }
    }

    // --- CUSTOM DATE RANGE ---
    if (startDate && endDate) {
        conditions.push(`CAST(m.VoucherDate AS DATE) BETWEEN @startDate AND @endDate`);
        request.input("startDate", sql.Date, startDate);
        request.input("endDate", sql.Date, endDate);
    }

    // --- SEARCH FILTER ---
    if (search && search.trim() !== "") {
        conditions.push(`
            (
                ISNULL(m.PartyName, '') LIKE '%' + @search + '%'
                OR ISNULL(m.PartyBillID, '') LIKE '%' + @search + '%'
                OR ISNULL(l.LedgerName, '') LIKE '%' + @search + '%'
            )
        `);
        request.input("search", sql.NVarChar(100), search.trim());
    }

    // --- PARTY FILTER ---
    if (party && party.trim() !== "") {
        conditions.push(`ISNULL(NULLIF(m.PartyName, ''), l.LedgerName) = @party`);
        request.input("party", sql.NVarChar(250), party.trim());
    }

    if (conditions.length === 0) return "";
    return `WHERE ${conditions.join(" AND ")}`;
};


// =========================================
// SALES REPORT FILTERS (NEW)
// =========================================
const buildSalesFilters = (query, request, sql) => {
    const conditions = [];
    const { period, startDate, endDate, search, party } = query;

    // --- DATE / PERIOD FILTER ---
    if (period) {
        switch (period) {
            case "Today":
                conditions.push(`CAST(m.VoucherDate AS DATE) = CAST(GETDATE() AS DATE)`); break;
            case "Yesterday":
                conditions.push(`CAST(m.VoucherDate AS DATE) = CAST(DATEADD(DAY, -1, GETDATE()) AS DATE)`); break;
            case "Last 7 Days":
                conditions.push(`m.VoucherDate >= DATEADD(DAY, -7, GETDATE())`); break;
            case "Last 30 Days":
                conditions.push(`m.VoucherDate >= DATEADD(DAY, -30, GETDATE())`); break;
            case "This Month":
                conditions.push(`m.VoucherDate >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)`); break;
            case "Last Month":
                conditions.push(`m.VoucherDate >= DATEADD(MONTH, DATEDIFF(MONTH, 0, GETDATE()) - 1, 0) AND m.VoucherDate < DATEADD(MONTH, DATEDIFF(MONTH, 0, GETDATE()), 0)`); break;
        }
    }

    // --- CUSTOM DATE RANGE ---
    if (startDate && endDate) {
        conditions.push(`CAST(m.VoucherDate AS DATE) BETWEEN @startDate AND @endDate`);
        request.input("startDate", sql.Date, startDate);
        request.input("endDate", sql.Date, endDate);
    }

    // --- SEARCH FILTER (Using VoucherID for Sales instead of PartyBillID) ---
    if (search && search.trim() !== "") {
        conditions.push(`
            (
                ISNULL(m.VoucherID, '') LIKE '%' + @search + '%'
                OR ISNULL(l.LedgerName, '') LIKE '%' + @search + '%'
                OR ISNULL(m.PartyName, '') LIKE '%' + @search + '%'
            )
        `);
        request.input("search", sql.NVarChar(100), search.trim());
    }

    // --- PARTY FILTER ---
    if (party && party.trim() !== "") {
        conditions.push(`ISNULL(NULLIF(m.PartyName, ''), l.LedgerName) = @party`);
        request.input("party", sql.NVarChar(250), party.trim());
    }

    if (conditions.length === 0) return "";
    return `WHERE ${conditions.join(" AND ")}`;
};

module.exports = {
    buildPurchaseFilters,
    buildSalesFilters
};
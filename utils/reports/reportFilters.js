// =========================================
// PURCHASE REPORT FILTERS
// =========================================
const buildPurchaseFilters = (query, request, sql) => {
    const conditions = [];
    const { startDate, endDate, search, party } = query;

    // --- DATE RANGE ---
    // 👉 The old `period` string-matching switch was removed here.
    // PurchaseScreen's filter chips already compute real startDate/
    // endDate for every quick-filter option (Today, Yesterday, This
    // Week, Last Week, etc.) before calling the API, so the switch
    // was dead code — and it was missing cases for "This Week"/
    // "Last Week", which would have silently returned unfiltered
    // results if anything ever relied on it. Just handle explicit
    // dates now.
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
// SALES REPORT FILTERS
// =========================================
const buildSalesFilters = (query, request, sql) => {
    const conditions = [];
    const { startDate, endDate, search, party } = query;

    // --- DATE RANGE ---
    // 👉 Same simplification as Purchase: SaleScreen's filter chips
    // already compute real startDate/endDate for every quick-filter
    // option, so the old `period` switch was dead code with the same
    // missing-case gap.
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
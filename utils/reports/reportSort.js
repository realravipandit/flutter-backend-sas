// =========================================
// PURCHASE REPORT SORTING
// =========================================
const buildPurchaseSort = (sortBy, sortOrder) => {
    const direction = String(sortOrder).toLowerCase() === "asc" ? "ASC" : "DESC";

    switch (sortBy) {
        case "amount":
            return `m.NetAmount ${direction}, CAST(m.VoucherDate AS DATE) DESC, m.VoucherTime DESC`;
        case "party":
            return `ISNULL(NULLIF(m.PartyName, ''), l.LedgerName) ${direction}, CAST(m.VoucherDate AS DATE) DESC`;
        case "invoice":
            return `m.PartyBillID ${direction}, CAST(m.VoucherDate AS DATE) DESC`;
        case "date":
        default:
            // 👉 FIX: cast VoucherDate to DATE before comparing. Some
            // legacy-written rows have a baked-in 05:45:00 time-of-day
            // on VoucherDate (from before posSalesService.js wrote
            // clean midnight values), which made same-day records sort
            // out of order against clean 00:00:00 rows. Truncating to
            // just the date, then breaking ties on the real VoucherTime
            // creation timestamp, gives correct "latest first" order
            // regardless of what's baked into VoucherDate historically.
            return `CAST(m.VoucherDate AS DATE) ${direction}, m.VoucherTime ${direction}`;
    }
};

// =========================================
// SALES REPORT SORTING (NEW)
// =========================================
const buildSalesSort = (sortBy, sortOrder) => {
    const direction = String(sortOrder).toLowerCase() === "asc" ? "ASC" : "DESC";

    switch (sortBy) {
        case "amount":
            return `m.NetAmount ${direction}, CAST(m.VoucherDate AS DATE) DESC, m.VoucherTime DESC`;
        case "party":
            return `ISNULL(NULLIF(m.PartyName, ''), l.LedgerName) ${direction}, CAST(m.VoucherDate AS DATE) DESC`;
        case "invoice":
            // Sales uses VoucherID as the invoice number
            return `m.VoucherID ${direction}, CAST(m.VoucherDate AS DATE) DESC`;
        case "date":
        default:
            // Same fix as Purchase: truncate VoucherDate to its date
            // part before comparing, then tie-break on VoucherTime.
            return `CAST(m.VoucherDate AS DATE) ${direction}, m.VoucherTime ${direction}`;
    }
};

module.exports = {
    buildPurchaseSort,
    buildSalesSort
};
// =========================================
// PURCHASE REPORT SORTING
// =========================================
const buildPurchaseSort = (sortBy, sortOrder) => {
    const direction = String(sortOrder).toLowerCase() === "asc" ? "ASC" : "DESC";

    switch (sortBy) {
        case "amount":
            return `m.NetAmount ${direction}, m.VoucherDate DESC, m.VoucherTime DESC`;
        case "party":
            return `ISNULL(NULLIF(m.PartyName, ''), l.LedgerName) ${direction}, m.VoucherDate DESC`;
        case "invoice":
            return `m.PartyBillID ${direction}, m.VoucherDate DESC`;
        case "date":
        default:
            return `m.VoucherDate ${direction}, m.VoucherTime ${direction}`;
    }
};

// =========================================
// SALES REPORT SORTING (NEW)
// =========================================
const buildSalesSort = (sortBy, sortOrder) => {
    const direction = String(sortOrder).toLowerCase() === "asc" ? "ASC" : "DESC";

    switch (sortBy) {
        case "amount":
            return `m.NetAmount ${direction}, m.VoucherDate DESC, m.VoucherTime DESC`;
        case "party":
            return `ISNULL(NULLIF(m.PartyName, ''), l.LedgerName) ${direction}, m.VoucherDate DESC`;
        case "invoice":
            // Sales uses VoucherID as the invoice number
            return `m.VoucherID ${direction}, m.VoucherDate DESC`; 
        case "date":
        default:
            return `m.VoucherDate ${direction}, m.VoucherTime ${direction}`;
    }
};

module.exports = {
    buildPurchaseSort,
    buildSalesSort
};
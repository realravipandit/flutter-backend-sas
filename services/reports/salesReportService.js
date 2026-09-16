const { getPool, sql } = require("../../db");
const { buildSalesFilters } = require("../../utils/reports/reportFilters");
const { buildSalesSort } = require("../../utils/reports/reportSort");
const { buildPagination } = require("../../utils/reports/reportPagination");

// =========================================
// DATE HELPER
// Converts a JS Date (or already-a-string) into a plain
// 'YYYY-MM-DD' string using LOCAL getters --- never toISOString(),
// which always renders in UTC and caused the one-day-behind bug
// on the Windows Server (Nepal, UTC+5:45) once db.js's useUTC:false
// setting produced a Date object internally shifted by that offset.
// =========================================
function toLocalDateString(date) {
    if (!date) return null;
    if (typeof date === 'string') return date;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// =========================================
// TIME HELPER
// Same idea as toLocalDateString, but preserves the full
// timestamp (hours/minutes/seconds) since VoucherTime is a genuine
// creation-time column for Sales (shown to the user), not just a
// date paired with a throwaway time-of-day.
// =========================================
function toLocalDateTimeString(date) {
    if (!date) return null;
    if (typeof date === 'string') return date;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ` +
        `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

// =========================================
// GET SALES LIST
// List + Filtering + Sorting + Pagination
// =========================================
const getSalesList = async (req) => {
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

    // --- Query Parameters ---
    const {
        page = 1,
        limit = 25,
        sortBy = "date",
        sortOrder = "desc"
    } = req.query;

    // --- Build Filters, Sort & Pagination ---
    const request = pool.request();
    const whereClause = buildSalesFilters(req.query, request, sql);
    const orderBy = buildSalesSort(sortBy, sortOrder);
    const pagination = buildPagination(page, limit, request, sql);

    // --- Main Sales Query (Using exact View_DynamicSITerms column mapping) ---
    // 👉 FIX: VoucherDate and VoucherTime are both CONVERTed to plain
    // strings in SQL, so no native DATETIME ever becomes a JS Date
    // object here --- that's what was getting UTC-serialized and
    // shown a day/hours off once it reached the client.
    const query = `
        SELECT
            m.VoucherID AS id,
            m.VoucherID,
            CONVERT(varchar(10), m.VoucherDate, 23) AS VoucherDate,
            CONVERT(varchar(19), m.VoucherTime, 120) AS VoucherTime,
            ISNULL(NULLIF(m.PartyName, ''), l.LedgerName) AS customerName,
            m.VoucherID AS invoiceNumber,
            m.NetAmount AS totalAmount,
            (
                SELECT
                    d.Sno,
                    d.ItemID,
                    i.ItemName AS productName,
                    d.Qty,
                    d.Rate,
                    d.NetAmount AS amount,
                    u.UnitName AS unit
                FROM tblSIDetails d
                LEFT JOIN tblItems i ON d.ItemID = i.ItemID
                LEFT JOIN tblItemsUnit u ON d.UnitID = u.UnitID
                WHERE d.VoucherID = m.VoucherID
                FOR JSON PATH
            ) AS itemsJson,
            (
                SELECT
                    [Term Name] AS TermName,
                    [Term Rate] AS Rate,
                    [Term Amount] AS Amount,
                    Sign
                FROM View_DynamicSITerms
                WHERE [Voucher No] = m.VoucherID
                FOR JSON PATH
            ) AS termsJson
        FROM tblSIMaster m
        LEFT JOIN tblLedger l ON m.LedgerID = l.LedgerID
 ${whereClause}
ORDER BY ${orderBy}
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY;
    `;

    // --- Count Query ---
    const countRequest = pool.request();
    const countWhereClause = buildSalesFilters(req.query, countRequest, sql);
    const countQuery = `
        SELECT COUNT(*) AS total
        FROM tblSIMaster m
        LEFT JOIN tblLedger l ON m.LedgerID = l.LedgerID
 ${countWhereClause};
    `;

    // --- Execute Queries Concurrently ---
    const [result, countResult] = await Promise.all([
        request.query(query),
        countRequest.query(countQuery)
    ]);

    // --- Format Records ---
    const records = result.recordset.map(row => {
        let parsedItems = [];
        let parsedTerms = [];

        if (row.itemsJson) {
            try {
                parsedItems = JSON.parse(row.itemsJson);
            } catch (error) {
                console.error("Sales items JSON parse error:", error);
                parsedItems = [];
            }
        }

        if (row.termsJson) {
            try {
                parsedTerms = JSON.parse(row.termsJson);
            } catch (error) {
                console.error("Sales terms JSON parse error:", error);
                parsedTerms = [];
            }
        }

        const { itemsJson, termsJson, ...masterData } = row;
        return {
            ...masterData,
            items: parsedItems,
            terms: parsedTerms
        };
    });

    // --- Pagination Info ---
    const total = Number(countResult.recordset[0]?.total || 0);
    const totalPages = total > 0 ? Math.ceil(total / pagination.limit) : 0;

    return {
        records,
        data: records,
        pagination: {
            page: pagination.page,
            limit: pagination.limit,
            total,
            totalPages,
            hasNextPage: pagination.page < totalPages,
            hasPreviousPage: pagination.page > 1
        },
        meta: { totalPages }
    };
};

// =========================================
// GET SALES DETAILS
// Single Voucher
// =========================================
const getSalesDetails = async (req) => {
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

    // --- Get Voucher ID ---
    const voucherId = req.query.voucherId || req.params.voucherId;
    if (!voucherId) {
        throw new Error("Voucher ID is required.");
    }

    // --- Master Record (+ customer address, + counter/class name) ---
    const masterRes = await pool
        .request()
        .input("VoucherID", sql.VarChar(50), voucherId)
        .query(`
            SELECT
                m.*,
                l.LedgerAddress AS customerAddress,
                c.ClassName AS counterName
            FROM tblSIMaster m
            LEFT JOIN tblLedger l ON m.LedgerID = l.LedgerID
            LEFT JOIN tblClass c ON m.ClassID = c.ClassID
            WHERE m.VoucherID = @VoucherID
        `);

    if (!masterRes.recordset.length) {
        throw new Error(`Sale record ${voucherId} not found.`);
    }

    // --- Detail Items (+ unit name) ---
    const detailsRes = await pool
        .request()
        .input("VoucherID", sql.VarChar(50), voucherId)
        .query(`
            SELECT
                d.*,
                i.ItemName AS productName,
                u.UnitName AS unit
            FROM tblSIDetails d
            LEFT JOIN tblItems i ON d.ItemID = i.ItemID
            LEFT JOIN tblItemsUnit u ON d.UnitID = u.UnitID
            WHERE d.VoucherID = @VoucherID
        `);

    // --- Dynamic Terms via View ---
    const termsRes = await pool
        .request()
        .input("VoucherID", sql.VarChar(50), voucherId)
        .query(`
            SELECT
                [Term Name] AS TermName,
                [Term Rate] AS Rate,
                [Term Amount] AS Amount,
                Sign
            FROM View_DynamicSITerms
            WHERE [Voucher No] = @VoucherID
        `);

    // --- Resolve Invoice Type (SB / Tax / Abbr) from voucher prefix ---
    const seqRes = await pool.request().query(`
        SELECT Module, DocumentName, ISNULL(POSSequence, '') AS POSSequence, Prefix
        FROM tblVoucherSequences
        WHERE Module IN ('SB', 'CS') AND Prefix IS NOT NULL AND Prefix <> ''
    `);

    const match = seqRes.recordset
        .filter(r => voucherId.startsWith(r.Prefix))
        .sort((a, b) => b.Prefix.length - a.Prefix.length)[0];

    let type = 'Unknown';
    if (match) {
        if (match.Module === 'SB') {
            type = 'SB';
        } else {
            type = (match.POSSequence || '').toLowerCase() === 'tax' ? 'Tax' : 'Abbr';
        }
    }

    // 👉 FIX: reformat VoucherDate and VoucherTime using local getters
    // before returning, so this single-voucher view doesn't have the
    // same UTC-shift issue as the list view. VoucherTime keeps its
    // full hh:mm:ss since it's a genuine creation-timestamp column
    // shown to the user for Sales (unlike Purchase).
    const master = { ...masterRes.recordset[0], type };
    master.VoucherDate = toLocalDateString(master.VoucherDate);
    master.VoucherTime = toLocalDateTimeString(master.VoucherTime);

    return {
        master,
        items: detailsRes.recordset,
        terms: termsRes.recordset
    };
};

// =========================================
// GET SALES SUMMARY (Top Widgets)
// =========================================
const getSalesSummary = async (req) => {
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

    // --- Build Filters ---
    const request = pool.request();
    const whereClause = buildSalesFilters(req.query, request, sql);

    const result = await request.query(`
        SELECT
            ISNULL(SUM(d.Qty),0) AS salesQty,
            ISNULL(SUM(d.NetAmount),0) AS salesAmount,
            ISNULL(SUM(d.Qty),0) AS quantity,
            ISNULL(SUM(d.NetAmount),0) AS totalAmount
        FROM tblSIDetails d
        LEFT JOIN tblSIMaster m ON m.VoucherID = d.VoucherID
        LEFT JOIN tblLedger l ON m.LedgerID = l.LedgerID
 ${whereClause}
    `);

    return result.recordset[0] || { salesQty: 0, salesAmount: 0, quantity: 0, totalAmount: 0 };
};

module.exports = {
    getSalesList,
    getSalesDetails,
    getSalesSummary
};
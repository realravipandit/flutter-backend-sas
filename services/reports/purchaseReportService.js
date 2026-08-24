const { getPool, sql } = require("../../db");
const { buildPurchaseFilters } = require("../../utils/reports/reportFilters");
const { buildPurchaseSort } = require("../../utils/reports/reportSort");
const { buildPagination } = require("../../utils/reports/reportPagination");

// =========================================
// GET PURCHASE SUMMARY / LIST
// List + Filtering + Sorting + Pagination
// =========================================
const getPurchaseSummary = async (req) => {
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
    const whereClause = buildPurchaseFilters(req.query, request, sql);
    const orderBy = buildPurchaseSort(sortBy, sortOrder);
    const pagination = buildPagination(page, limit, request, sql);

    // --- Main Purchase Query (Using FOR JSON PATH for Items & Dynamic Terms) ---
    const query = `
        SELECT
            m.VoucherID AS id,
            m.VoucherID,
            m.VoucherDate,
            ISNULL(m.VoucherTime, '00:00:00') AS VoucherTime,
            ISNULL(NULLIF(m.PartyName, ''), l.LedgerName) AS supplierName,
            m.PartyBillID AS invoiceNumber,
            m.NetAmount AS totalAmount,
            (
                SELECT
                    d.Sno,
                    d.ItemID,
                    i.ItemName AS productName,
                    d.Qty,
                    d.Rate,
                    d.NetAmount AS amount
                FROM tblPIDetails d
                LEFT JOIN tblItems i ON d.ItemID = i.ItemID
                WHERE d.VoucherID = m.VoucherID
                FOR JSON PATH
            ) AS itemsJson,
            (
                SELECT
                    [Term Name] AS TermName,
                    [Term Rate] AS Rate,
                    [Term Amount] AS Amount,
                    Sign
                FROM View_DynamicPITerms
                WHERE [Voucher No] = m.VoucherID OR [Voucher No] = m.PartyBillID
                FOR JSON PATH
            ) AS termsJson
        FROM tblPIMaster m
        LEFT JOIN tblLedger l ON m.LedgerID = l.LedgerID
        ${whereClause}
        ORDER BY ${orderBy}
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY;
    `;

    // --- Count Query ---
    const countRequest = pool.request();
    const countWhereClause = buildPurchaseFilters(req.query, countRequest, sql);

    const countQuery = `
        SELECT COUNT(*) AS total
        FROM tblPIMaster m
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
                console.error("Purchase items JSON parse error:", error);
                parsedItems = [];
            }
        }

        if (row.termsJson) {
            try {
                parsedTerms = JSON.parse(row.termsJson);
            } catch (error) {
                console.error("Purchase terms JSON parse error:", error);
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
        data: records, // Fallback injected so Flutter UI doesn't crash
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
// GET PURCHASE DETAILS
// Single Voucher
// =========================================
const getPurchaseDetails = async (req) => {
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

    // --- Master Record ---
    const masterRes = await pool
        .request()
        .input("VoucherID", sql.VarChar(50), voucherId)
        .query(`
            SELECT *
            FROM tblPIMaster
            WHERE VoucherID = @VoucherID
        `);

    // --- Detail Items ---
    const detailsRes = await pool
        .request()
        .input("VoucherID", sql.VarChar(50), voucherId)
        .query(`
            SELECT
                d.*,
                i.ItemName AS productName
            FROM tblPIDetails d
            LEFT JOIN tblItems i ON d.ItemID = i.ItemID
            WHERE d.VoucherID = @VoucherID
        `);

    // --- Dynamic Terms via View (Matching VoucherID or PartyBillID) ---
    const termsRes = await pool
        .request()
        .input("VoucherID", sql.VarChar(50), voucherId)
        .query(`
            SELECT 
                [Term Name] AS TermName,
                [Term Rate] AS Rate,
                [Term Amount] AS Amount,
                Sign
            FROM View_DynamicPITerms
            WHERE [Voucher No] = @VoucherID OR [Voucher No] IN (
                SELECT PartyBillID FROM tblPIMaster WHERE VoucherID = @VoucherID
            )
        `);

    return {
        master: masterRes.recordset[0] || {},
        items: detailsRes.recordset,
        terms: termsRes.recordset
    };
};

module.exports = {
    getPurchaseSummary,
    getPurchaseDetails
};
const { getPool, sql } = require("../db");
const {
    getNextVoucher,
    incrementVoucherSequence,
} = require("../utils/voucherSequence");
const {
    resolveBranch,
} = require("../utils/branchResolver");

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

async function getSystemSettings(tx) {
    const result = await new sql.Request(tx).query(`
        SELECT TOP 1 * FROM tblSystemSettings
    `);
    if (!result.recordset.length) throw new Error("System settings not configured.");
    return result.recordset[0];
}

// No "walk-in vendor" concept --- a Purchase Order always needs a real
// vendor ledger. (Sales Order falls back to Cash_Book when no customer
// is picked; there is no equivalent fallback here.)
async function resolveVendorLedger(vendorLedgerId) {
    if (vendorLedgerId == null) throw new Error("Vendor is required.");
    return vendorLedgerId;
}

async function resolveCurrency(tx, currencyId) {
    if (currencyId != null) return currencyId;
    const settings = await getSystemSettings(tx);
    return settings.CurrencyID != null ? settings.CurrencyID : null;
}

async function validateItemsGodownsUnits(tx, items) {
    const itemIds = [...new Set(items.map(i => i.itemId).filter(id => id != null))];
    const godownIds = [...new Set(items.map(i => i.godownId).filter(id => id != null))];
    const unitIds = [...new Set(items.map(i => i.unitId).filter(id => id != null))];

    const req = new sql.Request(tx);

    if (itemIds.length > 0) {
        const itemCheck = await req.query(`SELECT ItemID FROM tblItems WHERE ItemID IN (${itemIds.join(',')})`);
        const foundItemIds = new Set(itemCheck.recordset.map(r => r.ItemID));
        for (const id of itemIds) {
            if (!foundItemIds.has(id)) throw new Error(`Item ID ${id} does not exist.`);
        }
    }

    if (godownIds.length > 0) {
        const godownCheck = await req.query(`SELECT GodownID FROM tblGodown WHERE GodownID IN (${godownIds.join(',')})`);
        const foundGodownIds = new Set(godownCheck.recordset.map(r => r.GodownID));
        for (const id of godownIds) {
            if (!foundGodownIds.has(id)) throw new Error(`Godown ID ${id} does not exist.`);
        }
    }

    if (unitIds.length > 0) {
        const unitCheck = await req.query(`SELECT UnitID FROM tblItemsUnit WHERE UnitID IN (${unitIds.join(',')})`);
        const foundUnitIds = new Set(unitCheck.recordset.map(r => r.UnitID));
        for (const id of unitIds) {
            if (!foundUnitIds.has(id)) throw new Error(`Unit ID ${id} does not exist.`);
        }
    }
}

// Shared vendor-name resolution: PartyName unless blank, in which case
// fall back to tblLedger.LedgerName via LedgerID. (No "cash" special
// case here --- that's a sales-only concept.)
const VENDOR_NAME_EXPR = `
    CASE
        WHEN m.PartyName IS NULL OR LTRIM(RTRIM(m.PartyName)) = ''
            THEN l.LedgerName
        ELSE m.PartyName
    END
`;

// ─────────────────────────────────────────────────────────────
// CREATE PURCHASE ORDER
// ─────────────────────────────────────────────────────────────

exports.createPurchaseOrder = async (req) => {
    const companyCode = req.headers["x-company-code"];
    if (!companyCode) throw new Error("Company not selected.");

    const pool = await getPool(companyCode);
    if (!pool) throw new Error("Database unavailable.");

    const {
        vendorLedgerId, vendorName, branchId = null, agentId = null, classId = null, classId1 = null,
        classId2 = null, currencyId = null, nepaliDate, adDate, remarks = "",
        items = [], billTerms = []
    } = req.body;

    if (!items.length) throw new Error("Cart is empty.");

    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
        const finalBranchId = await resolveBranch(tx, branchId);
        const ledgerId = await resolveVendorLedger(vendorLedgerId);
        const finalCurrency = await resolveCurrency(tx, currencyId);

        await validateItemsGodownsUnits(tx, items);

        // Sequence uses 'PO' for Purchase Order
        const poSequence = await getNextVoucher(tx, "PO", finalBranchId);
        const orderId = poSequence.voucherId;

        const orderDate = adDate ? new Date(adDate) : new Date();
        const orderTime = new Date();

        let basicAmount = 0;
        let masterBasicAmount = 0;
        let billTermAmount = 0;

        items.forEach(item => {
            let itemBasic = (Number(item.qty) || 0) * (Number(item.rate) || 0);
            basicAmount += itemBasic;

            let itemTermsTotal = 0;
            if (item.itemTerms && item.itemTerms.length > 0) {
                item.itemTerms.forEach(t => {
                    const amt = Number(t.amount) || 0;
                    itemTermsTotal += (t.sign === '-') ? -amt : amt;
                });
            }

            item.basicAmount = itemBasic;
            item.termAmount = itemTermsTotal;
            item.netAmount = itemBasic + itemTermsTotal;
            masterBasicAmount += item.netAmount;
        });

        billTerms.forEach(term => {
            const amt = Number(term.amount) || 0;
            billTermAmount += (term.sign === '-') ? -amt : amt;
        });

        const netAmount = Math.round((masterBasicAmount + billTermAmount) * 100) / 100;

        // 1. Insert Master into tblPOMaster
        // Note: column is TermsAmount (plural) here, unlike tblSOMaster's TermAmount.
        // tblPOMaster has no OrderType column, unlike tblSOMaster.
        await new sql.Request(tx)
            .input("orderId", sql.NVarChar(100), orderId)
            .input("orderDate", sql.DateTime, orderDate)
            .input("orderTime", sql.DateTime, orderTime)
            .input("orderMiti", sql.NVarChar(30), nepaliDate || null)
            .input("ledgerId", sql.Int, ledgerId)
            .input("partyName", sql.NVarChar(1000), vendorName || null)
            .input("agentId", sql.Int, agentId)
            .input("classId", sql.Int, classId)
            .input("classId1", sql.Int, classId1)
            .input("classId2", sql.Int, classId2)
            .input("branchId", sql.Int, finalBranchId)
            .input("currencyId", sql.Int, finalCurrency)
            .input("basicAmount", sql.Decimal(18, 4), masterBasicAmount)
            .input("termsAmount", sql.Decimal(18, 4), billTermAmount)
            .input("netAmount", sql.Decimal(18, 4), netAmount)
            .input("remarks", sql.NVarChar(2048), remarks || "")
            .input("userId", sql.Int, req.user?.userId || 1)
            .query(`
                INSERT INTO tblPOMaster (
                    OrderID, OrderDate, OrderTime, OrderMiti,
                    LedgerID, PartyName, AgentID, ClassID, ClassID1, ClassID2, BranchID, CurrencyID, CurrencyRate,
                    BasicAmount, TermsAmount, NetAmount, Remarks, UserID, IsAproved
                ) VALUES (
                    @orderId, @orderDate, @orderTime, @orderMiti,
                    @ledgerId, @partyName, @agentId, @classId, @classId1, @classId2, @branchId, @currencyId, 1,
                    @basicAmount, @termsAmount, @netAmount, @remarks, @userId, 'N'
                )
            `);

        // 2. Insert Items into tblPODetails & Item-Wise Terms into tblPOTerm
        let sno = 1;
        for (const item of items) {
            item.sno = sno;

            await new sql.Request(tx)
                .input("orderId", sql.NVarChar(100), orderId)
                .input("sno", sql.Int, sno)
                .input("itemId", sql.Int, item.itemId)
                .input("altQty", sql.Decimal(18, 4), item.altQty || 0)
                .input("altUnitId", sql.Int, item.altUnitId || null)
                .input("qty", sql.Decimal(18, 4), item.qty)
                .input("unitId", sql.Int, item.unitId)
                .input("altStockQty", sql.Decimal(18, 4), item.altQty || 0)
                .input("stockQty", sql.Decimal(18, 4), item.qty)
                .input("rate", sql.Decimal(18, 4), item.rate)
                .input("basicAmount", sql.Decimal(18, 4), item.basicAmount)
                .input("termAmount", sql.Decimal(18, 4), Math.abs(item.termAmount))
                .input("netAmount", sql.Decimal(18, 4), item.netAmount)
                .query(`
                    INSERT INTO tblPODetails (
                        OrderID, Sno, ItemID, AltQty, AltUnitID, Qty, UnitID,
                        AltStockQty, StockQty, Rate, BasicAmount, TermAmount, NetAmount,
                        OrderIssueQty, OrderAltIssueQty, OrderBalanceQty, FreeQty, StockFreeQty
                    ) VALUES (
                        @orderId, @sno, @itemId, @altQty, @altUnitId, @qty, @unitId,
                        @altStockQty, @stockQty, @rate, @basicAmount, @termAmount, @netAmount,
                        0, 0, @qty, 0, 0
                    )
                `);

            if (item.itemTerms && item.itemTerms.length > 0) {
                for (const t of item.itemTerms) {
                    await new sql.Request(tx)
                        .input("orderId", sql.NVarChar(100), orderId)
                        .input("termId", sql.Int, t.termId)
                        .input("sno", sql.Int, sno)
                        .input("itemId", sql.Int, item.itemId)
                        .input("termType", sql.Char(2), 'P')
                        .input("rate", sql.Decimal(18, 4), t.percent || t.rate || 0)
                        .input("amount", sql.Decimal(18, 4), Math.abs(t.amount))
                        .query(`
                            INSERT INTO tblPOTerm (OrderID, TermID, Sno, ItemID, TermType, Rate, Amount)
                            VALUES (@orderId, @termId, @sno, @itemId, @termType, @rate, @amount)
                        `);
                }
            }
            sno++;
        }

        // 3. Insert Bill-Level Terms & Apportionment ('B' & 'BT') into tblPOTerm
        let totalItemsNetAmount = masterBasicAmount;
        let baseForApportion = totalItemsNetAmount > 0 ? totalItemsNetAmount : basicAmount;

        for (const term of billTerms) {
            const bAmount = Number(term.amount) || 0;

            await new sql.Request(tx)
                .input("orderId", sql.NVarChar(100), orderId)
                .input("termId", sql.Int, term.termId)
                .input("sno", sql.Int, 0)
                .input("termType", sql.Char(2), 'B')
                .input("rate", sql.Decimal(18, 4), term.percent || term.rate || 0)
                .input("amount", sql.Decimal(18, 4), Math.abs(bAmount))
                .query(`
                    INSERT INTO tblPOTerm (OrderID, TermID, Sno, TermType, Rate, Amount)
                    VALUES (@orderId, @termId, @sno, @termType, @rate, @amount)
                `);

            if (bAmount !== 0 && baseForApportion > 0) {
                let distributedSoFar = 0;
                for (let i = 0; i < items.length; i++) {
                    const itm = items[i];
                    let itemBase = totalItemsNetAmount > 0 ? Number(itm.netAmount) : Number(itm.basicAmount);
                    let proportion = itemBase / baseForApportion;
                    let btAmount = Number((bAmount * proportion).toFixed(2));

                    if (i === items.length - 1) {
                        btAmount = Number((bAmount - distributedSoFar).toFixed(2));
                    }
                    distributedSoFar += btAmount;

                    await new sql.Request(tx)
                        .input("orderId", sql.NVarChar(100), orderId)
                        .input("termId", sql.Int, term.termId)
                        .input("sno", sql.Int, itm.sno)
                        .input("itemId", sql.Int, itm.itemId)
                        .input("termType", sql.Char(2), 'BT')
                        .input("rate", sql.Decimal(18, 4), term.percent || term.rate || 0)
                        .input("amount", sql.Decimal(18, 4), Math.abs(btAmount))
                        .query(`
                            INSERT INTO tblPOTerm (OrderID, TermID, Sno, ItemID, TermType, Rate, Amount)
                            VALUES (@orderId, @termId, @sno, @itemId, @termType, @rate, @amount)
                        `);
                }
            }
        }

        // 4. Advance Main Voucher Sequence & Commit
        await incrementVoucherSequence(tx, poSequence.documentId, poSequence.documentName);
        await tx.commit();

        return {
            success: true,
            voucherId: orderId,
            basicAmount: masterBasicAmount,
            termAmount: billTermAmount,
            netAmount
        };

    } catch (err) {
        console.error("Purchase Order Service Error:", err.message);
        if (tx && !tx._aborted) {
            try { await tx.rollback(); } catch (rollbackErr) { }
        }
        throw err;
    }
};

// ─────────────────────────────────────────────────────────────
// GET NEXT PURCHASE ORDER NUMBER
// ─────────────────────────────────────────────────────────────

exports.getNextPurchaseOrderNumber = async (req) => {
    const pool = await getPool(req.headers["x-company-code"]);
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
        const voucher = await getNextVoucher(tx, 'PO', null);
        await tx.commit();
        return { success: true, voucherId: voucher.voucherId };
    } catch (err) {
        await tx.rollback();
        throw err;
    }
};

// ─────────────────────────────────────────────────────────────
// GET TERM MASTERS (from tblPITermMaster, the purchase-side term master)
// ─────────────────────────────────────────────────────────────

exports.getPiTermMasters = async (req) => {
    const companyCode = req.headers['x-company-code'];
    if (!companyCode) throw new Error("Company code required");

    const pool = await getPool(companyCode);
    const result = await pool.request().query(`
        SELECT TermID, TermName, Rate, Sign, LedgerID, ISNULL(ItemWise, 'N') AS ItemWise
        FROM tblPITermMaster
        ORDER BY TermID ASC
    `);
    return result.recordset;
};

// ─────────────────────────────────────────────────────────────
// GET VENDORS
//
// tblLedger filtered by LedgerType = 'VE'. Mirrors fetchLedgers() on the
// sales side, but scoped to vendors only.
// ─────────────────────────────────────────────────────────────

exports.getVendors = async (req) => {
    const companyCode = req.headers['x-company-code'];
    if (!companyCode) throw new Error("Company code required");

    const pool = await getPool(companyCode);
    const result = await pool.request().query(`
        SELECT LedgerID, LedgerName, LedgerCode
        FROM tblLedger
        WHERE LedgerType = 'VE'
        ORDER BY LedgerName ASC
    `);
    return result.recordset;
};

// ─────────────────────────────────────────────────────────────
// GET PURCHASE ORDERS (LIST)
//
// Vendor name resolves via PartyName, falling back to
// tblLedger.LedgerName when PartyName is blank.
// Status is IsAproved (Y/N).
// OrderDate is returned as a yyyy-MM-dd string (CONVERT ... 23) to avoid
// the UTC date-shift problem.
// Optional query params: page, pageSize (default 1 / 50), search.
// ─────────────────────────────────────────────────────────────

exports.getPurchaseOrders = async (req) => {
    const companyCode = req.headers["x-company-code"];
    if (!companyCode) throw new Error("Company not selected.");

    const pool = await getPool(companyCode);
    if (!pool) throw new Error("Database unavailable.");

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
    const offset = (page - 1) * pageSize;
    const search = (req.query.search || "").trim();

    const request = pool.request()
        .input("offset", sql.Int, offset)
        .input("pageSize", sql.Int, pageSize);

    let searchClause = "";
    if (search) {
        request.input("search", sql.NVarChar(100), `%${search}%`);
        searchClause = `AND (m.OrderID LIKE @search OR ${VENDOR_NAME_EXPR} LIKE @search)`;
    }

    const result = await request.query(`
        SELECT
            m.OrderID                              AS orderNumber,
            CONVERT(varchar(10), m.OrderDate, 23)  AS orderDate,
            m.OrderMiti                            AS miti,
            ${VENDOR_NAME_EXPR}                    AS vendorName,
            m.IsAproved                            AS isApproved,
            m.NetAmount                            AS total,
            ISNULL(d.itemCount, 0)                 AS itemCount,
            ISNULL(d.totalQty, 0)                  AS totalQty
        FROM tblPOMaster m
        LEFT JOIN tblLedger l ON l.LedgerID = m.LedgerID
        OUTER APPLY (
            SELECT COUNT(*) AS itemCount, SUM(det.Qty) AS totalQty
            FROM tblPODetails det
            WHERE det.OrderID = m.OrderID
        ) d
        WHERE 1 = 1
            ${searchClause}
        ORDER BY m.OrderDate DESC, m.OrderID DESC
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return { success: true, orders: result.recordset, page, pageSize };
};

// ─────────────────────────────────────────────────────────────
// GET PURCHASE ORDER BY ID (DETAIL)
//
// Response shape matches PurchaseOrderDetail.fromJson (Dart):
//   { success, order: {...}, lineItems: [...], terms: [...] }
//
// * order keys include vendorAddress and vendorPan (tblLedger.LedgerAddress /
//   tblLedger.PanNo). NULL becomes '' here; the app hides blank lines.
// * lineItems keys: srNo, itemId, productName, quantity, unitPrice,
//   lineTotal, unitCode, itemTerms[]
// * term keys: termId, termName, termSign, termRate, termAmount
// * `terms` = bill-level terms (TermType 'B'). 'P' rows are attached to
//   their line as itemTerms (matched on Sno). 'BT' rows are NOT returned
//   (they're the bill terms split across items; would double count).
// * tblPOTerm.Amount is absolute; the sign comes from tblPITermMaster.Sign.
// * TermType is char(2), so it comes back space-padded ('B '). It is
//   RTRIMmed in SQL and trimmed again in JS before comparing.
// ─────────────────────────────────────────────────────────────

exports.getPurchaseOrderById = async (req) => {
    const companyCode = req.headers["x-company-code"];
    if (!companyCode) throw new Error("Company not selected.");

    const pool = await getPool(companyCode);
    if (!pool) throw new Error("Database unavailable.");

    const orderId = (req.params.orderId || "").trim();
    if (!orderId) throw new Error("Order ID is required.");

    // 1. Master
    const masterResult = await pool.request()
        .input("orderId", sql.NVarChar(100), orderId)
        .query(`
            SELECT
                m.OrderID                              AS orderNumber,
                CONVERT(varchar(10), m.OrderDate, 23)  AS orderDate,
                m.OrderMiti                            AS miti,
                ${VENDOR_NAME_EXPR}                    AS vendorName,
                LTRIM(RTRIM(ISNULL(l.LedgerAddress, ''))) AS vendorAddress,
                LTRIM(RTRIM(ISNULL(l.PanNo, '')))         AS vendorPan,
                m.IsAproved                            AS isApproved,
                m.BasicAmount                          AS basicAmount,
                m.TermsAmount                          AS termAmount,
                m.NetAmount                            AS total,
                m.Remarks                              AS remarks
            FROM tblPOMaster m
            LEFT JOIN tblLedger l ON l.LedgerID = m.LedgerID
            WHERE m.OrderID = @orderId
        `);

    if (!masterResult.recordset.length) throw new Error("Purchase order not found.");
    const master = masterResult.recordset[0];

    // 2. Line items
    const itemsResult = await pool.request()
        .input("orderId", sql.NVarChar(100), orderId)
        .query(`
            SELECT
                det.Sno         AS srNo,
                det.ItemID      AS itemId,
                i.ItemName      AS productName,
                det.Qty         AS quantity,
                det.Rate        AS unitPrice,
                det.NetAmount   AS lineTotal,
                u.UnitCode      AS unitCode
            FROM tblPODetails det
            LEFT JOIN tblItems i ON i.ItemID = det.ItemID
            LEFT JOIN tblItemsUnit u ON u.UnitID = det.UnitID
            WHERE det.OrderID = @orderId
            ORDER BY det.Sno ASC
        `);

    // 3. Item-wise ('P') and bill ('B') terms
    const termsResult = await pool.request()
        .input("orderId", sql.NVarChar(100), orderId)
        .query(`
            SELECT
                RTRIM(t.TermType)                   AS termType,
                t.Sno                               AS srNo,
                t.TermID                            AS termId,
                tm.TermName                         AS termName,
                ISNULL(LTRIM(RTRIM(tm.Sign)), '+')  AS termSign,
                t.Rate                              AS termRate,
                t.Amount                            AS termAmount
            FROM tblPOTerm t
            LEFT JOIN tblPITermMaster tm ON tm.TermID = t.TermID
            WHERE t.OrderID = @orderId
              AND RTRIM(t.TermType) IN ('P', 'B')
            ORDER BY t.TermType, t.Sno, t.TermID
        `);

    const itemTermsBySno = {};
    const billTerms = [];
    for (const t of termsResult.recordset) {
        const term = {
            termId: t.termId,
            termName: t.termName,
            termSign: t.termSign,
            termRate: t.termRate,
            termAmount: t.termAmount,
        };
        const type = String(t.termType || "").trim();
        if (type === 'B') {
            billTerms.push(term);
        } else if (type === 'P') {
            (itemTermsBySno[t.srNo] = itemTermsBySno[t.srNo] || []).push(term);
        }
    }

    const lineItems = itemsResult.recordset.map(li => ({
        ...li,
        itemTerms: itemTermsBySno[li.srNo] || [],
    }));

    return { success: true, order: master, lineItems, terms: billTerms };
};
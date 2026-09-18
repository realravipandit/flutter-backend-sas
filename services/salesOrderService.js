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

async function resolveCustomerLedger(tx, customerLedgerId) {
    if (customerLedgerId != null) return customerLedgerId;
    const settings = await getSystemSettings(tx);
    if (!settings.Cash_Book) throw new Error("Cash Book ledger is not configured.");
    return settings.Cash_Book;
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

// Shared customer-name resolution: PartyName unless it's blank/"cash",
// in which case fall back to tblLedger.LedgerName via LedgerID.
const CUSTOMER_NAME_EXPR = `
    CASE
        WHEN m.PartyName IS NULL OR LTRIM(RTRIM(m.PartyName)) = '' OR LOWER(LTRIM(RTRIM(m.PartyName))) = 'cash'
            THEN l.LedgerName
        ELSE m.PartyName
    END
`;

// ─────────────────────────────────────────────────────────────
// CREATE SALES ORDER
// ─────────────────────────────────────────────────────────────
exports.createSalesOrder = async (req) => {
    const companyCode = req.headers["x-company-code"];
    if (!companyCode) throw new Error("Company not selected.");

    const pool = await getPool(companyCode);
    if (!pool) throw new Error("Database unavailable.");

    const {
        customerLedgerId, customerName, branchId = null, agentId = null, classId = null, classId1 = null,
        classId2 = null, currencyId = null, nepaliDate, adDate, remarks = "",
        items = [], billTerms = []
    } = req.body;

    if (!items.length) throw new Error("Cart is empty.");

    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
        const finalBranchId = await resolveBranch(tx, branchId);
        const ledgerId = await resolveCustomerLedger(tx, customerLedgerId);
        const finalCurrency = await resolveCurrency(tx, currencyId);

        await validateItemsGodownsUnits(tx, items);

        // Sequence uses 'SO' for Sales Order
        const soSequence = await getNextVoucher(tx, "SO", finalBranchId);
        const orderId = soSequence.voucherId;
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

        // 1. Insert Master into tblSOMaster
        await new sql.Request(tx)
            .input("orderId", sql.NVarChar(50), orderId)
            .input("orderDate", sql.DateTime, orderDate)
            .input("orderTime", sql.DateTime, orderTime)
            .input("orderMiti", sql.NVarChar(20), nepaliDate || null)
            .input("ledgerId", sql.Int, ledgerId)
            .input("partyName", sql.NVarChar(100), customerName || null)
            .input("agentId", sql.Int, agentId)
            .input("classId", sql.Int, classId)
            .input("classId1", sql.Int, classId1)
            .input("classId2", sql.Int, classId2)
            .input("branchId", sql.Int, finalBranchId)
            .input("currencyId", sql.Int, finalCurrency)
            .input("basicAmount", sql.Decimal(18, 4), masterBasicAmount)
            .input("termAmount", sql.Decimal(18, 4), billTermAmount)
            .input("netAmount", sql.Decimal(18, 4), netAmount)
            .input("tenderAmount", sql.Decimal(18, 4), 0)
            .input("returnAmount", sql.Decimal(18, 4), 0)
            .input("remarks", sql.NVarChar(500), remarks || "")
            .input("userId", sql.Int, req.user?.userId || 1)
            .query(`
                INSERT INTO tblSOMaster (
                    OrderID, OrderDate, OrderTime, OrderMiti, OrderType,
                    LedgerID, PartyName, AgentID, ClassID, ClassID1, ClassID2, BranchID, CurrencyID, CurrencyRate,
                    BasicAmount, TermAmount, NetAmount, TenderAmount, ReturnAmount, Remarks, UserID, IsAproved
                ) VALUES (
                    @orderId, @orderDate, @orderTime, @orderMiti, 'N',
                    @ledgerId, @partyName, @agentId, @classId, @classId1, @classId2, @branchId, @currencyId, 1,
                    @basicAmount, @termAmount, @netAmount, @tenderAmount, @returnAmount, @remarks, @userId, 'N'
                )
            `);

        // 2. Insert Items into tblSODetails & Item-Wise Terms into tblSOTerm
        let sno = 1;
        for (const item of items) {
            item.sno = sno;

            await new sql.Request(tx)
                .input("orderId", sql.NVarChar(50), orderId)
                .input("sno", sql.Int, sno)
                .input("itemId", sql.Int, item.itemId)
                .input("godownId", sql.Int, item.godownId ?? null)
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
                    INSERT INTO tblSODetails (
                        OrderID, Sno, ItemID, GodownID, AltQty, AltUnitID, Qty, UnitID,
                        AltStockQty, StockQty, Rate, BasicAmount, TermAmount, NetAmount,
                        OrderIssueQty, OrderAltIssueQty, OrderBalanceQty, FreeQty, StockFreeQty
                    ) VALUES (
                        @orderId, @sno, @itemId, @godownId, @altQty, @altUnitId, @qty, @unitId,
                        @altStockQty, @stockQty, @rate, @basicAmount, @termAmount, @netAmount,
                        0, 0, @qty, 0, 0
                    )
                `);

            if (item.itemTerms && item.itemTerms.length > 0) {
                for (const t of item.itemTerms) {
                    await new sql.Request(tx)
                        .input("orderId", sql.NVarChar(50), orderId)
                        .input("termId", sql.Int, t.termId)
                        .input("sno", sql.Int, sno)
                        .input("itemId", sql.Int, item.itemId)
                        .input("termType", sql.VarChar(5), 'P')
                        .input("rate", sql.Decimal(18, 4), t.percent || t.rate || 0)
                        .input("amount", sql.Decimal(18, 4), Math.abs(t.amount))
                        .query(`
                            INSERT INTO tblSOTerm (OrderID, TermID, Sno, ItemID, TermType, Rate, Amount)
                            VALUES (@orderId, @termId, @sno, @itemId, @termType, @rate, @amount)
                        `);
                }
            }

            sno++;
        }

        // 3. Insert Bill-Level Terms & Apportionment ('B' & 'BT') into tblSOTerm
        let totalItemsNetAmount = masterBasicAmount;
        let baseForApportion = totalItemsNetAmount > 0 ? totalItemsNetAmount : basicAmount;

        for (const term of billTerms) {
            const bAmount = Number(term.amount) || 0;

            await new sql.Request(tx)
                .input("orderId", sql.NVarChar(50), orderId)
                .input("termId", sql.Int, term.termId)
                .input("sno", sql.Int, 0)
                .input("termType", sql.VarChar(5), 'B')
                .input("rate", sql.Decimal(18, 4), term.percent || term.rate || 0)
                .input("amount", sql.Decimal(18, 4), Math.abs(bAmount))
                .query(`
                    INSERT INTO tblSOTerm (OrderID, TermID, Sno, TermType, Rate, Amount)
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
                        .input("orderId", sql.NVarChar(50), orderId)
                        .input("termId", sql.Int, term.termId)
                        .input("sno", sql.Int, itm.sno)
                        .input("itemId", sql.Int, itm.itemId)
                        .input("termType", sql.VarChar(5), 'BT')
                        .input("rate", sql.Decimal(18, 4), term.percent || term.rate || 0)
                        .input("amount", sql.Decimal(18, 4), Math.abs(btAmount))
                        .query(`
                            INSERT INTO tblSOTerm (OrderID, TermID, Sno, ItemID, TermType, Rate, Amount)
                            VALUES (@orderId, @termId, @sno, @itemId, @termType, @rate, @amount)
                        `);
                }
            }
        }

        // 4. Advance Main Voucher Sequence & Commit
        await incrementVoucherSequence(tx, soSequence.documentId, soSequence.documentName);
        await tx.commit();

        return {
            success: true,
            voucherId: orderId,
            basicAmount: masterBasicAmount,
            termAmount: billTermAmount,
            netAmount
        };
    } catch (err) {
        console.error("Sales Order Service Error:", err.message);
        if (tx && !tx._aborted) {
            try { await tx.rollback(); } catch (rollbackErr) { }
        }
        throw err;
    }
};

// ─────────────────────────────────────────────────────────────
// GET NEXT SALES ORDER NUMBER
// ─────────────────────────────────────────────────────────────
exports.getNextSalesOrderNumber = async (req) => {
    const pool = await getPool(req.headers["x-company-code"]);
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
        const voucher = await getNextVoucher(tx, 'SO', null);
        await tx.commit();
        return { success: true, voucherId: voucher.voucherId };
    } catch (err) {
        await tx.rollback();
        throw err;
    }
};

// ─────────────────────────────────────────────────────────────
// GET TERM MASTERS (Reused for Orders)
// ─────────────────────────────────────────────────────────────
exports.getTermMasters = async (req) => {
    const companyCode = req.headers['x-company-code'];
    if (!companyCode) throw new Error("Company code required");

    const pool = await getPool(companyCode);
    const result = await pool.request().query(`
        SELECT TermID, TermName, Rate, Sign, LedgerID, ISNULL(ItemWise, 'N') AS ItemWise
        FROM tblSITermMaster
        ORDER BY TermID ASC
    `);
    return result.recordset;
};

// ─────────────────────────────────────────────────────────────
// GET SALES ORDERS (LIST)
//
// Powers the list screen. Customer name resolves via PartyName, falling
// back to tblLedger.LedgerName when PartyName is blank/"Cash" (per the
// same convention createSalesOrder uses when no customerName is given).
// Status is IsAproved (Y/N) --- there's no separate status column.
// Optional query params: page, pageSize (default 1 / 50), search (matches
// OrderID or resolved customer name).
// ─────────────────────────────────────────────────────────────
exports.getSalesOrders = async (req) => {
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
        searchClause = `AND (m.OrderID LIKE @search OR ${CUSTOMER_NAME_EXPR} LIKE @search)`;
    }

    const result = await request.query(`
        SELECT
            m.OrderID           AS orderNumber,
            m.OrderDate         AS orderDate,
            ${CUSTOMER_NAME_EXPR} AS customerName,
            m.IsAproved          AS isApproved,
            m.NetAmount          AS total,
            ISNULL(d.itemCount, 0) AS itemCount,
            ISNULL(d.totalQty, 0)  AS totalQty
        FROM tblSOMaster m
        LEFT JOIN tblLedger l ON l.LedgerID = m.LedgerID
        OUTER APPLY (
            SELECT COUNT(*) AS itemCount, SUM(det.Qty) AS totalQty
            FROM tblSODetails det
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
// GET SALES ORDER BY ID (DETAIL)
//
// Powers the detail screen --- master row + line items, joined to
// tblItems for the product name (tblSODetails only stores ItemID).
// ─────────────────────────────────────────────────────────────
exports.getSalesOrderById = async (req) => {
    const companyCode = req.headers["x-company-code"];
    if (!companyCode) throw new Error("Company not selected.");

    const orderId = req.params.orderId;
    if (!orderId) throw new Error("Order ID is required.");

    const pool = await getPool(companyCode);
    if (!pool) throw new Error("Database unavailable.");

    const masterResult = await pool.request()
        .input("orderId", sql.NVarChar(50), orderId)
        .query(`
            SELECT
                m.OrderID AS orderNumber,
                m.OrderDate AS orderDate,
                ${CUSTOMER_NAME_EXPR} AS customerName,
                m.IsAproved AS isApproved,
                m.BasicAmount AS basicAmount,
                m.TermAmount AS termAmount,
                m.NetAmount AS total,
                m.Remarks AS remarks
            FROM tblSOMaster m
            LEFT JOIN tblLedger l ON l.LedgerID = m.LedgerID
            WHERE m.OrderID = @orderId
        `);

    if (!masterResult.recordset.length) {
        throw new Error(`Sales order ${orderId} not found.`);
    }

        const itemsQuery = `
        SELECT
            det.Sno AS srNo,
            det.ItemID AS itemId,
            it.ItemName AS productName,
            det.Qty AS quantity,
            det.Rate AS unitPrice,
            det.NetAmount AS lineTotal
        FROM tblSODetails det
        LEFT JOIN tblItems it ON it.ItemID = det.ItemID
        WHERE det.OrderID = @orderId
        ORDER BY det.Sno ASC
    `;

    const itemsResult = await pool.request()
        .input("orderId", sql.NVarChar(50), orderId)
        .query(itemsQuery);

    return {
        success: true,
        order: masterResult.recordset[0],
        lineItems: itemsResult.recordset
    };
};
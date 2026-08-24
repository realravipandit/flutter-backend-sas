const { getPool, sql } = require("../db");
const {
    UpdateAccountTransactionfromSalesInvoice,
    UpdateInvTransactionfromSalesInvoice,
    UpdateAccountTransactionfromCashBank,
} = require("../sql/salesScripts");
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
function formatNepaliDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split(/[-/]/);
    if (parts.length === 3 && parts[0].length === 4) {
        const [year, month, day] = parts;
        return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
    }
    return dateStr;
}

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

async function resolvePaymentLedger(tx, payment) {
    if (payment.ledgerId != null) return payment.ledgerId;
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

async function validatePayments(payments = []) {
    for (const payment of payments) {
        if (Number(payment.amount) <= 0)
            throw new Error("Payment amount must be greater than zero.");
    }
}

// ─────────────────────────────────────────────────────────────
// CREATE SALE
// ─────────────────────────────────────────────────────────────
exports.createSale = async (req) => {
    const companyCode = req.headers["x-company-code"];
    if (!companyCode) throw new Error("Company not selected.");
    const pool = await getPool(companyCode);
    if (!pool) throw new Error("Database unavailable.");

    const {
        customerLedgerId, customerName, branchId = null, agentId = null, classId = null, classId1 = null,
        classId2 = null, currencyId = null, nepaliDate, adDate, remarks = "",
        items = [], payments = [], billTerms = []
    } = req.body;

    if (!items.length) throw new Error("Cart is empty.");

    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
        const finalBranchId = await resolveBranch(tx, branchId);
        const ledgerId = await resolveCustomerLedger(tx, customerLedgerId);
        const finalCurrency = await resolveCurrency(tx, currencyId);

        await validateItemsGodownsUnits(tx, items);
        await validatePayments(payments);

        const saleSequence = await getNextVoucher(tx, "SB", finalBranchId);
        const voucherId = saleSequence.voucherId;
        const voucherDate = adDate ? new Date(adDate) : new Date();
        const voucherTime = new Date();

        // 1. PURCHASE-STYLE MATH ENGINE
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
            
            // Master Basic accumulates item Net Amount (Gross Basic + Item Terms)
            masterBasicAmount += item.netAmount;
        });

        // Accumulate ONLY bill-level terms
        billTerms.forEach(term => {
            const amt = Number(term.amount) || 0;
            billTermAmount += (term.sign === '-') ? -amt : amt;
        });

        const netAmount = Math.round((masterBasicAmount + billTermAmount) * 100) / 100;
        const tenderAmount = Math.round((payments || []).reduce((s, p) => s + Number(p.amount || 0), 0) * 100) / 100;
        const returnAmount = tenderAmount > netAmount ? Math.round((tenderAmount - netAmount) * 100) / 100 : 0;

        // 2. Insert Master (tblSIMaster)
        await new sql.Request(tx)
            .input("voucherId", sql.NVarChar(50), voucherId)
            .input("voucherDate", sql.DateTime, voucherDate)
            .input("voucherTime", sql.DateTime, voucherTime)
            .input("voucherMiti", sql.NVarChar(20), nepaliDate || null)
            .input("ledgerId", sql.Int, ledgerId)
            .input("partyName", sql.NVarChar(100), customerName || null)
            .input("agentId", sql.Int, agentId)
            .input("classId", sql.Int, classId)
            .input("classId1", sql.Int, classId1)
            .input("classId2", sql.Int, classId2)
            .input("branchId", sql.Int, finalBranchId)
            .input("currencyId", sql.Int, finalCurrency)
            .input("basicAmount", sql.Decimal(18, 4), masterBasicAmount) // Matches purchase exactly
            .input("termAmount", sql.Decimal(18, 4), billTermAmount)     // Matches purchase exactly
            .input("netAmount", sql.Decimal(18, 4), netAmount)
            .input("tenderAmount", sql.Decimal(18, 4), tenderAmount)
            .input("returnAmount", sql.Decimal(18, 4), returnAmount)
            .input("remarks", sql.NVarChar(500), remarks || "")
            .input("userId", sql.Int, req.user?.userId || 1)
            .query(`
                INSERT INTO tblSIMaster (VoucherID, VoucherDate, VoucherTime, VoucherMiti, VoucherType,
                LedgerID, PartyName, AgentID, ClassID, ClassID1, ClassID2, BranchID, CurrencyID, CurrencyRate,
                BasicAmount, TermAmount, NetAmount, TenderAmount, ReturnAmount, Remarks, UserID)
                VALUES (@voucherId, @voucherDate, @voucherTime, @voucherMiti, 'S',
                @ledgerId, @partyName, @agentId, @classId, @classId1, @classId2, @branchId, @currencyId, 1,
                @basicAmount, @termAmount, @netAmount, @tenderAmount, @returnAmount, @remarks, @userId)
            `);

        // 3. Insert Items (tblSIDetails) & Item-Wise Terms ('P')
        let sno = 1;
        for (const item of items) {
            item.sno = sno; // Tag it for apportionment mapping
            await new sql.Request(tx)
                .input("voucherId", sql.NVarChar(50), voucherId)
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
                .input("termAmount", sql.Decimal(18, 4), Math.abs(item.termAmount)) // Store absolute
                .input("netAmount", sql.Decimal(18, 4), item.netAmount)
                .query(`
                    INSERT INTO tblSIDetails (VoucherID, Sno, ItemID, GodownID, AltQty, AltUnitID, Qty, UnitID,
                    AltStockQty, StockQty, Rate, BasicAmount, TermAmount, NetAmount)
                    VALUES (@voucherId, @sno, @itemId, @godownId, @altQty, @altUnitId, @qty, @unitId,
                    @altStockQty, @stockQty, @rate, @basicAmount, @termAmount, @netAmount)
                `);

            // Item-Level Terms ('P')
            if (item.itemTerms && item.itemTerms.length > 0) {
                for (const t of item.itemTerms) {
                    await new sql.Request(tx)
                        .input("voucherId", sql.NVarChar(50), voucherId)
                        .input("termId", sql.Int, t.termId)
                        .input("sno", sql.Int, sno)
                        .input("itemId", sql.Int, item.itemId)
                        .input("termType", sql.VarChar(5), 'P')
                        .input("rate", sql.Decimal(18, 4), t.percent || t.rate || 0)
                        .input("amount", sql.Decimal(18, 4), Math.abs(t.amount))
                        .query(`
                            INSERT INTO tblSITerm (VoucherID, TermID, Sno, ItemID, TermType, Rate, Amount)
                            VALUES (@voucherId, @termId, @sno, @itemId, @termType, @rate, @amount)
                        `);
                }
            }
            sno++;
        }

        // 4. Insert Bill-Level Terms ('B') & Apportionment ('BT')
        let totalItemsNetAmount = masterBasicAmount;
        let baseForApportion = totalItemsNetAmount > 0 ? totalItemsNetAmount : basicAmount;

        for (const term of billTerms) {
            const bAmount = Number(term.amount) || 0;

            // Insert Overall Bill Term ('B')
            await new sql.Request(tx)
                .input("voucherId", sql.NVarChar(50), voucherId)
                .input("termId", sql.Int, term.termId)
                .input("sno", sql.Int, 0)
                .input("termType", sql.VarChar(5), 'B')
                .input("rate", sql.Decimal(18, 4), term.percent || term.rate || 0)
                .input("amount", sql.Decimal(18, 4), Math.abs(bAmount))
                .query(`
                    INSERT INTO tblSITerm (VoucherID, TermID, Sno, ItemID, TermType, Rate, Amount)
                    VALUES (@voucherId, @termId, @sno, NULL, @termType, @rate, @amount)
                `);

            // Distribute Bill Term proportionally into Items ('BT')
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
                        .input("voucherId", sql.NVarChar(50), voucherId)
                        .input("termId", sql.Int, term.termId)
                        .input("sno", sql.Int, itm.sno)
                        .input("itemId", sql.Int, itm.itemId)
                        .input("termType", sql.VarChar(5), 'BT')
                        .input("rate", sql.Decimal(18, 4), term.percent || term.rate || 0)
                        .input("amount", sql.Decimal(18, 4), Math.abs(btAmount))
                        .query(`
                            INSERT INTO tblSITerm (VoucherID, TermID, Sno, ItemID, TermType, Rate, Amount)
                            VALUES (@voucherId, @termId, @sno, @itemId, @termType, @rate, @amount)
                        `);
                }
            }
        }

        // 5. Execute Accounting + Inventory triggers
        await new sql.Request(tx)
            .input("VoucherNo", sql.NVarChar(50), voucherId)
            .query(UpdateAccountTransactionfromSalesInvoice);

        await new sql.Request(tx)
            .input("VoucherNo", sql.NVarChar(50), voucherId)
            .query(UpdateInvTransactionfromSalesInvoice);

        // 6. Handle Cash / Bank receipt voucher(s)
        await incrementVoucherSequence(tx, saleSequence.documentId, saleSequence.documentName);

        if (payments.length) {
            for (const payment of payments) {
                if (Number(payment.amount) <= 0) continue;

                const cbVoucher = await getNextVoucher(tx, "CB", finalBranchId);
                const cashLedgerId = await resolvePaymentLedger(tx, payment);

                // Insert Cash/Bank Master
                await new sql.Request(tx)
                    .input("cashBankId", sql.NVarChar(50), cbVoucher.voucherId)
                    .input("voucherDate", sql.DateTime, voucherDate)
                    .input("voucherTime", sql.DateTime, voucherTime)
                    .input("voucherMiti", sql.NVarChar(20), nepaliDate || null)
                    .input("branchId", sql.Int, finalBranchId)
                    .input("currencyId", sql.Int, finalCurrency)
                    .input("classId", sql.Int, classId)
                    .input("classId1", sql.Int, classId1)
                    .input("classId2", sql.Int, classId2)
                    .input("cashLedgerId", sql.Int, cashLedgerId)
                    .input("userId", sql.Int, req.user?.userId || 1)
                    .input("refVoucherNo", sql.NVarChar(50), voucherId)
                    .input("documentName", sql.NVarChar(250), payment.documentName || cbVoucher.documentName)
                    .query(`
                        INSERT INTO tblCBMaster
                        (CashBankID, VoucherDate, VoucherTime, VoucherMiti, ChequeNo, ChequeDate,
                         BranchID, CurrencyID, CurrencyRate, ClassID, ClassID1, ClassID2,
                         LedgerID, UserID, Remarks, EffectiveDate, Posting, Export,
                         RefVoucherNo, CBReconcileDate, PrintVal, DocumentName)
                        VALUES
                        (@cashBankId, @voucherDate, @voucherTime, @voucherMiti, NULL, NULL,
                         @branchId, @currencyId, 1, @classId, @classId1, @classId2,
                         @cashLedgerId, @userId, '', @voucherDate, 'Y', 'N',
                         @refVoucherNo, NULL, NULL, @documentName)
                    `);

                // Insert Cash/Bank Details
                await new sql.Request(tx)
                    .input("cashBankId", sql.NVarChar(50), cbVoucher.voucherId)
                    .input("ledgerId", sql.Int, ledgerId)
                    .input("amount", sql.Decimal(18, 4), payment.amount)
                    .query(`
                        INSERT INTO tblCBDetails
                        (CashBankID, Sno, LedgerID, SubLedgerID, AgentID, CashBankType,
                         Amount, VatReg, Narration, ClassDetilsID, ClassDetilsID1, ClassDetilsID2)
                        VALUES
                        (@cashBankId, 1, @ledgerId, NULL, NULL, 'R', @amount, '', '', NULL, NULL, NULL)
                    `);

                // Execute Triggers
                await new sql.Request(tx)
                    .input("VoucherNo", sql.NVarChar(50), cbVoucher.voucherId)
                    .query(UpdateAccountTransactionfromCashBank);

                // Update Transaction References
                await new sql.Request(tx)
                    .input("cashBankId", sql.NVarChar(50), cbVoucher.voucherId)
                    .input("voucherId", sql.NVarChar(50), voucherId)
                    .query(`
                        UPDATE tblAccTransaction
                        SET CashBankID=tblCBMaster.LedgerID
                        FROM tblCBMaster
                        WHERE tblAccTransaction.VoucherID=tblCBMaster.CashBankID
                          AND tblAccTransaction.Source='CB'
                          AND tblCBMaster.CashBankID=@cashBankId;

                        UPDATE tblAccTransaction
                        SET TransDueDate=VoucherDate
                        WHERE VoucherID=@cashBankId AND Source='CB';

                        UPDATE tblAccTransaction
                        SET RefVoucherNo=@voucherId
                        WHERE VoucherID=@cashBankId AND Source='CB';
                    `);

                // Increment CB Sequence
                await incrementVoucherSequence(tx, cbVoucher.documentId, cbVoucher.documentName);
            }
        }

        await tx.commit();
        return { 
            success: true, 
            voucherId, 
            basicAmount: masterBasicAmount, 
            termAmount: billTermAmount,
            netAmount, 
            tenderAmount, 
            returnAmount, 
            balanceDue: Math.round((netAmount - tenderAmount) * 100) / 100 
        };
    } catch (err) {
        console.error("Sales Service Error:", err.message);
        try { await tx.rollback(); } catch (rollbackErr) { }
        throw err;
    }
};

// ─────────────────────────────────────────────────────────────
// NEXT INVOICE NUMBER
// ─────────────────────────────────────────────────────────────
exports.getNextInvoiceNumber = async (req) => {
    const pool = await getPool(req.headers["x-company-code"]);
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
        const voucher = await getNextVoucher(tx, 'SB', null);
        await tx.commit();
        return { success: true, voucherId: voucher.voucherId };
    } catch (err) {
        await tx.rollback();
        throw err;
    }
};

// ─────────────────────────────────────────────────────────────
// GET TERM MASTERS
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
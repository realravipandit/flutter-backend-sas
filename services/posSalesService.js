const { getPool, sql } = require("../db");

const {
    UpdateAccountTransactionfromSalesInvoice,
    UpdateInvTransactionfromSalesInvoice,
    UpdateAccountTransactionfromCashBank,
} = require("../sql/posSalesScript");

const {
    getNextVoucher,
    incrementVoucherSequence,
} = require("../utils/voucherSequence");

const {
    resolveBranch,
} = require("../utils/branchResolver");

async function getSystemSettings(tx) {
    const result = await new sql.Request(tx).query(`SELECT TOP 1 * FROM tblSystemSettings`);
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

exports.createPosSale = async (req) => {
    const companyCode = req.headers["x-company-code"];
    if (!companyCode) throw new Error("Company not selected.");

    const pool = await getPool(companyCode);
    if (!pool) throw new Error("Database unavailable.");

    const {
        isTaxInvoice = false,
        classId = null,
        customerLedgerId,
        customerName,
        branchId = null,
        currencyId = null,
        nepaliDate,
        adDate,
        remarks = null,
        counter = "",
        isApproved = "N",
        effectiveDate,
        items = [],
        payments = [],
        billTerms = []
    } = req.body;

    if (!items.length) throw new Error("Cart is empty.");

    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
        const finalBranchId = await resolveBranch(tx, branchId);
        const ledgerId = await resolveCustomerLedger(tx, customerLedgerId);
        const finalCurrency = await resolveCurrency(tx, currencyId);
        const settings = await getSystemSettings(tx);

        const finalPrintedBy = req.user?.username || "ADMIN";

        // ==========================================
        // 1. FLAWLESS INCLUSIVE MATH ENGINE
        // ==========================================
        let masterBasicAmount = 0;
        let masterTermAmount = 0;
        let netAmount = 0;
        let globalDiscountAmt = 0;
        let globalTaxRate = 0;

        if (billTerms && billTerms.length > 0) {
            billTerms.forEach(t => {
                if (t.sign === '-') globalDiscountAmt += (Number(t.amount) || 0);
                if (t.sign === '+') globalTaxRate += (Number(t.rate) || 0);
            });
        }

        let totalGross = items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.rate) || 0), 0);

        items.forEach(item => {
            let itemGross = (Number(item.qty) || 0) * (Number(item.rate) || 0);
            let itemTaxRate = globalTaxRate;
            let itemDiscountAmt = 0;

            if (totalGross > 0) {
                itemDiscountAmt += globalDiscountAmt * (itemGross / totalGross);
            }

            if (item.itemTerms && item.itemTerms.length > 0) {
                item.itemTerms.forEach(t => {
                    if (t.sign === '+') itemTaxRate += (Number(t.rate) || 0);
                    if (t.sign === '-') itemDiscountAmt += (Number(t.amount) || 0);
                });
            }

            let itemBasic = itemGross;
            if (itemTaxRate > 0) {
                itemBasic = itemGross / (1 + (itemTaxRate / 100));
            }

            let itemTaxAmount = itemGross - itemBasic;
            let itemTermAmount = itemTaxAmount - itemDiscountAmt;
            let itemPayable = itemBasic + itemTermAmount;

            item.basicAmount = Math.round(itemBasic * 100) / 100;
            item.termAmount = Math.round(itemTermAmount * 100) / 100;
            item.netAmount = Math.round(itemPayable * 100) / 100;

            masterBasicAmount += item.basicAmount;
            masterTermAmount += item.termAmount;
            netAmount += item.netAmount;
        });

        if (billTerms && billTerms.length > 0) {
            billTerms.forEach(t => {
                if (t.sign === '+') {
                    t.calculatedAmount = masterBasicAmount * ((Number(t.rate) || 0) / 100);
                } else if (t.sign === '-') {
                    t.calculatedAmount = Number(t.amount) || 0;
                }
            });
        }

        const tenderAmount = Math.round((payments || []).reduce((s, p) => s + Number(p.amount || 0), 0) * 100) / 100;
        const returnAmount = tenderAmount > netAmount ? Math.round((tenderAmount - netAmount) * 100) / 100 : 0;

        // ==========================================
        // 2. DYNAMIC ROUTING USING `POSSequence` COLUMN
        // ==========================================
        const abbrMaxAmount = Number(settings.AbbrMaxAmount || settings.AbbreviatedMaxAmount || 10000);

        const docResult = await new sql.Request(tx).query(`
            SELECT DocumentName, ISNULL(POSSequence, '') as POSSequence
            FROM tblVoucherSequences
            WHERE Module = 'CS'
        `);

        const docs = docResult.recordset;
        if (docs.length === 0) throw new Error("No sequence configuration found for Counter Sales (CS) in tblVoucherSequences.");

        const abbrDoc = docs.find(d => d.POSSequence.toLowerCase() === 'abbr') || docs[0];
        const taxDoc = docs.find(d => d.POSSequence.toLowerCase() === 'tax') || (docs.length > 1 ? docs[1] : docs[0]);

        let targetDocumentName = abbrDoc.DocumentName;
        if (isTaxInvoice || netAmount >= abbrMaxAmount) {
            targetDocumentName = taxDoc.DocumentName;
        }

        const saleSequence = await getNextVoucher(tx, "CS", finalBranchId, targetDocumentName);
        let voucherId = saleSequence.voucherId;

        // --- Prevent Duplicate Key Violations ---
        let duplicateCheck = await new sql.Request(tx)
            .input("vid", sql.NVarChar(50), voucherId)
            .query("SELECT COUNT(1) as cnt FROM tblSIMaster WHERE VoucherID = @vid");

        while (duplicateCheck.recordset[0].cnt > 0) {
            const parts = voucherId.split('-');
            if (parts.length === 2) {
                const prefix = parts[0];
                const num = parseInt(parts[1], 10) + 1;
                voucherId = `${prefix}-${num.toString().padStart(parts[1].length, '0')}`;
            } else {
                voucherId = `${voucherId}-1`;
            }

            duplicateCheck = await new sql.Request(tx)
                .input("vid", sql.NVarChar(50), voucherId)
                .query("SELECT COUNT(1) as cnt FROM tblSIMaster WHERE VoucherID = @vid");
        }

        const voucherDate = adDate ? new Date(adDate) : new Date();
        const finalRemarks = (remarks === null || remarks.trim() === "") ? null : remarks.trim();
        const finalEffectiveDate = effectiveDate ? effectiveDate : adDate;

        // ==========================================
        // 3. Insert Master (tblSIMaster)
        // ==========================================
        await new sql.Request(tx)
            .input("voucherId", sql.NVarChar(50), voucherId)
            .input("voucherDate", sql.DateTime, voucherDate)
            .input("voucherMiti", sql.NVarChar(20), nepaliDate || null)
            .input("ledgerId", sql.Int, ledgerId)
            .input("partyName", sql.NVarChar(100), customerName || 'Cash Party')
            .input("branchId", sql.Int, finalBranchId)
            .input("currencyId", sql.Int, finalCurrency)
            .input("basicAmount", sql.Decimal(18, 4), masterBasicAmount)
            .input("termAmount", sql.Decimal(18, 4), masterTermAmount)
            .input("netAmount", sql.Decimal(18, 4), netAmount)
            .input("tenderAmount", sql.Decimal(18, 4), tenderAmount)
            .input("returnAmount", sql.Decimal(18, 4), returnAmount)
            .input("remarks", sql.NVarChar(500), finalRemarks)
            .input("userId", sql.Int, req.user?.userId || 1)
            .input("classId", sql.Int, classId)
            .input("printedBy", sql.NVarChar(50), finalPrintedBy)
            .input("isaproved", sql.Char(1), isApproved)
            .input("effectiveDate", sql.DateTime, finalEffectiveDate ? new Date(finalEffectiveDate) : voucherDate)
            .query(`
                INSERT INTO tblSIMaster (
                    VoucherID, VoucherDate, VoucherTime, VoucherMiti, VoucherType,
                    LedgerID, PartyName, BranchID, CurrencyID, CurrencyRate,
                    BasicAmount, TermAmount, NetAmount, TenderAmount, ReturnAmount, Remarks, UserID,
                    ClassID, PrintedBy, isaproved, EffectiveDate
                ) VALUES (
                    @voucherId, @voucherDate, GETDATE(), @voucherMiti, 'S',
                    @ledgerId, @partyName, @branchId, @currencyId, 1,
                    @basicAmount, @termAmount, @netAmount, @tenderAmount, @returnAmount, @remarks, @userId,
                    @classId, @printedBy, @isaproved, @effectiveDate
                )
            `);

        // 4. Insert Items (tblSIDetails)
        let sno = 1;
        for (const item of items) {
            item.sno = sno;
            const validItemId = item.itemId || item.id;

            await new sql.Request(tx)
                .input("voucherId", sql.NVarChar(50), voucherId)
                .input("sno", sql.Int, sno)
                .input("itemId", sql.Int, validItemId)
                .input("godownId", sql.Int, item.godownId ?? null)
                .input("qty", sql.Decimal(18, 4), item.qty)
                .input("unitId", sql.Int, item.unitId || null)
                .input("rate", sql.Decimal(18, 4), item.rate)
                .input("basicAmount", sql.Decimal(18, 4), item.basicAmount)
                .input("termAmount", sql.Decimal(18, 4), Math.abs(item.termAmount))
                .input("netAmount", sql.Decimal(18, 4), item.netAmount)
                .query(`
                    INSERT INTO tblSIDetails (
                        VoucherID, Sno, ItemID, GodownID, AltQty, Qty, UnitID,
                        AltStockQty, StockQty, Rate, BasicAmount, TermAmount, NetAmount
                    ) VALUES (
                        @voucherId, @sno, @itemId, @godownId, 0, @qty, @unitId,
                        0, @qty, @rate, @basicAmount, @termAmount, @netAmount
                    )
                `);

            sno++;
        }

        // 5. Insert Bill Terms (tblSITerm)
        if (billTerms && billTerms.length > 0) {
            for (const t of billTerms) {
                const termAmt = t.calculatedAmount || 0;
                if (termAmt === 0) continue;

                await new sql.Request(tx)
                    .input("voucherId", sql.NVarChar(100), voucherId)
                    .input("termId", sql.Int, t.termId)
                    .input("sno", sql.Int, 0)
                    .input("itemId", sql.Int, null)
                    .input("termType", sql.Char(2), 'B')
                    .input("taxationType", sql.NVarChar(100), null)
                    .input("rate", sql.Decimal(18, 4), t.rate || 0)
                    .input("amount", sql.Decimal(18, 4), termAmt)
                    .query(`
                        INSERT INTO tblSITerm (VoucherID, TermID, Sno, ItemID, TermType, TaxationType, Rate, Amount)
                        VALUES (@voucherId, @termId, @sno, @itemId, @termType, @taxationType, @rate, @amount)
                    `);
            }
        }

        // 6. Trigger Inventory & Accounting Updates
        await new sql.Request(tx).input("VoucherNo", sql.NVarChar(50), voucherId).query(UpdateAccountTransactionfromSalesInvoice);
        await new sql.Request(tx).input("VoucherNo", sql.NVarChar(50), voucherId).query(UpdateInvTransactionfromSalesInvoice);
        await incrementVoucherSequence(tx, saleSequence.documentId, saleSequence.documentName);

        // 7. Handle POS Cash Payment
        if (netAmount > 0 && payments.length > 0) {
            for (const payment of payments) {
                if (Number(payment.amount) <= 0) continue;

                const cbVoucher = await getNextVoucher(tx, "CB", finalBranchId);

                await new sql.Request(tx)
                    .input("cashBankId", sql.NVarChar(50), cbVoucher.voucherId)
                    .input("voucherDate", sql.DateTime, voucherDate)
                    .input("voucherMiti", sql.NVarChar(20), nepaliDate || null)
                    .input("branchId", sql.Int, finalBranchId)
                    .input("currencyId", sql.Int, finalCurrency)
                    .input("cashLedgerId", sql.Int, ledgerId)
                    .input("userId", sql.Int, req.user?.userId || 1)
                    .input("refVoucherNo", sql.NVarChar(50), voucherId)
                    .input("documentName", sql.NVarChar(250), cbVoucher.documentName)
                    .query(`
                        INSERT INTO tblCBMaster (
                            CashBankID, VoucherDate, VoucherTime, VoucherMiti,
                            BranchID, CurrencyID, CurrencyRate, LedgerID, UserID, Remarks, EffectiveDate, Posting, Export,
                            RefVoucherNo, DocumentName
                        ) VALUES (
                            @cashBankId, @voucherDate, GETDATE(), @voucherMiti,
                            @branchId, @currencyId, 1, @cashLedgerId, @userId, 'POS Settlement', @voucherDate, 'Y', 'N',
                            @refVoucherNo, @documentName
                        )
                    `);

                await new sql.Request(tx)
                    .input("cashBankId", sql.NVarChar(50), cbVoucher.voucherId)
                    .input("ledgerId", sql.Int, ledgerId)
                    .input("amount", sql.Decimal(18, 4), payment.amount)
                    .query(`
                        INSERT INTO tblCBDetails (
                            CashBankID, Sno, LedgerID, CashBankType, Amount, Narration
                        ) VALUES (
                            @cashBankId, 1, @ledgerId, 'R', @amount, 'POS Cash Receipt'
                        )
                    `);

                await new sql.Request(tx).input("VoucherNo", sql.NVarChar(50), cbVoucher.voucherId).query(UpdateAccountTransactionfromCashBank);

                await new sql.Request(tx)
                    .input("cashBankId", sql.NVarChar(50), cbVoucher.voucherId)
                    .input("voucherId", sql.NVarChar(50), voucherId)
                    .query(`
                        UPDATE tblAccTransaction
                        SET CashBankID = tblCBMaster.LedgerID, TransDueDate = tblCBMaster.VoucherDate, RefVoucherNo = @voucherId
                        FROM tblCBMaster
                        WHERE tblAccTransaction.VoucherID = tblCBMaster.CashBankID
                          AND tblAccTransaction.Source = 'CB'
                          AND tblCBMaster.CashBankID = @cashBankId;
                    `);

                await incrementVoucherSequence(tx, cbVoucher.documentId, cbVoucher.documentName);
            }
        }

        await tx.commit();
        return { success: true, voucherId, basicAmount: masterBasicAmount, termAmount: masterTermAmount, netAmount, tenderAmount, returnAmount, cashier: finalPrintedBy };
    } catch (err) {
        console.error("POS Sales Service Error:", err.message);
        if (tx) { try { await tx.rollback(); } catch (_) {} }
        throw err;
    }
};

exports.getNextPosInvoiceNumber = async (req) => {
    const pool = await getPool(req.headers["x-company-code"]);
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
        const voucher = await getNextVoucher(tx, 'CS', null);
        await tx.commit();
        return { success: true, voucherId: voucher.voucherId };
    } catch (err) {
        await tx.rollback();
        throw err;
    }
};
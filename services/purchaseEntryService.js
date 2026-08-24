const { sql, getPool } = require('../db');
const { resolveBranch } = require('../utils/branchResolver');
const { getNextVoucher, incrementVoucherSequence } = require('../utils/voucherSequence');
const {
    UpdateAccountTransactionfromPurchaseInvoice,
    UpdateInvTransactionfromPurchaseInvoice
} = require('../sql/purchaseScripts');

const getPurchaseTermMasters = async (req) => {
    const companyCode = req.headers['x-company-code'];
    if (!companyCode) throw new Error("No company selected.");
    const pool = await getPool(companyCode);
    if (!pool) throw new Error("Database unavailable.");

    const result = await pool.request().query("SELECT * FROM tblPITermMaster");
    
    const normalizedTerms = result.recordset.map(t => {
        let rawRate = t.Rate ?? t.rate ?? t.TermRate ?? t.termRate ?? t.Percentage ?? t.PERCENT ?? 0.0;
        return {
            TermID: t.TermID ?? t.termID ?? t.TermId ?? t.ID ?? t.id ?? 0,
            TermName: t.TermName ?? t.termName ?? t.Termname ?? t.Name ?? t.name ?? 'Term',
            Rate: parseFloat(rawRate) || 0.0,
            Sign: t.Sign ?? t.sign ?? '+',
            ItemWise: t.ItemWise ?? t.itemWise ?? t.itemwise ?? t.IsItemWise ?? 'N'
        };
    });

    return normalizedTerms;
};

const createPurchase = async (req) => {
    const companyCode = req.headers['x-company-code'];
    if (!companyCode) throw new Error("Company not selected.");
    
    const pool = await getPool(companyCode);
    if (!pool) throw new Error("Database unavailable.");

    const {
        vendorLedgerId, vendorName, partyBillNo, partyBillDate,
        orderNo, challanNo, dueDays = 0,
        branchId, nepaliDate, adDate, remarks = "", paymentMode = 'Credit',  
        items = [], billTerms = []
    } = req.body;

    if (!items.length) throw new Error("Cart is empty.");

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

    const netAmount = masterBasicAmount + billTermAmount;

    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
        const resolvedBranchId = await resolveBranch(tx, branchId);
        const voucherData = await getNextVoucher(tx, 'PB', resolvedBranchId);
        const generatedVoucherId = voucherData.voucherId;
        const docId = voucherData.documentId;
        const docName = voucherData.documentName;

        const voucherDate = adDate ? new Date(adDate) : new Date();
        const dueDate = new Date(voucherDate);
        dueDate.setDate(dueDate.getDate() + Number(dueDays));

        let finalLedgerId = vendorLedgerId;

        if (!finalLedgerId && paymentMode === 'Cash') {
            const cashRes = await new sql.Request(tx).query("SELECT TOP 1 Cash_Book FROM tblSystemSettings");
            if (cashRes.recordset.length > 0 && cashRes.recordset[0].Cash_Book) {
                finalLedgerId = cashRes.recordset[0].Cash_Book;
            } else {
                throw new Error("Cash Book ledger is not configured in System Settings.");
            }
        }

        if (!finalLedgerId) throw new Error("Vendor or Cash Ledger ID is missing.");

        await new sql.Request(tx)
            .input("VoucherID", sql.VarChar(50), generatedVoucherId)
            .input("VoucherDate", sql.DateTime, voucherDate)
            .input("VoucherMiti", sql.VarChar(15), nepaliDate)
            .input("PartyBillID", sql.VarChar(50), partyBillNo || '')
            .input("PartyBillDate", sql.DateTime, partyBillDate ? new Date(partyBillDate) : null)
            .input("VoucherType", sql.VarChar(5), 'L')
            .input("DueDays", sql.Int, Number(dueDays))
            .input("DueDate", sql.DateTime, dueDate)
            .input("ReferenceOrderID", sql.VarChar(50), orderNo || null)
            .input("ReferenceChallanID", sql.VarChar(50), challanNo || null)
            .input("LedgerID", sql.Int, finalLedgerId)
            .input("PartyName", sql.VarChar(100), vendorName || null)
            .input("BranchID", sql.Int, resolvedBranchId)
            .input("CurrencyRate", sql.Decimal(18, 4), 1.0)
            .input("BasicAmount", sql.Decimal(18, 2), masterBasicAmount)
            .input("TermAmount", sql.Decimal(18, 2), billTermAmount)
            .input("NetAmount", sql.Decimal(18, 2), netAmount)
            .input("UserID", sql.Int, req.user?.userId || 1)
            .input("Remarks", sql.VarChar(255), remarks)
            .query(`
                INSERT INTO tblPIMaster (
                    VoucherID, VoucherDate, VoucherTime, VoucherMiti, PartyBillID, PartyBillDate, VoucherType,
                    DueDays, DueDate, ReferenceOrderID, ReferenceChallanID,
                    LedgerID, BranchID, CurrencyRate, BasicAmount, TermAmount, NetAmount, UserID, Remarks, PartyName
                ) VALUES (
                    @VoucherID, @VoucherDate, GETDATE(), @VoucherMiti, @PartyBillID, @PartyBillDate, @VoucherType,
                    @DueDays, @DueDate, @ReferenceOrderID, @ReferenceChallanID,
                    @LedgerID, @BranchID, @CurrencyRate, @BasicAmount, @TermAmount, @NetAmount, @UserID, @Remarks, @PartyName
                )
            `);

        let sno = 1;
        for (const item of items) {
            item.sno = sno;
            await new sql.Request(tx)
                .input("VoucherID", sql.VarChar(50), generatedVoucherId)
                .input("Sno", sql.Int, sno)
                .input("ItemID", sql.Int, item.itemId)
                .input("Qty", sql.Decimal(18, 4), item.qty)
                .input("StockQty", sql.Decimal(18, 4), item.qty)
                .input("AltQty", sql.Decimal(18, 4), item.altQty || 0)
                .input("AltStockQty", sql.Decimal(18, 4), item.altQty || 0)
                .input("Rate", sql.Decimal(18, 4), item.rate)
                .input("BasicAmount", sql.Decimal(18, 2), item.basicAmount)
                .input("TermAmount", sql.Decimal(18, 2), item.termAmount)
                .input("NetAmount", sql.Decimal(18, 2), item.netAmount)
                .input("ReferenceOrderID", sql.VarChar(50), orderNo || null)
                .input("ReferenceChallanID", sql.VarChar(50), challanNo || null)
                .query(`
                    INSERT INTO tblPIDetails (
                        VoucherID, Sno, ItemID, Qty, StockQty, AltQty, AltStockQty, Rate, BasicAmount, TermAmount, NetAmount,
                        ReferenceOrderID, ReferenceChallanID
                    ) VALUES (
                        @VoucherID, @Sno, @ItemID, @Qty, @StockQty, @AltQty, @AltStockQty, @Rate, @BasicAmount, @TermAmount, @NetAmount,
                        @ReferenceOrderID, @ReferenceChallanID
                    )
                `);

            await new sql.Request(tx)
                .input("Rate", sql.Decimal(18, 4), item.rate)
                .input("ItemID", sql.Int, item.itemId)
                .query(`UPDATE tblItems SET BuyRate = @Rate WHERE ItemID = @ItemID`);

            if (item.itemTerms && item.itemTerms.length > 0) {
                for (const t of item.itemTerms) {
                    await new sql.Request(tx)
                        .input("VoucherID", sql.VarChar(50), generatedVoucherId)
                        .input("TermID", sql.Int, t.termId)
                        .input("Sno", sql.Int, sno)
                        .input("ItemID", sql.Int, item.itemId)
                        .input("TermType", sql.VarChar(5), 'P')
                        .input("Rate", sql.Decimal(18, 4), t.percent)
                        .input("Amount", sql.Decimal(18, 2), t.amount)
                        .query(`
                            INSERT INTO tblPITerm (VoucherID, TermID, Sno, ItemID, TermType, Rate, Amount)
                            VALUES (@VoucherID, @TermID, @Sno, @ItemID, @TermType, @Rate, @Amount)
                        `);
                }
            }
            sno++;
        }

        let totalItemsNetAmount = items.reduce((sum, itm) => sum + (Number(itm.netAmount) || 0), 0);
        let baseForApportion = totalItemsNetAmount > 0 ? totalItemsNetAmount : basicAmount;

        for (const term of billTerms) {
            const bAmount = Number(term.amount) || 0;
            
            await new sql.Request(tx)
                .input("VoucherID", sql.VarChar(50), generatedVoucherId)
                .input("TermID", sql.Int, term.termId)
                .input("Sno", sql.Int, 0)
                .input("TermType", sql.VarChar(5), 'B')
                .input("Rate", sql.Decimal(18, 4), term.percent)
                .input("Amount", sql.Decimal(18, 2), bAmount)
                .query(`
                    INSERT INTO tblPITerm (VoucherID, TermID, Sno, TermType, Rate, Amount)
                    VALUES (@VoucherID, @TermID, @Sno, @TermType, @Rate, @Amount)
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
                        .input("VoucherID", sql.VarChar(50), generatedVoucherId)
                        .input("TermID", sql.Int, term.termId)
                        .input("Sno", sql.Int, itm.sno)
                        .input("ItemID", sql.Int, itm.itemId)
                        .input("TermType", sql.VarChar(5), 'BT')
                        .input("Rate", sql.Decimal(18, 4), term.percent)
                        .input("Amount", sql.Decimal(18, 2), Math.abs(btAmount)) 
                        .query(`
                            INSERT INTO tblPITerm (VoucherID, TermID, Sno, ItemID, TermType, Rate, Amount)
                            VALUES (@VoucherID, @TermID, @Sno, @ItemID, @TermType, @Rate, @Amount)
                        `);
                }
            }
        }

        if (UpdateAccountTransactionfromPurchaseInvoice) {
            await new sql.Request(tx)
                .input("VoucherNo", sql.VarChar(50), generatedVoucherId)
                .query(UpdateAccountTransactionfromPurchaseInvoice);
        }

        if (UpdateInvTransactionfromPurchaseInvoice) {
            await new sql.Request(tx)
                .input("VoucherNo", sql.VarChar(50), generatedVoucherId)
                .query(UpdateInvTransactionfromPurchaseInvoice);
        }

        if (paymentMode === 'Cash' && vendorLedgerId) {
            let cashLedgerId = null;
            const cashRes = await new sql.Request(tx).query("SELECT TOP 1 Cash_Book FROM tblSystemSettings");
            if (cashRes.recordset.length > 0) cashLedgerId = cashRes.recordset[0].Cash_Book;

            if (cashLedgerId) {
                await new sql.Request(tx)
                    .input("VoucherID", sql.VarChar(50), generatedVoucherId)
                    .input("VoucherDate", sql.DateTime, voucherDate)
                    .input("VoucherMiti", sql.VarChar(15), nepaliDate)
                    .input("LedgerID", sql.Int, vendorLedgerId)
                    .input("DebitAmount", sql.Decimal(18, 2), netAmount)
                    .input("CreditAmount", sql.Decimal(18, 2), 0)
                    .input("LocalDebitAmount", sql.Decimal(18, 2), netAmount)
                    .input("LocalCreditAmount", sql.Decimal(18, 2), 0)
                    .input("Source", sql.VarChar(5), 'PB')
                    .input("CurrencyRate", sql.Decimal(18, 4), 1.0)
                    .input("BranchID", sql.Int, resolvedBranchId)
                    .query(`
                        INSERT INTO tblAccTransaction (VoucherID, VoucherDate, VoucherMiti, LedgerID, DebitAmount, CreditAmount, LocalDebitAmount, LocalCreditAmount, Source, CurrencyRate, BranchID)
                        VALUES (@VoucherID, @VoucherDate, @VoucherMiti, @LedgerID, @DebitAmount, @CreditAmount, @LocalDebitAmount, @LocalCreditAmount, @Source, @CurrencyRate, @BranchID)
                    `);

                await new sql.Request(tx)
                    .input("VoucherID", sql.VarChar(50), generatedVoucherId)
                    .input("VoucherDate", sql.DateTime, voucherDate)
                    .input("VoucherMiti", sql.VarChar(15), nepaliDate)
                    .input("LedgerID", sql.Int, cashLedgerId)
                    .input("DebitAmount", sql.Decimal(18, 2), 0)
                    .input("CreditAmount", sql.Decimal(18, 2), netAmount)
                    .input("LocalDebitAmount", sql.Decimal(18, 2), 0)
                    .input("LocalCreditAmount", sql.Decimal(18, 2), netAmount)
                    .input("Source", sql.VarChar(5), 'PB')
                    .input("CurrencyRate", sql.Decimal(18, 4), 1.0)
                    .input("BranchID", sql.Int, resolvedBranchId)
                    .query(`
                        INSERT INTO tblAccTransaction (VoucherID, VoucherDate, VoucherMiti, LedgerID, DebitAmount, CreditAmount, LocalDebitAmount, LocalCreditAmount, Source, CurrencyRate, BranchID)
                        VALUES (@VoucherID, @VoucherDate, @VoucherMiti, @LedgerID, @DebitAmount, @CreditAmount, @LocalDebitAmount, @LocalCreditAmount, @Source, @CurrencyRate, @BranchID)
                    `);
            }
        }

        await tx.commit();

        try {
            await incrementVoucherSequence(pool, docId, docName);
        } catch (seqErr) {
            console.error("Warning: Failed to increment voucher sequence:", seqErr.message);
        }

        return { success: true, voucherId: generatedVoucherId, basicAmount: masterBasicAmount, termAmount: billTermAmount, netAmount };

    } catch (err) {
        try {
            if (tx) await tx.rollback();
        } catch (rbErr) {
            console.error("Rollback failed:", rbErr.message);
        }
        console.error("PURCHASE ENTRY ERROR:", err);
        throw err;
    }
};

module.exports = {
    getPurchaseTermMasters,
    createPurchase
};
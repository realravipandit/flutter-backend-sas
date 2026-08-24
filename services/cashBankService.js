const { sql, getPool } = require("../db");
const { resolveBranch } = require("../utils/branchResolver");
const { getNextVoucher, incrementVoucherSequence } = require("../utils/voucherSequence");
const { UpdateAccountTransactionfromCashBank } = require("../sql/cashBankScripts");
const { getVoucherSequences } = require("../utils/voucherSequence");

// ==========================================
// 1. Fetch Cash/Bank Summary (History)
// ==========================================
exports.getCashBankSummary = async (req) => {
    const companyCode = req.headers['x-company-code'];
    if (!companyCode) throw new Error("No company selected.");
    
    const pool = await getPool(companyCode);
    if (!pool) throw new Error("Database unavailable.");

    const result = await pool.request().query(`
        SELECT
            m.CashBankID AS voucherId,
            m.VoucherDate,
            ISNULL(m.VoucherTime, '00:00:00') AS voucherTime,
            l.LedgerName AS cashBankLedgerName,
            m.Remarks AS remarks
        FROM tblCBMaster m
        LEFT JOIN tblLedger l ON m.LedgerID = l.LedgerID
        ORDER BY m.VoucherDate DESC, m.CashBankID DESC
    `);
    
    return result.recordset;
};

// ==========================================
// 2. Fetch Cash/Bank Single Voucher Details
// ==========================================
exports.getCashBankDetails = async (req) => {
    const companyCode = req.headers['x-company-code'];
    if (!companyCode) throw new Error("No company selected.");
    
    const pool = await getPool(companyCode);
    if (!pool) throw new Error("Database unavailable.");

    const voucherId = req.query.voucherId || req.params.voucherId;
    if (!voucherId) throw new Error("Voucher ID is required.");

    const masterRes = await pool.request()
        .input("VoucherID", sql.VarChar(50), voucherId)
        .query(`
            SELECT m.*, l.LedgerName as cashBankLedgerName 
            FROM tblCBMaster m
            LEFT JOIN tblLedger l ON m.LedgerID = l.LedgerID
            WHERE m.CashBankID = @VoucherID
        `);

    const detailsRes = await pool.request()
        .input("VoucherID", sql.VarChar(50), voucherId)
        .query(`
            SELECT d.*, l.LedgerName as ledgerName, sl.SubLedgerName as subLedgerName, a.AgentName as agentName
            FROM tblCBDetails d
            LEFT JOIN tblLedger l ON d.LedgerID = l.LedgerID
            LEFT JOIN tblSubLedger sl ON d.SubLedgerID = sl.SubLedgerID
            LEFT JOIN tblAgent a ON d.AgentID = a.AgentID
            WHERE d.CashBankID = @VoucherID
            ORDER BY d.Sno
        `);

    return {
        master: masterRes.recordset[0] || {},
        items: detailsRes.recordset
    };
};

// ==========================================
// 3. Create Cash/Bank Voucher Entry
// ==========================================
exports.createCashBankVoucher = async (req) => {
    const companyCode = req.headers['x-company-code'];
    if (!companyCode) throw new Error("Company not selected.");
    
    const pool = await getPool(companyCode);
    if (!pool) throw new Error("Database unavailable.");

    const {
        cashBankLedgerId, 
        branchId,
        nepaliDate,
        adDate,
        chequeNo,
        chequeDate,
        refVoucherNo,
        refVoucherDate,
        currencyRate = 1.0,
        remarks = "",
        documentName,   // From header UI dropdown
        items = [] 
    } = req.body;

    if (!items.length) throw new Error("Voucher details/items are empty.");
    if (!cashBankLedgerId) throw new Error("Cash or Bank ledger is mandatory.");

    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
        const resolvedBranchId = await resolveBranch(tx, branchId);
        
        // FIX 1: Restored strictly to 'CB' so the sequence generator doesn't fail
        const voucherData = await getNextVoucher(tx, 'CB', resolvedBranchId, documentName);
        
        const generatedVoucherId = voucherData.voucherId;
        const docId = voucherData.documentId;
        // Writes exactly what is selected in the UI dropdown to the database
        const finalDocName = documentName || voucherData.documentName;

        const voucherDate = adDate ? new Date(adDate) : new Date();

        // 1. Insert Master Record (`tblCBMaster`)
        await new sql.Request(tx)
            .input("CashBankID", sql.VarChar(50), generatedVoucherId)
            .input("VoucherDate", sql.DateTime, voucherDate)
            .input("VoucherMiti", sql.VarChar(15), nepaliDate || '')
            .input("ChequeNo", sql.VarChar(50), chequeNo || null)
            .input("ChequeDate", sql.DateTime, chequeDate ? new Date(chequeDate) : null)
            .input("BranchID", sql.Int, resolvedBranchId)
            .input("CurrencyRate", sql.Decimal(18, 4), Number(currencyRate) || 1.0)
            .input("LedgerID", sql.Int, cashBankLedgerId)
            .input("UserID", sql.Int, req.user?.userId || 1)
            .input("Remarks", sql.VarChar(255), remarks)
            .input("EffectiveDate", sql.DateTime, voucherDate)
            .input("Posting", sql.VarChar(5), 'Y')
            .input("Export", sql.VarChar(5), 'N')
            .input("RefVoucherNo", sql.VarChar(50), refVoucherNo || null)
            .input("RefVoucherDate", sql.DateTime, refVoucherDate ? new Date(refVoucherDate) : null)
            .input("DocumentName", sql.VarChar(100), finalDocName) 
            .query(`
                INSERT INTO tblCBMaster (
                    CashBankID, VoucherDate, VoucherTime, ChequeNo, ChequeDate, BranchID, CurrencyRate,
                    LedgerID, UserID, Remarks, EffectiveDate, VoucherMiti, Posting, Export, RefVoucherNo, RefVoucherDate, DocumentName
                ) VALUES (
                    @CashBankID, @VoucherDate, GETDATE(), @ChequeNo, @ChequeDate, @BranchID, @CurrencyRate,
                    @LedgerID, @UserID, @Remarks, @EffectiveDate, @VoucherMiti, @Posting, @Export, @RefVoucherNo, @RefVoucherDate, @DocumentName
                )
            `);

        // 2. Insert Details Rows (`tblCBDetails`)
        let sno = 1;
        let totalAmount = 0; // Gather amount for success popup
        
        for (const row of items) {
            const rowAmt = Number(row.amount) || 0;
            totalAmount += rowAmt;

            // FIX 2: Removed "NetAmount" column entirely so it matches your schema and doesn't crash SQL
            await new sql.Request(tx)
                .input("CashBankID", sql.VarChar(50), generatedVoucherId)
                .input("Sno", sql.Int, sno)
                .input("LedgerID", sql.Int, row.ledgerId)
                .input("SubLedgerID", sql.Int, row.subLedgerId || null)
                .input("AgentID", sql.Int, row.agentId || null)
                .input("CashBankType", sql.VarChar(5), row.cashBankType)
                .input("Amount", sql.Decimal(18, 2), rowAmt)
                .input("VatReg", sql.VarChar(5), row.vatReg || 'N')
                .input("Narration", sql.VarChar(255), row.narration || '')
                .query(`
                    INSERT INTO tblCBDetails (
                        CashBankID, Sno, LedgerID, SubLedgerID, AgentID, CashBankType, Amount, VatReg, Narration
                    ) VALUES (
                        @CashBankID, @Sno, @LedgerID, @SubLedgerID, @AgentID, @CashBankType, @Amount, @VatReg, @Narration
                    )
                `);
            sno++;
        }

        // 3. Run Double-Entry Accounting Script (`tblAccTransaction`)
        await new sql.Request(tx)
            .input("VoucherNo", sql.VarChar(50), generatedVoucherId)
            .query(UpdateAccountTransactionfromCashBank);

        // 4. Additional Sync Updates
        await new sql.Request(tx)
            .input("VoucherNo", sql.VarChar(50), generatedVoucherId)
            .query(`
                UPDATE tblAccTransaction 
                SET ChequeNo = m.ChequeNo, 
                    ChequeDate = m.ChequeDate, 
                    CashBankID = m.LedgerID, 
                    TransDueDate = m.VoucherDate, 
                    RefVoucherNo = m.RefVoucherNo 
                FROM tblCBMaster m 
                WHERE tblAccTransaction.VoucherID = m.CashBankID 
                  AND tblAccTransaction.Source = 'CB' 
                  AND m.CashBankID = @VoucherNo;
            `);

        await tx.commit();

        try {
            await incrementVoucherSequence(pool, docId, finalDocName);
        } catch (seqErr) {
            console.error("Warning: Failed to increment CB voucher sequence:", seqErr.message);
        }

        // Returns totalAmount smoothly to the Flutter Frontend popup
        return { 
            success: true, 
            voucherId: generatedVoucherId,
            netAmount: totalAmount 
        };

    } catch (err) {
        try {
            if (tx) await tx.rollback();
        } catch (rbErr) {
            console.error("Rollback failed:", rbErr.message);
        }
        throw err;
    }
};

// ==========================================
// 4. Fetch Strictly Cash/Bank Ledgers
// ==========================================
exports.getCashBankLedgers = async (req) => {
    const companyCode = req.headers['x-company-code'];
    if (!companyCode) throw new Error("No company selected.");
    
    const pool = await getPool(companyCode);
    if (!pool) throw new Error("Database unavailable.");

    const result = await pool.request().query(`
        SELECT * FROM tblLedger 
        WHERE CashBank = 'Y'
        ORDER BY LedgerName
    `);
    
    return result.recordset;
};

// ==========================================
// 5. Get Voucher Sequences (for Document Type / Voucher No dropdown)
// ==========================================
exports.getVoucherSequences = async (req) => {
    const companyCode = req.headers['x-company-code'];
    if (!companyCode) throw new Error("No company selected.");

    const pool = await getPool(companyCode);
    if (!pool) throw new Error("Database unavailable.");

    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    const userId = req.user?.userId || null;

    // 'CB' matches the Module value used in createCashBankVoucher's getNextVoucher(tx, 'CB', ...)
    const sequences = await getVoucherSequences(pool, 'CB', branchId, userId);
    return sequences;
};

// ==========================================
// 6. Get Full Ledger List (for row-level "any account" selector)
// ==========================================
exports.getVoucherLedgers = async (req) => {
    const companyCode = req.headers['x-company-code'];
    if (!companyCode) throw new Error("No company selected.");

    const pool = await getPool(companyCode);
    if (!pool) throw new Error("Database unavailable.");

    const result = await pool.request().query(`
        SELECT * FROM tblLedger
        ORDER BY LedgerName
    `);
    return result.recordset;
};
module.exports = {
    UpdateAccountTransactionfromCashBank: `
        DELETE FROM tblAccTransaction WHERE VoucherID = @VoucherNo AND Source = 'CB';

        INSERT INTO tblAccTransaction (
            VoucherID, VoucherDate, VoucherMiti, VoucherTime, CurrencyID, CurrencyRate,
            ClassID, ClassID1, ClassID2, BranchID, LedgerID, SubLedgerID, DebitAmount, CreditAmount, 
            LocalDebitAmount, LocalCreditAmount, Narration, Remarks, Source, UserID, AgentID, Sno, EffectiveDate, ReconcileDate
        )
        SELECT 
            VoucherNo, VoucherDate, VoucherMiti, VoucherTime, CurrencyID, CurrencyRate,
            ClassID, ClassID1, ClassID2, BranchID, LedgerID, SubLedgerID, DebitAmount, CreditAmount, 
            LocalDebitAmount, LocalCreditAmount, Narration, Remarks, Source, UserID, AgentID, Sno, EffectiveDate, ReconcileDate
        FROM (
            -- Line Item Postings
            SELECT 
                MCB.CashBankID AS VoucherNo, MCB.VoucherDate, MCB.VoucherMiti, MCB.VoucherTime, MCB.CurrencyID, MCB.CurrencyRate,
                MCB.ClassID, MCB.ClassID1, MCB.ClassID2, MCB.BranchID, 
                DCB.LedgerID, DCB.SubLedgerID, 
                CASE WHEN CashBankType = 'P' THEN ROUND(Amount, 2) ELSE 0 END AS DebitAmount,  
                CASE WHEN CashBankType = 'R' THEN ROUND(Amount, 2) ELSE 0 END AS CreditAmount, 
                CASE WHEN CashBankType = 'P' THEN ROUND((Amount * MCB.CurrencyRate), 2) ELSE 0 END AS LocalDebitAmount, 
                CASE WHEN CashBankType = 'R' THEN ROUND((Amount * MCB.CurrencyRate), 2) ELSE 0 END AS LocalCreditAmount, 
                DCB.Narration, MCB.Remarks, 'CB' AS Source, MCB.UserID, DCB.AgentID, DCB.Sno, MCB.EffectiveDate, MCB.CBReconcileDate AS ReconcileDate  
            FROM tblCBMaster MCB 
            LEFT JOIN tblCBDetails DCB ON DCB.CashBankID = MCB.CashBankID  
            WHERE MCB.CashBankID = @VoucherNo

            UNION ALL  

            -- Master Summary Balancing Leg (The Cash/Bank Account Leg)
            SELECT 
                VoucherNo, VoucherDate, VoucherMiti, VoucherTime, CurrencyID, CurrencyRate,
                ClassID, ClassID1, ClassID2, BranchID, LedgerID, NULL AS SubLedgerID, 
                CASE WHEN Amt < 0 THEN ROUND(ABS(Amt), 2) ELSE 0 END AS DebitAmount, 
                CASE WHEN Amt >= 0 THEN ROUND(Amt, 2) ELSE 0 END AS CreditAmount, 
                CASE WHEN LocalAmt < 0 THEN ROUND(ABS(LocalAmt), 2) ELSE 0 END AS LocalDebitAmount, 
                CASE WHEN LocalAmt >= 0 THEN ROUND(LocalAmt, 2) ELSE 0 END AS LocalCreditAmount, 
                '' AS Narration, Remarks, 'CB' AS Source, UserID, AgentID, Sno, EffectiveDate, ReconcileDate  
            FROM (
                SELECT 
                    MCB.CashBankID AS VoucherNo, MCB.VoucherDate, MCB.VoucherMiti, MCB.VoucherTime,
                    MCB.CurrencyID, MCB.CurrencyRate, MCB.ClassID, MCB.ClassID1, MCB.ClassID2,  
                    MCB.BranchID, MCB.LedgerID,  
                    ROUND(SUM((CASE WHEN CashBankType = 'P' THEN Amount ELSE 0 END) - (CASE WHEN CashBankType = 'R' THEN Amount ELSE 0 END)), 2) AS Amt, 
                    ROUND(SUM((CASE WHEN CashBankType = 'P' THEN (Amount * MCB.CurrencyRate) ELSE 0 END) - (CASE WHEN CashBankType = 'R' THEN (Amount * MCB.CurrencyRate) ELSE 0 END)), 2) AS LocalAmt,  
                    MCB.Remarks, 'CB' AS Source, MCB.UserID, NULL AS AgentID, 0 AS Sno,  
                    MCB.EffectiveDate, MCB.CBReconcileDate AS ReconcileDate  
                FROM tblCBMaster MCB 
                LEFT JOIN tblCBDetails DCB ON DCB.CashBankID = MCB.CashBankID  
                WHERE MCB.CashBankID = @VoucherNo
                GROUP BY MCB.CashBankID, MCB.VoucherDate, MCB.VoucherMiti, MCB.VoucherTime, MCB.CurrencyID,
                         MCB.CurrencyRate, MCB.ClassID, MCB.ClassID1, MCB.ClassID2, MCB.BranchID,
                         MCB.LedgerID, MCB.Remarks, MCB.UserID, MCB.EffectiveDate, MCB.CBReconcileDate
            ) AS CbMaster
        ) AS ACCTran;
    `
};
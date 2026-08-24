// ============================================================================
// Sales & Cash/Bank SQL Scripts
// Fully aliased for MS SQL Server compliance
// ============================================================================

const UpdateAccountTransactionfromSalesInvoice = `
DECLARE @RateLen INT=2;

DELETE FROM tblAccTransaction
WHERE Source='SB' AND VoucherID=@VoucherNo;

INSERT INTO tblAccTransaction
(VoucherID,VoucherDate,VoucherTime,VoucherMiti,CurrencyID,CurrencyRate,
ClassID,ClassID1,ClassID2,BranchID,LedgerID,SubLedgerID,
DebitAmount,CreditAmount,LocalDebitAmount,LocalCreditAmount,
Narration,Remarks,Source,UserID,AgentID,Sno,EffectiveDate)

SELECT VoucherID,VoucherDate,VoucherTime,VoucherMiti,CurrencyID,CurrencyRate,
ClassID,ClassID1,ClassID2,BranchID,LedgerID,SubLedgerID,
DebitAmount,CreditAmount,LocalDebitAmount,LocalCreditAmount,
Narration,Remarks,Source,UserID,AgentID,Sno,EffectiveDate
FROM (

SELECT 
    VoucherID, VoucherDate, VoucherTime, VoucherMiti, CurrencyID, CurrencyRate,
    ClassID, ClassID1, ClassID2, BranchID, LedgerID, SubLedgerID,
    ROUND(NetAmount,@RateLen) AS DebitAmount,
    0 AS CreditAmount,
    ROUND(NetAmount*CurrencyRate,@RateLen) AS LocalDebitAmount,
    0 AS LocalCreditAmount,
    '' AS Narration,
    Remarks,
    'SB' AS Source,
    UserID,
    AgentID,
    NULL AS Sno,
    EffectiveDate
FROM tblSIMaster
WHERE VoucherID=@VoucherNo

UNION ALL

SELECT
    P_MS.VoucherID, VoucherDate, VoucherTime, VoucherMiti, CurrencyID, CurrencyRate,
    P_MS.ClassID, P_MS.ClassID1, P_MS.ClassID2, BranchID,
    ISNULL(SILedgerID,SIAccount) AS LedgerID,
    SubLedgerID,
    0 AS DebitAmount,
    ROUND(SUM(P_DT.BasicAmount),@RateLen) AS CreditAmount,
    0 AS LocalDebitAmount,
    ROUND(SUM(P_DT.BasicAmount*P_MS.CurrencyRate),@RateLen) AS LocalCreditAmount,
    '' AS Narration,
    P_MS.Remarks,
    'SB' AS Source,
    UserID,
    P_MS.AgentID,
    NULL AS Sno,
    EffectiveDate
FROM tblSIMaster P_MS,
tblSIDetails P_DT,
tblSystemSettings,
tblItems
WHERE P_DT.ItemID=tblItems.ItemID
AND P_DT.VoucherID=P_MS.VoucherID
AND P_MS.VoucherID=@VoucherNo
GROUP BY
P_MS.VoucherID,SIAccount,VoucherDate,VoucherTime,VoucherMiti,
CurrencyID,CurrencyRate,P_MS.ClassID,P_MS.ClassID1,P_MS.ClassID2,
BranchID,P_MS.Remarks,SILedgerID,SubLedgerID,
UserID,P_MS.AgentID,Sno,EffectiveDate

UNION ALL

SELECT
    VoucherID, VoucherDate, VoucherTime, VoucherMiti, CurrencyID, CurrencyRate,
    ClassID, ClassID1, ClassID2, BranchID,
    LedgerID, SubLedgerID,
    CASE WHEN Amt<0 THEN ROUND(ABS(Amt),@RateLen) ELSE 0 END AS DebitAmount,
    CASE WHEN Amt>0 THEN ROUND(Amt,@RateLen) ELSE 0 END AS CreditAmount,
    CASE WHEN Amt<0 THEN ROUND(ABS(Amt)*CurrencyRate,@RateLen) ELSE 0 END AS LocalDebitAmount,
    CASE WHEN Amt>0 THEN ROUND(Amt*CurrencyRate,@RateLen) ELSE 0 END AS LocalCreditAmount,
    Narration, Remarks, Source, UserID, AgentID, Sno, EffectiveDate
FROM (

SELECT
    P_MAST.VoucherID,
    P_MAST.VoucherDate,
    P_MAST.VoucherTime,
    VoucherMiti,
    CurrencyID,
    CurrencyRate,
    ClassID,
    ClassID1,
    ClassID2,
    P_MAST.BranchID,
    P_TM.LedgerID,
    SubLedgerID,
    ROUND(SUM(CASE WHEN Sign='+' THEN P_TD.Amount ELSE -P_TD.Amount END),@RateLen) AS Amt,
    '' AS Narration,
    P_MAST.Remarks,
    'SB' AS Source,
    P_MAST.UserID,
    NULL AS AgentID,
    NULL AS Sno,
    EffectiveDate

FROM tblSITerm P_TD,
tblSITermMaster P_TM,
tblSIMaster P_MAST

WHERE P_TD.TermID=P_TM.TermID
AND P_TD.VoucherID=P_MAST.VoucherID
AND P_TD.TermType<>'BT'
AND P_MAST.VoucherID=@VoucherNo

GROUP BY
P_TM.TermID,P_MAST.VoucherID,P_MAST.VoucherDate,P_MAST.VoucherTime,
VoucherMiti,CurrencyID,CurrencyRate,
ClassID,ClassID1,ClassID2,
P_MAST.BranchID,P_TM.LedgerID,
P_MAST.Remarks,SubLedgerID,
ItemID,UserID,Sno,EffectiveDate

) TT
WHERE Source='SB'

) DATA;
`;

const UpdateInvTransactionfromSalesInvoice = `
DELETE FROM tblInvTransaction
WHERE Sources='SB'
AND VoucherID=@VoucherNo;

INSERT INTO tblInvTransaction
(
    VoucherID,VoucherDate,VoucherMiti,VoucherTime,
    LedgerID,AgentID,
    ClassID,ClassID1,ClassID2,
    CurrencyID,CurrencyRate,
    Sno,ItemID,GodownID,BranchID,CostCenterID,
    AltQty,AltUnitID,Qty,UnitID,
    AltStockQty,StockQty,
    FreeQty,FreeUnitID,
    ConversionRatio,
    Rate,BasicAmount,TermAmount,NetAmount,
    Types,Sources,
    ReferenceVoucher,
    ReferenceVoucherSource,
    IssueQty,
    StockValue
)

SELECT
    M.VoucherID,
    M.VoucherDate,
    M.VoucherMiti,
    M.VoucherTime,
    M.LedgerID,
    M.AgentID,
    M.ClassID,
    M.ClassID1,
    M.ClassID2,
    M.CurrencyID,
    M.CurrencyRate,
    D.SNO,
    D.ItemID,
    D.GodownID,
    M.BranchID,
    NULL AS CostCenterID,
    D.AltQty,
    D.AltUnitID,
    D.Qty,
    D.UnitID,
    D.AltStockQty,
    D.StockQty,
    D.FreeQty,
    D.FreeUnitID,
    D.ConversionRatio,
    D.Rate,
    D.BasicAmount,
    D.TermAmount,
    D.NetAmount,
    'O' AS Types,
    'SB' AS Sources,
    CASE
        WHEN D.ChallanID<>'' THEN D.ChallanID
        ELSE D.OrderID
    END AS ReferenceVoucher,
    '' AS ReferenceVoucherSource,
    D.Qty AS IssueQty,
    '0' AS StockValue

FROM tblSIMaster M
LEFT JOIN tblSIDetails D
ON M.VoucherID=D.VoucherID

WHERE M.VoucherID=@VoucherNo;
`;

const UpdateAccountTransactionfromCashBank = `
DELETE FROM tblAccTransaction
WHERE VoucherID=@VoucherNo
AND Source='CB';

INSERT INTO tblAccTransaction
(
    VoucherID,VoucherDate,VoucherMiti,VoucherTime,
    CurrencyID,CurrencyRate,
    ClassID,ClassID1,ClassID2,
    BranchID,
    LedgerID,
    SubLedgerID,
    DebitAmount,
    CreditAmount,
    LocalDebitAmount,
    LocalCreditAmount,
    Narration,
    Remarks,
    Source,
    UserID,
    AgentID,
    Sno,
    EffectiveDate,
    ReconcileDate
)

SELECT
    VoucherNo,
    VoucherDate,
    VoucherMiti,
    VoucherTime,
    CurrencyID,
    CurrencyRate,
    ClassID,
    ClassID1,
    ClassID2,
    BranchID,
    LedgerID,
    SubLedgerID,
    DebitAmount,
    CreditAmount,
    LocalDebitAmount,
    LocalCreditAmount,
    Narration,
    Remarks,
    Source,
    UserID,
    AgentID,
    Sno,
    EffectiveDate,
    ReconcileDate

FROM
(

SELECT
    MCB.CashBankID AS VoucherNo,
    MCB.VoucherDate,
    MCB.VoucherMiti,
    MCB.VoucherTime,
    MCB.CurrencyID,
    MCB.CurrencyRate,

    CASE WHEN DCB.ClassDetilsID IS NOT NULL THEN DCB.ClassDetilsID ELSE MCB.ClassID END AS ClassID,
    CASE WHEN DCB.ClassDetilsID1 IS NOT NULL THEN DCB.ClassDetilsID1 ELSE MCB.ClassID1 END AS ClassID1,
    CASE WHEN DCB.ClassDetilsID2 IS NOT NULL THEN DCB.ClassDetilsID2 ELSE MCB.ClassID2 END AS ClassID2,

    MCB.BranchID,
    DCB.LedgerID,
    DCB.SubLedgerID,

    CASE WHEN CashBankType='P' THEN ROUND(Amount,2) ELSE 0 END AS DebitAmount,
    CASE WHEN CashBankType='R' THEN ROUND(Amount,2) ELSE 0 END AS CreditAmount,

    CASE WHEN CashBankType='P' THEN ROUND(Amount*MCB.CurrencyRate,2) ELSE 0 END AS LocalDebitAmount,
    CASE WHEN CashBankType='R' THEN ROUND(Amount*MCB.CurrencyRate,2) ELSE 0 END AS LocalCreditAmount,

    Narration,
    Remarks,
    'CB' AS Source,
    UserID,
    DCB.AgentID,
    Sno,
    EffectiveDate,
    CBReconcileDate AS ReconcileDate

FROM tblCBMaster MCB
LEFT JOIN tblCBDetails DCB
ON DCB.CashBankID=MCB.CashBankID

UNION ALL

SELECT
    VoucherNo,
    VoucherDate,
    VoucherMiti,
    VoucherTime,
    CurrencyID,
    CurrencyRate,
    ClassID,
    ClassID1,
    ClassID2,
    BranchID,
    LedgerID,
    SubLedgerID,

    CASE WHEN Amt<0 THEN ROUND(ABS(Amt),2) ELSE 0 END AS DebitAmount,
    CASE WHEN Amt>=0 THEN ROUND(Amt,2) ELSE 0 END AS CreditAmount,

    CASE WHEN LocalAmt<0 THEN ROUND(ABS(LocalAmt),2) ELSE 0 END AS LocalDebitAmount,
    CASE WHEN LocalAmt>=0 THEN ROUND(LocalAmt,2) ELSE 0 END AS LocalCreditAmount,

    '' AS Narration,
    Remarks,
    'CB' AS Source,
    UserID,
    AgentID,
    Sno,
    EffectiveDate,
    ReconcileDate

FROM
(

SELECT
    MCB.CashBankID AS VoucherNo,
    MCB.VoucherDate,
    MCB.VoucherMiti,
    MCB.VoucherTime,
    MCB.CurrencyID,
    MCB.CurrencyRate,

    CASE WHEN DCB.ClassDetilsID IS NOT NULL THEN DCB.ClassDetilsID ELSE MCB.ClassID END AS ClassID,
    CASE WHEN DCB.ClassDetilsID1 IS NOT NULL THEN DCB.ClassDetilsID1 ELSE MCB.ClassID1 END AS ClassID1,
    CASE WHEN DCB.ClassDetilsID2 IS NOT NULL THEN DCB.ClassDetilsID2 ELSE MCB.ClassID2 END AS ClassID2,

    MCB.BranchID,
    MCB.LedgerID,
    NULL AS SubLedgerID,

    ROUND(
        SUM(
            (CASE WHEN CashBankType='P' THEN Amount ELSE 0 END)
          - (CASE WHEN CashBankType='R' THEN Amount ELSE 0 END)
        ),2
    ) AS Amt,

    ROUND(
        SUM(
            (CASE WHEN CashBankType='P' THEN Amount*MCB.CurrencyRate ELSE 0 END)
          - (CASE WHEN CashBankType='R' THEN Amount*MCB.CurrencyRate ELSE 0 END)
        ),2
    ) AS LocalAmt,

    Remarks,
    'CB' AS Source,
    MCB.UserID,
    DCB.AgentID,
    Sno,
    EffectiveDate,
    CBReconcileDate AS ReconcileDate

FROM tblCBMaster MCB
LEFT JOIN tblCBDetails DCB
ON DCB.CashBankID=MCB.CashBankID

GROUP BY
    MCB.CashBankID,
    MCB.VoucherDate,
    MCB.VoucherMiti,
    MCB.VoucherTime,
    MCB.CurrencyID,
    MCB.CurrencyRate,
    MCB.ClassID,
    MCB.ClassID1,
    MCB.ClassID2,
    DCB.ClassDetilsID,
    DCB.ClassDetilsID1,
    DCB.ClassDetilsID2,
    MCB.BranchID,
    MCB.LedgerID,
    Remarks,
    UserID,
    AgentID,
    Sno,
    EffectiveDate,
    CBReconcileDate

) CbMaster

) ACCTran

WHERE VoucherNo=@VoucherNo
AND Source='CB';
`;

module.exports = {
    UpdateAccountTransactionfromSalesInvoice,
    UpdateInvTransactionfromSalesInvoice,
    UpdateAccountTransactionfromCashBank,
};
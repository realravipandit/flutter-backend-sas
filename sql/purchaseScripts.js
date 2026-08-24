const UpdateAccountTransactionfromPurchaseInvoice = `
    Declare @RateLen int Set @RateLen = 2    
    Delete from tblAccTransaction Where Source = 'PB' and (VoucherID = @VoucherNo)    
    
    Insert into tblAccTransaction (VoucherID, VoucherDate, VoucherTime, VoucherMiti, CurrencyID, CurrencyRate, ClassID, ClassID1, ClassID2, BranchID, LedgerID, SubLedgerID, DebitAmount, CreditAmount, LocalDebitAmount, LocalCreditAmount, Narration, Remarks, Source, UserID, AgentID, Sno, EffectiveDate)    
    select VoucherID, VoucherDate, VoucherTime, VoucherMiti, CurrencyID, CurrencyRate, ClassID, ClassID1, ClassID2, BranchID, LedgerID, SubLedgerID, DebitAmount, CreditAmount, LocalDebitAmount, LocalCreditAmount, Narration, Remarks, Source, UserID, AgentID, Sno, EffectiveDate
    from (
        SELECT VoucherID, VoucherDate, VoucherTime, VoucherMiti, CurrencyID, CurrencyRate, ClassID, ClassID1, ClassID2, BranchID, LedgerID, SubLedgerID, 0 AS DebitAmount, round(NetAmount,2) AS CreditAmount, 0 AS LocalDebitAmount, round((NetAmount * CurrencyRate),2) AS LocalCreditAmount, '' as Narration, Remarks, 'PB' as Source, UserID, AgentID, Null As Sno, EffectiveDate 
        From tblPIMaster 
        Where VoucherID = @VoucherNo

        Union All
        
        SELECT P_MS.VoucherID, VoucherDate, VoucherTime, VoucherMiti, CurrencyID, CurrencyRate, P_MS.ClassID, P_MS.ClassID1, P_MS.ClassID2, BranchID, Isnull(PiLedgerId,PIAccount) as LedgerID, SubLedgerID, round(Sum(P_DT.BasicAmount),2) AS DebitAmount, 0 AS CreditAmount, round(Sum(P_DT.BasicAmount * P_MS.CurrencyRate),2) AS LocalDebitAmount, 0 AS LocalCreditAmount, '' as Narration, P_MS.Remarks, 'PB' as Source, P_MS.UserID, P_MS.AgentID, Null as Sno, EffectiveDate 
        FROM tblPIMaster as P_MS, tblPIDetails as P_DT, tblSystemSettings, tblItems 
        where P_DT.ItemID = tblItems.ItemID And P_DT.VoucherID = P_MS.VoucherID And P_MS.VoucherID = @VoucherNo
        group by P_MS.VoucherID, PIAccount, VoucherDate, VoucherTime, CurrencyID, CurrencyRate, P_MS.ClassID, P_MS.ClassID1, P_MS.ClassID2, BranchID, P_MS.Remarks, PiLedgerId, SubLedgerID, UserID, P_MS.AgentID, Sno, VoucherMiti, EffectiveDate 

        Union All
        
        Select VoucherID, VoucherDate, VoucherTime, VoucherMiti, CurrencyID, CurrencyRate, ClassID, ClassID1, ClassID2, BranchID, LedgerID, SubLedgerID, Case when Amt > 0 then round(Amt,2) else 0 end as DebitAmount, Case when Amt < 0 then round(ABS(Amt),2) else 0 end as CreditAmount, Case when Amt > 0 then round((Amt * CurrencyRate),2) else 0 end as LocalDebitAmount, Case when Amt < 0 then round((ABS(Amt) * CurrencyRate),2) else 0 end as LocalCreditAmount, Narration, Remarks, Source, UserID, AgentID, Null as Sno, EffectiveDate
        from( 
            SELECT P_MAST.VoucherID, P_MAST.VoucherDate, P_MAST.VoucherTime, VoucherMiti, CurrencyID, CurrencyRate, ClassID, ClassID1, ClassID2, BranchID, ISNULL((Select top 1 LedgerID from tblItemsTerm where LedgerID is not null and P_TD.TermID = P_TM.TermID and TermType = 'P' and tblItemsTerm.ItemID = P_TD.ItemID), P_TM.LedgerID) as LedgerID, SubLedgerID, round(Sum(CASE WHEN Sign = '+' THEN P_TD.Amount ELSE - P_TD.Amount END),2) AS Amt, '' as Narration, P_MAST.Remarks, 'PB' as Source, P_MAST.UserID, NULL as AgentID, Null As Sno, EffectiveDate 
            FROM tblPITerm as P_TD, tblPITermMaster AS P_TM, tblPIMaster as P_MAST 
            where P_TM.TermID = P_TD.TermID and P_TD.VoucherID = P_MAST.VoucherID and P_TD.TermType<>'BT' And P_MAST.VoucherID = @VoucherNo
            group by P_TM.TermID, P_MAST.VoucherID, P_MAST.VoucherDate, VoucherMiti, P_TD.TermID, P_MAST.VoucherTime, CurrencyID, CurrencyRate, ClassID, ClassID1, ClassID2, BranchID, P_TM.LedgerID, SubLedgerID, ItemID, UserID, Sno, P_MAST.Remarks, EffectiveDate 
        ) as Pur_Trm WHERE SOURCE='PB' 
    ) as Acctransaction where VoucherID = @VoucherNo and source='PB'
`;

const UpdateInvTransactionfromPurchaseInvoice = `
    Delete from tblInvTransaction Where Sources = 'PB' and (VoucherID = @VoucherNo) 
    
    Insert into tblInvTransaction (VoucherID, VoucherDate, VoucherMiti, VoucherTime, LedgerID, AgentID, ClassID, ClassID1, ClassID2, CurrencyID, CurrencyRate, Sno, ItemID, GodownID, BranchID, CostCenterID, AltQty, AltUnitID, Qty, UnitID, AltStockQty, StockQty, FreeQty, FreeUnitID, ConversionRatio, Rate, BasicAmount, TermAmount, NetAmount, Types, Sources, ReferenceVoucher, ReferenceVoucherSource, IssueQty, StockValue)
    Select tblPIMaster.VoucherID, VoucherDate, VoucherMiti, VoucherTime, LedgerID, AgentID, ClassID, ClassID1, ClassID2, CurrencyID, CurrencyRate, tblPIDetails.SNO, ItemID, GodownID, BranchID, NULL as CostCenterID, AltQty, AltUnitID, Qty, UnitID, AltStockQty, StockQty, isnull(FreeQty,0) as FreeQty, FreeUnitID, isnull(ConversionRatio,0) as ConversionRatio, Rate, tblPIDetails.BasicAmount, tblPIDetails.TermAmount, tblPIDetails.NetAmount, 'I' as types, 'PB' as source, null as ReferenceVoucher, null as ReferenceVoucherSource, 0 as IssueQty, (Case when StockValue is null then 0 else StockValue end) as StockValue
    from tblPIDetails 
    LEFT Outer Join (
        Select VoucherID, Sno, Sum(Case when Sign = '+' then Amount else -Amount End) as VoucherTerm 
        from tblPITerm, tblPITermMaster 
        where tblPITerm.TermID = tblPITermMaster.TermID and tblPITerm.TermType = 'BT' and StockValuation = 'Y' 
        Group by VoucherID, Sno
    ) as VTmp On tblPIDetails.VoucherID = VTmp.VoucherID and tblPIDetails.Sno = VTmp.Sno 
    LEFT Outer Join ( 
        Select Sum(TAmount) as StockValue, VoucherID, Sno 
        from( 
            select round(sum(pd.BasicAmount * pm.CurrencyRate),0) as TAmount, pd.VoucherID, pd.sno 
            from tblPIMaster pm, tblPIDetails pd 
            Where pm.VoucherID = pd.VoucherID 
            group by pd.VoucherID, pd.sno             
        ) as StValue group by VoucherID, Sno
    ) as StValue on tblPIDetails.VoucherID = StValue.VoucherID and tblPIDetails.Sno = StValue.Sno, tblPIMaster 
    Where tblPIDetails.VoucherID = tblPIMaster.VoucherID and tblPIMaster.VoucherID = @VoucherNo
`;

module.exports = {
    UpdateAccountTransactionfromPurchaseInvoice,
    UpdateInvTransactionfromPurchaseInvoice
};
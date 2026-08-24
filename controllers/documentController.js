const { getPool } = require('../db'); 
const mssql = require('mssql');

// 1. Fetch document numbering sequences
async function getDocumentNumbering(req, res) {
    try {
        const companyCode = req.headers['x-company-code'];
        const pool = await getPool(companyCode);

        const moduleName = req.query.module || 'SB';
        const userId = req.user ? req.user.userId : 1; 
        const branchId = parseInt(req.headers['branch-id'] || req.query.branchId || 0);

        let strSql = `
            SELECT DocumentID, DocumentName, StartDate, EndDate, DocumentMode, IsAuto, StartNo, EndNo, DocumentType, Prefix, BodyLength, CurrentNo,
            CASE 
                WHEN DocumentMode='C' THEN 'Alphanumeric' 
                WHEN DocumentMode='A' THEN 'Auto' 
                WHEN DocumentMode='N' THEN 'Numeric' 
            END AS [Type] 
            FROM tblVoucherSequences 
            WHERE (UserID IS NULL or UserID = @UserID) AND Module = @Module
        `;

        const request = pool.request()
            .input('UserID', mssql.Int, userId)
            .input('Module', mssql.VarChar, moduleName);

        if (branchId > 0) {
            strSql += ` AND DocumentType <> 'O'`;
            request.input('BranchID', mssql.Int, branchId);
        } else {
            strSql += ` AND (BranchID = @BranchID OR BranchID IS NULL)`;
            request.input('BranchID', mssql.Int, branchId);
        }

        const result = await request.query(strSql);
        res.status(200).json(result.recordset);
    } catch (error) {
        console.error("Error in getDocumentNumbering:", error);
        res.status(500).json({ error: error.message });
    }
}

// 2. Generate the next invoice number using Sales Invoice (SB) sequence and CurrentNo + 1
async function getNextInvoiceNumber(req, res) {
    try {
        const companyCode = req.headers['x-company-code'];
        const pool = await getPool(companyCode);

        const userId = req.user ? req.user.userId : 1;
        const branchId = parseInt(req.headers['branch-id'] || req.query.branchId || 0);
        const moduleType = req.query.module || 'SB'; // SB = Sales Invoice

        let seqQuery = `
            SELECT TOP 1 StartNo, EndNo, DocumentMode, IsAuto, DocumentName, Prefix, BodyLength, CurrentNo 
            FROM tblVoucherSequences 
            WHERE Module = @Module AND (UserID IS NULL OR UserID = @UserID)
        `;
        const reqSeq = pool.request()
            .input('UserID', mssql.Int, userId)
            .input('Module', mssql.VarChar, moduleType);

        if (branchId > 0) {
            seqQuery += ` AND (BranchID = @BranchID OR BranchID IS NULL) AND DocumentType <> 'O'`;
            reqSeq.input('BranchID', mssql.Int, branchId);
        }

        const seqResult = await reqSeq.query(seqQuery);
        console.log("🔍 Sales Invoice Sequence Result:", seqResult.recordset);

        let nextNumber = 1;
        let prefix = 'SI-';
        let bodyLength = 6;

        if (seqResult.recordset.length > 0) {
            const seq = seqResult.recordset[0];
            prefix = seq.Prefix || 'SI-';
            bodyLength = parseInt(seq.BodyLength) || 6;
            let currentNo = parseInt(seq.CurrentNo) || 0;

            // Increment CurrentNo by 1 as requested
            nextNumber = currentNo + 1;
        }

        // Format with prefix and zero padding (e.g., SI-001924)
        const paddedNumericPart = nextNumber.toString().padStart(bodyLength, '0');
        const finalInvoiceNumber = `${prefix}${paddedNumericPart}`;

        console.log("🚀 Sending Formatted Sales Invoice Number to Flutter:", finalInvoiceNumber);
        res.status(200).json({ nextInvoice: finalInvoiceNumber });
    } catch (error) {
        console.error("🔥 Error generating next invoice from sequence:", error);
        res.status(500).json({ error: error.message });
    }
}

module.exports = {
    getDocumentNumbering,
    getNextInvoiceNumber
};
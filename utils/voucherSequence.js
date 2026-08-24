const { sql } = require("../db");

/**
 * Returns the next voucher without incrementing the sequence.
 * Call incrementVoucherSequence() after the transaction succeeds.
 */
async function getNextVoucher(tx, module, branchId = null, documentName = null) {
    let query = `
        SELECT TOP 1
            DocumentID,
            Prefix,
            Suffix,
            BodyLength,
            CurrentNo,
            DocumentName
        FROM tblVoucherSequences
        WHERE Module = @module
    `;

    // Future branch support
    if (branchId != null) {
        query += ` AND (BranchID=@branchId OR BranchID IS NULL)`;
    }

    // Disambiguates when a module has more than one document type
    // (e.g. "POS Invoice" vs "Regular Sales Invoice" both under Module='SB')
    if (documentName != null) {
        query += ` AND DocumentName=@documentName`;
    }

    query += ` ORDER BY DocumentID`;

    const req = new sql.Request(tx);

    req.input("module", sql.NVarChar(10), module);

    if (branchId != null) {
        req.input("branchId", sql.Int, branchId);
    }

    if (documentName != null) {
        req.input("documentName", sql.NVarChar(250), documentName);
    }

    const result = await req.query(query);

    if (!result.recordset.length) {
        throw new Error(`Voucher sequence not found for module '${module}'.`);
    }

    const seq = result.recordset[0];

    const nextNo = Number(seq.CurrentNo) ;

    const voucherId =
        `${seq.Prefix || ""}` +
        `${String(nextNo).padStart(seq.BodyLength || 4, "0")}` +
        `${seq.Suffix || ""}`;

    return {
        documentId: seq.DocumentID,
        documentName: seq.DocumentName,
        voucherId,
        currentNo: seq.CurrentNo,
    };
}

async function getVoucherSequences(pool, module, branchId = null, userId = null) {
    const request = pool.request();
    request.input("module", sql.NVarChar(10), module);

    let query = `
        SELECT DocumentID, DocumentName, Prefix, Suffix, BodyLength, CurrentNo, DocumentMode,
        CASE 
            WHEN DocumentMode = 'C' THEN 'Alphanumeric' 
            WHEN DocumentMode = 'A' THEN 'Auto'  
            WHEN DocumentMode = 'N' THEN 'Numeric' 
        END AS [Type]
        FROM tblVoucherSequences
        WHERE Module = @module
    `;

    if (branchId != null) {
        request.input("branchId", sql.Int, branchId);
        query += ` AND (BranchID = @branchId OR BranchID IS NULL)`;
    }

    if (userId != null) {
        request.input("userId", sql.Int, userId);
        query += ` AND (UserID = @userId OR UserID IS NULL)`;
    }

    query += ` ORDER BY DocumentID`;

    const result = await request.query(query);
    return result.recordset;
}

/**
 * Advances the voucher sequence after successful commit work.
 */
async function incrementVoucherSequence(
    tx,
    documentId,
    documentName
) {
    await new sql.Request(tx)
        .input("documentId", sql.Int, documentId)
        .input("documentName", sql.NVarChar(250), documentName)
        .query(`
            UPDATE tblVoucherSequences
            SET CurrentNo = CurrentNo + 1
            WHERE DocumentID=@documentId
              AND DocumentName=@documentName
        `);
}

module.exports = {
    getNextVoucher,
    incrementVoucherSequence,
    getVoucherSequences,
};
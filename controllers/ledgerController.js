const sql = require('mssql'); 
const { getPool } = require('../db'); 

// 1. Fetch the next auto-generated sequence
exports.getNextLedgerCode = async (req, res) => {
    try {
        const { prefix } = req.query; 
        if (!prefix || prefix.length < 2) {
            return res.status(400).json({ message: "Valid 2-letter prefix required" });
        }

        const companyCode = req.headers['x-company-code'];
        const pool = await getPool(companyCode); 

        const result = await pool.request()
            .input('Prefix', sql.VarChar, prefix)
            .query(`
                SELECT TOP 1 (RIGHT(LedgerCode, 5) + 1) AS NextNum 
                FROM dbo.tblLedger 
                WHERE LEFT(LedgerCode, 2) = @Prefix 
                  AND LEN(LedgerCode) = 7 
                  AND ISNUMERIC(RIGHT(LedgerCode, 5)) = 1 
                ORDER BY (RIGHT(LedgerCode, 5) + 1) DESC
            `);

        let nextCode = `${prefix}00001`; // Default fallback 

        if (result.recordset.length > 0 && result.recordset[0].NextNum) {
            const nextNum = result.recordset[0].NextNum;
            nextCode = `${prefix}${String(nextNum).padStart(5, '0')}`;
        }

        res.status(200).json({ nextCode });
    } catch (error) {
        console.error("Error generating ledger code:", error);
        res.status(500).json({ message: "Failed to generate code" });
    }
};

// 2. Check if a Ledger Name already exists (for real-time UI validation)
exports.checkLedgerName = async (req, res) => {
    try {
        const { name } = req.query;
        if (!name) return res.status(400).json({ exists: false });

        const companyCode = req.headers['x-company-code'];
        const pool = await getPool(companyCode); 

        const result = await pool.request()
            .input('CheckName', sql.VarChar, name.trim())
            .query(`SELECT TOP 1 LedgerID FROM dbo.tblLedger WHERE LedgerName = @CheckName`);

        if (result.recordset.length > 0) {
            return res.status(200).json({ exists: true });
        }
        
        res.status(200).json({ exists: false });
    } catch (error) {
        console.error("Error checking ledger name:", error);
        res.status(500).json({ error: "Failed to verify name" });
    }
};

// 3. Safely Create Ledger (Using the Direct AccGrpID)
exports.createLedger = async (req, res) => {
    try {
        const { 
            ledgerName, ledgerCode, ledgerType, accGrpId, 
            panNo, cashBank, ledgerAddress, phoneNo, ledgerEmail 
        } = req.body;

        const companyCode = req.headers['x-company-code'];
        const pool = await getPool(companyCode);

        // Server-side safety check for duplicate names
        const checkResult = await pool.request()
            .input('CheckName', sql.VarChar, ledgerName.trim())
            .query(`SELECT LedgerID FROM dbo.tblLedger WHERE LedgerName = @CheckName`);

        if (checkResult.recordset.length > 0) {
            return res.status(400).json({ error: "A Ledger with this exact name already exists." });
        }

        const insertQuery = `
            DECLARE @LedgerID INT = (SELECT ISNULL(MAX(CAST(LedgerID AS INT)), 0) + 1 FROM dbo.tblLedger);
            
            INSERT INTO dbo.tblLedger (
                LedgerID, LedgerName, LedgerCode, LedgerType, AccGrpID, 
                PanNo, CashBank, LedgerAddress, PhoneNo, LedgerEmail,
                CashBook, SubLedger, Adjustment, LedgerLock
            ) VALUES (
                @LedgerID, @LedgerName, @LedgerCode, @LedgerType, @AccGrpID,
                @PanNo, @CashBank, @LedgerAddress, @PhoneNo, @LedgerEmail,
                'N', 'N', 'N', 'N' 
            );
        `;

        await pool.request()
            .input('LedgerName', sql.VarChar, ledgerName || '')
            .input('LedgerCode', sql.VarChar, ledgerCode || '')
            .input('LedgerType', sql.VarChar, ledgerType || 'OT')
            .input('AccGrpID', sql.Int, accGrpId) 
            .input('PanNo', sql.VarChar, panNo || '')
            .input('CashBank', sql.VarChar, cashBank || 'N')
            .input('LedgerAddress', sql.VarChar, ledgerAddress || '')
            .input('PhoneNo', sql.VarChar, phoneNo || '')
            .input('LedgerEmail', sql.VarChar, ledgerEmail || '')
            .query(insertQuery);

        res.status(201).json({ message: "Ledger Created Successfully" });
    } catch (error) {
        console.error("Error creating ledger:", error);
        res.status(500).json({ error: error.message });
    }
};

// 4. Fetch Account Groups
exports.getAccountGroups = async (req, res) => {
    try {
        const companyCode = req.headers['x-company-code'];
        const pool = await getPool(companyCode); 

        const result = await pool.request().query(`
            SELECT AccGrpID, AccName 
            FROM dbo.tblAccGroup 
            ORDER BY AccName ASC
        `);

        res.status(200).json(result.recordset);
    } catch (error) {
        console.error("Error fetching account groups:", error);
        res.status(500).json({ error: "Failed to fetch account groups" });
    }
};


// --- NEW CHANGE START: ADDED FUNCTION FOR POS CUSTOMER SELECTION ---

// 5. Fetch all Ledgers (Customers) for the POS Dropdown
exports.getLedgers = async (req, res) => {
    try {
        const companyCode = req.headers['x-company-code'];
        const pool = await getPool(companyCode);
        
        const result = await pool.request().query(`
            SELECT LedgerID, LedgerName, LedgerCode, LedgerType, LedgerAddress, MobileNo 
            FROM dbo.tblLedger 
            WHERE LedgerType IN ('CU', 'BO')
            ORDER BY LedgerName ASC
        `);
        
        res.status(200).json(result.recordset);
    } catch (error) {
        console.error("DETAILED SQL ERROR in getLedgers:", error); // <-- Check your Node console for this
        res.status(500).json({ error: error.message });
    }
};

// Fetch all active ledgers for voucher line items
exports.getVoucherLedgers = async (req, res) => {
    try {
        const companyCode = req.headers['x-company-code'];
        const pool = await getPool(companyCode);
        if (!pool) return res.status(500).json({ error: "Database unavailable." });

        const result = await pool.request().query(`
            SELECT * FROM dbo.tblLedger 
            ORDER BY LedgerName ASC
        `);
        
        res.status(200).json(result.recordset);
    } catch (error) {
        console.error("Error fetching voucher ledgers:", error);
        res.status(500).json({ error: error.message });
    }
};

// --- NEW CHANGE END ---

// =====================================================================
// Add this into ledgerController.js, alongside the other exports.
// Same pattern as the rest of the file: sql/getPool from mssql + ../db,
// company resolved from the x-company-code header.
//
// Rather than guessing the stored proc's internal @parameter names, this
// calls it positionally — same order as the legacy C# EXEC string — but
// through bound parameters instead of string concatenation, so it's not
// vulnerable the way the old
//   sm = "Exec ... '" + fromdate + "','" + todate + "'..."
// building was.
// =====================================================================

// Ledger statement report (sp_SMLedgerReports / sp_SMLedgerCashSalesReports)
exports.getLedgerReport = async (req, res) => {
    try {
        console.log("➡️ Starting ledger report generation..."); // <-- ADD THIS
        
        const { fromDate, toDate, ledgerType, glCodes, agentCode, areaCode, productDetails, remarks, chkMiti, cashSales } = req.body;

        const companyCode = req.headers['x-company-code'];
        console.log(`⏳ Requesting DB pool for company: ${companyCode}...`); // <-- ADD THIS
        const pool = await getPool(companyCode);
        console.log(`✅ DB Pool acquired! Building SQL request...`); // <-- ADD THIS

        const request = pool.request()
            .input('FromDate', sql.Date, new Date(fromDate))
            .input('ToDate', sql.Date, new Date(toDate))
            .input('ColDataGL', sql.VarChar(sql.MAX), glCodes || '')
            .input('AgentCode', sql.VarChar, agentCode || '')
            .input('AreaCode', sql.VarChar, areaCode || '')
            .input('ProductDetails', sql.Int, productDetails ? 1 : 0)
            .input('Remarks', sql.Int, remarks ? 1 : 0)
            .input('ChkMiti', sql.Int, chkMiti ? 1 : 0);

        let result;
        if (cashSales) {
            console.log("⏳ Executing sp_SMLedgerCashSalesReports..."); // <-- ADD THIS
            result = await request.query(`
                EXEC sp_SMLedgerCashSalesReports 
                    @FromDate, @ToDate, NULL, @ColDataGL, NULL, 
                    @AgentCode, @AreaCode, @ProductDetails, @Remarks, @ChkMiti
            `);
        } else {
            request.input('LedgerType', sql.Int, ledgerType ?? null);
            console.log(`⏳ Executing sp_SMLedgerReports (LedgerType: ${ledgerType ?? 'NULL'})...`); // <-- ADD THIS
            result = await request.query(`
                EXEC sp_SMLedgerReports 
                    @FromDate, @ToDate, @LedgerType, @ColDataGL, NULL, 
                    @AgentCode, @AreaCode, @ProductDetails, @Remarks, @ChkMiti
            `);
        }

        console.log(`✅ Query finished! Returning ${result.recordset.length} rows.`); // <-- ADD THIS
        res.status(200).json(result.recordset);
    } catch (error) {
        console.error("❌ Error fetching ledger report:", error);
        res.status(500).json({ error: error.message });
    }
};

// Fetch Master List of all Ledgers
exports.getAllLedgers = async (req, res) => {
    try {
        const companyCode = req.headers['x-company-code'];
        const pool = await getPool(companyCode);

        // NOTE: Verify that "LedgerMaster" is the correct table name in your database.
        // It might also be called "AccountMaster" or "GLMaster".
        const result = await pool.request().query(`
            SELECT 
                LedgerName AS description, 
                LedgerCode AS shortName 
            FROM tblledger
            ORDER BY LedgerName
        `);

        res.status(200).json(result.recordset);
    } catch (error) {
        console.error("Error fetching ledgers master list:", error);
        res.status(500).json({ error: error.message });
    }
};
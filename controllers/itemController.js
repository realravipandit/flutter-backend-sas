const sql = require('mssql');
const { getPool } = require('../db');

// 1. Fetch all items for the Data Table/List
exports.getItems = async (req, res) => {
    try {
        const companyCode = req.headers['x-company-code'];
        const pool = await getPool(companyCode);
        const result = await pool.request().query('SELECT * FROM dbo.tblItems ORDER BY ItemID DESC');
        res.status(200).json(result.recordset);
    } catch (error) {
        console.error("Error fetching items:", error);
        res.status(500).json({ error: error.message });
    }
};

// 2. Fetch all units for dropdown selection from tblItemsUnit
exports.getUnits = async (req, res) => {
    try {
        const companyCode = req.headers['x-company-code'];
        const pool = await getPool(companyCode);
        const result = await pool.request().query('SELECT UnitID, UnitCode FROM dbo.tblItemsUnit ORDER BY UnitCode ASC');
        res.status(200).json(result.recordset);
    } catch (error) {
        console.error("Error fetching units:", error);
        res.status(500).json({ error: error.message });
    }
};

// 3. Generate next item code based on 2-letter prefix
exports.getNextItemCode = async (req, res) => {
    try {
        const companyCode = req.headers['x-company-code'];
        const prefix = req.query.prefix;

        if (!prefix || prefix.length < 2) {
            return res.status(400).json({ error: "Prefix of 2 letters required" });
        }

        const cleanPrefix = prefix.substring(0, 2);
        const pool = await getPool(companyCode);

        const result = await pool.request()
            .input('Prefix', sql.VarChar, cleanPrefix + '%')
            .query("SELECT ItemCode FROM dbo.tblItems WHERE ItemCode LIKE @Prefix");

        let maxNumeric = 0;

        if (result.recordset.length > 0) {
            for (let row of result.recordset) {
                if (row.ItemCode) {
                    const numericPart = parseInt(row.ItemCode.replace(/[^0-9]/g, ''), 10);
                    if (!isNaN(numericPart) && numericPart > maxNumeric) {
                        maxNumeric = numericPart;
                    }
                }
            }
        }

        const nextNumeric = maxNumeric + 1;
        const nextCode = cleanPrefix + String(nextNumeric).padStart(5, '0');

        res.status(200).json({ nextCode });
    } catch (error) {
        console.error("Error generating item code:", error);
        res.status(500).json({ message: "Failed to generate item code" });
    }
};

// 4. The Master Insert Transaction
exports.createItem = async (req, res) => {
    let pool;
    let transaction;

    try {
        const {
            itemName, itemCode, itemType, itemsSKU, hssCode,
            groupName, subGroupName, unitId, altUnitId, valuationTech,
            ConversionRatio, Factor,
            buyRate, salesRate, mrp, tradePrice, mrRate,
            vatStatus, vatRate, mfgDate, expiryDate, itemLock, batchItem
        } = req.body;

        const companyCode = req.headers['x-company-code'];
        pool = await getPool(companyCode);

        const checkDuplicate = await pool.request()
            .input('ItemName', sql.VarChar, itemName || '')
            .query('SELECT TOP 1 ItemID FROM dbo.tblItems WHERE ItemName = @ItemName');

        if (checkDuplicate.recordset.length > 0) {
            return res.status(400).json({ error: "An item with this exact name already exists." });
        }

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const request = new sql.Request(transaction);

        const finalItemRate = (vatStatus === 'Yes') ? (vatRate || 13.00) : 0.0000;

        const insertMasterQuery = `
            DECLARE @ItemID INT = ISNULL((SELECT TOP 1 MAX(CAST(ItemID AS INT)) FROM dbo.tblItems), 0) + 1;

            INSERT INTO dbo.tblItems (
                ItemID, ItemName, ItemCode, ItemType, ItemsSKU, HSSCode,
                GroupID, SubGroupID, UnitID, ValuationTech, AltUnitID,
                ConversionRatio, Factor,
                BuyRate, SalesRate, MRP, TradePrice, MRRate, ItemRate,
                ItemLock, BatchItem, MfgDate, ExpiryDate
            ) VALUES (
                @ItemID, @ItemName, @ItemCode, @ItemType, @ItemsSKU, @HSSCode,
                (SELECT TOP 1 ItemGrpID FROM dbo.tblItemsGroup WHERE GrpName = @GroupName),
                (SELECT TOP 1 ItemSubGrpID FROM dbo.tblItemsSubGroup WHERE SubGrpName = @SubGroupName),
                @UnitId,
                @ValuationTech,
                @AltUnitId,
                @ConversionRatio,
                @Factor,
                @BuyRate, @SalesRate, @MRP, @TradePrice, @MRRate, @ItemRate,
                @ItemLock, @BatchItem, @MfgDate, @ExpiryDate
            );

            SELECT @ItemID AS InsertedItemID;
        `;

        const masterResult = await request
            .input('ItemName', sql.VarChar(255), itemName || '')
            .input('ItemCode', sql.VarChar(50), itemCode || '')
            .input('ItemType', sql.VarChar(10), itemType || 'PO')
            .input('ItemsSKU', sql.VarChar(50), itemsSKU || '')
            .input('HSSCode', sql.VarChar(50), hssCode || '')
            .input('GroupName', sql.VarChar(100), groupName || '')
            .input('SubGroupName', sql.VarChar(100), subGroupName || '')
            .input('UnitId', sql.Int, unitId)
            .input('AltUnitId', sql.Int, altUnitId || null)
            .input('ValuationTech', sql.VarChar(10), valuationTech || 'F')
            .input('ConversionRatio', sql.Decimal(18, 4), ConversionRatio || 0.0000)
            .input('Factor', sql.Decimal(18, 4), Factor || 0.0000)
            .input('BuyRate', sql.Decimal(18, 4), buyRate || 0.0000)
            .input('SalesRate', sql.Decimal(18, 4), salesRate || 0.0000)
            .input('MRP', sql.Decimal(18, 4), mrp || 0.0000)
            .input('TradePrice', sql.Decimal(18, 4), tradePrice || 0.0000)
            .input('MRRate', sql.Decimal(18, 4), mrRate || 0.0000)
            .input('ItemRate', sql.Decimal(18, 4), finalItemRate)
            .input('ItemLock', sql.VarChar(5), itemLock || 'N')
            .input('BatchItem', sql.VarChar(5), batchItem || 'N')
            .input('MfgDate', sql.Date, mfgDate || null)
            .input('ExpiryDate', sql.Date, expiryDate || null)
            .query(insertMasterQuery);

        const newItemID = masterResult.recordset[0].InsertedItemID;

        await transaction.commit();
        res.status(201).json({ message: "Item Master Created Successfully", itemId: newItemID });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error("Error creating item:", error);
        res.status(500).json({ error: error.message });
    }
};

// 5. Fetch all Item Groups
exports.getItemGroups = async (req, res) => {
    try {
        const companyCode = req.headers['x-company-code'];
        const pool = await getPool(companyCode);
        const result = await pool.request()
            .query('SELECT ItemGrpID, GrpName, GrpCode FROM tblItemsGroup ORDER BY GrpName ASC');
        res.json(result.recordset);
    } catch (err) {
        console.error("Error fetching groups:", err);
        res.status(500).json({ error: err.message });
    }
};

// 6. Fetch Sub Groups for a given Group
exports.getItemSubGroups = async (req, res) => {
    try {
        const companyCode = req.headers['x-company-code'];
        const pool = await getPool(companyCode);
        const result = await pool.request()
            .input('ItemGrpID', sql.Int, req.params.groupId)
            .query('SELECT ItemSubGrpID, SubGrpName FROM tblItemsSubGroup WHERE ItemGrpID = @ItemGrpID ORDER BY SubGrpName ASC');
        res.json(result.recordset);
    } catch (err) {
        console.error("Error fetching sub groups:", err);
        res.status(500).json({ error: err.message });
    }
};

// 7. Search items by name — powers the "Item Name (Live Search)" autocomplete
exports.searchItemNames = async (req, res) => {
    try {
        const companyCode = req.headers['x-company-code'];
        const query = (req.query.q || '').trim();

        if (query.length < 1) {
            return res.status(200).json([]);
        }

        const pool = await getPool(companyCode);
        const result = await pool.request()
            .input('Query', sql.VarChar(255), `%${query}%`)
            .query(`
                SELECT TOP 15 ItemID, ItemName, ItemCode
                FROM dbo.tblItems
                WHERE ItemName LIKE @Query
                ORDER BY ItemName ASC
            `);
        res.status(200).json(result.recordset);
    } catch (error) {
        console.error("Error searching item names:", error);
        res.status(500).json({ error: error.message });
    }
};
const express = require("express");
const router = express.Router();
const { getCentralPool, sql } = require("../db");
const jwt = require("jsonwebtoken");
const { decryptLegacyBuffer } = require("../utils/legacyCipher"); 

router.post("/login", async (req, res) => {
  const { username, password, centralDatabase } = req.body;

  try {
    const targetDb = centralDatabase && centralDatabase.trim() !== ''
      ? centralDatabase.trim()
      : 'SmAkountMaster';

    const pool = await getCentralPool(targetDb);
    if (!pool) {
      return res.status(503).json({ error: "Database unavailable" });
    }

    const result = await pool.request()
      .input('username', sql.VarChar, username)
      .query(`
        SELECT 
          UserID, 
          UserCode, 
          UserName, 
          UserType, 
          CAST(UserPassword AS VARBINARY(MAX)) AS UserPasswordBytes
        FROM tblUser 
        WHERE UserCode = @username
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result.recordset[0];
    const storedBytes = user.UserPasswordBytes;
    
    let validPassword = false;

    // STRICT PURE LEGACY VALIDATION ONLY
    try {
      const decodedRaw = decryptLegacyBuffer(storedBytes);
      const decoded = decodedRaw.replace(/[^\x20-\x7E]/g, '');
      validPassword = (decoded === password);
    } catch (decodeError) {
      validPassword = false;
    }

    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const jwtSecret = process.env.JWT_SECRET || "temporary_fallback_secret_key_12345";
    const accessToken = jwt.sign(
      {
        userId: user.UserID,
        username: user.UserName,
        role: user.UserType,
        centralDatabase: targetDb
      },
      jwtSecret,
      { expiresIn: '8h' }
    );

    res.json({ accessToken });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
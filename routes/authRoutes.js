const express = require("express");
const router = express.Router();
const { getCentralPool, sql } = require("../db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { isBcryptHash, decryptLegacyBuffer } = require("../utils/legacyCipher");

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

    // CAST to VARBINARY to retrieve exact byte values without charset corruption
    const result = await pool.request()
      .input('username', sql.VarChar, username)
      .query(`
        SELECT 
          UserID, 
          UserCode, 
          UserName, 
          UserType, 
          UserPassword,
          CAST(UserPassword AS VARBINARY(MAX)) AS UserPasswordBytes
        FROM tblUser 
        WHERE UserName = @username
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result.recordset[0];
    const stored = user.UserPassword || '';
    const storedBytes = user.UserPasswordBytes;

    let validPassword = false;

    // 1. Check if already migrated to Bcrypt
    if (isBcryptHash(stored)) {
      validPassword = await bcrypt.compare(password, stored);
    } else {
      // 2. Decode raw bytes with legacy byte-inversion
      try {
        const decoded = decryptLegacyBuffer(storedBytes);
        validPassword = (decoded === password);

        // 3. Lazy migration on successful match
        if (validPassword) {
          const newHash = await bcrypt.hash(password, 10);
          await pool.request()
            .input('userId', sql.Int, user.UserID)
            .input('newHash', sql.VarChar, newHash)
            .query(`
              UPDATE tblUser 
              SET UserPassword = @newHash 
              WHERE UserID = @userId
            `);
          console.log(`✅ Successfully migrated password for user: ${username}`);
        }
      } catch (decodeError) {
        console.error(`⚠️ Failed to decode legacy password for ${username}:`, decodeError.message);
        validPassword = false;
      }
    }

    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const accessToken = jwt.sign(
      {
        userId: user.UserID,
        username: user.UserName,
        role: user.UserType,
        centralDatabase: targetDb
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ accessToken });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
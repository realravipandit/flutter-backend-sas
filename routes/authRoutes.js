const express = require("express");
const router = express.Router();
const { getCentralPool, sql } = require("../db"); // 👉 Swapped poolPromise for getCentralPool
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt"); // Kept for future use!

router.post("/login", async (req, res) => {
  console.log("🔍 REQUEST BODY RECEIVED:", req.body); // <--- ADD THIS
  
  const { username, password, centralDatabase } = req.body;
  
  try {
    const targetDb = centralDatabase && centralDatabase.trim() !== '' 
      ? centralDatabase.trim() 
      : 'SmAkountMaster';

    console.log("🔍 TARGET DB SELECTED:", targetDb); // <--- ADD THIS

    const pool = await getCentralPool(targetDb);
    if (!pool) {
      console.log("❌ Pool creation failed.");
      return res.status(503).json({ error: "Database unavailable" });
    }
    
    const result = await pool.request()
      .input('username', sql.VarChar, username)
      .query(`
        SELECT UserID, UserCode, UserName, UserType, UserPassword 
        FROM tblUser 
        WHERE UserName = @username
      `);
    
    console.log("🔍 USER QUERY RESULT COUNT:", result.recordset.length); // <--- ADD THIS

    if (result.recordset.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    
    const user = result.recordset[0];
    const validPassword = (password === user.UserPassword); 
    
    if (!validPassword) {
      console.log("❌ Password mismatch for user:", username); // <--- ADD THIS
      return res.status(401).json({ error: "Invalid credentials" });
    }
    
    // ... rest of your code
    
    // 🌟 CRITICAL: Embed centralDatabase inside the JWT Token payload!
    // This ensures subsequent requests (like fetching companies) remember the user's database choice.
    const accessToken = jwt.sign(
      { 
        userId: user.UserID, 
        username: user.UserName,
        role: user.UserType,
        centralDatabase: targetDb // <--- Saved in token context
      },
      process.env.JWT_SECRET || "your_fallback_super_secret_key_123",
      { expiresIn: '8h' }
    );
    
    res.json({ accessToken });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
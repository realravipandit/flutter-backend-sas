const { getCentralPool, sql } = require("../db");

const getCompanies = async (req, res) => {
  try {
    // 1. Extract userId and centralDatabase from the verified JWT token (req.user)
    const userId = req.user && req.user.userId;
    const centralDatabase = req.user && req.user.centralDatabase 
      ? req.user.centralDatabase 
      : 'SmAkountMaster'; // Default fallback

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized: User ID missing from token." });
    }

    // 2. Get the correct dynamic central database pool (SASBillingMaster or SmAkountMaster)
    const pool = await getCentralPool(centralDatabase);
    if (!pool) {
      return res.status(503).json({ error: "Database unavailable" });
    }

    // 3. Query only the companies mapped to this UserID via tblCompanyRights
    const result = await pool.request()
      .input('userId', sql.Int, userId)
      .query(`
        SELECT c.CompanyID, c.CompanyCode, c.CompanyName 
        FROM tblCompanyMaster c
        JOIN tblCompanyRights cr ON c.CompanyID = cr.CompanyID
        WHERE cr.UserID = @userId
      `);

    res.json(result.recordset);
  } catch (error) {
    console.error("Error fetching authorized companies:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  getCompanies,
};
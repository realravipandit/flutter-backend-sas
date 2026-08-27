const { getCentralPool, getPool, sql } = require("../db");

// 1. Get all companies assigned to the user
const getCompanies = async (req, res) => {
  try {
    const userId = req.user && req.user.userId;
    const centralDatabase = req.user && req.user.centralDatabase ? req.user.centralDatabase : "SmAkountMaster";
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const pool = await getCentralPool(centralDatabase);
    const result = await pool.request().input("userId", sql.Int, userId).query(`
        SELECT c.CompanyID, c.CompanyCode, c.CompanyName
        FROM tblCompanyMaster c
        JOIN tblCompanyRights cr ON c.CompanyID = cr.CompanyID
        WHERE cr.UserID = @userId
      `);
    res.json(result.recordset);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

// 2. Get Active Company Profile
const getActiveCompanyProfile = async (req, res) => {
  try {
    // 👇 ADDED 'x-company-code' to catch exactly what your Flutter app is sending!
    const dbName = req.headers['x-company-code'] || req.user?.companyCode || req.user?.database || req.headers['companycode'] || req.headers['database'] || req.headers['x-database'];

    if (!dbName) {
      console.log("Headers received:", req.headers); 
      return res.status(400).json({ error: "Cannot find database name in headers or token." });
    }

    // Connect directly to this specific company's database (e.g., 'DEMO')
    const pool = await getPool(dbName); 

    if (!pool) {
      return res.status(503).json({ error: `Database connection failed for: ${dbName}` });
    }

    // Fetch details directly from tblCompany
    const result = await pool.request().query(`SELECT TOP 1 * FROM tblCompany`);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Company profile not found in tblCompany." });
    }

    // Send the data back to Flutter
    res.json(result.recordset[0]);
  } catch (error) {
    console.error("Error fetching company profile:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  getCompanies,
  getActiveCompanyProfile,
};
const sql = require('mssql');
require('dotenv').config();

const baseConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

// ============================================================
// 0. SQL SERVER CONNECTION TEST
//    Tests SQL Server connectivity WITHOUT selecting a database
// ============================================================
const testSqlServerConnection = async () => {
  let pool;

  try {
    console.log('🔄 Testing SQL Server connection...');

    const config = {
      ...baseConfig
    };

    // No database is specified here.
    // This tests the SQL Server instance itself.
    pool = await new sql.ConnectionPool(config).connect();

    console.log('==========================================');
    console.log('✅ SQL SERVER CONNECTION ESTABLISHED');
    console.log(`🖥️ Server: ${process.env.DB_SERVER}`);
    console.log('==========================================');

    return true;

  } catch (err) {
    console.error('==========================================');
    console.error('❌ SQL SERVER CONNECTION FAILED');
    console.error(`🖥️ Server: ${process.env.DB_SERVER}`);
    console.error('Error:', err.message);
    console.error('==========================================');

    return false;

  } finally {
    // Close only the temporary test connection.
    // This does NOT affect your existing pools.
    if (pool) {
      try {
        await pool.close();
      } catch (closeErr) {
        console.error('⚠️ Error closing SQL test connection:', closeErr.message);
      }
    }
  }
};


// ============================================================
// 1. DYNAMIC CENTRAL DATABASE POOL CACHE
//    Supports both SASBillingMaster & SmAkountMaster
// ============================================================
const centralPools = {};

const getCentralPool = async (dbName) => {
  // Default fallback if nothing is passed
  const targetDb =
    dbName && dbName.trim() !== ''
      ? dbName.trim()
      : 'SmAkountMaster';

  if (centralPools[targetDb]) {
    return centralPools[targetDb];
  }

  try {
    const config = {
      ...baseConfig,
      database: targetDb
    };

    const pool = new sql.ConnectionPool(config);

    centralPools[targetDb] = await pool.connect();

    console.log(
      `✅ Connected to Central Database: [${targetDb}]`
    );

    return centralPools[targetDb];

  } catch (err) {
    console.error(
      `❌ Central Database connection failed for [${targetDb}]:`,
      err.message
    );

    throw err;
  }
};


// ============================================================
// 2. DYNAMIC COMPANY DATABASE POOLS CACHE
// ============================================================
const pools = {};

const getPool = async (companyCode) => {
  if (!companyCode) {
    throw new Error(
      "Company code is missing from request headers."
    );
  }

  const dbName = companyCode.trim();

  if (pools[dbName]) {
    return pools[dbName];
  }

  try {
    const config = {
      ...baseConfig,
      database: dbName
    };

    const pool = new sql.ConnectionPool(config);

    pools[dbName] = await pool.connect();

    console.log(
      `✅ Connected to Company Database: [${dbName}]`
    );

    return pools[dbName];

  } catch (err) {
    console.error(
      `❌ Company Database connection failed for [${dbName}]:`,
      err.message
    );

    throw err;
  }
};


// ============================================================
// 3. EXPORTS
// ============================================================
module.exports = {
  getCentralPool,
  getPool,
  testSqlServerConnection,
  sql
};

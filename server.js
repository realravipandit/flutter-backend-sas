console.log("🔥🔥🔥 NEW SERVER.JS FILE IS RUNNING 🔥🔥🔥");

require("dotenv").config();

const express = require("express");
const cors = require("cors");

// Security & performance
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");

// SQL Server
const sql = require("mssql");

// Import modularized components
const apiRoutes = require("./routes");
const requestLogger = require("./middlewares/logger");

const app = express();
const PORT = process.env.PORT || 5000;

// ============================================================
// 1. GLOBAL MIDDLEWARE
// ============================================================

app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(requestLogger);

// ============================================================
// 2. RATE LIMITING
// ============================================================

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: {
    error: "Too many requests from this IP, please try again later."
  }
});

app.use("/api", apiLimiter);

// ============================================================
// 3. HEALTH CHECK
// ============================================================

app.get("/", (req, res) => {
  res.status(200).json({
    status: "success",
    message: "SaaS POS API is running smoothly 🚀"
  });
});

// ============================================================
// 4. MOUNT API ROUTES
// ============================================================

app.use("/api", apiRoutes);

// ============================================================
// 5. GLOBAL ERROR HANDLERS
// ============================================================

app.use((req, res, next) => {
  res.status(404).json({
    error: `Route ${req.originalUrl} not found`
  });
});

app.use((err, req, res, next) => {
  console.error("🔥 Fatal Server Error:", err.stack);

  res.status(500).json({
    error: "Internal Server Error",
    message: err.message
  });
});

// ============================================================
// 6. SQL SERVER CONNECTION TEST
// ============================================================

const testSqlServerConnection = async () => {
  let pool;

  try {
    console.log("🔄 Testing SQL Server connection...");

    const config = {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      server: process.env.DB_SERVER,

      options: {
        encrypt: false,
        trustServerCertificate: true
      }
    };

    console.log(`🖥️ SQL Server: ${process.env.DB_SERVER}`);
    console.log(`👤 SQL User: ${process.env.DB_USER}`);

    pool = await sql.connect(config);

    console.log("==========================================");
    console.log("✅ SQL SERVER CONNECTION ESTABLISHED");
    console.log("==========================================");

    return true;

  } catch (err) {

    console.error("==========================================");
    console.error("❌ SQL SERVER CONNECTION FAILED");
    console.error("==========================================");
    console.error("Error:", err.message);
    console.error("==========================================");

    return false;

  } finally {

    if (pool) {
      try {
        await pool.close();
      } catch (err) {
        console.error(
          "⚠️ Error closing SQL Server test connection:",
          err.message
        );
      }
    }
  }
};

// ============================================================
// 7. START SERVER
// ============================================================

const startServer = async () => {

  console.log("==========================================");
  console.log("🚀 Starting SaaS POS Backend...");
  console.log("==========================================");

  await testSqlServerConnection();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running at http://0.0.0.0:${PORT}`);
  });
};

startServer();

require("dotenv").config();
const express = require("express");
const cors = require("cors");

// 👉 The 3 new optimization packages
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");

// Import modularized components
const apiRoutes = require("./routes"); 
const requestLogger = require("./middlewares/logger"); 

const app = express();
const PORT = process.env.PORT || 5000;

// --- 1. GLOBAL MIDDLEWARE (Security & Performance) ---
app.use(helmet()); // Locks down HTTP headers
app.use(compression()); // Shrinks JSON data for faster Flutter loading
app.use(cors());
app.use(express.json());
app.use(requestLogger);

// --- 2. RATE LIMITING ---
// Protects your API: Limits each IP to 200 requests every 15 minutes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 200, 
  message: { error: "Too many requests from this IP, please try again later." }
});
app.use("/api", apiLimiter); 

// --- 3. HEALTH CHECK ---
app.get("/", (req, res) => {
  res.status(200).json({ 
    status: "success", 
    message: "SaaS POS API is running smoothly 🚀" 
  });
});

// --- 4. MOUNT API ROUTES ---
app.use("/api", apiRoutes);

// --- 5. GLOBAL ERROR HANDLERS ---
app.use((req, res, next) => {
  res.status(404).json({ error: `Route ${req.originalUrl} not found` });
});

app.use((err, req, res, next) => {
  console.error("🔥 Fatal Server Error:", err.stack);
  res.status(500).json({ 
    error: "Internal Server Error", 
    message: err.message 
  });
});

// --- 6. START SERVER ---
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running at http://0.0.0.0:${PORT}`);
});
const jwt = require("jsonwebtoken");

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    console.log('❌ Auth Failed: No token provided');
    return res.status(401).json({ error: "Access denied. No token provided." });
  }
  
  const secret = process.env.JWT_SECRET || "your_fallback_super_secret_key_123";
  
  jwt.verify(token, secret, (err, user) => {
    if (err) {
      console.log('❌ JWT Verification Error:', err.message);
      return res.status(403).json({ error: "Invalid or expired token." });
    }
    
    req.user = user;
    next();
  });
};

module.exports = authenticateToken;
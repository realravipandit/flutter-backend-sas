const requestLogger = (req, res, next) => {
  console.log(`📥 INCOMING REQUEST: ${req.method} ${req.url}`);
  console.log('Headers received:', req.headers);
  next();
};

module.exports = requestLogger;
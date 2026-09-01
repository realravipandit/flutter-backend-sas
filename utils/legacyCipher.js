function isBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]\$/.test(value);
}

// Decodes directly from SQL Server's raw byte buffer
function decryptLegacyBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return '';
  let out = '';
  for (let i = 0; i < buffer.length; i++) {
    const charCode = (249 - buffer[i]) & 0xFF;
    out += String.fromCharCode(charCode);
  }
  return out;
}

module.exports = { isBcryptHash, decryptLegacyBuffer };
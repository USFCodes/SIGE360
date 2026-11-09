const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string') return false;
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, key] = parts;
  if (!/^[a-f0-9]{32}$/i.test(salt)) return false;
  if (!/^[a-f0-9]{128}$/i.test(key)) return false;
  const expectedHash = Buffer.from(key, 'hex');
  const actualHash = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

function generateSessionToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto
    .createHash('sha256')
    .update(rawToken)
    .digest('hex');
  return { rawToken, tokenHash };
}

function hashSessionToken(token) {
  return crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken
};
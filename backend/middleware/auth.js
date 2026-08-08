// Minimal JWT auth. One admin account, configured via env vars.
// Good enough to stop random people from hitting your control
// endpoints; swap for a real user collection + bcrypt if you need
// multiple accounts.

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';

function login(email, password) {
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    return jwt.sign({ email }, JWT_SECRET, { expiresIn: '12h' });
  }
  return null;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing auth token' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'invalid or expired token' });
  }
}

module.exports = { login, requireAuth };

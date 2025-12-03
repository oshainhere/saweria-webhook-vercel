// api/webhook.js
const crypto = require('crypto');
const { URL } = require('url');

// In-memory storage (development). Use DB / Vercel KV for production.
global.donations ||= [];
global.topDonators ||= {};
global.donationIndex ||= new Set();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function parseQuery(urlString) {
  try {
    const u = new URL(urlString, 'http://localhost');
    const obj = {};
    for (const [k, v] of u.searchParams.entries()) obj[k] = v;
    return obj;
  } catch {
    return {};
  }
}

// read raw body buffer (works in Vercel serverless)
async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = [];
    req.on('data', chunk => data.push(chunk));
    req.on('end', () => resolve(Buffer.concat(data)));
    req.on('error', err => reject(err));
  });
}

// timing-safe hex compare
function safeEqualHex(aHex, bHex) {
  try {
    const a = Buffer.from(aHex, 'hex');
    const b = Buffer.from(bHex, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

module.exports = async (req, res) => {
  // Basic CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-saweria-sig, x-saweria-signature, x-signature');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = (req.url || '/').split('?')[0];
  try {
    // ------------------ WEBHOOK ------------------
    if (req.method === 'POST' && path === '/api/webhook') {
      log('📨 Incoming webhook');

      // read raw body
      const rawBuf = await readRawBody(req);
      const rawBodyStr = rawBuf.toString('utf8');

      // parse content-type
      let body = {};
      const contentType = (req.headers['content-type'] || '').split(';')[0].trim();
      if (!rawBodyStr) {
        body = {};
      } else if (contentType === 'application/json' || contentType === 'text/json' || contentType === '') {
        try { body = JSON.parse(rawBodyStr); } catch (e) {
          log('⚠️ Invalid JSON body');
          return res.status(400).json({ success: false, error: 'Invalid JSON' });
        }
      } else if (contentType === 'application/x-www-form-urlencoded') {
        const params = new URLSearchParams(rawBodyStr);
        body = Object.fromEntries(params.entries());
      } else {
        try { body = JSON.parse(rawBodyStr); } catch { body = {}; }
      }

      // Signature verification (if SAWERIA_SECRET set)
      const SAWERIA_SECRET = process.env.SAWERIA_SECRET || '';
      const headerSig = req.headers['x-saweria-sig'] || req.headers['x-saweria-signature'] || req.headers['x-signature'] || '';
      if (SAWERIA_SECRET && SAWERIA_SECRET.length > 0) {
        const computed = crypto.createHmac('sha256', SAWERIA_SECRET).update(rawBodyStr).digest('hex');
        if (!headerSig || !safeEqualHex(headerSig, computed)) {
          log('❌ Signature mismatch', { headerSig, computed });
          return res.status(401).json({ success: false, error: 'Invalid signature' });
        }
        log('✅ Signature verified');
      } else {
        log('⚠️ SAWERIA_SECRET not set - skipping signature verification');
      }

      // Optional: only accept paid events
      const paymentStatus = body.payment_status || body.status || body.transaction_status || '';
      if (paymentStatus && String(paymentStatus).toUpperCase() !== 'PAID') {
        log('ℹ️ Ignored event (not PAID):', paymentStatus);
        return res.status(200).json({ success: true, ignored: true, payment_status: paymentStatus });
      }

      // Deduplicate
      const donationId = body.id || body.transaction_id || `don-${Date.now()}`;
      if (global.donationIndex.has(donationId)) {
        log('🔁 Duplicate donation ignored:', donationId);
        return res.status(200).json({ success: true, duplicate: true });
      }

      const donorName = body.donor_name || body.name || body.username || 'Anonymous';
      const rawAmount = body.amount_raw || body.amount || body.nominal || 0;
      const amount = Number(rawAmount) || 0;

      const donationData = {
        id: donationId,
        donor_name: String(donorName),
        amount,
        message: body.message || '',
        created_at: body.created_at || body.timestamp || new Date().toISOString()
      };

      // save to in-memory (dev only)
      global.donations.push(donationData);
      global.donationIndex.add(donationData.id);
      global.topDonators[donationData.donor_name] = (global.topDonators[donationData.donor_name] || 0) + donationData.amount;

      if (global.donations.length > 100) {
        const removed = global.donations.shift();
        if (removed?.id) global.donationIndex.delete(removed.id);
      }

      log('✅ Donation stored:', donationData.id, donationData.donor_name, donationData.amount);
      return res.status(200).json({ success: true, message: 'Donation received', donation: donationData });
    }

    // ------------------ LATEST DONATIONS ------------------
    if (req.method === 'GET' && path === '/api/latest-donations') {
      const latest = (global.donations || []).slice(-10).reverse();
      return res.status(200).json({ success: true, donations: latest, count: latest.length });
    }

    // ------------------ TOP DONATORS ------------------
    if (req.method === 'GET' && path === '/api/top-donators') {
      const q = parseQuery(req.url || '/');
      const limit = Math.min(Math.max(parseInt(q.limit || '20', 10) || 20, 1), 200);
      const sorted = Object.entries(global.topDonators || {})
        .map(([username, amount]) => ({ username, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, limit)
        .map((d, i) => ({ rank: i + 1, username: d.username, amount: d.amount }));
      return res.status(200).json({ success: true, donators: sorted, count: sorted.length });
    }

    // ------------------ TEST DONATION ------------------
    if (req.method === 'POST' && path === '/api/test-donation') {
      const rawBuf = await readRawBody(req);
      let body = {};
      try { body = rawBuf.length ? JSON.parse(rawBuf.toString('utf8')) : {}; } catch { body = {}; }

      const testDonation = {
        id: 'test-' + Date.now(),
        donor_name: body.donor_name || `TestUser${Math.floor(Math.random()*1000)}`,
        amount: Number(body.amount) || (Math.floor(Math.random()*50000) + 10000),
        message: 'Test donation',
        created_at: new Date().toISOString()
      };

      global.donations.push(testDonation);
      global.donationIndex.add(testDonation.id);
      global.topDonators[testDonation.donor_name] = (global.topDonators[testDonation.donor_name] || 0) + testDonation.amount;
      if (global.donations.length > 100) global.donations = global.donations.slice(-100);

      return res.status(200).json({ success: true, donation: testDonation });
    }

    // ------------------ CLEAR DATA ------------------
    if (req.method === 'POST' && path === '/api/clear-data') {
      global.donations = [];
      global.topDonators = {};
      global.donationIndex = new Set();
      return res.status(200).json({ success: true, message: 'Cleared data' });
    }

    // ------------------ HEALTH ------------------
    if (req.method === 'GET' && path === '/api/health') {
      return res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
    }

    return res.status(404).json({ success: false, error: 'Endpoint not found' });
  } catch (err) {
    log('❌ Handler error:', err && err.message ? err.message : err);
    return res.status(500).json({ success: false, error: String(err) });
  }
};

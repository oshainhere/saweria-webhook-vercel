const crypto = require('crypto');

// In-memory storage (untuk production pakai database seperti Vercel KV)
let donations = [];
let topDonators = {};

// Helper function
function log(message, data = '') {
  console.log(`[${new Date().toISOString()}] ${message}`, data);
}

// Main handler
module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle OPTIONS (preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { method, url } = req;
  const path = url.split('?')[0];

  // ==================== WEBHOOK (POST) ====================
  if (method === 'POST' && path === '/api/webhook') {
    try {
      log('📨 Webhook received from Saweria');
      
      const SAWERIA_SECRET = process.env.SAWERIA_SECRET || '';
      const sig = req.headers['x-saweria-sig'];
      
      // Verify signature
      if (SAWERIA_SECRET && SAWERIA_SECRET !== '') {
        const computedSig = crypto.createHmac('sha256', SAWERIA_SECRET)
          .update(JSON.stringify(req.body))
          .digest('hex');
        
        if (sig && sig !== computedSig) {
          log('❌ Invalid signature');
          return res.status(401).json({ success: false, error: 'Invalid signature' });
        }
        log('✅ Signature verified');
      }

      const donation = req.body;
      
      const donationData = {
        id: donation.id || 'donation-' + Date.now(),
        donor_name: donation.donor_name || 'Anonymous',
        amount: donation.amount_raw || donation.amount || 0,
        message: donation.message || '',
        timestamp: new Date().toISOString(),
        created_at: donation.created_at || new Date().toISOString()
      };

      donations.push(donationData);
      log('✅ Donation saved:', donationData);

      const username = donationData.donor_name;
      topDonators[username] = (topDonators[username] || 0) + donationData.amount;

      if (donations.length > 100) {
        donations = donations.slice(-100);
      }

      return res.status(200).json({ 
        success: true, 
        message: 'Donation received', 
        donation: donationData 
      });
    } catch (error) {
      log('❌ Error:', error.message);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==================== LATEST DONATIONS (GET) ====================
  if (method === 'GET' && path === '/api/latest-donations') {
    try {
      const latest = donations.slice(-10).reverse();
      log(`📋 Sent ${latest.length} latest donations`);
      return res.status(200).json({ 
        success: true, 
        donations: latest, 
        count: latest.length 
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==================== TOP DONATORS (GET) ====================
  if (method === 'GET' && path === '/api/top-donators') {
    try {
      const limit = parseInt(req.query.limit) || 20;
      
      const sorted = Object.entries(topDonators)
        .map(([username, amount]) => ({ username, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, limit)
        .map((donator, index) => ({
          rank: index + 1,
          username: donator.username,
          amount: donator.amount,
          imageId: 'rbxasset://textures/ui/GuiImagePlaceholder.png'
        }));

      log(`🏆 Sent top ${sorted.length} donators`);
      return res.status(200).json({ 
        success: true, 
        donators: sorted, 
        count: sorted.length 
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==================== TEST DONATION (POST) ====================
  if (method === 'POST' && path === '/api/test-donation') {
    try {
      const { donor_name, amount } = req.body;
      
      const testDonation = {
        id: 'test-' + Date.now(),
        donor_name: donor_name || 'TestUser' + Math.floor(Math.random() * 1000),
        amount: amount || Math.floor(Math.random() * 50000) + 10000,
        message: 'Test donation from Vercel',
        timestamp: new Date().toISOString(),
        created_at: new Date().toISOString()
      };

      donations.push(testDonation);
      topDonators[testDonation.donor_name] = 
        (topDonators[testDonation.donor_name] || 0) + testDonation.amount;

      log('🧪 Test donation created:', testDonation);
      return res.status(200).json({ success: true, donation: testDonation });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==================== CLEAR DATA (POST) ====================
  if (method === 'POST' && path === '/api/clear-data') {
    try {
      const prevCount = donations.length;
      donations = [];
      topDonators = {};
      log(`🗑️ Cleared ${prevCount} donations`);
      return res.status(200).json({ 
        success: true, 
        message: `Cleared ${prevCount} donations` 
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==================== HEALTH CHECK (GET) ====================
  if (method === 'GET' && path === '/api/health') {
    return res.status(200).json({ 
      status: 'healthy',
      timestamp: new Date().toISOString()
    });
  }

  // ==================== 404 ====================
  return res.status(404).json({ success: false, error: 'Endpoint not found' });
};
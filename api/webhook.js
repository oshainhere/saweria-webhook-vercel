const crypto = require("crypto");

// Memory storage (gunakan DB jika ingin permanen)
let donations = [];
let topDonators = {};

// Logging helper
function log(msg, data = "") {
  console.log(`[${new Date().toISOString()}] ${msg}`, data);
}

// -----------------------------
// SIGNATURE VERIFICATION
// -----------------------------
function verifySignature(body, receivedSig, secret) {
  try {
    const {
      version = "",
      id = "",
      amount_raw = "",
      donator_name = "",
      donator_email = ""
    } = body;

    // Order must match Saweria documentation
    const msg = `${version}${id}${amount_raw}${donator_name}${donator_email}`;

    const computed = crypto
      .createHmac("sha256", secret)
      .update(msg)
      .digest("hex");

    return computed === receivedSig;
  } catch (err) {
    return false;
  }
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const path = req.url.split("?")[0];
  const method = req.method;

  // ---------------------------------------------------
  // 🔥 WEBHOOK ENDPOINT (Saweria → Vercel)
  // ---------------------------------------------------
  if (method === "POST" && path === "/api/webhook") {
    const STREAM_KEY = process.env.SAWERIA_STREAMING_KEY || "";
    const signature = req.headers["saweria-callback-signature"];

    log("📨 Webhook received");

    // Verify signature
    if (STREAM_KEY !== "") {
      const valid = verifySignature(req.body, signature, STREAM_KEY);

      if (!valid) {
        log("❌ Invalid signature");
        return res
          .status(401)
          .json({ success: false, error: "Invalid signature" });
      }

      log("✅ Signature verified");
    }

    // Format donation
    const donation = {
      id: req.body.id || "donation-" + Date.now(),
      donor_name: req.body.donator_name || "Anonymous",
      amount: req.body.amount_raw || req.body.amount || 0,
      message: req.body.message || "",
      timestamp: new Date().toISOString(),
      created_at: req.body.created_at || new Date().toISOString()
    };

    // Save donation
    donations.push(donation);

    // Track top donators
    topDonators[donation.donor_name] =
      (topDonators[donation.donor_name] || 0) + donation.amount;

    // Limit memory
    if (donations.length > 100) donations = donations.slice(-100);

    log("💰 Donation saved:", donation);

    return res.status(200).json({
      success: true,
      message: "Donation received",
      donation
    });
  }

  // ---------------------------------------------------
  // GET: latest donations
  // ---------------------------------------------------
  if (method === "GET" && path === "/api/latest-donations") {
    const latest = donations.slice(-10).reverse();

    return res.status(200).json({
      success: true,
      donations: latest,
      count: latest.length
    });
  }

  // ---------------------------------------------------
  // GET: top donators
  // ---------------------------------------------------
  if (method === "GET" && path === "/api/top-donators") {
    const list = Object.entries(topDonators)
      .map(([username, amount]) => ({ username, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 20);

    return res.status(200).json({
      success: true,
      donators: list,
      count: list.length
    });
  }

  // ---------------------------------------------------
  // POST: test donation
  // ---------------------------------------------------
  if (method === "POST" && path === "/api/test-donation") {
    const d = {
      id: "test-" + Date.now(),
      donor_name: req.body.donor_name || "TestUser",
      amount: req.body.amount || Math.floor(Math.random() * 50000) + 5000,
      message: "Test donation",
      timestamp: new Date().toISOString()
    };

    donations.push(d);

    topDonators[d.donor_name] =
      (topDonators[d.donor_name] || 0) + d.amount;

    return res.status(200).json({ success: true, donation: d });
  }

  // ---------------------------------------------------
  // CLEAR DATA
  // ---------------------------------------------------
  if (method === "POST" && path === "/api/clear-data") {
    donations = [];
    topDonators = {};

    return res.status(200).json({ success: true, message: "Cleared" });
  }

  // ---------------------------------------------------
  // HEALTH CHECK
  // ---------------------------------------------------
  if (method === "GET" && path === "/api/health") {
    return res.status(200).json({
      healthy: true,
      timestamp: new Date().toISOString()
    });
  }

  // Fallback
  return res.status(404).json({ success: false, error: "Not found" });
};

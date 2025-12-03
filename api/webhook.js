const crypto = require("crypto");

// Memory storage
let donations = [];
let topDonators = {};

// LOG
function log(msg, data = "") {
  console.log(`[${new Date().toISOString()}] ${msg}`, data);
}

// -------------------------------------
// SIGNATURE VALIDATION (RAW BODY)
// -------------------------------------
function verifySignature(rawBody, receivedSig, secret) {
  try {
    const body = JSON.parse(rawBody);

    const {
      version = "",
      id = "",
      amount_raw = "",
      donator_name = "",
      donator_email = ""
    } = body;

    const msg = `${version}${id}${amount_raw}${donator_name}${donator_email}`;

    const computed = crypto
      .createHmac("sha256", secret)
      .update(msg)
      .digest("hex");

    return computed === receivedSig;
  } catch (err) {
    console.error("Signature error:", err);
    return false;
  }
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Saweria-Callback-Signature");

  if (req.method === "OPTIONS") return res.status(200).end();

  const path = req.url.split("?")[0];

  // -------------------------------------
  // READ RAW BODY (WAJIB UNTUK SAWERIA)
  // -------------------------------------
  let rawBody = "";

  await new Promise((resolve) => {
    req.on("data", (chunk) => (rawBody += chunk));
    req.on("end", resolve);
  });

  // -------------------------------------
  // WEBHOOK ENDPOINT
  // Saweria → Vercel
  // -------------------------------------
  if (req.method === "POST" && path === "/api/webhook") {
    log("📨 Webhook received");

    const STREAM_KEY = process.env.SAWERIA_STREAMING_KEY || "";
    const signature = req.headers["saweria-callback-signature"];

    if (!rawBody || rawBody.length < 10) {
      log("❌ EMPTY BODY RECEIVED");
      return res.status(400).json({ error: "Empty body" });
    }

    // Signature check
    if (STREAM_KEY) {
      const valid = verifySignature(rawBody, signature, STREAM_KEY);

      if (!valid) {
        log("❌ Invalid signature");
        return res.status(401).json({ success: false, error: "Invalid signature" });
      }

      log("✅ Signature verified");
    }

    const body = JSON.parse(rawBody);

    const donation = {
      id: body.id,
      donor_name: body.donator_name,
      amount: body.amount_raw,
      message: body.message,
      created_at: body.created_at,
      timestamp: new Date().toISOString()
    };

    donations.push(donation);

    topDonators[donation.donor_name] =
      (topDonators[donation.donor_name] || 0) + donation.amount;

    log("💰 Donation saved:", donation);

    return res.status(200).json({
      success: true,
      donation
    });
  }

  // OTHER ROUTES
  if (req.method === "GET" && path === "/api/latest-donations") {
    const latest = donations.slice(-10).reverse();
    return res.status(200).json(latest);
  }

  if (req.method === "GET" && path === "/api/top-donators") {
    const list = Object.entries(topDonators)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
    return res.status(200).json(list);
  }

  res.status(404).json({ error: "Not found" });
};

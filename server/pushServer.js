// server/pushServer.js
// Minimal dev push server for PeersHub with debug logging

const express = require("express");
const bodyParser = require("body-parser");
const webpush = require("web-push");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "64kb" }));

// Use your VAPID keys (better: set via env in production)
const VAPID_PUBLIC =
  process.env.VAPID_PUBLIC_KEY ||
  "BLjfWTbV2jpZkHM-AetFzvIB80Cq2J8Em8zUn66U_Yqp3RRvW4JIUb8k-iAfmonjWhOtf_i6fVq29dx-ggQ8Bhs";

const VAPID_PRIVATE =
  process.env.VAPID_PRIVATE_KEY ||
  "_gyAUBXq8lHV7PD3zn02tXYgzVnDZmu8mw4DorwarTU";

webpush.setVapidDetails(
  "mailto:admin@yourdomain.com",
  VAPID_PUBLIC,
  VAPID_PRIVATE
);

// In-memory store (replace with DB in production)
const subs = new Map();

// Save subscription
app.post("/api/save-subscription", (req, res) => {
  const { subscription, username } = req.body || {};
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: "invalid subscription" });
  }

  subs.set(subscription.endpoint, { subscription, username });

  console.log("\n=== New subscription saved ===");
  console.log("Username:", username || "unknown");
  console.log("Endpoint:", subscription.endpoint);
  console.log("Keys:", subscription.keys || "(missing)");
  console.log("==============================\n");

  res.json({ ok: true });
});

// Debug: list all subs
app.get("/api/list-subs", (req, res) => {
  res.json({
    count: subs.size,
    subs: [...subs.entries()].map(([endpoint, data]) => ({
      endpoint,
      username: data.username,
    })),
  });
});

// Send test push to all subs
app.post("/api/send-test-push", async (req, res) => {
  const payload = JSON.stringify(
    req.body || { title: "PeersHub", body: "Test push" }
  );
  const results = [];

  for (const [key, info] of subs.entries()) {
    try {
      await webpush.sendNotification(info.subscription, payload);
      results.push({ endpoint: key, ok: true });
    } catch (err) {
      results.push({
        endpoint: key,
        error: err.statusCode || err.message || String(err),
      });
      if (err.statusCode === 410 || err.statusCode === 404) subs.delete(key);
    }
  }

  console.log("Push results:", results);
  res.json({ results, count: results.length });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log("Push server running at http://localhost:" + PORT)
);

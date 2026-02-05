// server.js
const path = require("path");
const express = require("express");

const app = express();

// Parse JSON bodies
app.use(express.json());

// --- Serve your static storefront from /public ---
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// Root route -> index.html (fixes "Cannot GET /")
app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// Optional friendly routes (keeps your links clean)
app.get("/cart", (req, res) => {
  res.sendFile(path.join(publicDir, "cart.html"));
});

// --- (TEMP) Checkout endpoint so your cart button has something to call ---
// Replace this later with Stripe Checkout session creation.
app.post("/api/checkout", async (req, res) => {
  // For now, just return an error so you can confirm the route exists.
  // Once you add Stripe, return: res.json({ url: session.url })
  return res.status(501).json({
    error: "Checkout not wired yet. Add Stripe server code here.",
    received: req.body,
  });
});

// Helpful health check for Render
app.get("/healthz", (req, res) => res.status(200).send("ok"));

// Start server (Render provides PORT)
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

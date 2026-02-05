// server.js (ESM)
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

// __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static storefront from /public
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// Root route -> index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// Optional: clean cart route
app.get("/cart", (req, res) => {
  res.sendFile(path.join(publicDir, "cart.html"));
});

// Health check
app.get("/healthz", (req, res) => res.status(200).send("ok"));

// TEMP checkout stub (replace later with Stripe)
app.post("/api/checkout", (req, res) => {
  res.status(501).json({
    error: "Checkout not wired yet. Add Stripe server code here.",
    received: req.body,
  });
});

// Render uses PORT
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));

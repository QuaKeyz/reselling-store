// server.js
// Express + Supabase admin API for Render
// Provides:
//   GET    /api/health
//   GET    /api/admin/products
//   GET    /api/admin/products/:id
//   POST   /api/admin/products
//   PUT    /api/admin/products/:id
//   DELETE /api/admin/products/:id
//
// ENV REQUIRED (set in Render -> Environment):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// Render also provides:
//   PORT

import "dotenv/config";
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();

// If your frontend is served from a different domain, add it here.
const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://localhost:3000",
  "https://reselling-store.onrender.com"
]);

app.use(
  cors({
    origin(origin, cb) {
      // allow curl/postman/no-origin + allowed origins
      if (!origin || allowedOrigins.has(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true
  })
);

app.use(express.json({ limit: "2mb" }));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing env vars. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Render Environment."
  );
  process.exit(1);
}

// Server-only client (service role bypasses RLS). NEVER use this key in the browser.
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

// ---- Routes ----

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// List all products (admin)
app.get("/api/admin/products", async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data ?? []);
});

// Get one product by id (admin)
app.get("/api/admin/products/:id", async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabaseAdmin
    .from("products")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return res.status(404).json({ error: error.message });
  return res.json(data);
});

// Create product (admin)
app.post("/api/admin/products", async (req, res) => {
  const payload = req.body;

  const { data, error } = await supabaseAdmin
    .from("products")
    .insert([payload])
    .select("*")
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(data);
});

// Update product (admin)
app.put("/api/admin/products/:id", async (req, res) => {
  const { id } = req.params;
  const patch = req.body;

  const { data, error } = await supabaseAdmin
    .from("products")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.json(data);
});

// Delete product (admin)
app.delete("/api/admin/products/:id", async (req, res) => {
  const { id } = req.params;

  const { error } = await supabaseAdmin.from("products").delete().eq("id", id);

  if (error) return res.status(400).json({ error: error.message });
  return res.status(204).end();
});

// ---- Start ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});

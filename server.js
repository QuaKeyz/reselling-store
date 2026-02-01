import express from "express";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import crypto from "crypto";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import Stripe from "stripe";
import multer from "multer";

dotenv.config();

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");

// Serve static files
app.use(express.static(PUBLIC_DIR));

// ✅ Supabase client (MUST export { supabase } from lib/supabaseClient.js)
const { supabase } = await import("./lib/supabaseClient.js");

// Env
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const BASE_URL = process.env.BASE_URL || "http://localhost:4242";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me-now";

// Persistent dirs (Render paid disk optional)
const STORE_DATA_DIR = process.env.STORE_DATA_DIR || "";
const STORE_UPLOADS_DIR = process.env.STORE_UPLOADS_DIR || "";

if (!STRIPE_SECRET_KEY) {
  console.error("Missing STRIPE_SECRET_KEY in environment.");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

// Paths (orders can stay local for now)
const DATA_DIR = STORE_DATA_DIR ? STORE_DATA_DIR : path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

const UPLOADS_DIR = STORE_UPLOADS_DIR
  ? STORE_UPLOADS_DIR
  : path.join(PUBLIC_DIR, "uploads");

// Ensure dirs
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// -------------------------
// Webhook (raw body)
// -------------------------
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    if (!STRIPE_WEBHOOK_SECRET) {
      return res.status(200).send("Webhook secret not set; ignoring.");
    }

    const sig = req.headers["stripe-signature"];
    const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const orderId = session?.metadata?.orderId;

      if (orderId) {
        const db = await readDb();
        const order = db.orders.find(o => o.id === orderId);

        if (order && order.status !== "paid") {
          order.status = "paid";
          order.paidAt = nowIso();
          order.stripeSessionId = session.id;
          order.customerEmail = session.customer_details?.email || "";
          order.customerName = session.customer_details?.name || "";
          order.customerPhone = session.customer_details?.phone || "";
          order.shipping = session.shipping_details || null;

          await writeDb(db);
        }
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// JSON AFTER webhook
app.use(express.json());

// Static extra
app.use("/uploads", express.static(UPLOADS_DIR));

// -------------------------
// Simple JSON DB (orders only for now)
// -------------------------
let writeLock = Promise.resolve();

async function readDb() {
  try {
    const raw = await fsp.readFile(DB_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    const initial = { orders: [] };
    await writeDb(initial);
    return initial;
  }
}

async function writeDb(db) {
  writeLock = writeLock.then(async () => {
    const tmp = DB_PATH + ".tmp";
    await fsp.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
    await fsp.rename(tmp, DB_PATH);
  });
  return writeLock;
}

function nowIso() {
  return new Date().toISOString();
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || crypto.randomUUID().slice(0, 8);
}

function moneyCents(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x);
}

// Convert Supabase row -> frontend shape
function mapProductOut(row) {
  const imgs = Array.isArray(row.images) ? row.images : [];
  return {
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    currency: row.currency || "USD",
    imageUrl: imgs.length ? imgs[0] : "",
    images: imgs,
    description: row.description || "",
    category: row.category || "",
    brand: row.brand || "",
    inventory: Number(row.inventory ?? 0),
    active: !!row.is_active,
    createdAt: row.created_at
  };
}

// -------------------------
// Admin auth
// -------------------------
const adminTokens = new Map();

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const info = adminTokens.get(token);

  if (!info) return res.status(401).json({ error: "Not authorized" });
  if (Date.now() > info.expiresAt) {
    adminTokens.delete(token);
    return res.status(401).json({ error: "Token expired" });
  }
  next();
}

app.post("/api/admin/login", async (req, res) => {
  const { password } = req.body || {};
  if (String(password || "") !== String(ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "Wrong password" });
  }
  const token = makeToken();
  adminTokens.set(token, { createdAt: Date.now(), expiresAt: Date.now() + 1000 * 60 * 60 * 12 });
  res.json({ token });
});

// -------------------------
// Uploads (optional)
// -------------------------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase().slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext || ".jpg"}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype);
    cb(ok ? null : new Error("Only image uploads allowed"), ok);
  }
});

app.post("/api/admin/upload", requireAdmin, upload.single("image"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file uploaded" });
  res.json({ url: `/uploads/${file.filename}` });
});

// -------------------------
// ✅ Public products (Supabase PERMANENT)
// -------------------------
app.get("/api/products", async (_req, res) => {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("is_active", true)
    .gt("inventory", 0)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).map(mapProductOut));
});

app.get("/api/products/:id", async (req, res) => {
  const id = String(req.params.id || "");

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return res.status(404).json({ error: "Not found" });
  if (!data.is_active || Number(data.inventory ?? 0) <= 0) {
    return res.status(404).json({ error: "Not found" });
  }

  res.json(mapProductOut(data));
});

// -----------------------------
// ✅ Bulk import -> Supabase (PERMANENT)
// POST /api/admin/bulk-import
// Body: { products: [ ... ] }
// -----------------------------
app.post("/api/admin/bulk-import", requireAdmin, async (req, res) => {
  try {
    const products = req.body?.products;

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: "products must be a non-empty array" });
    }

    const rows = products.map((raw) => {
      const name = String(raw.name || "").trim();
      const id = raw.id ? slugify(raw.id) : slugify(name);
      const images = Array.isArray(raw.images) ? raw.images.map(String) : [];

      return {
        id,
        name,
        brand: String(raw.brand || ""),
        category: String(raw.category || "General"),
        description: String(raw.description || ""),
        price_cents: moneyCents(raw.priceCents),
        currency: String(raw.currency || "USD"),
        images,
        inventory: Number.isFinite(Number(raw.inventory)) ? Number(raw.inventory) : 0,
        is_active: raw.active !== false
      };
    });

    // basic validation
    for (const r of rows) {
      if (!r.name) return res.status(400).json({ error: "Missing name in one item" });
      if (r.price_cents < 50) return res.status(400).json({ error: "priceCents too low (min 50 cents)" });
      if (!Number.isFinite(r.inventory) || r.inventory < 0) r.inventory = 0;
    }

    const { data, error } = await supabase
      .from("products")
      .upsert(rows, { onConflict: "id" })
      .select("id");

    if (error) return res.status(500).json({ error: error.message });

    res.json({ ok: true, upsertedCount: data?.length || 0, ids: (data || []).map(d => d.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Bulk import failed" });
  }
});

// -------------------------
// ✅ Admin: view orders (still local)
// -------------------------
app.get("/api/admin/orders", requireAdmin, async (_req, res) => {
  const db = await readDb();
  const orders = [...db.orders].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  res.json(orders);
});

// -------------------------
// ✅ Secure checkout (reads products from Supabase, writes order locally)
// -------------------------
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const cart = req.body?.cart;
    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: "Cart is empty or invalid." });
    }

    // Fetch products from Supabase
    const ids = cart.map(x => String(x.id || "")).filter(Boolean);
    const { data: products, error } = await supabase
      .from("products")
      .select("*")
      .in("id", ids);

    if (error) return res.status(500).json({ error: error.message });

    const byId = new Map((products || []).map(p => [p.id, p]));

    const items = cart.map(x => ({
      productId: String(x.id || ""),
      qty: Math.max(1, Math.min(99, Number(x.qty || 1)))
    }));

    const line_items = [];
    const orderItems = [];

    for (const item of items) {
      const p = byId.get(item.productId);
      if (!p || !p.is_active) return res.status(400).json({ error: `Product not available: ${item.productId}` });

      const inv = Number(p.inventory ?? 0);
      if (inv <= 0) return res.status(400).json({ error: `${p.name} is sold out` });
      if (item.qty > inv) return res.status(400).json({ error: `${p.name}: only ${inv} left` });

      const imgs = Array.isArray(p.images) ? p.images : [];

      line_items.push({
        quantity: item.qty,
        price_data: {
          currency: (p.currency || "USD").toLowerCase(),
          unit_amount: Number(p.price_cents),
          product_data: {
            name: p.name,
            images: imgs.length ? [imgs[0]] : undefined
          }
        }
      });

      orderItems.push({ productId: p.id, name: p.name, priceCents: Number(p.price_cents), qty: item.qty });
    }

    const orderId = crypto.randomUUID();
    const subtotal = orderItems.reduce((s, i) => s + i.priceCents * i.qty, 0);

    const db = await readDb();
    db.orders.push({
      id: orderId,
      status: "pending",
      createdAt: nowIso(),
      paidAt: null,
      items: orderItems,
      subtotalCents: subtotal,
      customerEmail: "",
      customerName: "",
      customerPhone: "",
      shipping: null,
      stripeSessionId: ""
    });
    await writeDb(db);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      success_url: `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/cancel.html`,
      shipping_address_collection: { allowed_countries: ["US"] },
      phone_number_collection: { enabled: true },
      metadata: { orderId }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

// Admin route
app.get("/admin", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

// Start
const port = process.env.PORT || 4242;
app.listen(port, () => console.log(`Listening on ${port}`));

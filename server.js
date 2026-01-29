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

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const BASE_URL = process.env.BASE_URL || "http://localhost:4242";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me-now";

// NEW: persistent storage locations (set these on Render)
const STORE_DATA_DIR = process.env.STORE_DATA_DIR || "";     // e.g. /var/data
const STORE_UPLOADS_DIR = process.env.STORE_UPLOADS_DIR || ""; // e.g. /var/data/uploads

if (!STRIPE_SECRET_KEY) {
  console.error("Missing STRIPE_SECRET_KEY in environment.");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");

// Decide data dir
const DATA_DIR = STORE_DATA_DIR
  ? STORE_DATA_DIR
  : path.join(__dirname, "data");

const DB_PATH = path.join(DATA_DIR, "db.json");

// Decide uploads dir (if not set, fall back to public/uploads for local dev)
const UPLOADS_DIR = STORE_UPLOADS_DIR
  ? STORE_UPLOADS_DIR
  : path.join(PUBLIC_DIR, "uploads");

// Ensure dirs exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Stripe webhook MUST be raw body
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

          for (const item of order.items) {
            const p = db.products.find(x => x.id === item.productId);
            if (p) {
              const inv = Number(p.inventory ?? 0);
              p.inventory = Math.max(0, inv - Number(item.qty));
            }
          }

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

// JSON after webhook
app.use(express.json());

// Serve frontend + uploads
app.use(express.static(PUBLIC_DIR));
app.use("/uploads", express.static(UPLOADS_DIR)); // IMPORTANT for persistent uploads

// -----------------------------
// Tiny JSON DB (atomic write)
// -----------------------------
let writeLock = Promise.resolve();

async function readDb() {
  try {
    const raw = await fsp.readFile(DB_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    const initial = { products: [], orders: [] };
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

// -----------------------------
// Admin auth (token)
// -----------------------------
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

// -----------------------------
// Upload images (admin)
// -----------------------------
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
  // Always store as /uploads/...
  res.json({ url: `/uploads/${file.filename}` });
});

// -----------------------------
// Public products
// -----------------------------
app.get("/api/products", async (_req, res) => {
  const db = await readDb();
  const visible = db.products.filter(p => p.active !== false && Number(p.inventory ?? 0) > 0);
  res.json(visible);
});

// Admin products CRUD
app.get("/api/admin/products", requireAdmin, async (_req, res) => {
  const db = await readDb();
  res.json(db.products);
});

app.post("/api/admin/products", requireAdmin, async (req, res) => {
  const db = await readDb();
  const body = req.body || {};

  const name = String(body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required" });

  const id = body.id ? slugify(body.id) : slugify(name);
  if (db.products.some(p => p.id === id)) return res.status(400).json({ error: "ID already exists" });

  const product = {
    id,
    name,
    priceCents: moneyCents(body.priceCents),
    imageUrl: String(body.imageUrl || ""),
    description: String(body.description || ""),
    category: String(body.category || "General"),
    brand: String(body.brand || ""),
    size: String(body.size || ""),
    condition: String(body.condition || "Good"),
    inventory: Number.isFinite(Number(body.inventory)) ? Number(body.inventory) : 1,
    active: body.active !== false,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  if (product.priceCents < 50) return res.status(400).json({ error: "Price too low" });
  if (product.inventory < 0) product.inventory = 0;

  db.products.push(product);
  await writeDb(db);
  res.json(product);
});

app.put("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const db = await readDb();
  const id = String(req.params.id || "");
  const p = db.products.find(x => x.id === id);
  if (!p) return res.status(404).json({ error: "Not found" });

  const body = req.body || {};

  if (body.name !== undefined) p.name = String(body.name || "").trim();
  if (body.priceCents !== undefined) p.priceCents = moneyCents(body.priceCents);
  if (body.imageUrl !== undefined) p.imageUrl = String(body.imageUrl || "");
  if (body.description !== undefined) p.description = String(body.description || "");
  if (body.category !== undefined) p.category = String(body.category || "General");
  if (body.brand !== undefined) p.brand = String(body.brand || "");
  if (body.size !== undefined) p.size = String(body.size || "");
  if (body.condition !== undefined) p.condition = String(body.condition || "Good");
  if (body.inventory !== undefined) p.inventory = Number(body.inventory);
  if (body.active !== undefined) p.active = !!body.active;

  if (!p.name) return res.status(400).json({ error: "Name is required" });
  if (p.priceCents < 50) return res.status(400).json({ error: "Price too low" });
  if (!Number.isFinite(p.inventory) || p.inventory < 0) p.inventory = 0;

  p.updatedAt = nowIso();
  await writeDb(db);
  res.json(p);
});

app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const db = await readDb();
  const id = String(req.params.id || "");
  const before = db.products.length;
  db.products = db.products.filter(p => p.id !== id);
  if (db.products.length === before) return res.status(404).json({ error: "Not found" });
  await writeDb(db);
  res.json({ ok: true });
});

// Admin orders
app.get("/api/admin/orders", requireAdmin, async (_req, res) => {
  const db = await readDb();
  const orders = [...db.orders].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  res.json(orders);
});

// Secure checkout (server uses DB prices)
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const cart = req.body?.cart;
    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: "Cart is empty or invalid." });
    }

    const db = await readDb();
    const items = cart.map(x => ({
      productId: String(x.id || ""),
      qty: Math.max(1, Math.min(99, Number(x.qty || 1)))
    }));

    const line_items = [];
    const orderItems = [];

    for (const item of items) {
      const p = db.products.find(prod => prod.id === item.productId);
      if (!p || p.active === false) return res.status(400).json({ error: `Product not available: ${item.productId}` });

      const inv = Number(p.inventory ?? 0);
      if (inv <= 0) return res.status(400).json({ error: `${p.name} is sold out` });
      if (item.qty > inv) return res.status(400).json({ error: `${p.name}: only ${inv} left` });

      line_items.push({
        quantity: item.qty,
        price_data: {
          currency: "usd",
          unit_amount: Number(p.priceCents),
          product_data: { name: p.name, images: p.imageUrl ? [p.imageUrl] : undefined }
        }
      });

      orderItems.push({ productId: p.id, name: p.name, priceCents: Number(p.priceCents), qty: item.qty });
    }

    const orderId = crypto.randomUUID();
    const subtotal = orderItems.reduce((s, i) => s + i.priceCents * i.qty, 0);

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
      line

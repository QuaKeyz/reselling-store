const state = {
  products: [],
  cart: loadCart(),
  query: "",
  category: ""
};

const els = {
  products: document.getElementById("products"),
  cartItems: document.getElementById("cartItems"),
  cartCount: document.getElementById("cartCount"),
  subtotal: document.getElementById("subtotal"),
  checkoutBtn: document.getElementById("checkoutBtn"),
  clearBtn: document.getElementById("clearBtn"),
  search: document.getElementById("search"),
  category: document.getElementById("category")
};

function money(cents) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
}

function loadCart() {
  try { return JSON.parse(localStorage.getItem("cart_v2") || "[]"); }
  catch { return []; }
}
function saveCart() { localStorage.setItem("cart_v2", JSON.stringify(state.cart)); }
function cartCount() { return state.cart.reduce((sum, i) => sum + i.qty, 0); }
function cartSubtotal() { return state.cart.reduce((sum, i) => sum + i.priceCents * i.qty, 0); }

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setQuery(q) {
  state.query = (q || "").toLowerCase().trim();
  renderProducts();
}
function setCategory(c) {
  state.category = String(c || "");
  renderProducts();
}

function addToCart(productId) {
  const p = state.products.find(x => x.id === productId);
  if (!p) return;

  const existing = state.cart.find(x => x.id === productId);
  if (existing) existing.qty += 1;
  else state.cart.push({ id: p.id, name: p.name, priceCents: p.priceCents, qty: 1 });

  saveCart();
  renderCart();
}

function updateQty(productId, delta) {
  const item = state.cart.find(x => x.id === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) state.cart = state.cart.filter(x => x.id !== productId);
  saveCart();
  renderCart();
}

function clearCart() {
  state.cart = [];
  saveCart();
  renderCart();
}

function renderCategoryDropdown() {
  const cats = Array.from(new Set(state.products.map(p => p.category || "General"))).sort();
  const options = ['<option value="">All categories</option>']
    .concat(cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`));
  els.category.innerHTML = options.join("");
  els.category.value = state.category;
}

function renderProducts() {
  const q = state.query;
  const cat = state.category;

  const filtered = state.products.filter(p => {
    const okCat = !cat || (p.category || "General") === cat;
    const hay = `${p.name} ${p.description || ""} ${p.brand || ""} ${p.condition || ""} ${p.size || ""}`.toLowerCase();
    const okQ = !q || hay.includes(q);
    return okCat && okQ;
  });

  els.products.innerHTML = filtered.map(p => {
    const badges = [
      p.brand ? `Brand: ${p.brand}` : "",
      p.size ? `Size: ${p.size}` : "",
      p.condition ? `Cond: ${p.condition}` : "",
      `Left: ${p.inventory ?? 0}`
    ].filter(Boolean);

    return `
      <div class="card product">
        <img src="${escapeHtml(p.imageUrl || "")}" alt="${escapeHtml(p.name)}" />
        <div class="pad">
          <div class="row">
            <h3>${escapeHtml(p.name)}</h3>
            <div class="price">${money(p.priceCents)}</div>
          </div>
          <p>${escapeHtml(p.description || "")}</p>
          <div class="row" style="gap:8px; flex-wrap:wrap; justify-content:flex-start;">
            ${badges.map(b => `<span class="pill">${escapeHtml(b)}</span>`).join("")}

          </div>
          <div class="row">
            <button class="btn" data-add="${escapeHtml(p.id)}">Add to cart</button>
            <span class="badge">${escapeHtml(p.category || "General")}</span>
          </div>
        </div>
      </div>
    `;
  }).join("");

  els.products.querySelectorAll("[data-add]").forEach(btn => {
    btn.addEventListener("click", () => addToCart(btn.dataset.add));
  });
}

function renderCart() {
  els.cartCount.textContent = String(cartCount());
  els.subtotal.textContent = money(cartSubtotal());
  els.checkoutBtn.disabled = state.cart.length === 0;

  if (state.cart.length === 0) {
    els.cartItems.innerHTML = `<div class="footer-note">Your cart is empty. Add items to checkout.</div>`;
    return;
  }

  els.cartItems.innerHTML = state.cart.map(i => `
    <div class="cart-item">
      <div>
        <div><strong>${escapeHtml(i.name)}</strong></div>
        <small>${money(i.priceCents)} each</small>
      </div>
      <div class="qty-controls">
        <button class="btn danger" data-dec="${escapeHtml(i.id)}">−</button>
        <div class="qty">${i.qty}</div>
        <button class="btn" data-inc="${escapeHtml(i.id)}">+</button>
      </div>
    </div>
  `).join("");

  els.cartItems.querySelectorAll("[data-inc]").forEach(btn => btn.addEventListener("click", () => updateQty(btn.dataset.inc, +1)));
  els.cartItems.querySelectorAll("[data-dec]").forEach(btn => btn.addEventListener("click", () => updateQty(btn.dataset.dec, -1)));
}

async function checkout() {
  els.checkoutBtn.disabled = true;
  els.checkoutBtn.textContent = "Starting checkout…";

  try {
    const payload = { cart: state.cart.map(i => ({ id: i.id, qty: i.qty })) };
    const res = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Checkout failed");
    window.location.href = data.url;
  } catch (err) {
    alert(err.message);
    els.checkoutBtn.disabled = state.cart.length === 0;
    els.checkoutBtn.textContent = "Checkout (Stripe)";
  }
}

async function init() {
  const productsRes = await fetch("/api/products");
  state.products = await productsRes.json();

  // Keep cart item names/prices in sync in case you edit products
  const byId = new Map(state.products.map(p => [p.id, p]));
  state.cart = state.cart.filter(i => byId.has(i.id)).map(i => {
    const p = byId.get(i.id);
    return { ...i, name: p.name, priceCents: p.priceCents };
  });
  saveCart();

  renderCategoryDropdown();

  els.search.addEventListener("input", (e) => setQuery(e.target.value));
  els.category.addEventListener("change", (e) => setCategory(e.target.value));
  els.checkoutBtn.addEventListener("click", checkout);
  els.clearBtn.addEventListener("click", clearCart);

  renderProducts();
  renderCart();
}

init();

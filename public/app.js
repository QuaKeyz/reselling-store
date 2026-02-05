// app.js
const CART_KEY = "cart";

export function readCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || "[]");
  } catch {
    return [];
  }
}

export function writeCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateBagCount();
}

export function addToCart(item) {
  const cart = readCart();
  const id = String(item.id);

  const existing = cart.find((x) => String(x.id) === id);
  if (existing) {
    existing.qty = (existing.qty || 1) + 1;
  } else {
    cart.push({
      id,
      title: item.title || "Item",
      price: Number(item.price || 0),
      image: item.image || "",
      qty: 1,
    });
  }

  writeCart(cart);
}

export function updateBagCount() {
  const cart = readCart();
  const count = cart.reduce((sum, it) => sum + (it.qty || 1), 0);
  const el = document.getElementById("bagCount");
  if (el) el.textContent = String(count);
}

// Click handler for any button with class "add-to-bag"
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".add-to-bag");
  if (!btn) return;

  const item = {
    id: btn.dataset.id,
    title: btn.dataset.title,
    price: Number(btn.dataset.price || 0),
    image: btn.dataset.image || "",
  };

  addToCart(item);

  const original = btn.textContent;
  btn.textContent = "Added!";
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 800);
});

updateBagCount();

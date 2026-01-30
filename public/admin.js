let token = localStorage.getItem("admin_token") || "";
let selectedId = "";

const $ = (id) => document.getElementById(id);

const loginCard = $("loginCard");
const app = $("app");

const msg = $("msg");

function setMsg(t) { msg.textContent = t || ""; }

function money(cents) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format((cents || 0) / 100);
}

async function api(path, options = {}) {
  const headers = options.headers || {};
  if (token) headers.Authorization = `Bearer ${token}`;
  options.headers = headers;

  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function fillForm(p) {
  selectedId = p?.id || "";
  $("p_id").value = p?.id || "";
  $("p_name").value = p?.name || "";
  $("p_price").value = p?.priceCents ?? "";
  $("p_inventory").value = p?.inventory ?? 0;
  $("p_category").value = p?.category || "General";
  $("p_condition").value = p?.condition || "Good";
  $("p_brand").value = p?.brand || "";
  $("p_size").value = p?.size || "";
  $("p_description").value = p?.description || "";
  $("p_imageUrl").value = p?.imageUrl || "";
  $("p_active").checked = p?.active !== false;

  $("updateBtn").disabled = !selectedId;
  $("deleteBtn").disabled = !selectedId;
}

function readForm() {
  return {
    id: $("p_id").value.trim() || undefined,
    name: $("p_name").value.trim(),
    priceCents: Number($("p_price").value),
    inventory: Number($("p_inventory").value),
    category: $("p_category").value,
    condition: $("p_condition").value,
    brand: $("p_brand").value.trim(),
    size: $("p_size").value.trim(),
    description: $("p_description").value.trim(),
    imageUrl: $("p_imageUrl").value.trim(),
    active: $("p_active").checked
  };
}

async function uploadImageIfAny() {
  const fileInput = $("p_imageFile");
  if (!fileInput.files || fileInput.files.length === 0) return null;

  const form = new FormData();
  form.append("image", fileInput.files[0]);

  const res = await fetch("/api/admin/upload", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Upload failed");
  fileInput.value = "";
  return data.url;
}

async function renderProducts() {
  const products = await api("/api/admin/products");
  const list = $("productsList");

  list.innerHTML = products.map(p => {
    const inv = Number(p.inventory ?? 0);
    const active = p.active !== false;
    return `
      <div style="padding:10px; border:1px solid var(--border); border-radius:14px; margin-bottom:10px; background:rgba(0,0,0,0.18);">
        <div style="display:flex; gap:10px; align-items:center;">
          <div style="width:52px; height:52px; border-radius:12px; overflow:hidden; border:1px solid var(--border); flex:0 0 auto;">
            <img src="${p.imageUrl || ""}" style="width:100%; height:100%; object-fit:cover;" />
          </div>
          <div style="flex:1;">
            <div><strong>${p.name}</strong></div>
            <div class="small">
              <span class="pill">${p.id}</span>
              <span class="pill">${money(p.priceCents)}</span>
              <span class="pill">${p.category || "General"}</span>
              <span class="pill">Inv: ${inv}</span>
              <span class="pill">${active ? "Active" : "Hidden"}</span>
            </div>
          </div>
          <button class="btn" data-edit="${p.id}">Edit</button>
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-edit");
      const all = await api("/api/admin/products");
      const p = all.find(x => x.id === id);
      fillForm(p);
      setMsg(`Editing: ${id}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

async function renderOrders() {
  const orders = await api("/api/admin/orders");
  const body = $("ordersBody");

  body.innerHTML = orders.map(o => {
    const items = (o.items || []).map(i => `${i.qty}× ${i.name}`).join("<br/>");
    const who = [o.customerName, o.customerEmail].filter(Boolean).join("<br/>") || "-";
    const when = new Date(o.createdAt).toLocaleString();
    return `
      <tr>
        <td>${when}</td>
        <td><span class="pill">${o.status}</span></td>
        <td>${who}</td>
        <td>${items || "-"}</td>
        <td>${money(o.subtotalCents)}</td>
      </tr>
    `;
  }).join("");
}

async function refreshAll() {
  await renderProducts();
  await renderOrders();
}

async function login() {
  const password = $("password").value;
  const data = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  }).then(r => r.json().then(d => ({ ok: r.ok, d })));

  if (!data.ok) throw new Error(data.d.error || "Login failed");

 const token = (data?.token) || (data?.d?.token);

if (!token) {
  throw new Error("Login succeeded but token missing in response");
}
headers: { Authorization: "Bearer " + token }

localStorage.setItem("adminToken", token);
sessionStorage.setItem("adminToken", token);
window.adminToken = token;


  localStorage.setItem("admin_token", token);
  loginCard.style.display = "none";
  app.style.display = "block";
  await refreshAll();
}

function logout() {
localStorage.removeItem("adminToken");
sessionStorage.removeItem("adminToken");
window.adminToken = "";

  token = "";
  localStorage.removeItem("admin_token");
  location.reload();
}

$("loginBtn").addEventListener("click", async () => {
  $("loginMsg").textContent = "";
  try { await login(); }
  catch (e) { $("loginMsg").textContent = e.message; }
});

$("logoutBtn").addEventListener("click", logout);

$("clearBtn").addEventListener("click", () => {
  selectedId = "";
  fillForm(null);
  setMsg("Cleared.");
});

$("createBtn").addEventListener("click", async () => {
  try {
    setMsg("Creating...");
    const uploaded = await uploadImageIfAny();
    const payload = readForm();
    if (uploaded) payload.imageUrl = uploaded;

    const created = await api("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    fillForm(created);
    setMsg(`Created: ${created.id}`);
    await refreshAll();
  } catch (e) {
    setMsg(e.message);
  }
});

$("updateBtn").addEventListener("click", async () => {
  if (!selectedId) return;
  try {
    setMsg("Updating...");
    const uploaded = await uploadImageIfAny();
    const payload = readForm();
    if (uploaded) payload.imageUrl = uploaded;

    const updated = await api(`/api/admin/products/${selectedId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    fillForm(updated);
    setMsg(`Updated: ${updated.id}`);
    await refreshAll();
  } catch (e) {
    setMsg(e.message);
  }
});

$("deleteBtn").addEventListener("click", async () => {
  if (!selectedId) return;
  if (!confirm(`Delete ${selectedId}?`)) return;
  try {
    setMsg("Deleting...");
    await api(`/api/admin/products/${selectedId}`, { method: "DELETE" });
    fillForm(null);
    setMsg("Deleted.");
    await refreshAll();
  } catch (e) {
    setMsg(e.message);
  }
});

(async function boot() {
  if (!token) return;
  try {
    loginCard.style.display = "none";
    app.style.display = "block";
    await refreshAll();
  } catch {
    // token expired/bad
    localStorage.removeItem("admin_token");
    location.reload();
  }
})();

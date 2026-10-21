const parts = location.pathname.split("/").filter(Boolean);
const slug = parts[0] === "b" ? decodeURIComponent(parts[1] || "") : "";
const productId = parts[2] === "p" ? decodeURIComponent(parts[3] || "") : "";
const tableCode = new URLSearchParams(location.search).get("table") || "";

function refreshCart() {
  const rows = readCart(slug);
  document.getElementById("count").textContent = String(cartCount(slug));
  const total = cartTotal(slug);
  const tax = vatOf(total);
  document.getElementById("total").textContent = money(total);
  document.getElementById("vat").textContent = total ? `dont TVA 20 % ${money(tax.vat)}` : "";
  document.getElementById("lines").innerHTML =
    rows.map((row) => `<p>${esc(row.name)} × ${row.qty} <strong>${money(row.priceCents * row.qty)}</strong></p>`).join("") ||
    `<p class="muted">Le panier est vide.</p>`;
}

function showCart() {
  refreshCart();
  document.getElementById("drawer").hidden = false;
  document.getElementById("backdrop").hidden = false;
}

document.getElementById("openCart").addEventListener("click", showCart);
document.getElementById("closeCart").addEventListener("click", () => {
  document.getElementById("drawer").hidden = true;
  document.getElementById("backdrop").hidden = true;
});
document.getElementById("backdrop").addEventListener("click", () => {
  document.getElementById("drawer").hidden = true;
  document.getElementById("backdrop").hidden = true;
});

document.getElementById("checkout").addEventListener("submit", async (event) => {
  event.preventDefault();
  const msg = document.getElementById("msg");
  const items = readCart(slug);
  if (!items.length) {
    msg.textContent = "Ajoute un article.";
    return;
  }
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  body.tableCode = tableCode;
  body.items = items.map((item) => ({ productId: item.id, qty: item.qty }));
  const response = await fetch(`/api/shops/${encodeURIComponent(slug)}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    msg.textContent = payload.error || "Commande refusée";
    return;
  }
  writeCart(slug, []);
  refreshCart();
  msg.innerHTML = `Commande ${esc(payload.order.number)} · ${esc(payload.order.priceLabel)}. ${
    payload.order.whatsappUrl ? `<a href="${esc(payload.order.whatsappUrl)}">WhatsApp</a>` : "Enregistrée."
  }`;
});

async function boot() {
  const res = await fetch(`/api/shops/${encodeURIComponent(slug)}`);
  const data = await res.json();
  if (!res.ok) {
    document.getElementById("fiche").textContent = data.error || "Introuvable";
    return;
  }
  const product = (data.products || []).find((row) => row.id === productId);
  const back = document.getElementById("back");
  back.href = tableCode
    ? `/b/${encodeURIComponent(slug)}/t/${encodeURIComponent(tableCode)}`
    : `/b/${encodeURIComponent(slug)}`;
  back.textContent = data.shop.name;
  const form = document.getElementById("checkout");
  form.addressLine.value = data.shop.addressLine || "";
  form.postalCode.value = data.shop.postalCode || "";
  form.city.value = data.shop.city || "";
  if (!product) {
    document.getElementById("fiche").textContent = "Produit introuvable";
    return;
  }
  document.title = product.name;
  const visual = product.image
    ? `<img alt="" src="${esc(product.image)}" />`
    : product.video
      ? `<video controls playsinline src="${esc(product.video)}"></video>`
      : `<div class="ph"></div>`;
  document.getElementById("fiche").innerHTML = `${visual}
    <div>
      <p class="kicker">${esc(data.shop.city)} · TVA 20 %</p>
      <h1>${esc(product.name)}</h1>
      <p class="lede">${esc(product.description || "")}</p>
      <p class="price" style="font-size:1.4rem">${esc(product.priceLabel)}</p>
      <p class="muted">Prix TTC. ${product.stock} en stock.</p>
      <button class="btn" id="add" type="button">Ajouter au panier</button>
    </div>`;
  document.getElementById("add").addEventListener("click", () => {
    addToCart(slug, product, 1);
    showCart();
  });
  refreshCart();
}

boot();

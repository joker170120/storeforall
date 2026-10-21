const parts = location.pathname.split("/").filter(Boolean);
const slug = parts[0] === "b" ? decodeURIComponent(parts[1] || "") : "";
const tableCode = parts[2] === "t" ? decodeURIComponent(parts[3] || "") : "";

function refreshCart() {
  const rows = readCart(slug);
  document.getElementById("count").textContent = String(cartCount(slug));
  const total = cartTotal(slug);
  const tax = vatOf(total);
  document.getElementById("total").textContent = money(total);
  document.getElementById("vat").textContent = total ? `dont TVA 20 % ${money(tax.vat)}` : "";
  document.getElementById("lines").innerHTML =
    rows
      .map(
        (row) => `<p>${esc(row.name)} × ${row.qty} <span class="price">${money(row.priceCents * row.qty)}</span>
          <button class="ghost" type="button" data-remove="${esc(row.id)}">Retirer</button></p>`
      )
      .join("") || `<p class="muted">Le panier est vide.</p>`;
}

function openCart() {
  refreshCart();
  document.getElementById("drawer").hidden = false;
  document.getElementById("backdrop").hidden = false;
}

function closeCart() {
  document.getElementById("drawer").hidden = true;
  document.getElementById("backdrop").hidden = true;
}

async function boot() {
  const res = await fetch(`/api/shops/${encodeURIComponent(slug)}`);
  const data = await res.json();
  if (!res.ok) {
    document.getElementById("title").textContent = data.error || "Introuvable";
    return;
  }
  const shop = data.shop;
  document.title = shop.name;
  document.getElementById("title").textContent = shop.name;
  document.getElementById("pitch").textContent = shop.pitch || "";
  document.getElementById("kicker").textContent = tableCode
    ? `Table ${tableCode} · ${shop.addressLine}, ${shop.postalCode} ${shop.city}`
    : `${shop.kind === "resto" ? "Restaurant" : "Boutique"} · ${shop.postalCode} ${shop.city}`;
  const form = document.getElementById("checkout");
  form.addressLine.value = shop.addressLine || "";
  form.postalCode.value = shop.postalCode || "";
  form.city.value = shop.city || "";
  const wa = document.getElementById("wa");
  if (wa && shop.whatsapp) {
    wa.hidden = false;
    wa.href = `https://wa.me/${shop.whatsapp}`;
  }
  document.getElementById("products").innerHTML = (data.products || [])
    .map((product) => {
      const href = `/b/${encodeURIComponent(slug)}/p/${encodeURIComponent(product.id)}${tableCode ? `?table=${encodeURIComponent(tableCode)}` : ""}`;
      const visual = product.image ? `<img alt="" src="${esc(product.image)}" />` : `<div class="ph"></div>`;
      return `<a class="card product-card" href="${href}">
        ${visual}
        <h3>${esc(product.name)}</h3>
        <p class="price">${esc(product.priceLabel)}</p>
        <p class="muted">TTC · TVA 20 %</p>
      </a>`;
    })
    .join("");
  refreshCart();
}

document.getElementById("openCart").addEventListener("click", openCart);
document.getElementById("closeCart").addEventListener("click", closeCart);
document.getElementById("backdrop").addEventListener("click", closeCart);
document.getElementById("lines").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  writeCart(slug, readCart(slug).filter((row) => row.id !== button.dataset.remove));
  refreshCart();
});
document.getElementById("checkout").addEventListener("submit", async (event) => {
  event.preventDefault();
  const msg = document.getElementById("msg");
  const items = readCart(slug);
  if (!items.length) {
    msg.textContent = "Ajoute un article.";
    return;
  }
  msg.textContent = "Envoi…";
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
    payload.order.whatsappUrl ? `<a href="${esc(payload.order.whatsappUrl)}">Envoyer sur WhatsApp</a>` : "Enregistrée."
  }`;
});

boot().catch((error) => {
  document.getElementById("title").textContent = error.message;
});

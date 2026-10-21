const parts = location.pathname.split("/").filter(Boolean);
const slug = parts[0] === "b" ? decodeURIComponent(parts[1] || "") : "";
const tableCode = parts[2] === "t" ? decodeURIComponent(parts[3] || "") : "";
const basket = new Map();

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n) {
  return `${new Intl.NumberFormat("fr-FR").format(Math.round(Number(n) || 0))} FCFA`;
}

function play(video, src, mp4) {
  if (!src) return;
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = src;
    return;
  }
  import("https://esm.sh/hls.js@1.5.17")
    .then((mod) => {
      const Hls = mod.default;
      if (Hls.isSupported()) {
        const player = new Hls();
        player.loadSource(src);
        player.attachMedia(video);
      } else if (mp4) video.src = mp4;
    })
    .catch(() => {
      if (mp4) video.src = mp4;
    });
}

function renderCart() {
  const form = document.getElementById("cart");
  let total = 0;
  for (const item of basket.values()) total += item.priceFcfa * item.qty;
  document.getElementById("total").textContent = money(total);
  form.hidden = basket.size === 0;
}

async function boot() {
  const res = await fetch(`/api/shops/${encodeURIComponent(slug)}`);
  const data = await res.json();
  if (!res.ok) {
    document.getElementById("title").textContent = data.error || "Introuvable";
    return;
  }
  document.title = data.shop.name;
  document.getElementById("title").textContent = data.shop.name;
  document.getElementById("pitch").textContent = data.shop.pitch || "";
  document.getElementById("kicker").textContent = tableCode
    ? `Table ${tableCode} · ${data.shop.city || ""}`
    : `${data.shop.kind === "resto" ? "Restaurant" : "Boutique"} · ${data.shop.city || ""}`;
  if (data.shop.whatsapp) {
    const wa = document.getElementById("wa");
    if (wa) {
      wa.hidden = false;
      wa.href = `https://wa.me/${data.shop.whatsapp}`;
    }
  }
  const root = document.getElementById("products");
  root.innerHTML = (data.products || [])
    .map((product) => {
      const visual = product.image
        ? `<img alt="" src="${esc(product.image)}" />`
        : `<div class="ph"></div>`;
      const video = product.video ? `<video controls playsinline data-hls="${esc(product.video)}"></video>` : "";
      return `<article class="card product">
        ${visual}
        ${video}
        <h3>${esc(product.name)}</h3>
        <p class="muted">${esc(product.description || "")}</p>
        <p class="price">${esc(product.priceLabel || money(product.priceFcfa))}</p>
        <button class="btn" type="button" data-id="${product.id}">Ajouter</button>
      </article>`;
    })
    .join("");
  root.querySelectorAll("video[data-hls]").forEach((video) => play(video, video.dataset.hls, ""));
  root.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-id]");
    if (!button) return;
    const product = data.products.find((row) => row.id === button.dataset.id);
    const current = basket.get(product.id) || { ...product, qty: 0 };
    current.qty += 1;
    basket.set(product.id, current);
    renderCart();
  });
  document.getElementById("cart").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const msg = document.getElementById("msg");
    msg.textContent = "Envoi…";
    const response = await fetch(`/api/shops/${encodeURIComponent(slug)}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: form.get("customerName"),
        customerPhone: form.get("customerPhone"),
        tableCode,
        items: [...basket.values()].map((item) => ({ productId: item.id, qty: item.qty }))
      })
    });
    const body = await response.json();
    if (!response.ok) {
      msg.textContent = body.error || "Commande refusée";
      return;
    }
    msg.innerHTML = `Commande ${body.order.number} · ${body.order.priceLabel}. ${
      body.order.whatsappUrl ? `<a href="${body.order.whatsappUrl}">Envoyer sur WhatsApp</a>` : "Enregistrée."
    }`;
    if (body.order.whatsappUrl) window.open(body.order.whatsappUrl, "_blank", "noopener");
    basket.clear();
    renderCart();
  });
}

boot().catch((error) => {
  document.getElementById("title").textContent = error.message;
});

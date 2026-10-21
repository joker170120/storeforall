const grid = document.getElementById("shops");

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

async function load() {
  const data = await fetch("/api/shops").then((res) => res.json());
  grid.innerHTML = (data.shops || [])
    .map(
      (shop) => `<a class="card" href="/b/${encodeURIComponent(shop.slug)}">
        <p class="kicker">${shop.kind === "resto" ? "Table & menu" : "Boutique"} · ${esc(shop.city || "Gabon")}</p>
        <h2>${esc(shop.name)}</h2>
        <p class="muted">${esc(shop.pitch || "")}</p>
        <p>${shop.open ? "Ouverte" : "Abonnement suspendu"}</p>
      </a>`
    )
    .join("");
}

document.getElementById("open").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form).entries());
  const msg = document.getElementById("openMsg");
  msg.textContent = "Création…";
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    msg.textContent = data.error || "Impossible";
    return;
  }
  localStorage.setItem("storeforall-token", data.token);
  location.href = "/admin/";
});

load().catch((error) => {
  grid.innerHTML = `<p class="error">${error.message}</p>`;
});

window.StoreMoney = { money };

const grid = document.getElementById("shops");

async function load() {
  const [shopsRes, plansRes] = await Promise.all([fetch("/api/shops"), fetch("/api/plans")]);
  const shops = await shopsRes.json();
  const plans = await plansRes.json();
  document.getElementById("plans").innerHTML = (plans.plans || [])
    .map(
      (plan) => `<article class="plan">
        <p class="kicker">${esc(plan.name)}</p>
        <strong>${esc(plan.priceLabel)}</strong>
        <p class="muted">${plan.priceCents ? "par mois" : "pour démarrer"} · commission ${esc(plan.commissionLabel)}</p>
      </article>`
    )
    .join("");
  grid.innerHTML = (shops.shops || [])
    .map(
      (shop) => `<a class="card" href="/b/${encodeURIComponent(shop.slug)}">
        <p class="kicker">${shop.kind === "resto" ? "Restaurant" : "Boutique"} · ${esc(shop.city || "France")}</p>
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
  grid.innerHTML = `<p class="error">${esc(error.message)}</p>`;
});

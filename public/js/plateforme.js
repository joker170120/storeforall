function money(n) {
  return `${new Intl.NumberFormat("fr-FR").format(Math.round(Number(n) || 0))} FCFA`;
}

const tokenKey = "storeforall-platform-token";

async function overview() {
  const token = localStorage.getItem(tokenKey);
  if (!token) return;
  const res = await fetch("/api/platform/overview", { headers: { Authorization: "Bearer " + token } });
  const data = await res.json();
  if (!res.ok) {
    document.getElementById("msg").textContent = data.error || "Refusé";
    return;
  }
  document.getElementById("mrr").textContent = `Abonnements actifs : ${money(data.mrrFcfa)} / mois · commissions dues ${money(data.ledger.commissionDue)}`;
  document.getElementById("shops").innerHTML = (data.shops || [])
    .map(
      (shop) => `<article class="card">
        <h2>${shop.name}</h2>
        <p class="muted">${shop.kind} · ${shop.planId} · ${shop.status}</p>
        <p>${money(shop.priceFcfa)} / mois · commission ${Math.round(shop.commissionRate * 1000) / 10} %</p>
        <p>${shop.orders} commandes · commission due ${money(shop.commissionDue)}</p>
        <div class="row">
          <button class="btn" data-id="${shop.id}" data-plan="boutique" type="button">Boutique</button>
          <button class="btn" data-id="${shop.id}" data-plan="marche" type="button">Marché</button>
          <button class="ghost" data-id="${shop.id}" data-plan="decouverte" data-status="suspendu" type="button">Suspendre</button>
        </div>
      </article>`
    )
    .join("");
}

document.getElementById("login").addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  const res = await fetch("/api/platform/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    document.getElementById("msg").textContent = data.error || "Refusé";
    return;
  }
  localStorage.setItem(tokenKey, data.token);
  await overview();
});

document.getElementById("shops").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-plan]");
  if (!button) return;
  await fetch(`/api/platform/shops/${button.dataset.id}/plan`, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + localStorage.getItem(tokenKey),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ planId: button.dataset.plan, status: button.dataset.status || "" })
  });
  await overview();
});

overview();

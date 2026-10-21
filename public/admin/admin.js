const tokenKey = "storeforall-token";

function token() {
  return localStorage.getItem(tokenKey) || "";
}

function money(n) {
  return `${new Intl.NumberFormat("fr-FR").format(Math.round(Number(n) || 0))} FCFA`;
}

async function api(path, options = {}) {
  const headers = { Authorization: "Bearer " + token(), ...(options.headers || {}) };
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    localStorage.removeItem(tokenKey);
    location.href = "/admin/login.html";
    throw new Error("Reconnecte-toi");
  }
  if (!res.ok) throw new Error(data.error || "Action impossible");
  return data;
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let me = null;

async function boot() {
  if (!token()) {
    location.href = "/admin/login.html";
    return;
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/" }).catch(() => {});
  me = await api("/api/auth/me");
  document.getElementById("shopName").textContent = me.shop.name;
  const sub = me.subscription;
  document.getElementById("planLine").textContent = sub
    ? `${sub.plan.name} · ${sub.status} · commission ${Math.round(sub.commissionRate * 1000) / 10} %`
    : "";
  document.getElementById("logout").addEventListener("click", (event) => {
    event.preventDefault();
    localStorage.removeItem(tokenKey);
    location.href = "/admin/login.html";
  });
  document.querySelector(".tabs").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tab]");
    if (!button) return;
    document.querySelectorAll(".tabs button").forEach((el) => el.classList.toggle("active", el === button));
    for (const section of document.querySelectorAll("main section")) {
      section.hidden = section.id !== button.dataset.tab;
    }
  });
  await Promise.all([products(), orders(), medias(), tables(), offer()]);
}

async function products() {
  const data = await api("/api/admin/products");
  const root = document.getElementById("produits");
  root.innerHTML = `<form class="card" id="newProduct">
      <h2>Nouveau produit</h2>
      <label>Nom<input name="name" required /></label>
      <label>Prix FCFA<input name="priceFcfa" type="number" min="0" required /></label>
      <label>Stock<input name="stock" type="number" min="0" value="10" /></label>
      <label>Description<textarea name="description"></textarea></label>
      <button class="btn" type="submit">Ajouter</button>
    </form>
    <div id="productList"></div>`;
  const list = document.getElementById("productList");
  list.innerHTML = data.products
    .map(
      (product) => `<article class="card">
        <strong>${esc(product.name)}</strong>
        <div class="price">${money(product.priceFcfa)}</div>
        <p class="muted">${esc(product.description || "")} · stock ${product.stock} · ${product.active ? "visible" : "masqué"}</p>
        ${product.image ? `<img alt="" src="${esc(product.image)}" style="max-width:160px;border-radius:12px" />` : ""}
      </article>`
    )
    .join("");
  document.getElementById("newProduct").addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    body.priceFcfa = Number(body.priceFcfa);
    body.stock = Number(body.stock);
    await api("/api/admin/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await products();
  });
}

async function orders() {
  const data = await api("/api/admin/orders");
  const root = document.getElementById("commandes");
  root.innerHTML =
    data.orders
      .map(
        (order) => `<article class="card" data-id="${order.id}">
          <strong>${esc(order.number)}</strong> · ${esc(order.status)}
          <div class="price">${money(order.subtotalFcfa)}</div>
          <p class="muted">${esc(order.customerName)} ${order.tableCode ? "· table " + esc(order.tableCode) : ""} · commission ${money(order.commissionFcfa)}</p>
          <div class="row">
            <button type="button" data-status="confirmee">Confirmer</button>
            <button type="button" data-status="payee">Payée</button>
            <button type="button" data-status="annulee">Annuler</button>
            ${order.whatsappUrl ? `<a href="${esc(order.whatsappUrl)}">WhatsApp</a>` : ""}
          </div>
        </article>`
      )
      .join("") || `<p class="muted">Aucune commande.</p>`;
  root.onclick = async (event) => {
    const button = event.target.closest("button[data-status]");
    if (!button) return;
    const card = button.closest("[data-id]");
    await api(`/api/admin/orders/${card.dataset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: button.dataset.status })
    });
    await orders();
    await offer();
  };
}

async function putPart(url, chunk) {
  const res = await fetch(url, { method: "PUT", body: chunk });
  if (!res.ok) throw new Error("Morceau interrompu. Réessaie : les parties déjà envoyées sont reprises.");
  const header = res.headers.get("etag");
  if (header) return header;
  const data = await res.json().catch(() => ({}));
  if (!data.etag) throw new Error("Le stockage n'a pas renvoyé l'identifiant de la partie (ETag).");
  return data.etag;
}

async function uploadFile(file, rightsAccepted, onProgress) {
  if (!rightsAccepted) throw new Error("Coche la case : tu dois certifier détenir les droits sur ce fichier.");
  const isImage = file.type.startsWith("image/");
  let prepared = file;
  if (isImage) {
    onProgress("Compression de la photo…");
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (blob) prepared = new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  }
  const resumeKey = `sf-upload:${file.name}:${prepared.size}`;
  let session = null;
  try {
    session = JSON.parse(sessionStorage.getItem(resumeKey) || "null");
  } catch (_) {
    session = null;
  }
  if (!session) {
    const started = await api("/api/upload-multipart/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: prepared.name,
        contentType: prepared.type || (prepared.name.endsWith(".mp4") ? "video/mp4" : "image/jpeg"),
        size: prepared.size,
        originalSize: file.size,
        rightsAccepted: true
      })
    });
    session = { mediaId: started.mediaId, uploadId: started.uploadId, partSize: started.partSize, parts: [] };
    sessionStorage.setItem(resumeKey, JSON.stringify(session));
  }
  const remote = await api(`/api/upload-multipart/parts?mediaId=${encodeURIComponent(session.mediaId)}`);
  const done = new Map((remote.parts || session.parts || []).map((part) => [Number(part.partNumber), part.etag]));
  const partSize = remote.partSize || session.partSize;
  const total = Math.max(1, Math.ceil(prepared.size / partSize));
  for (let n = 1; n <= total; n += 1) {
    if (done.get(n)) {
      onProgress(`Reprise ${n} / ${total}`);
      continue;
    }
    const signed = await api("/api/upload-multipart/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId: session.mediaId, partNumber: n })
    });
    const chunk = prepared.slice((n - 1) * partSize, Math.min(prepared.size, n * partSize));
    const etag = await putPart(signed.url, chunk);
    done.set(n, etag);
    session.parts = [...done.entries()].map(([partNumber, etagValue]) => ({ partNumber, etag: etagValue }));
    sessionStorage.setItem(resumeKey, JSON.stringify(session));
    onProgress(`Envoi ${n} / ${total}`);
  }
  const finished = await api("/api/upload-multipart/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mediaId: session.mediaId,
      parts: [...done.entries()].map(([partNumber, etag]) => ({ partNumber, etag }))
    })
  });
  sessionStorage.removeItem(resumeKey);
  return finished.media;
}

async function medias() {
  const data = await api("/api/mes-medias");
  const root = document.getElementById("medias");
  root.innerHTML = `<form class="card" id="mediaForm">
      <h2>Photo ou vidéo</h2>
      <p class="muted">Morceaux, puis compression, Wasabi (ou disque local), Bunny et HLS. Tu ne vois que ta boutique. Limite 5 Go.</p>
      <label>Fichier<input name="file" type="file" accept="image/jpeg,image/png,video/mp4" required /></label>
      <label class="row"><input name="rights" type="checkbox" style="width:auto" required /> <span>Je certifie détenir les droits sur ce fichier.</span></label>
      <progress id="mediaBar" value="0" max="100" hidden></progress>
      <p id="mediaMsg" class="muted"></p>
      <button class="btn" type="submit">Envoyer</button>
    </form>
    <div id="mediaList"></div>`;
  document.getElementById("mediaList").innerHTML =
    data.medias
      .map((media) => {
        const step = media.pipeline || {};
        return `<article class="card">
          <strong>${esc(media.fileName)}</strong>
          <p class="muted">${esc(media.statut)} · ${media.taille_apres_compression || media.size} o · ${esc(step.compression?.tool || "")} · ${esc(step.wasabi?.driver || "")}</p>
          ${media.url_hls ? `<p>HLS prêt</p><video controls playsinline src="${esc(media.url_hls)}" style="width:100%"></video>` : ""}
          ${media.type !== "video" && media.url ? `<img alt="" src="${esc(media.url)}" style="max-width:180px;border-radius:12px" />` : ""}
          <div class="row">
            <button type="button" data-cover="${media.id}">Photo du dernier produit</button>
            <button type="button" data-del="${media.id}">Supprimer</button>
          </div>
        </article>`;
      })
      .join("") || `<p class="muted">Aucun média.</p>`;
  document.getElementById("mediaForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.file.files[0];
    const msg = document.getElementById("mediaMsg");
    try {
      msg.textContent = "Préparation…";
      await uploadFile(file, form.rights.checked, (label) => {
        msg.textContent = label;
      });
      msg.textContent = "Publié. La vidéo HLS se prépare ensuite.";
      await medias();
    } catch (error) {
      msg.textContent = error.message;
    }
  });
  document.getElementById("mediaList").onclick = async (event) => {
    const del = event.target.closest("[data-del]");
    const cover = event.target.closest("[data-cover]");
    if (del) {
      await api(`/api/mes-medias/${del.dataset.del}`, { method: "DELETE" });
      await medias();
    }
    if (cover) {
      const productsData = await api("/api/admin/products");
      const product = productsData.products[0];
      if (!product) return;
      await api(`/api/admin/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: cover.dataset.cover })
      });
      await products();
    }
  };
}

async function tables() {
  const root = document.getElementById("tables");
  if (me.shop.kind !== "resto") {
    root.innerHTML = `<p class="muted">Les QR de table sont réservés au bar et au restaurant.</p>`;
    return;
  }
  const data = await api("/api/admin/tables");
  root.innerHTML = `<form class="card" id="newTable">
      <h2>Nouvelle table</h2>
      <label>Code<input name="code" placeholder="T5" required /></label>
      <label>Nom<input name="label" placeholder="Terrasse" /></label>
      <button class="btn" type="submit">Ajouter</button>
    </form>` + data.tables
    .map(
      (table) => `<article class="card">
        <strong>${esc(table.label)} · ${esc(table.code)}</strong>
        <p><img class="qr" alt="QR ${esc(table.code)}" src="/api/admin/tables/${encodeURIComponent(table.code)}/qr.svg" /></p>
        <a href="${esc(table.url)}">${esc(table.url)}</a>
      </article>`
    )
    .join("");
  const imgAuth = root.querySelectorAll("img.qr");
  for (const img of imgAuth) {
    const res = await fetch(img.getAttribute("src"), { headers: { Authorization: "Bearer " + token() } });
    if (!res.ok) continue;
    const blob = await res.blob();
    img.src = URL.createObjectURL(blob);
  }
  document.getElementById("newTable").addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    await api("/api/admin/tables", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await tables();
  });
}

async function offer() {
  const data = await api("/api/admin/billing");
  const root = document.getElementById("offre");
  const ledger = data.ledger || {};
  root.innerHTML = `<article class="card">
      <h2>${esc(data.plan?.name || "Offre")}</h2>
      <p>Abonnement ${money(data.subscription?.priceFcfa || 0)} / mois · commission ${Math.round((data.subscription?.commissionRate || 0) * 1000) / 10} %</p>
      <p class="muted">Commission due ${money(ledger.commissionDue)} · encaissée ${money(ledger.commissionEncaissee)}</p>
      <p class="muted">L'offre se change depuis l'espace plateforme.</p>
    </article>`;
}

boot().catch((error) => {
  document.body.insertAdjacentHTML("beforeend", `<p class="card">${esc(error.message)}</p>`);
});

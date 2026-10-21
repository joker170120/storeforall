const { randomUUID } = require("crypto");
const bunny = require("./bunny");

function ensure(store) {
  if (!Array.isArray(store.medias)) store.medias = [];
  return store.medias;
}

function listByShop(store, shopId) {
  return ensure(store)
    .filter((row) => String(row.id_boutique || row.shopId) === String(shopId))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function findOwned(store, mediaId, shopId) {
  return ensure(store).find(
    (row) =>
      String(row.id) === String(mediaId) && String(row.id_boutique || row.shopId) === String(shopId)
  );
}

function usedBytes(store, shopId) {
  return listByShop(store, shopId).reduce((sum, row) => {
    if (row.statut === "pending" || row.status === "pending") return sum;
    return sum + (Number(row.taille_apres_compression || row.size) || 0);
  }, 0);
}

function createPending(store, payload) {
  const typeFichier = payload.type === "video" ? "video" : "image";
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(),
    id_admin: String(payload.adminId || ""),
    id_boutique: String(payload.shopId),
    shopId: String(payload.shopId),
    key: String(payload.key),
    uploadId: String(payload.uploadId || ""),
    url: String(payload.url || ""),
    url_wasabi: String(payload.url || ""),
    url_bunny: "",
    url_hls: "",
    publishedUrl: "",
    type: typeFichier === "video" ? "video" : "photo",
    type_fichier: typeFichier,
    fileName: String(payload.fileName || ""),
    mimeType: String(payload.mimeType || ""),
    size: Number(payload.size) || 0,
    taille_originale: Number(payload.originalSize) || Number(payload.size) || 0,
    taille_apres_compression: Number(payload.size) || 0,
    duree_video: payload.duration == null || payload.duration === "" ? null : Number(payload.duration),
    resolution: String(payload.resolution || ""),
    date_upload: now,
    status: "pending",
    statut: "pending",
    pipeline: {
      chunk: { ok: false },
      compression: { ok: false },
      wasabi: { ok: false },
      bunny: { branched: true, ok: false },
      hls: { ok: false }
    },
    createdAt: Date.now(),
    publishedAt: null
  };
  ensure(store).push(row);
  return row;
}

function displayUrl(row) {
  return row.url_hls || row.url_bunny || row.publishedUrl || row.url_wasabi || row.url || "";
}

function toPublic(row) {
  if (!row) return null;
  const bunnyUrl = row.url_bunny || bunny.cdnUrlForKey(row.key) || "";
  return {
    id: row.id,
    id_boutique: row.id_boutique || row.shopId,
    shopId: row.shopId || row.id_boutique,
    url: row.url_hls || bunnyUrl || row.url_wasabi || row.url,
    url_mp4: row.type_fichier === "video" || row.type === "video" ? row.url_bunny || row.url_wasabi || row.url : "",
    url_wasabi: row.url_wasabi || row.url,
    url_bunny: bunnyUrl,
    url_hls: row.url_hls || "",
    type: row.type,
    type_fichier: row.type_fichier || (row.type === "video" ? "video" : "image"),
    fileName: row.fileName,
    mimeType: row.mimeType,
    size: row.taille_apres_compression || row.size,
    taille_originale: row.taille_originale || row.size || 0,
    taille_apres_compression: row.taille_apres_compression || row.size || 0,
    status: row.statut || row.status,
    statut: row.statut || row.status,
    pipeline: row.pipeline || {},
    key: row.key,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt || null
  };
}

function removeOwned(store, mediaId, shopId) {
  const list = ensure(store);
  const idx = list.findIndex(
    (row) =>
      String(row.id) === String(mediaId) && String(row.id_boutique || row.shopId) === String(shopId)
  );
  if (idx < 0) return null;
  return list.splice(idx, 1)[0];
}

module.exports = { listByShop, findOwned, usedBytes, createPending, toPublic, removeOwned, displayUrl };

const express = require("express");
const wasabi = require("../lib/wasabi");
const mediaRepo = require("../lib/media-repo");
const pipeline = require("../lib/pipeline");
const hls = require("../lib/hls-job");
const store = require("../lib/store");
const { sessionFromRequest } = require("../lib/auth");

const QUOTA_MSG = "Vous avez atteint votre limite de stockage de 5 Go pour votre boutique";

function createMediaRouter() {
  const router = express.Router();

  function requireAdmin(req, res) {
    const auth = sessionFromRequest(store.read(), req);
    if (auth?.role === "merchant") return auth;
    res.status(401).json({ error: "Connexion administrateur de boutique requise." });
    return null;
  }

  async function spaceUsed(shopId, data) {
    try {
      return await wasabi.usedBytes(shopId);
    } catch (_) {
      return mediaRepo.usedBytes(data, shopId);
    }
  }

  async function assertRoom(shopId, incoming, data) {
    const used = await spaceUsed(shopId, data);
    const limit = wasabi.SHOP_QUOTA_BYTES;
    if (used >= limit || used + Number(incoming || 0) > limit) {
      const err = new Error(QUOTA_MSG);
      err.status = 413;
      throw err;
    }
  }

  function rightsOk(body) {
    return body?.rightsAccepted === true || body?.rightsAccepted === "true";
  }

  router.get("/api/upload-presigned/config", (_req, res) => {
    res.json({
      ok: true,
      enabled: wasabi.isConfigured(),
      driver: wasabi.driver(),
      pipeline: ["chunk", "compression", "wasabi", "bunny", "hls"],
      imageMaxBytes: wasabi.IMAGE_MAX,
      videoMaxBytes: wasabi.VIDEO_MAX,
      quotaBytes: wasabi.SHOP_QUOTA_BYTES,
      partSize: wasabi.partSize(),
      bunnyHost: require("../lib/bunny").hostname(),
      allowed: ["image/jpeg", "image/png", "video/mp4"]
    });
  });

  router.get("/api/mes-medias/espace", async (req, res) => {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    const data = store.read();
    const used = await spaceUsed(auth.shop.id, data);
    const limit = wasabi.SHOP_QUOTA_BYTES;
    res.json({
      ok: true,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      full: used >= limit,
      message: used >= limit ? QUOTA_MSG : ""
    });
  });

  router.get("/api/mes-medias", (req, res) => {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    const data = store.read();
    res.json({ ok: true, medias: mediaRepo.listByShop(data, auth.shop.id).map(mediaRepo.toPublic) });
  });

  router.get("/api/mes-medias/:id", (req, res) => {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    const row = mediaRepo.findOwned(store.read(), req.params.id, auth.shop.id);
    if (!row) return res.status(404).json({ error: "Média introuvable" });
    res.json({ ok: true, media: mediaRepo.toPublic(row) });
  });

  router.post("/api/upload-multipart/start", async (req, res) => {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    if (!rightsOk(req.body)) {
      return res.status(400).json({
        error: "Coche la case : tu dois certifier détenir les droits sur ce fichier."
      });
    }
    try {
      const size = Number(req.body?.size || 0);
      const data = store.read();
      await assertRoom(auth.shop.id, size, data);
      const signed = await wasabi.createMultipart({
        shopId: auth.shop.id,
        fileName: req.body?.fileName || "fichier",
        contentType: req.body?.contentType || "",
        size
      });
      const pending = await store.update((current) => {
        return mediaRepo.createPending(current, {
          shopId: auth.shop.id,
          adminId: auth.admin.id,
          key: signed.key,
          uploadId: signed.uploadId,
          url: signed.publicUrl,
          type: signed.type,
          fileName: signed.fileName,
          mimeType: signed.contentType,
          size: signed.size,
          originalSize: Number(req.body?.originalSize || size),
          duration: req.body?.duration,
          resolution: req.body?.resolution || ""
        });
      });
      res.status(201).json({
        ok: true,
        mediaId: pending.id,
        uploadId: signed.uploadId,
        key: signed.key,
        publicUrl: signed.publicUrl,
        partSize: signed.partSize,
        contentType: signed.contentType,
        type: signed.type
      });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message || "Démarrage impossible" });
    }
  });

  router.post("/api/upload-multipart/sign", async (req, res) => {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    const data = store.read();
    const row = mediaRepo.findOwned(data, req.body?.mediaId, auth.shop.id);
    if (!row || !row.uploadId) return res.status(404).json({ error: "Upload introuvable" });
    try {
      wasabi.assertKeyBelongsToShop(row.key, auth.shop.id);
      const signed = await wasabi.signUploadPart({
        shopId: auth.shop.id,
        key: row.key,
        uploadId: row.uploadId,
        partNumber: req.body?.partNumber,
        mediaId: row.id
      });
      res.json({ ok: true, url: signed.url, partNumber: signed.partNumber });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message || "Signature impossible" });
    }
  });

  router.put(
    "/api/upload-multipart/raw",
    express.raw({ type: () => true, limit: "12mb" }),
    (req, res) => {
      try {
        const saved = wasabi.writeLocalPart({
          mediaId: req.query.mediaId,
          uploadId: req.query.uploadId,
          partNumber: req.query.partNumber,
          body: req.body,
          query: req.query
        });
        res.setHeader("Access-Control-Expose-Headers", "ETag");
        res.setHeader("ETag", saved.etag);
        res.status(200).json({ ok: true, etag: saved.etag, partNumber: saved.partNumber });
      } catch (error) {
        res.status(error.status || 400).json({ error: error.message || "Morceau refusé" });
      }
    }
  );

  router.get("/api/upload-multipart/parts", async (req, res) => {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    const row = mediaRepo.findOwned(store.read(), req.query.mediaId, auth.shop.id);
    if (!row || !row.uploadId) return res.status(404).json({ error: "Upload introuvable" });
    try {
      const parts = await wasabi.listUploadedParts({
        shopId: auth.shop.id,
        key: row.key,
        uploadId: row.uploadId
      });
      res.json({ ok: true, mediaId: row.id, uploadId: row.uploadId, partSize: wasabi.partSize(), parts });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message || "Liste des parties impossible" });
    }
  });

  router.post("/api/upload-multipart/complete", async (req, res) => {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    const current = store.read();
    const row = mediaRepo.findOwned(current, req.body?.mediaId, auth.shop.id);
    if (!row) return res.status(404).json({ error: "Média introuvable" });
    try {
      await wasabi.completeMultipart({
        shopId: auth.shop.id,
        key: row.key,
        uploadId: row.uploadId,
        parts: req.body?.parts
      });
      const finished = await pipeline.finish(row);
      const published = await store.update((data) => {
        const owned = mediaRepo.findOwned(data, row.id, auth.shop.id);
        if (!owned) return null;
        Object.assign(owned, finished, {
          status: "publié",
          statut: "publié",
          publishedAt: Date.now(),
          uploadId: ""
        });
        return mediaRepo.toPublic(owned);
      });
      if ((published.type_fichier === "video" || published.type === "video") && finished.pipeline.compression) {
        const fresh = mediaRepo.findOwned(store.read(), row.id, auth.shop.id);
        hls.schedule(fresh);
      }
      res.json({ ok: true, media: published });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message || "Finalisation impossible" });
    }
  });

  router.post("/api/upload-multipart/abort", async (req, res) => {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    const row = mediaRepo.findOwned(store.read(), req.body?.mediaId, auth.shop.id);
    if (!row) return res.status(404).json({ error: "Média introuvable" });
    try {
      if (row.uploadId && row.statut !== "publié") {
        try {
          await wasabi.abortMultipart({ shopId: auth.shop.id, key: row.key, uploadId: row.uploadId });
        } catch (_) {}
      }
      await store.update((data) => mediaRepo.removeOwned(data, row.id, auth.shop.id));
      res.json({ ok: true });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message || "Annulation impossible" });
    }
  });

  router.delete("/api/mes-medias/:id", async (req, res) => {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    const row = mediaRepo.findOwned(store.read(), req.params.id, auth.shop.id);
    if (!row) return res.status(404).json({ error: "Média introuvable" });
    try {
      wasabi.assertKeyBelongsToShop(row.key, auth.shop.id);
      await wasabi.deleteObject(row.key).catch(() => {});
      if (row.hls_key) {
        await wasabi.deletePrefix(String(row.hls_key).replace(/master\.m3u8$/, "")).catch(() => {});
      }
      await store.update((data) => {
        mediaRepo.removeOwned(data, row.id, auth.shop.id);
        for (const product of data.products || []) {
          if (product.shopId === auth.shop.id && product.mediaId === row.id) {
            product.mediaId = "";
            product.image = "";
            product.video = "";
          }
        }
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message || "Suppression impossible" });
    }
  });

  return router;
}

module.exports = { createMediaRouter };

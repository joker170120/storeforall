const express = require("express");
const { randomUUID } = require("crypto");
const QRCode = require("qrcode");
const store = require("../lib/store");
const { hashPassword, verifyPassword, issueSession, sessionFromRequest } = require("../lib/auth");
const { formatFcfa } = require("../lib/money");
const { PLANS, planById, publicPlan, subscriptionLive } = require("../lib/plans");
const billing = require("../lib/billing");
const { orderLink, digits } = require("../lib/whatsapp");
const mediaRepo = require("../lib/media-repo");

const RESERVED = new Set(["admin", "api", "media", "plateforme", "b", "public", "uploads"]);
const hits = new Map();

function limited(key, max, windowMs) {
  const now = Date.now();
  const next = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (next.length >= max) return false;
  next.push(now);
  hits.set(key, next);
  return true;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function publicBase() {
  return String(process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4180}`).replace(/\/$/, "");
}

function publicShop(data, shop) {
  const sub = billing.shopSub(data, shop.id);
  return {
    id: shop.id,
    slug: shop.slug,
    name: shop.name,
    kind: shop.kind,
    city: shop.city || "",
    pitch: shop.pitch || "",
    whatsapp: shop.whatsapp || "",
    open: subscriptionLive(sub)
  };
}

function publicProduct(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    priceFcfa: row.priceFcfa,
    priceLabel: formatFcfa(row.priceFcfa),
    image: row.image || "",
    video: row.video || "",
    stock: row.stock
  };
}

function requireMerchant(req, res) {
  const auth = sessionFromRequest(store.read(), req);
  if (auth?.role !== "merchant") {
    res.status(401).json({ error: "Connexion marchand requise." });
    return null;
  }
  return auth;
}

function requirePlatform(req, res) {
  const auth = sessionFromRequest(store.read(), req);
  if (auth?.role !== "platform") {
    res.status(401).json({ error: "Connexion plateforme requise." });
    return null;
  }
  return auth;
}

function shopBySlug(data, slug) {
  return (data.shops || []).find((shop) => shop.slug === slug) || null;
}

function createApiRouter() {
  const router = express.Router();

  router.get("/api/health", (_req, res) => {
    const { ffmpegAvailable } = require("../lib/compress");
    const wasabi = require("../lib/wasabi");
    const bunny = require("../lib/bunny");
    res.json({
      ok: true,
      service: "storeforall",
      media: {
        driver: wasabi.driver(),
        wasabi: wasabi.isConfigured(),
        bunny: bunny.configured(),
        ffmpeg: ffmpegAvailable(),
        pipeline: ["chunk", "compression", "wasabi", "bunny", "hls"]
      }
    });
  });

  router.get("/api/plans", (_req, res) => {
    res.json({ ok: true, plans: Object.values(PLANS).map(publicPlan) });
  });

  router.get("/api/shops", (_req, res) => {
    const data = store.read();
    res.json({ ok: true, shops: (data.shops || []).map((shop) => publicShop(data, shop)) });
  });

  router.get("/api/shops/:slug", (req, res) => {
    const data = store.read();
    const shop = shopBySlug(data, req.params.slug);
    if (!shop) return res.status(404).json({ error: "Boutique introuvable" });
    const products = (data.products || [])
      .filter((row) => row.shopId === shop.id && row.active !== false)
      .map(publicProduct);
    const tables =
      shop.kind === "resto"
        ? (data.tables || []).filter((row) => row.shopId === shop.id).map((row) => ({ code: row.code, label: row.label }))
        : [];
    res.json({ ok: true, shop: publicShop(data, shop), products, tables });
  });

  router.post("/api/shops/:slug/orders", async (req, res) => {
    const data = store.read();
    const shop = shopBySlug(data, req.params.slug);
    if (!shop) return res.status(404).json({ error: "Boutique introuvable" });
    const sub = billing.shopSub(data, shop.id);
    if (!subscriptionLive(sub)) {
      return res.status(402).json({ error: "L'abonnement de cette boutique est suspendu." });
    }
    try {
      const order = await store.update((current) => {
        const live = current.shops.find((row) => row.id === shop.id);
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        if (!items.length) {
          const err = new Error("Panier vide.");
          err.status = 400;
          throw err;
        }
        const lines = [];
        for (const item of items) {
          const product = (current.products || []).find(
            (row) => row.id === item.productId && row.shopId === live.id && row.active !== false
          );
          const qty = Math.round(Number(item.qty));
          if (!product || qty < 1 || qty > 99) {
            const err = new Error("Article invalide.");
            err.status = 400;
            throw err;
          }
          lines.push({
            productId: product.id,
            name: product.name,
            qty,
            priceFcfa: product.priceFcfa,
            lineFcfa: product.priceFcfa * qty
          });
        }
        const tableCode = String(req.body?.tableCode || "").trim();
        if (tableCode) {
          const table = (current.tables || []).find((row) => row.shopId === live.id && row.code === tableCode);
          if (!table) {
            const err = new Error("Table introuvable.");
            err.status = 404;
            throw err;
          }
        }
        const customerName = String(req.body?.customerName || "").trim();
        if (customerName.length < 2) {
          const err = new Error("Indique ton nom.");
          err.status = 400;
          throw err;
        }
        current.orderSeq = Number(current.orderSeq || 1000) + 1;
        const subtotalFcfa = lines.reduce((sum, line) => sum + line.lineFcfa, 0);
        const order = {
          id: randomUUID(),
          shopId: live.id,
          number: `SF-${current.orderSeq}`,
          items: lines,
          subtotalFcfa,
          customerName,
          customerPhone: digits(req.body?.customerPhone),
          tableCode,
          channel: tableCode ? "table" : "vitrine",
          status: "nouvelle",
          createdAt: Date.now()
        };
        billing.recordCommission(current, live, order);
        order.whatsappUrl = orderLink(live, order);
        current.orders.push(order);
        return {
          id: order.id,
          number: order.number,
          subtotalFcfa: order.subtotalFcfa,
          priceLabel: formatFcfa(order.subtotalFcfa),
          status: order.status,
          tableCode: order.tableCode,
          whatsappUrl: order.whatsappUrl
        };
      });
      res.status(201).json({ ok: true, order });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message || "Commande impossible" });
    }
  });

  router.post("/api/auth/register", async (req, res) => {
    if (!limited(req.ip + ":register", 10, 10 * 60 * 1000)) {
      return res.status(429).json({ error: "Trop d'inscriptions. Réessaie dans quelques minutes." });
    }
    const shopName = String(req.body?.shopName || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const kind = req.body?.kind === "resto" ? "resto" : "boutique";
    if (shopName.length < 2 || !email.includes("@") || password.length < 8) {
      return res.status(400).json({ error: "Nom, e-mail et mot de passe (8 caractères) sont requis." });
    }
    let slug = slugify(req.body?.slug || shopName);
    if (!slug || RESERVED.has(slug)) return res.status(400).json({ error: "Adresse de boutique invalide." });
    try {
      const result = await store.update((current) => {
        if ((current.shops || []).some((shop) => shop.slug === slug)) {
          const err = new Error("Cette adresse de boutique est déjà prise.");
          err.status = 409;
          throw err;
        }
        if ((current.admins || []).some((admin) => admin.email === email)) {
          const err = new Error("Cet e-mail a déjà une boutique.");
          err.status = 409;
          throw err;
        }
        const shop = {
          id: randomUUID(),
          slug,
          name: shopName,
          kind,
          city: String(req.body?.city || "").trim(),
          whatsapp: digits(req.body?.whatsapp),
          pitch: String(req.body?.pitch || "").trim(),
          createdAt: Date.now()
        };
        const admin = {
          id: randomUUID(),
          shopId: shop.id,
          email,
          name: String(req.body?.ownerName || shopName).trim(),
          passwordHash: hashPassword(password),
          createdAt: Date.now()
        };
        current.shops.push(shop);
        current.admins.push(admin);
        const sub = billing.applyPlan(current, shop.id, "decouverte", "essai");
        const token = issueSession(current, { shopId: shop.id, adminId: admin.id, role: "merchant" });
        return { token, shop: publicShop(current, shop), plan: publicPlan(planById(sub.planId)) };
      });
      res.status(201).json({ ok: true, ...result });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message || "Inscription impossible" });
    }
  });

  router.post("/api/auth/login", async (req, res) => {
    if (!limited(req.ip + ":login", 20, 10 * 60 * 1000)) {
      return res.status(429).json({ error: "Trop de tentatives." });
    }
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const data = store.read();
    const admin = (data.admins || []).find((row) => row.email === email);
    if (!admin || !verifyPassword(password, admin.passwordHash)) {
      return res.status(401).json({ error: "E-mail ou mot de passe incorrect." });
    }
    const token = await store.update((current) => {
      const row = current.admins.find((item) => item.id === admin.id);
      return issueSession(current, { shopId: row.shopId, adminId: row.id, role: "merchant" });
    });
    const shop = data.shops.find((row) => row.id === admin.shopId);
    res.json({ ok: true, token, shop: publicShop(data, shop) });
  });

  router.get("/api/auth/me", (req, res) => {
    const auth = requireMerchant(req, res);
    if (!auth) return;
    const data = store.read();
    const sub = billing.shopSub(data, auth.shop.id);
    res.json({
      ok: true,
      shop: publicShop(data, auth.shop),
      admin: { id: auth.admin.id, email: auth.admin.email, name: auth.admin.name },
      subscription: sub
        ? {
            planId: sub.planId,
            plan: publicPlan(planById(sub.planId)),
            status: sub.status,
            renewsAt: sub.renewsAt,
            live: subscriptionLive(sub),
            priceFcfa: sub.priceFcfa,
            commissionRate: sub.commissionRate
          }
        : null
    });
  });

  router.get("/api/admin/products", (req, res) => {
    const auth = requireMerchant(req, res);
    if (!auth) return;
    const rows = (store.read().products || []).filter((row) => row.shopId === auth.shop.id);
    res.json({ ok: true, products: rows });
  });

  router.post("/api/admin/products", async (req, res) => {
    const auth = requireMerchant(req, res);
    if (!auth) return;
    const name = String(req.body?.name || "").trim();
    const priceFcfa = Math.round(Number(req.body?.priceFcfa));
    if (name.length < 2 || !Number.isFinite(priceFcfa) || priceFcfa < 0) {
      return res.status(400).json({ error: "Nom et prix FCFA requis." });
    }
    const created = await store.update((current) => {
      const row = {
        id: randomUUID(),
        shopId: auth.shop.id,
        name,
        description: String(req.body?.description || "").trim(),
        priceFcfa,
        stock: Math.max(0, Math.round(Number(req.body?.stock ?? 0))),
        active: true,
        image: "",
        mediaId: "",
        video: "",
        createdAt: Date.now()
      };
      attachMedia(current, auth.shop.id, row, req.body?.mediaId);
      current.products.push(row);
      return row;
    });
    res.status(201).json({ ok: true, product: created });
  });

  router.patch("/api/admin/products/:id", async (req, res) => {
    const auth = requireMerchant(req, res);
    if (!auth) return;
    try {
      const product = await store.update((current) => {
        const row = (current.products || []).find((item) => item.id === req.params.id && item.shopId === auth.shop.id);
        if (!row) {
          const err = new Error("Produit introuvable");
          err.status = 404;
          throw err;
        }
        if (req.body?.name != null) row.name = String(req.body.name).trim();
        if (req.body?.description != null) row.description = String(req.body.description).trim();
        if (req.body?.priceFcfa != null) row.priceFcfa = Math.max(0, Math.round(Number(req.body.priceFcfa) || 0));
        if (req.body?.stock != null) row.stock = Math.max(0, Math.round(Number(req.body.stock) || 0));
        if (req.body?.active != null) row.active = Boolean(req.body.active);
        if (req.body?.mediaId != null) attachMedia(current, auth.shop.id, row, req.body.mediaId);
        return row;
      });
      res.json({ ok: true, product });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message || "Mise à jour impossible" });
    }
  });

  router.get("/api/admin/orders", (req, res) => {
    const auth = requireMerchant(req, res);
    if (!auth) return;
    const orders = (store.read().orders || [])
      .filter((row) => row.shopId === auth.shop.id)
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ ok: true, orders });
  });

  router.get("/api/admin/orders/:id", (req, res) => {
    const auth = requireMerchant(req, res);
    if (!auth) return;
    const order = (store.read().orders || []).find((row) => row.id === req.params.id && row.shopId === auth.shop.id);
    if (!order) return res.status(404).json({ error: "Commande introuvable" });
    res.json({ ok: true, order });
  });

  router.patch("/api/admin/orders/:id", async (req, res) => {
    const auth = requireMerchant(req, res);
    if (!auth) return;
    const status = String(req.body?.status || "");
    const allowed = new Set(["nouvelle", "confirmee", "payee", "annulee"]);
    if (!allowed.has(status)) return res.status(400).json({ error: "Statut inconnu." });
    try {
      const order = await store.update((current) => {
        const row = (current.orders || []).find((item) => item.id === req.params.id && item.shopId === auth.shop.id);
        if (!row) {
          const err = new Error("Commande introuvable");
          err.status = 404;
          throw err;
        }
        row.status = status;
        if (status === "payee") billing.setCommissionStatus(current, row.id, "encaissee");
        if (status === "annulee") billing.setCommissionStatus(current, row.id, "annulee");
        if (status === "confirmee" || status === "nouvelle") billing.setCommissionStatus(current, row.id, "due");
        return row;
      });
      res.json({ ok: true, order });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message || "Mise à jour impossible" });
    }
  });

  router.get("/api/admin/billing", (req, res) => {
    const auth = requireMerchant(req, res);
    if (!auth) return;
    const data = store.read();
    const sub = billing.shopSub(data, auth.shop.id);
    res.json({
      ok: true,
      subscription: sub,
      plan: sub ? publicPlan(planById(sub.planId)) : null,
      live: subscriptionLive(sub),
      plans: Object.values(PLANS).map(publicPlan),
      ledger: billing.sumLedger(data, auth.shop.id),
      lines: (data.ledger || []).filter((row) => row.shopId === auth.shop.id).slice(-30).reverse()
    });
  });

  router.get("/api/admin/tables", (req, res) => {
    const auth = requireMerchant(req, res);
    if (!auth) return;
    const tables = (store.read().tables || []).filter((row) => row.shopId === auth.shop.id);
    res.json({
      ok: true,
      tables: tables.map((row) => ({
        ...row,
        url: `${publicBase()}/b/${auth.shop.slug}/t/${encodeURIComponent(row.code)}`
      }))
    });
  });

  router.post("/api/admin/tables", async (req, res) => {
    const auth = requireMerchant(req, res);
    if (!auth) return;
    if (auth.shop.kind !== "resto") return res.status(400).json({ error: "Les QR de table sont réservés au bar et au restaurant." });
    const label = String(req.body?.label || "").trim();
    const code = String(req.body?.code || label).trim().replace(/\s+/g, "").slice(0, 12);
    if (!code) return res.status(400).json({ error: "Code de table requis." });
    try {
      const table = await store.update((current) => {
        if ((current.tables || []).some((row) => row.shopId === auth.shop.id && row.code === code)) {
          const err = new Error("Ce code existe déjà.");
          err.status = 409;
          throw err;
        }
        const row = { id: randomUUID(), shopId: auth.shop.id, code, label: label || code };
        current.tables.push(row);
        return row;
      });
      res.status(201).json({ ok: true, table });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message || "Table impossible" });
    }
  });

  router.get("/api/admin/tables/:code/qr.svg", async (req, res) => {
    const auth = requireMerchant(req, res);
    if (!auth) return;
    const table = (store.read().tables || []).find((row) => row.shopId === auth.shop.id && row.code === req.params.code);
    if (!table) return res.status(404).json({ error: "Table introuvable" });
    const url = `${publicBase()}/b/${auth.shop.slug}/t/${encodeURIComponent(table.code)}`;
    const svg = await QRCode.toString(url, { type: "svg", margin: 1, width: 280 });
    res.type("image/svg+xml").send(svg);
  });

  router.post("/api/platform/login", async (req, res) => {
    if (!limited(req.ip + ":platform", 20, 10 * 60 * 1000)) {
      return res.status(429).json({ error: "Trop de tentatives." });
    }
    const data = store.read();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (email !== String(data.platform?.email || "").toLowerCase() || !verifyPassword(password, data.platform?.passwordHash)) {
      return res.status(401).json({ error: "E-mail ou mot de passe incorrect." });
    }
    const token = await store.update((current) => issueSession(current, { role: "platform" }));
    res.json({ ok: true, token });
  });

  router.get("/api/platform/overview", (req, res) => {
    const auth = requirePlatform(req, res);
    if (!auth) return;
    const data = store.read();
    const shops = (data.shops || []).map((shop) => {
      const sub = billing.shopSub(data, shop.id);
      const ledger = billing.sumLedger(data, shop.id);
      const orders = (data.orders || []).filter((row) => row.shopId === shop.id).length;
      return {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        kind: shop.kind,
        planId: sub?.planId || "",
        status: sub?.status || "",
        priceFcfa: sub?.priceFcfa || 0,
        commissionRate: sub?.commissionRate || 0,
        orders,
        ...ledger
      };
    });
    res.json({
      ok: true,
      mrrFcfa: billing.mrr(data),
      ledger: billing.sumLedger(data),
      shops
    });
  });

  router.post("/api/platform/shops/:id/plan", async (req, res) => {
    const auth = requirePlatform(req, res);
    if (!auth) return;
    const plan = planById(req.body?.planId);
    if (!plan) return res.status(400).json({ error: "Offre inconnue" });
    const status = req.body?.status === "suspendu" ? "suspendu" : plan.priceFcfa === 0 ? "essai" : "actif";
    try {
      const sub = await store.update((current) => {
        if (!(current.shops || []).some((shop) => shop.id === req.params.id)) {
          const err = new Error("Boutique introuvable");
          err.status = 404;
          throw err;
        }
        return billing.applyPlan(current, req.params.id, plan.id, status);
      });
      res.json({ ok: true, subscription: sub });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message || "Offre impossible" });
    }
  });

  return router;
}

function attachMedia(current, shopId, product, mediaId) {
  if (!mediaId) return;
  const media = mediaRepo.findOwned(current, mediaId, shopId);
  if (!media || media.statut !== "publié") {
    const err = new Error("Photo introuvable dans cette boutique.");
    err.status = 404;
    throw err;
  }
  product.mediaId = media.id;
  const url = media.url_bunny || media.url_wasabi || media.url;
  if (media.type_fichier === "video") product.video = media.url_hls || url;
  else product.image = url;
}

module.exports = { createApiRouter };

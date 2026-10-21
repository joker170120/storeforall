const { randomUUID } = require("crypto");
const { hashPassword } = require("./auth");
const { PLANS } = require("./plans");

function days(n) {
  return Date.now() + n * 24 * 60 * 60 * 1000;
}

function subscription(shopId, planId, status) {
  const plan = PLANS[planId];
  return {
    id: randomUUID(),
    shopId,
    planId: plan.id,
    status,
    priceFcfa: plan.priceFcfa,
    commissionRate: plan.commissionRate,
    startedAt: Date.now(),
    renewsAt: status === "essai" ? days(plan.trialDays || 14) : days(30)
  };
}

function admin(shopId, email, name, password) {
  return {
    id: randomUUID(),
    shopId,
    email,
    name,
    passwordHash: hashPassword(password),
    createdAt: Date.now()
  };
}

function product(shopId, name, priceFcfa, description) {
  return {
    id: randomUUID(),
    shopId,
    name,
    description,
    priceFcfa,
    stock: 40,
    active: true,
    image: "",
    mediaId: "",
    createdAt: Date.now()
  };
}

function build() {
  const password = process.env.DEMO_PASSWORD || "storeforall-demo";
  const platformPassword = process.env.PLATFORM_PASSWORD || password;
  const koko = {
    id: "shop_koko",
    slug: "maison-koko",
    name: "Maison Koko",
    kind: "boutique",
    city: "Libreville",
    whatsapp: "241066000001",
    pitch: "Pagnes et créations. Commande WhatsApp, prix en FCFA.",
    createdAt: Date.now()
  };
  const maman = {
    id: "shop_maman",
    slug: "chez-maman",
    name: "Chez Maman",
    kind: "resto",
    city: "Libreville",
    whatsapp: "241066000002",
    pitch: "Bar-restaurant. Menu par QR de table.",
    createdAt: Date.now()
  };
  return {
    createdAt: Date.now(),
    orderSeq: 1000,
    platform: {
      email: process.env.PLATFORM_EMAIL || "platform@demo.storeforall",
      passwordHash: hashPassword(platformPassword),
      name: "StoreForAll"
    },
    shops: [koko, maman],
    admins: [
      admin(koko.id, "koko@demo.storeforall", "Koko", password),
      admin(maman.id, "maman@demo.storeforall", "Maman", password)
    ],
    subscriptions: [
      subscription(koko.id, "boutique", "actif"),
      subscription(maman.id, "marche", "actif")
    ],
    products: [
      product(koko.id, "Pagne wax 6 yards", 18500, "Coton, coupe au marché."),
      product(koko.id, "Robe droite", 35000, "Cousue à la commande."),
      product(maman.id, "Poulet braisé", 4500, "Servi avec alloco ou frites."),
      product(maman.id, "Jus de gingembre", 1500, "Verre 33 cl.")
    ],
    tables: [
      { id: randomUUID(), shopId: maman.id, code: "T1", label: "Table 1" },
      { id: randomUUID(), shopId: maman.id, code: "T2", label: "Table 2" },
      { id: randomUUID(), shopId: maman.id, code: "T3", label: "Table 3" },
      { id: randomUUID(), shopId: maman.id, code: "T4", label: "Comptoir" }
    ],
    orders: [],
    ledger: [],
    medias: [],
    sessions: []
  };
}

module.exports = { build, subscription };

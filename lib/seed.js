const { randomUUID } = require("crypto");
const { hashPassword } = require("./auth");
const { PLANS } = require("./plans");
const { VAT_RATE } = require("./money");

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
    priceCents: plan.priceCents,
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

function product(shopId, name, priceCents, description) {
  return {
    id: randomUUID(),
    shopId,
    name,
    description,
    priceCents,
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
  const lune = {
    id: "shop_lune",
    slug: "atelier-lune",
    name: "Atelier Lune",
    kind: "boutique",
    addressLine: "12 rue des Capucins",
    postalCode: "69001",
    city: "Lyon",
    country: "FR",
    whatsapp: "33601020304",
    pitch: "Linge de maison et pièces cousues à Lyon. Prix TTC, TVA 20 %.",
    createdAt: Date.now()
  };
  const marcel = {
    id: "shop_marcel",
    slug: "bistrot-marcel",
    name: "Bistrot Marcel",
    kind: "resto",
    addressLine: "8 rue Oberkampf",
    postalCode: "75011",
    city: "Paris",
    country: "FR",
    whatsapp: "33601020305",
    pitch: "Cuisine de bistrot. Menu par QR de table, commande en euros.",
    createdAt: Date.now()
  };
  return {
    createdAt: Date.now(),
    market: "FR",
    vatRate: VAT_RATE,
    currency: "EUR",
    orderSeq: 1000,
    platform: {
      email: process.env.PLATFORM_EMAIL || "platform@demo.storeforall",
      passwordHash: hashPassword(platformPassword),
      name: "StoreForAll"
    },
    shops: [lune, marcel],
    admins: [
      admin(lune.id, "lune@demo.storeforall", "Camille Lune", password),
      admin(marcel.id, "marcel@demo.storeforall", "Marcel", password)
    ],
    subscriptions: [
      subscription(lune.id, "boutique", "actif"),
      subscription(marcel.id, "marche", "actif")
    ],
    products: [
      product(lune.id, "Chemise en lin", 8900, "Lin lavé, coupe droite, fabriquée en petite série."),
      product(lune.id, "Sac en cuir", 14900, "Cuir pleine fleur, bandoulière réglable."),
      product(lune.id, "Écharpe mérinos", 4500, "Laine mérinos, tricotée à Lyon."),
      product(marcel.id, "Soupe à l'oignon", 1200, "Gratinée, bouillon de bœuf."),
      product(marcel.id, "Steak frites", 2400, "Entrecôte, frites maison."),
      product(marcel.id, "Tarte tatin", 900, "Pommes caramélisées, part du jour."),
      product(marcel.id, "Verre de vin", 600, "Côtes du Rhône, 12 cl.")
    ],
    tables: [
      { id: randomUUID(), shopId: marcel.id, code: "T1", label: "Table 1" },
      { id: randomUUID(), shopId: marcel.id, code: "T2", label: "Table 2" },
      { id: randomUUID(), shopId: marcel.id, code: "T3", label: "Table 3" },
      { id: randomUUID(), shopId: marcel.id, code: "T4", label: "Comptoir" }
    ],
    orders: [],
    customers: [],
    ledger: [],
    medias: [],
    sessions: []
  };
}

module.exports = { build, subscription };

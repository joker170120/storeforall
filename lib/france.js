const { build } = require("./seed");

const OLD_DEMOS = new Set(["shop_koko", "shop_maman"]);
const SHOP_MAP = { shop_koko: "shop_lune", shop_maman: "shop_marcel" };

/** Remplace les exemples FCFA par le marché France, sans toucher à un vrai marchand. */
function migrateFrance(store) {
  if (!store || store.market === "FR") return false;
  const ids = (store.shops || []).map((shop) => shop.id);
  const onlyOldDemos = ids.length > 0 && ids.every((id) => OLD_DEMOS.has(id));
  if (!onlyOldDemos && ids.length > 0) {
    store.market = "FR";
    store.vatRate = 0.2;
    store.currency = "EUR";
    return true;
  }
  const fresh = build();
  if (store.platform?.passwordHash) fresh.platform = store.platform;
  fresh.medias = (store.medias || []).map((media) => ({
    ...media,
    shopId: SHOP_MAP[media.shopId] || media.shopId
  }));
  fresh.createdAt = store.createdAt || fresh.createdAt;
  for (const key of Object.keys(store)) delete store[key];
  Object.assign(store, fresh);
  return true;
}

module.exports = { migrateFrance };

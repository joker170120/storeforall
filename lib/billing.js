const crypto = require("crypto");
const { PLANS, planById, subscriptionLive } = require("./plans");
const { commissionOf } = require("./money");
const { subscription } = require("./seed");

function shopSub(store, shopId) {
  return (store.subscriptions || []).find((row) => row.shopId === shopId) || null;
}

function applyPlan(store, shopId, planId, status) {
  const plan = planById(planId);
  if (!plan) {
    const err = new Error("Offre inconnue");
    err.status = 400;
    throw err;
  }
  const nextStatus = status || (plan.trialDays ? "essai" : "actif");
  const row = subscription(shopId, plan.id, nextStatus);
  store.subscriptions = (store.subscriptions || []).filter((item) => item.shopId !== shopId);
  store.subscriptions.push(row);
  if (plan.priceFcfa > 0 && nextStatus === "actif") {
    store.ledger.push({
      id: crypto.randomUUID(),
      shopId,
      type: "abonnement",
      orderId: "",
      amountFcfa: plan.priceFcfa,
      status: "due",
      planId: plan.id,
      createdAt: Date.now()
    });
  }
  return row;
}

function recordCommission(store, shop, order) {
  const sub = shopSub(store, shop.id);
  const rate = sub ? sub.commissionRate : PLANS.decouverte.commissionRate;
  const money = commissionOf(order.subtotalFcfa, rate);
  order.commissionRate = money.rate;
  order.commissionFcfa = money.fee;
  order.netFcfa = money.net;
  const entry = {
    id: crypto.randomUUID(),
    shopId: shop.id,
    type: "commission",
    orderId: order.id,
    amountFcfa: money.fee,
    rate: money.rate,
    status: "due",
    createdAt: Date.now()
  };
  store.ledger.push(entry);
  return entry;
}

function setCommissionStatus(store, orderId, status) {
  const entry = (store.ledger || []).find((row) => row.type === "commission" && row.orderId === orderId);
  if (entry) entry.status = status;
  return entry;
}

function sumLedger(store, shopId) {
  const rows = (store.ledger || []).filter((row) => !shopId || row.shopId === shopId);
  const active = rows.filter((row) => row.status !== "annulee");
  const of = (type, status) =>
    active
      .filter((row) => row.type === type && (!status || row.status === status))
      .reduce((sum, row) => sum + (Number(row.amountFcfa) || 0), 0);
  return {
    commissionDue: of("commission", "due"),
    commissionEncaissee: of("commission", "encaissee"),
    abonnementDue: of("abonnement", "due"),
    abonnementEncaisse: of("abonnement", "encaissee")
  };
}

function mrr(store) {
  return (store.subscriptions || [])
    .filter((row) => row.status === "actif")
    .reduce((sum, row) => sum + (Number(row.priceFcfa) || 0), 0);
}

module.exports = {
  shopSub,
  applyPlan,
  recordCommission,
  setCommissionStatus,
  sumLedger,
  mrr,
  subscriptionLive,
  PLANS
};

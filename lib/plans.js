/**
 * Abonnement mensuel + commission sur les commandes TTC.
 * Le taux est figé sur l'abonnement au moment de la commande.
 */
const { formatEur, percentLabel } = require("./money");

const PLANS = {
  decouverte: {
    id: "decouverte",
    name: "Découverte",
    priceCents: 0,
    commissionRate: 0.08,
    trialDays: 14
  },
  boutique: {
    id: "boutique",
    name: "Boutique",
    priceCents: 2900,
    commissionRate: 0.05,
    trialDays: 0
  },
  marche: {
    id: "marche",
    name: "Marché",
    priceCents: 7900,
    commissionRate: 0.03,
    trialDays: 0
  }
};

function planById(id) {
  return PLANS[String(id || "")] || null;
}

function subscriptionLive(sub, now = Date.now()) {
  if (!sub) return false;
  if (sub.status === "suspendu") return false;
  if (sub.status === "essai" && Number(sub.renewsAt || 0) < now) return false;
  return sub.status === "actif" || sub.status === "essai";
}

function publicPlan(plan) {
  if (!plan) return null;
  return {
    id: plan.id,
    name: plan.name,
    priceCents: plan.priceCents,
    priceLabel: formatEur(plan.priceCents),
    commissionRate: plan.commissionRate,
    commissionLabel: percentLabel(plan.commissionRate),
    trialDays: plan.trialDays || 0
  };
}

module.exports = { PLANS, planById, subscriptionLive, publicPlan };

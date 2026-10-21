/** Prix entiers en FCFA, comme sur phancommerce / gabmall. */

function formatFcfa(amount) {
  const n = Math.round(Number(amount) || 0);
  try {
    return `${new Intl.NumberFormat("fr-FR").format(n)} FCFA`;
  } catch (_) {
    return `${n} FCFA`;
  }
}

function commissionOf(amount, rate) {
  const total = Math.max(0, Math.round(Number(amount) || 0));
  const r = Number(rate);
  const safe = Number.isFinite(r) && r > 0 ? r : 0;
  const fee = Math.round(total * safe);
  return { amount: total, rate: safe, fee, net: total - fee };
}

function percentLabel(rate) {
  const n = Math.round(Number(rate) * 1000) / 10;
  return `${String(n).replace(".", ",")} %`;
}

module.exports = { formatFcfa, commissionOf, percentLabel };

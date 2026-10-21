/** Prix TTC en centimes d'euro. TVA française 20 %. */

const VAT_RATE = 0.2;

function formatEur(cents) {
  const value = Math.round(Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
  } catch (_) {
    return `${value.toFixed(2)} €`;
  }
}

function eurosToCents(value) {
  const n = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

function vatFromTtc(cents, rate = VAT_RATE) {
  const ttc = Math.max(0, Math.round(Number(cents) || 0));
  const ht = Math.round(ttc / (1 + rate));
  return { ttcCents: ttc, htCents: ht, vatCents: ttc - ht, vatRate: rate };
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

module.exports = { VAT_RATE, formatEur, eurosToCents, vatFromTtc, commissionOf, percentLabel };

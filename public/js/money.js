function money(cents) {
  const value = Math.round(Number(cents) || 0) / 100;
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
}

function vatOf(ttcCents) {
  const ttc = Math.max(0, Math.round(Number(ttcCents) || 0));
  const ht = Math.round(ttc / 1.2);
  return { ttc, ht, vat: ttc - ht };
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

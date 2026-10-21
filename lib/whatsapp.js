const { formatEur } = require("./money");

function digits(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function orderText(shop, order) {
  const lines = [`Commande ${order.number} — ${shop.name}`];
  if (order.tableCode) lines.push(`Table ${order.tableCode}`);
  for (const item of order.items || []) {
    lines.push(`${item.qty} × ${item.name} — ${formatEur(item.lineCents)}`);
  }
  lines.push(`Total TTC ${formatEur(order.subtotalCents)}`);
  lines.push(`dont TVA 20 % ${formatEur(order.vatCents)}`);
  if (order.customerName) lines.push(`Client : ${order.customerName}`);
  if (order.customerPhone) lines.push(`Tél : ${order.customerPhone}`);
  const address = [order.addressLine, order.postalCode, order.city].filter(Boolean).join(", ");
  if (address) lines.push(address);
  return lines.join("\n");
}

function link(phone, text) {
  const n = digits(phone);
  if (!n) return "";
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

function orderLink(shop, order) {
  return link(shop.whatsapp, orderText(shop, order));
}

module.exports = { digits, orderText, link, orderLink };

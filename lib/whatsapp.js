const { formatFcfa } = require("./money");

function digits(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function orderText(shop, order) {
  const lines = [`Commande ${order.number} — ${shop.name}`];
  if (order.tableCode) lines.push(`Table ${order.tableCode}`);
  for (const item of order.items || []) {
    lines.push(`${item.qty} × ${item.name} — ${formatFcfa(item.lineFcfa)}`);
  }
  lines.push(`Total ${formatFcfa(order.subtotalFcfa)}`);
  if (order.customerName) lines.push(`Client : ${order.customerName}`);
  if (order.customerPhone) lines.push(`Tél : ${order.customerPhone}`);
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

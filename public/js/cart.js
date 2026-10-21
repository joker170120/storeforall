function cartKey(slug) {
  return `sf-cart:${slug}`;
}

function readCart(slug) {
  try {
    const rows = JSON.parse(localStorage.getItem(cartKey(slug)) || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

function writeCart(slug, rows) {
  localStorage.setItem(cartKey(slug), JSON.stringify(rows));
}

function addToCart(slug, product, qty = 1) {
  const rows = readCart(slug);
  const current = rows.find((row) => row.id === product.id);
  if (current) current.qty += qty;
  else {
    rows.push({
      id: product.id,
      name: product.name,
      priceCents: product.priceCents,
      qty
    });
  }
  writeCart(slug, rows);
  return rows;
}

function cartCount(slug) {
  return readCart(slug).reduce((sum, row) => sum + row.qty, 0);
}

function cartTotal(slug) {
  return readCart(slug).reduce((sum, row) => sum + row.priceCents * row.qty, 0);
}

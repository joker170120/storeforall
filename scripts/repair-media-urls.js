#!/usr/bin/env node
/**
 * Réécrit les URLs médias vers Bunny quand BUNNY_CDN_HOSTNAME est défini.
 * Même idée que scripts/repair-gabmall-media-urls.js : la base garde la clé,
 * l'affichage passe par le CDN.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const fs = require("fs");
const bunny = require("../lib/bunny");

const file = process.argv[2] || path.join(__dirname, "..", "data", "store.json");
const store = JSON.parse(fs.readFileSync(file, "utf8"));
let n = 0;

function prefer(row) {
  if (!row?.key) return;
  const next = bunny.cdnUrlForKey(row.key);
  if (!next) return;
  if (row.url_bunny !== next) {
    row.url_bunny = next;
    n += 1;
  }
  if (row.url && row.url === row.url_wasabi) {
    row.url = next;
    n += 1;
  }
}

for (const media of store.medias || []) prefer(media);
const byWasabi = new Map((store.medias || []).filter((row) => row.url_wasabi).map((row) => [row.url_wasabi, row.url_bunny || row.url]));
for (const product of store.products || []) {
  const next = byWasabi.get(product.image);
  if (next && next !== product.image) {
    product.image = next;
    n += 1;
  }
}

fs.writeFileSync(file, JSON.stringify(store, null, 2));
console.log(JSON.stringify({ ok: true, patched: n, bunny: bunny.configured(), file }));

const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const store = require("./lib/store");
const seed = require("./lib/seed");
const { migrateFrance } = require("./lib/france");
const wasabi = require("./lib/wasabi");
const { createApiRouter } = require("./routes/api");
const { createMediaRouter } = require("./routes/media");

const existing = store.read();
if (!existing) store.write(seed.build());
else if (migrateFrance(existing)) store.write(existing);

const app = express();
const publicDir = path.join(__dirname, "public");
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
function publicSite() {
  return String(process.env.PUBLIC_BASE_URL || "https://storeforall.vercel.app").replace(/\/$/, "");
}

function dataRole() {
  return process.env.ROLE === "data";
}

app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    service: "storeforall",
    role: dataRole() ? "data" : "site",
    storage: dataRole() ? "hetzner" : "local",
    publicSite: publicSite()
  });
});
app.use(createMediaRouter());
app.use(createApiRouter());

app.get("/media/*", (req, res) => {
  try {
    const key = String(req.params[0] || "")
      .split("/")
      .map((part) => decodeURIComponent(part))
      .join("/");
    const file = wasabi.objectPath(key);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return res.status(404).end();
    if (key.endsWith(".m3u8")) res.type("application/vnd.apple.mpegurl");
    else if (key.endsWith(".ts")) res.type("video/mp2t");
    else if (key.endsWith(".mp4")) res.type("video/mp4");
    else if (key.endsWith(".png")) res.type("image/png");
    else if (key.endsWith(".jpg") || key.endsWith(".jpeg")) res.type("image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.sendFile(file);
  } catch (_) {
    res.status(400).end();
  }
});

if (dataRole()) {
  app.use((req, res) => {
    const dest = publicSite() + (req.originalUrl || "/");
    res.redirect(302, dest);
  });
} else {
  app.get("/b/:slug/p/:id", (_req, res) => {
    res.sendFile(path.join(publicDir, "product.html"));
  });
  app.get("/b/:slug/t/:code", (_req, res) => {
    res.sendFile(path.join(publicDir, "table.html"));
  });
  app.get("/b/:slug", (_req, res) => {
    res.sendFile(path.join(publicDir, "shop.html"));
  });
  app.get("/plateforme", (_req, res) => {
    res.sendFile(path.join(publicDir, "plateforme.html"));
  });
  app.use(express.static(publicDir));
}

async function ensureIcons() {
  const dir = path.join(publicDir, "admin");
  const targets = ["icon-192.png", "icon-512.png", "apple-touch-icon.png"];
  if (targets.every((name) => fs.existsSync(path.join(dir, name)))) return;
  const sharp = require("sharp");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <rect width="512" height="512" rx="96" fill="#0f6e56"/>
    <text x="256" y="320" text-anchor="middle" font-size="240" font-family="Georgia" fill="#f4efe4">S</text>
  </svg>`;
  fs.mkdirSync(dir, { recursive: true });
  const base = sharp(Buffer.from(svg));
  await base.clone().resize(192, 192).png().toFile(path.join(dir, "icon-192.png"));
  await base.clone().resize(512, 512).png().toFile(path.join(dir, "icon-512.png"));
  await base.clone().resize(180, 180).png().toFile(path.join(dir, "apple-touch-icon.png"));
}

function listen() {
  const port = Number(process.env.PORT || 4180);
  const host = process.env.HOST || "0.0.0.0";
  return app.listen(port, host, () => {
    console.log(`storeforall http://127.0.0.1:${port}`);
  });
}

if (require.main === module) {
  ensureIcons()
    .catch((error) => console.error("[icons]", error.message))
    .finally(() => listen());
}

module.exports = { app, listen, ensureIcons };

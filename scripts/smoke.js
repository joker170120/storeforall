#!/usr/bin/env node
/**
 * Parcours local : isolation marchand, commande FCFA + commission, pipeline média.
 */
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const port = 4191;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "storeforall-smoke-"));
const base = `http://127.0.0.1:${port}`;
const password = "storeforall-demo";

function fail(message) {
  console.error("ÉCHEC", message);
  process.exitCode = 1;
  throw new Error(message);
}

async function api(urlPath, options = {}, token) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = "Bearer " + token;
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(base + urlPath, { ...options, headers });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { raw: text };
  }
  if (!res.ok) fail(`${options.method || "GET"} ${urlPath} → ${res.status} ${data.error || text}`);
  return data;
}

async function login(email) {
  const data = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  return data.token;
}

async function upload(token, filePath, contentType, name) {
  const buf = fs.readFileSync(filePath);
  const started = await api(
    "/api/upload-multipart/start",
    {
      method: "POST",
      body: JSON.stringify({
        fileName: name,
        contentType,
        size: buf.length,
        originalSize: buf.length,
        rightsAccepted: true
      })
    },
    token
  );
  const partSize = started.partSize;
  const parts = [];
  const total = Math.max(1, Math.ceil(buf.length / partSize));
  for (let n = 1; n <= total; n += 1) {
    const signed = await api(
      "/api/upload-multipart/sign",
      { method: "POST", body: JSON.stringify({ mediaId: started.mediaId, partNumber: n }) },
      token
    );
    const chunk = buf.subarray((n - 1) * partSize, Math.min(buf.length, n * partSize));
    const put = await fetch(base + signed.url, { method: "PUT", body: chunk });
    if (!put.ok) fail(`PUT morceau ${n} → ${put.status}`);
    const etag = put.headers.get("etag") || (await put.json().catch(() => ({}))).etag;
    if (!etag) fail("ETag manquant");
    parts.push({ partNumber: n, etag });
  }
  if (total < 2) fail("le test doit envoyer au moins 2 morceaux");
  const done = await api(
    "/api/upload-multipart/complete",
    { method: "POST", body: JSON.stringify({ mediaId: started.mediaId, parts }) },
    token
  );
  return done.media;
}

async function main() {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      DATA_DIR: dataDir,
      PUBLIC_BASE_URL: base,
      DEMO_PASSWORD: password,
      PLATFORM_PASSWORD: password,
      MEDIA_PART_BYTES: "1024",
      NODE_ENV: "development"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", (buf) => {
    logs += buf.toString();
  });
  child.stderr.on("data", (buf) => {
    logs += buf.toString();
  });
  const stop = () => {
    child.kill("SIGTERM");
  };
  process.on("exit", stop);

  try {
    for (let i = 0; i < 50; i += 1) {
      try {
        const health = await fetch(base + "/api/health");
        if (health.ok) break;
      } catch (_) {}
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (i === 49) fail("serveur muet\n" + logs);
    }

    const health = await api("/api/health");
    if (health.media.pipeline.join(",") !== "chunk,compression,wasabi,bunny,hls") fail("pipeline");
    const shops = await api("/api/shops");
    if (shops.shops.length < 2) fail("boutiques démo");

    const koko = await login("koko@demo.storeforall");
    const maman = await login("maman@demo.storeforall");
    const created = await api(
      "/api/admin/products",
      { method: "POST", body: JSON.stringify({ name: "Boubou isolation", priceFcfa: 12000, stock: 3 }) },
      koko
    );
    const mamanProducts = await api("/api/admin/products", {}, maman);
    if (mamanProducts.products.some((row) => row.id === created.product.id)) fail("fuite produit");
    const leaked = await fetch(base + "/api/admin/products/" + created.product.id, {
      method: "PATCH",
      headers: { Authorization: "Bearer " + maman, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "piraté" })
    });
    if (leaked.status !== 404) fail("produit d'un autre marchand accessible " + leaked.status);

    const menu = await api("/api/shops/chez-maman");
    const poulet = menu.products.find((row) => row.name === "Poulet braisé");
    const jus = menu.products.find((row) => row.name === "Jus de gingembre");
    const order = await api("/api/shops/chez-maman/orders", {
      method: "POST",
      body: JSON.stringify({
        customerName: "Awa",
        customerPhone: "24106000000",
        tableCode: "T1",
        items: [
          { productId: poulet.id, qty: 2 },
          { productId: jus.id, qty: 1 }
        ]
      })
    });
    if (order.order.subtotalFcfa !== 10500) fail("total " + order.order.subtotalFcfa);
    const mamanOrders = await api("/api/admin/orders", {}, maman);
    const savedOrder = mamanOrders.orders.find((row) => row.id === order.order.id);
    if (!savedOrder || savedOrder.commissionFcfa !== 315) fail("commission " + JSON.stringify(savedOrder));
    if (!order.order.whatsappUrl.includes("wa.me/241066000002")) fail("whatsapp");
    if (order.order.tableCode !== "T1") fail("table");
    const kokoOrders = await api("/api/admin/orders", {}, koko);
    if (kokoOrders.orders.some((row) => row.id === order.order.id)) fail("fuite commande");
    const hidden = await fetch(base + "/api/admin/orders/" + order.order.id, {
      headers: { Authorization: "Bearer " + koko }
    });
    if (hidden.status !== 404) fail("commande visible par un autre marchand");

    const sharp = require("sharp");
    const raw = Buffer.alloc(120 * 120 * 3);
    for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 17) % 256;
    const pngPath = path.join(dataDir, "photo.jpg");
    await sharp(raw, { raw: { width: 120, height: 120, channels: 3 } }).jpeg({ quality: 90 }).toFile(pngPath);
    const photo = await upload(koko, pngPath, "image/jpeg", "photo.jpg");
    if (!photo.pipeline?.chunk?.ok || !photo.pipeline?.compression?.ok) fail("compression " + JSON.stringify(photo.pipeline));
    if (photo.pipeline.wasabi.driver !== "local" || !photo.pipeline.wasabi.ok) fail("dépôt");
    if (!photo.pipeline.bunny.branched) fail("bunny non branché");
    if (!photo.url.includes("/media/")) fail("url " + photo.url);
    const fetched = await fetch(photo.url);
    if (!fetched.ok) fail("fichier média " + fetched.status);
    const others = await api("/api/mes-medias", {}, maman);
    if (others.medias.some((row) => row.id === photo.id)) fail("fuite média");
    const denied = await fetch(base + "/api/mes-medias/" + photo.id, { headers: { Authorization: "Bearer " + maman } });
    if (denied.status !== 404) fail("média d'une autre boutique");

    const ffmpeg = require("ffmpeg-static");
    const mp4 = path.join(dataDir, "tiny.mp4");
    const encoded = spawnSync(
      ffmpeg,
      ["-y", "-f", "lavfi", "-i", "color=c=black:s=160x120:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", "1", mp4],
      { encoding: "utf8" }
    );
    if (encoded.status !== 0) fail("ffmpeg lavfi\n" + encoded.stderr);
    const video = await upload(maman, mp4, "video/mp4", "tiny.mp4");
    if (video.pipeline.compression.tool !== "ffmpeg") fail("compression vidéo " + JSON.stringify(video.pipeline.compression));
    let ready = null;
    for (let i = 0; i < 40; i += 1) {
      const row = await api("/api/mes-medias/" + video.id, {}, maman);
      if (row.media.url_hls) {
        ready = row.media;
        break;
      }
      if (row.media.pipeline?.hls?.reason) fail(row.media.pipeline.hls.reason);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!ready?.url_hls?.includes("master.m3u8")) fail("HLS absent");
    const playlist = await fetch(ready.url_hls);
    const body = await playlist.text();
    if (!playlist.ok || !body.includes("#EXTM3U")) fail("master illisible");

    const platform = await api("/api/platform/login", {
      method: "POST",
      body: JSON.stringify({ email: "platform@demo.storeforall", password })
    });
    const overview = await api("/api/platform/overview", {}, platform.token);
    const chez = overview.shops.find((shop) => shop.slug === "chez-maman");
    if (!chez || chez.commissionDue !== 315) fail("grand livre " + JSON.stringify(chez));
    if (overview.mrrFcfa !== 9900 + 24900) fail("mrr " + overview.mrrFcfa);

    console.log(
      JSON.stringify({
        ok: true,
        shops: shops.shops.length,
        order: order.order.number,
        commissionFcfa: order.order.commissionFcfa,
        photo: photo.url,
        hls: ready.url_hls,
        mrrFcfa: overview.mrrFcfa
      })
    );
  } finally {
    stop();
  }
}

main().catch((error) => {
  if (!process.exitCode) {
    console.error(error);
    process.exitCode = 1;
  }
});

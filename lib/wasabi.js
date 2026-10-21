/**
 * Stockage fichiers, même contrat que GabMall.
 * Wasabi si WASABI_* est complet, sinon disque local (mêmes étapes).
 * Les clés restent côté serveur.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pipeline } = require("stream/promises");
const store = require("./store");

const IMAGE_MIME = new Set(["image/jpeg", "image/jpg", "image/png"]);
const VIDEO_MIME = new Set(["video/mp4"]);
const IMAGE_MAX = 8 * 1024 * 1024;
const VIDEO_MAX = 250 * 1024 * 1024;
const PRESIGN_TTL_SEC = 15 * 60;
const SHOP_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;
const WASABI_PART = 8 * 1024 * 1024;

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function isConfigured() {
  return Boolean(
    env("WASABI_ACCESS_KEY") &&
      env("WASABI_SECRET_KEY") &&
      env("WASABI_BUCKET_NAME") &&
      env("WASABI_ENDPOINT_URL")
  );
}

function driver() {
  return isConfigured() ? "wasabi" : "local";
}

function partSize() {
  const asked = Number(process.env.MEDIA_PART_BYTES || 0);
  if (isConfigured()) {
    if (asked >= 5 * 1024 * 1024) return asked;
    return WASABI_PART;
  }
  if (asked >= 32 && asked <= WASABI_PART) return asked;
  return 512 * 1024;
}

function shopPrefix(shopId) {
  const safeShop = String(shopId || "").replace(/[^\w\-]+/g, "").slice(0, 64);
  if (!safeShop) {
    const err = new Error("Boutique invalide");
    err.status = 400;
    throw err;
  }
  return `boutiques/${safeShop}/`;
}

function assertKeyBelongsToShop(key, shopId) {
  const prefix = shopPrefix(shopId);
  if (!String(key || "").startsWith(prefix)) {
    const err = new Error("Accès refusé à ce fichier.");
    err.status = 403;
    throw err;
  }
}

function sanitizeFileName(name) {
  const base = path.basename(String(name || "fichier")).replace(/[^\w.\-]+/g, "_");
  return base.slice(0, 120) || "fichier";
}

function extForMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m === "image/png") return "png";
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "video/mp4") return "mp4";
  return "bin";
}

function classifyMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (IMAGE_MIME.has(m)) return "photo";
  if (VIDEO_MIME.has(m)) return "video";
  return "";
}

function validateUploadRequest({ contentType, size, fileName }) {
  const mime = String(contentType || "").toLowerCase();
  const normalized = mime === "image/jpg" ? "image/jpeg" : mime;
  const type = classifyMime(normalized);
  if (!type) {
    const err = new Error("Type refusé. Autorisé : jpg, jpeg, png, mp4.");
    err.status = 400;
    throw err;
  }
  const bytes = Number(size) || 0;
  const max = type === "photo" ? IMAGE_MAX : VIDEO_MAX;
  if (bytes < 1 || bytes > max) {
    const err = new Error(type === "photo" ? "Image trop lourde (max 8 Mo)." : "Vidéo trop lourde (max 250 Mo).");
    err.status = 400;
    throw err;
  }
  return {
    type,
    mime: normalized,
    fileName: sanitizeFileName(fileName),
    size: bytes,
    max
  };
}

function buildObjectKey(shopId, fileName, mime) {
  const id = crypto.randomUUID();
  const ext = extForMime(mime);
  const stamp = new Date().toISOString().slice(0, 10);
  const base = sanitizeFileName(fileName).replace(/\.(jpe?g|png|mp4)$/i, "");
  return `${shopPrefix(shopId)}${stamp}/${id}-${base}.${ext}`;
}

function hlsMasterKey(shopId, mediaId) {
  const id = String(mediaId || "").replace(/[^\w\-]+/g, "");
  if (!id) throw new Error("Média invalide");
  return `${shopPrefix(shopId)}hls/${id}/master.m3u8`;
}

function publicBase() {
  const raw = env("PUBLIC_BASE_URL", `http://127.0.0.1:${env("PORT", "4180")}`);
  return raw.replace(/\/$/, "");
}

function publicUrlForKey(key) {
  const clean = String(key || "").replace(/^\//, "");
  const custom = env("WASABI_PUBLIC_BASE_URL");
  if (custom && isConfigured()) return `${custom.replace(/\/$/, "")}/${clean}`;
  if (isConfigured()) {
    const endpoint = env("WASABI_ENDPOINT_URL", "https://s3.wasabisys.com").replace(/\/$/, "");
    return `${endpoint}/${env("WASABI_BUCKET_NAME")}/${clean}`;
  }
  return `${publicBase()}/media/${clean.split("/").map(encodeURIComponent).join("/")}`;
}

function objectsRoot() {
  return path.join(store.dir(), "objects");
}

function partsRoot(uploadId) {
  const id = String(uploadId || "").replace(/[^\w\-]+/g, "");
  if (!id) {
    const err = new Error("Upload invalide");
    err.status = 400;
    throw err;
  }
  return path.join(store.dir(), "parts", id);
}

function objectPath(key) {
  const clean = String(key || "").replace(/^\/+/, "");
  if (!clean || clean.includes("..")) {
    const err = new Error("Clé refusée");
    err.status = 400;
    throw err;
  }
  const root = path.resolve(objectsRoot());
  const file = path.resolve(root, clean);
  if (file !== root && !file.startsWith(root + path.sep)) {
    const err = new Error("Clé refusée");
    err.status = 400;
    throw err;
  }
  return file;
}

function signingSecret() {
  const secret = env("SESSION_SECRET");
  if (secret) return secret;
  if (env("NODE_ENV") === "production") {
    const err = new Error("SESSION_SECRET manquant");
    err.status = 500;
    throw err;
  }
  return "storeforall-local-dev";
}

function signLocalPart({ mediaId, uploadId, partNumber }) {
  const exp = Date.now() + PRESIGN_TTL_SEC * 1000;
  const payload = [mediaId, uploadId, partNumber, exp].join(".");
  const sig = crypto.createHmac("sha256", signingSecret()).update(payload).digest("base64url");
  const q = new URLSearchParams({
    mediaId: String(mediaId),
    uploadId: String(uploadId),
    partNumber: String(partNumber),
    exp: String(exp),
    sig
  });
  return `/api/upload-multipart/raw?${q}`;
}

function verifyLocalPart(query) {
  const exp = Number(query.exp);
  if (!exp || exp < Date.now()) {
    const err = new Error("Lien d'envoi expiré.");
    err.status = 403;
    throw err;
  }
  const payload = [query.mediaId, query.uploadId, query.partNumber, query.exp].join(".");
  const expected = crypto.createHmac("sha256", signingSecret()).update(payload).digest("base64url");
  const a = Buffer.from(String(query.sig || ""));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const err = new Error("Lien d'envoi refusé.");
    err.status = 403;
    throw err;
  }
}

function metaPath(uploadId) {
  return path.join(partsRoot(uploadId), "meta.json");
}

function readMeta(uploadId) {
  const file = metaPath(uploadId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeMeta(uploadId, meta) {
  const root = partsRoot(uploadId);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(metaPath(uploadId), JSON.stringify(meta));
}

let s3Promise = null;
function s3() {
  if (!s3Promise) {
    s3Promise = Promise.all([
      require("@aws-sdk/client-s3"),
      require("@aws-sdk/s3-request-presigner")
    ]).then(([client, presigner]) => ({ client, presigner }));
  }
  return s3Promise;
}

async function remoteClient() {
  const { client } = await s3();
  return new client.S3Client({
    region: env("WASABI_REGION", "eu-central-1"),
    endpoint: env("WASABI_ENDPOINT_URL"),
    forcePathStyle: true,
    credentials: {
      accessKeyId: env("WASABI_ACCESS_KEY"),
      secretAccessKey: env("WASABI_SECRET_KEY")
    }
  });
}

function bucket() {
  return env("WASABI_BUCKET_NAME");
}

async function createMultipart({ shopId, fileName, contentType, size }) {
  const meta = validateUploadRequest({ contentType, size, fileName });
  const key = buildObjectKey(shopId, meta.fileName, meta.mime);
  assertKeyBelongsToShop(key, shopId);
  const slice = partSize();
  if (!isConfigured()) {
    const uploadId = crypto.randomUUID();
    writeMeta(uploadId, {
      key,
      uploadId,
      shopId: String(shopId),
      size: meta.size,
      partSize: slice,
      mime: meta.mime,
      parts: {}
    });
    return {
      key,
      uploadId,
      publicUrl: publicUrlForKey(key),
      contentType: meta.mime,
      type: meta.type,
      fileName: meta.fileName,
      size: meta.size,
      partSize: slice,
      expiresIn: PRESIGN_TTL_SEC
    };
  }
  const { client } = await s3();
  const s3client = await remoteClient();
  const created = await s3client.send(
    new client.CreateMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: meta.mime
    })
  );
  if (!created.UploadId) {
    const err = new Error("Wasabi n'a pas renvoyé d'identifiant multipart.");
    err.status = 502;
    throw err;
  }
  return {
    key,
    uploadId: created.UploadId,
    publicUrl: publicUrlForKey(key),
    contentType: meta.mime,
    type: meta.type,
    fileName: meta.fileName,
    size: meta.size,
    partSize: slice,
    expiresIn: PRESIGN_TTL_SEC
  };
}

async function signUploadPart({ shopId, key, uploadId, partNumber, mediaId }) {
  assertKeyBelongsToShop(key, shopId);
  const n = Number(partNumber);
  if (!uploadId || !Number.isInteger(n) || n < 1 || n > 10000) {
    const err = new Error("Partie d'upload invalide.");
    err.status = 400;
    throw err;
  }
  if (!isConfigured()) {
    const meta = readMeta(uploadId);
    if (!meta || meta.key !== key) {
      const err = new Error("Upload introuvable");
      err.status = 404;
      throw err;
    }
    return { url: signLocalPart({ mediaId, uploadId, partNumber: n }), partNumber: n, expiresIn: PRESIGN_TTL_SEC };
  }
  const { client, presigner } = await s3();
  const s3client = await remoteClient();
  const command = new client.UploadPartCommand({
    Bucket: bucket(),
    Key: key,
    UploadId: String(uploadId),
    PartNumber: n
  });
  const url = await presigner.getSignedUrl(s3client, command, { expiresIn: PRESIGN_TTL_SEC });
  return { url, partNumber: n, expiresIn: PRESIGN_TTL_SEC };
}

function etagOf(buf) {
  return `"${crypto.createHash("md5").update(buf).digest("hex")}"`;
}

function writeLocalPart({ mediaId, uploadId, partNumber, body, query }) {
  verifyLocalPart(query);
  const meta = readMeta(uploadId);
  if (!meta) {
    const err = new Error("Upload introuvable");
    err.status = 404;
    throw err;
  }
  const n = Number(partNumber);
  const expected = Math.max(1, Math.ceil(meta.size / meta.partSize));
  if (!Number.isInteger(n) || n < 1 || n > expected) {
    const err = new Error("Partie d'upload invalide.");
    err.status = 400;
    throw err;
  }
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
  const last = n === expected;
  if (!last && buf.length !== meta.partSize) {
    const err = new Error("Taille de morceau incorrecte.");
    err.status = 400;
    throw err;
  }
  if (last && (buf.length < 1 || buf.length > meta.partSize)) {
    const err = new Error("Dernier morceau invalide.");
    err.status = 400;
    throw err;
  }
  const file = path.join(partsRoot(uploadId), `${n}.bin`);
  fs.writeFileSync(file, buf);
  const etag = etagOf(buf);
  meta.parts[String(n)] = { etag, size: buf.length, mediaId: String(mediaId || "") };
  writeMeta(uploadId, meta);
  return { etag, partNumber: n };
}

async function listUploadedParts({ shopId, key, uploadId }) {
  assertKeyBelongsToShop(key, shopId);
  if (!isConfigured()) {
    const meta = readMeta(uploadId);
    if (!meta || meta.key !== key) return [];
    return Object.entries(meta.parts)
      .map(([partNumber, row]) => ({
        partNumber: Number(partNumber),
        etag: row.etag,
        size: row.size
      }))
      .sort((a, b) => a.partNumber - b.partNumber);
  }
  const { client } = await s3();
  const s3client = await remoteClient();
  const parts = [];
  let marker;
  do {
    const out = await s3client.send(
      new client.ListPartsCommand({
        Bucket: bucket(),
        Key: key,
        UploadId: String(uploadId),
        PartNumberMarker: marker
      })
    );
    for (const part of out.Parts || []) {
      parts.push({ partNumber: part.PartNumber, etag: part.ETag, size: part.Size });
    }
    marker = out.IsTruncated ? out.NextPartNumberMarker : undefined;
  } while (marker);
  return parts;
}

async function completeMultipart({ shopId, key, uploadId, parts }) {
  assertKeyBelongsToShop(key, shopId);
  if (!isConfigured()) {
    const meta = readMeta(uploadId);
    if (!meta || meta.key !== key || String(meta.shopId) !== String(shopId)) {
      const err = new Error("Upload introuvable");
      err.status = 404;
      throw err;
    }
    const expected = Math.max(1, Math.ceil(meta.size / meta.partSize));
    const dest = objectPath(key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const chunks = [];
    for (let n = 1; n <= expected; n += 1) {
      const file = path.join(partsRoot(uploadId), `${n}.bin`);
      if (!fs.existsSync(file)) {
        const err = new Error("Aucune partie reçue — upload incomplet.");
        err.status = 400;
        throw err;
      }
      chunks.push(fs.readFileSync(file));
    }
    const buf = Buffer.concat(chunks);
    if (buf.length !== meta.size) {
      const err = new Error("Fichier incomplet.");
      err.status = 400;
      throw err;
    }
    fs.writeFileSync(dest, buf);
    fs.rmSync(partsRoot(uploadId), { recursive: true, force: true });
    return;
  }
  const sorted = (Array.isArray(parts) ? parts : [])
    .map((p) => ({
      PartNumber: Number(p.partNumber || p.PartNumber),
      ETag: String(p.etag || p.ETag || "")
    }))
    .filter((p) => p.PartNumber > 0 && p.ETag)
    .sort((a, b) => a.PartNumber - b.PartNumber);
  if (!sorted.length) {
    const err = new Error("Aucune partie reçue — upload incomplet.");
    err.status = 400;
    throw err;
  }
  const { client } = await s3();
  const s3client = await remoteClient();
  await s3client.send(
    new client.CompleteMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      UploadId: String(uploadId),
      MultipartUpload: { Parts: sorted }
    })
  );
}

async function abortMultipart({ shopId, key, uploadId }) {
  assertKeyBelongsToShop(key, shopId);
  if (!isConfigured()) {
    fs.rmSync(partsRoot(uploadId), { recursive: true, force: true });
    return;
  }
  const { client } = await s3();
  const s3client = await remoteClient();
  await s3client.send(
    new client.AbortMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      UploadId: String(uploadId)
    })
  );
}

async function headObject(key) {
  if (!isConfigured()) {
    const file = objectPath(key);
    const stat = fs.statSync(file);
    return { ContentLength: stat.size };
  }
  const { client } = await s3();
  const s3client = await remoteClient();
  return s3client.send(new client.HeadObjectCommand({ Bucket: bucket(), Key: key }));
}

async function downloadToFile(key, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!isConfigured()) {
    fs.copyFileSync(objectPath(key), dest);
    return;
  }
  const { client } = await s3();
  const s3client = await remoteClient();
  const out = await s3client.send(new client.GetObjectCommand({ Bucket: bucket(), Key: key }));
  await pipeline(out.Body, fs.createWriteStream(dest));
}

async function putFile(key, filePath, contentType) {
  if (!isConfigured()) {
    const dest = objectPath(key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(filePath, dest);
    return;
  }
  const { client } = await s3();
  const s3client = await remoteClient();
  const stat = fs.statSync(filePath);
  await s3client.send(
    new client.PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: contentType,
      ContentLength: stat.size,
      CacheControl: "public, max-age=31536000"
    })
  );
}

async function deleteObject(key) {
  if (!key) return;
  if (!isConfigured()) {
    fs.rmSync(objectPath(key), { force: true });
    return;
  }
  const { client } = await s3();
  const s3client = await remoteClient();
  await s3client.send(new client.DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

async function listKeys(prefix) {
  if (!isConfigured()) {
    const root = path.resolve(objectsRoot());
    const base = path.resolve(root, prefix);
    if (!fs.existsSync(base)) return [];
    const keys = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else keys.push(path.relative(root, abs).split(path.sep).join("/"));
      }
    };
    walk(base);
    return keys;
  }
  const { client } = await s3();
  const s3client = await remoteClient();
  const keys = [];
  let token;
  do {
    const out = await s3client.send(
      new client.ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: prefix,
        ContinuationToken: token
      })
    );
    for (const obj of out.Contents || []) if (obj.Key) keys.push(obj.Key);
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function deletePrefix(prefix) {
  const clean = String(prefix || "");
  if (!clean.includes("/hls/")) {
    const err = new Error("Suppression de dossier refusée.");
    err.status = 403;
    throw err;
  }
  const keys = await listKeys(clean);
  if (!isConfigured()) {
    for (const key of keys) fs.rmSync(objectPath(key), { force: true });
    return keys;
  }
  const { client } = await s3();
  const s3client = await remoteClient();
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100).map((Key) => ({ Key }));
    if (!chunk.length) continue;
    await s3client.send(
      new client.DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: chunk, Quiet: true } })
    );
  }
  return keys;
}

async function usedBytes(shopId) {
  const prefix = shopPrefix(shopId);
  if (!isConfigured()) {
    const keys = await listKeys(prefix);
    return keys.reduce((sum, key) => {
      try {
        return sum + fs.statSync(objectPath(key)).size;
      } catch (_) {
        return sum;
      }
    }, 0);
  }
  const { client } = await s3();
  const s3client = await remoteClient();
  let total = 0;
  let token;
  do {
    const out = await s3client.send(
      new client.ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: prefix,
        ContinuationToken: token
      })
    );
    for (const obj of out.Contents || []) total += Number(obj.Size) || 0;
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return total;
}

module.exports = {
  isConfigured,
  driver,
  partSize,
  shopPrefix,
  assertKeyBelongsToShop,
  validateUploadRequest,
  buildObjectKey,
  hlsMasterKey,
  publicUrlForKey,
  objectPath,
  createMultipart,
  signUploadPart,
  writeLocalPart,
  listUploadedParts,
  completeMultipart,
  abortMultipart,
  headObject,
  downloadToFile,
  putFile,
  deleteObject,
  listKeys,
  deletePrefix,
  usedBytes,
  IMAGE_MAX,
  VIDEO_MAX,
  SHOP_QUOTA_BYTES,
  get PART_SIZE() {
    return partSize();
  }
};

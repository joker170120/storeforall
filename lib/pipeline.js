/**
 * Après les morceaux : compression, dépôt Wasabi (ou disque), URL Bunny, puis HLS si vidéo.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const wasabi = require("./wasabi");
const bunny = require("./bunny");

function jpegKey(key) {
  return String(key).replace(/\.(png|jpe?g|bin)$/i, "") + ".jpg";
}

async function finish(row) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "storeforall-media-"));
  try {
    const ext = path.extname(row.key) || (row.type_fichier === "video" ? ".mp4" : ".bin");
    const input = path.join(work, "source" + ext);
    await wasabi.downloadToFile(row.key, input);
    const before = fs.statSync(input).size;
    const { compressFile } = require("./compress");
    const compressed = await compressFile(input, row.mimeType, work);
    const bytes = fs.statSync(compressed.path).size;
    let key = row.key;
    if (compressed.mime === "image/jpeg") key = jpegKey(row.key);
    await wasabi.putFile(key, compressed.path, compressed.mime);
    if (key !== row.key) {
      try {
        await wasabi.deleteObject(row.key);
      } catch (_) {}
    }
    const bunnyUrl = bunny.cdnUrlForKey(key);
    const wasabiUrl = wasabi.publicUrlForKey(key);
    const video = row.type_fichier === "video" || row.type === "video";
    return {
      key,
      mimeType: compressed.mime,
      size: bytes,
      url_wasabi: wasabiUrl,
      url_bunny: bunnyUrl,
      url: bunnyUrl || wasabiUrl,
      pipeline: {
        chunk: { ok: true, at: Date.now() },
        compression: {
          ok: compressed.ok,
          tool: compressed.tool,
          before,
          after: bytes,
          reason: compressed.reason || ""
        },
        wasabi: { ok: true, driver: wasabi.driver(), key, at: Date.now() },
        bunny: { branched: true, ok: Boolean(bunnyUrl), url: bunnyUrl },
        hls: video ? { ok: false, pending: true } : { ok: true, skipped: true, reason: "photo" }
      }
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { finish };

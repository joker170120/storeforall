/**
 * Découpe une vidéo en HLS (480p / 720p), une vidéo à la fois.
 * Les segments vont dans boutiques/{id}/hls/{id_media}/ puis sur Wasabi (ou le disque).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const wasabi = require("./wasabi");
const bunny = require("./bunny");
const store = require("./store");
const { ffmpegBin, run } = require("./compress");

const RENDITIONS = [
  { name: "480", height: 480, videoBitrate: 700000, maxrate: "770k", bufsize: "1540k", hlsTime: 2, audio: "64k" },
  { name: "720", height: 720, videoBitrate: 1200000, maxrate: "1320k", bufsize: "2640k", hlsTime: 4, audio: "80k" }
];

const queue = [];
let running = false;

function even(n) {
  const v = Math.max(2, Math.round(Number(n) || 2));
  return v % 2 === 0 ? v : v - 1;
}

function probe(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), ["-hide_banner", "-i", file], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (buf) => {
      err += buf.toString();
    });
    child.on("error", reject);
    child.on("close", () => {
      const video = err.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
      if (!video) {
        reject(new Error("Lecture vidéo impossible"));
        return;
      }
      resolve({
        width: Number(video[1]),
        height: Number(video[2]),
        audio: /Audio:/.test(err)
      });
    });
  });
}

function outputSize(srcW, srcH, target) {
  const portrait = (srcH || 0) >= (srcW || 0);
  if (portrait) {
    const width = even(Math.min(target, srcW || target));
    const height = even(((srcH || target) * width) / Math.max(1, srcW || target));
    return { width, height };
  }
  const height = even(Math.min(target, srcH || target));
  const width = even(((srcW || target) * height) / Math.max(1, srcH || target));
  return { width, height };
}

function renditionsFor(srcW, srcH) {
  const edge = (srcH || 0) >= (srcW || 0) ? srcW : srcH;
  const fit = RENDITIONS.filter((item) => !edge || edge >= item.height - 80);
  return fit.length ? fit : [RENDITIONS[RENDITIONS.length - 1]];
}

function scaleFilter(srcW, srcH, target) {
  if ((srcH || 0) >= (srcW || 0)) return `scale='min(${target},iw)':-2`;
  return `scale=-2:'min(${target},ih)'`;
}

async function encodeRendition(input, dir, rendition, source) {
  fs.mkdirSync(dir, { recursive: true });
  const args = [
    "-y",
    "-i",
    input,
    "-threads",
    "1",
    "-vf",
    scaleFilter(source.width, source.height, rendition.height),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-profile:v",
    "main",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    String(rendition.videoBitrate),
    "-maxrate",
    rendition.maxrate,
    "-bufsize",
    rendition.bufsize,
    "-g",
    "48",
    "-keyint_min",
    "48",
    "-sc_threshold",
    "0"
  ];
  if (source.audio) args.push("-c:a", "aac", "-b:a", rendition.audio, "-ac", "2");
  else args.push("-an");
  args.push(
    "-hls_time",
    String(rendition.hlsTime),
    "-hls_playlist_type",
    "vod",
    "-hls_list_size",
    "0",
    "-hls_flags",
    "independent_segments",
    "-hls_segment_filename",
    path.join(dir, "seg_%03d.ts"),
    path.join(dir, "index.m3u8")
  );
  await run(ffmpegBin(), args);
}

function writeMaster(dir, variants) {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];
  for (const item of variants) {
    const bandwidth = item.rendition.videoBitrate + (item.audio ? 96000 : 0);
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${item.size.width}x${item.size.height},NAME="${item.rendition.name}p"`
    );
    lines.push(`${item.rendition.name}/index.m3u8`);
  }
  fs.writeFileSync(path.join(dir, "master.m3u8"), lines.join("\n") + "\n");
}

function contentType(file) {
  if (file.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (file.endsWith(".ts")) return "video/mp2t";
  return "application/octet-stream";
}

async function uploadTree(dir, keyPrefix) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await uploadTree(abs, `${keyPrefix}${entry.name}/`);
      continue;
    }
    await wasabi.putFile(`${keyPrefix}${entry.name}`, abs, contentType(entry.name));
  }
}

async function remember(mediaId, shopId, masterKey, publicUrl, error) {
  await store.update((data) => {
    const row = (data.medias || []).find(
      (item) => String(item.id) === String(mediaId) && String(item.shopId) === String(shopId)
    );
    if (!row) return;
    row.pipeline = row.pipeline || {};
    if (error) {
      row.pipeline.hls = { ok: false, pending: false, reason: error };
      return;
    }
    row.url_hls = publicUrl;
    row.hls_key = masterKey;
    row.pipeline.hls = { ok: true, url: publicUrl, at: Date.now() };
    for (const product of data.products || []) {
      if (String(product.mediaId || "") === String(mediaId)) product.video = publicUrl;
    }
  });
}

function schedule(row) {
  if (!row || (row.type !== "video" && row.type_fichier !== "video")) return { queued: false };
  if (!row.key) return { queued: false };
  queue.push({
    mediaId: row.id,
    shopId: row.id_boutique || row.shopId,
    key: row.key
  });
  setImmediate(pump);
  return { queued: true, inline: true };
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      await processJob(job);
    } catch (error) {
      await remember(job.mediaId, job.shopId, "", "", error.message || "HLS impossible").catch(() => {});
    }
  }
  running = false;
}

async function processJob(data) {
  const mediaId = String(data.mediaId || "");
  const shopId = String(data.shopId || "");
  const key = String(data.key || "");
  wasabi.assertKeyBelongsToShop(key, shopId);
  const masterKey = wasabi.hlsMasterKey(shopId, mediaId);
  wasabi.assertKeyBelongsToShop(masterKey, shopId);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "storeforall-hls-"));
  const input = path.join(work, "source.mp4");
  try {
    await wasabi.downloadToFile(key, input);
    const source = await probe(input);
    const chosen = renditionsFor(source.width, source.height);
    const variants = [];
    for (const rendition of chosen) {
      const size = outputSize(source.width, source.height, rendition.height);
      const dir = path.join(work, rendition.name);
      await encodeRendition(input, dir, rendition, source);
      variants.push({ rendition, size, audio: source.audio });
    }
    writeMaster(work, variants);
    const prefix = masterKey.replace(/master\.m3u8$/, "");
    await uploadTree(work, prefix);
    const bunnyUrl = bunny.cdnUrlForKey(masterKey);
    const publicUrl = bunnyUrl || wasabi.publicUrlForKey(masterKey);
    await remember(mediaId, shopId, masterKey, publicUrl);
    return { ok: true, url: publicUrl };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { schedule, processJob, RENDITIONS };

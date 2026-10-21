const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function ffmpegBin() {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  try {
    const bundled = require("ffmpeg-static");
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch (_) {}
  return "ffmpeg";
}

function spawnText(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (buf) => {
      err = (err + buf.toString()).slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, err }));
  });
}

function run(cmd, args) {
  return spawnText(cmd, args).then(({ code, err }) => {
    if (code === 0) return err;
    throw new Error(err || `${cmd} a échoué`);
  });
}

async function hasAudio(input) {
  const { err } = await spawnText(ffmpegBin(), ["-hide_banner", "-i", input]);
  return /Audio:/.test(err);
}

async function compressImage(input, work) {
  const sharp = require("sharp");
  const out = path.join(work, "compressed.jpg");
  await sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(out);
  return { path: out, mime: "image/jpeg", tool: "sharp", ok: true };
}

async function compressVideo(input, work) {
  const out = path.join(work, "compressed.mp4");
  const bin = ffmpegBin();
  const audio = await hasAudio(input);
  const args = [
    "-y",
    "-i",
    input,
    "-threads",
    "1",
    "-map",
    "0:v:0",
    "-vf",
    "scale='min(1280,iw)':-2",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p"
  ];
  if (audio) args.push("-map", "0:a:0", "-c:a", "aac", "-b:a", "128k");
  else args.push("-an");
  args.push("-movflags", "+faststart", out);
  await run(bin, args);
  return { path: out, mime: "video/mp4", tool: "ffmpeg", ok: true };
}

/**
 * Compression serveur après assemblage des morceaux.
 * Image : sharp. Vidéo : ffmpeg (échelle 1280, crf 23), comme le plan GabMall.
 */
async function compressFile(input, mime, work) {
  const kind = String(mime || "");
  try {
    if (kind.startsWith("image/")) return await compressImage(input, work);
    if (kind.startsWith("video/")) return await compressVideo(input, work);
  } catch (error) {
    const copy = path.join(work, "copie" + path.extname(input));
    fs.copyFileSync(input, copy);
    return {
      path: copy,
      mime: kind || "application/octet-stream",
      tool: "copie",
      ok: false,
      reason: error.message || "compression impossible"
    };
  }
  return { path: input, mime: kind, tool: "copie", ok: false, reason: "type ignoré" };
}

function ffmpegAvailable() {
  const bin = ffmpegBin();
  return bin !== "ffmpeg" || fs.existsSync("/usr/bin/ffmpeg") || fs.existsSync("/opt/homebrew/bin/ffmpeg");
}

module.exports = { compressFile, ffmpegBin, ffmpegAvailable, run };

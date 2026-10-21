/**
 * BunnyCDN devant le bucket Wasabi.
 * L'URL Wasabi (ou le fichier local) reste en base. Le site préfère l'URL Bunny.
 *
 * Console https://dash.bunny.net :
 * 1. Pull Zone dont l'origine est l'endpoint Wasabi + / + bucket.
 * 2. Origin authentication AWS S3 (clés Wasabi, région eu-central-1).
 * 3. Range requests activés pour le MP4 et les segments HLS.
 * 4. Hostname dans BUNNY_CDN_HOSTNAME. BUNNY_API_KEY sert uniquement à purger.
 */
function hostname() {
  return String(process.env.BUNNY_CDN_HOSTNAME || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");
}

function configured() {
  return Boolean(hostname());
}

function cdnUrlForKey(key) {
  const host = hostname();
  const clean = String(key || "").replace(/^\//, "");
  if (!host || !clean) return "";
  return `https://${host}/${clean.split("/").map(encodeURIComponent).join("/")}`;
}

function isBunnyMediaUrl(url) {
  const host = hostname();
  if (!host) return false;
  try {
    const parsed = new URL(String(url || ""));
    return parsed.protocol === "https:" && parsed.hostname === host;
  } catch (_) {
    return false;
  }
}

async function purgeUrl(url) {
  const target = String(url || "").trim();
  const key = String(process.env.BUNNY_API_KEY || "").trim();
  if (!target || !key || !isBunnyMediaUrl(target)) return { ok: false, skipped: true };
  const endpoint = "https://api.bunny.net/purge?async=false&url=" + encodeURIComponent(target);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { AccessKey: key, Accept: "application/json" }
  });
  if (!res.ok) {
    const err = new Error("Purge BunnyCDN refusée");
    err.status = res.status;
    throw err;
  }
  return { ok: true };
}

module.exports = { hostname, configured, cdnUrlForKey, isBunnyMediaUrl, purgeUrl };

const { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } = require("crypto");

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !String(stored).includes(":")) return false;
  const [salt, hash] = String(stored).split(":");
  let prev;
  try {
    prev = Buffer.from(hash, "hex");
  } catch (_) {
    return false;
  }
  const next = scryptSync(String(password), salt, 64);
  if (prev.length !== next.length) return false;
  return timingSafeEqual(prev, next);
}

function tokenHash(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function issueSession(store, fields) {
  const token = randomBytes(32).toString("base64url");
  if (!Array.isArray(store.sessions)) store.sessions = [];
  store.sessions.push({
    id: randomUUID(),
    tokenHash: tokenHash(token),
    shopId: fields.shopId || "",
    adminId: fields.adminId || "",
    role: fields.role || "merchant",
    createdAt: Date.now()
  });
  return token;
}

function bearer(req) {
  const header = req.headers.authorization || "";
  return header.replace(/^Bearer\s+/i, "").trim();
}

function sessionFromRequest(store, req) {
  const token = bearer(req);
  if (!token || !store) return null;
  const hash = tokenHash(token);
  const session = (store.sessions || []).find((row) => row.tokenHash === hash);
  if (!session) return null;
  if (session.role === "platform") return { session, role: "platform" };
  const shop = (store.shops || []).find((row) => row.id === session.shopId);
  const admin = (store.admins || []).find(
    (row) => row.id === session.adminId && row.shopId === session.shopId
  );
  if (!shop || !admin) return null;
  return { session, role: "merchant", shop, admin };
}

module.exports = { hashPassword, verifyPassword, issueSession, sessionFromRequest, bearer };

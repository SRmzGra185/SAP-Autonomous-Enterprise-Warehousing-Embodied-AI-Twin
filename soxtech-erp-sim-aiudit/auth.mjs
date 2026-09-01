import crypto from "node:crypto";
import { HttpError, isLoopback } from "./http-utils.mjs";

const discoveryCache = new Map();
const base64Url = (value) => Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64");
const audienceMatches = (actual, expected) => Array.isArray(actual) ? actual.includes(expected) : actual === expected;
const roleList = (value) => (Array.isArray(value) ? value : String(value || "").split(/[ ,]/)).map((role) => role.toLowerCase()).filter(Boolean);

async function oidcMetadata(config) {
  const cached = discoveryCache.get(config.auth.issuer);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const issuer = config.auth.issuer.replace(/\/$/, "");
  const discovery = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!discovery.ok) throw new HttpError(503, "Identity provider discovery is unavailable.", "oidc_unavailable");
  const metadata = await discovery.json();
  const jwksResponse = await fetch(metadata.jwks_uri);
  if (!jwksResponse.ok) throw new HttpError(503, "Identity provider keys are unavailable.", "oidc_unavailable");
  const value = { issuer, keys: (await jwksResponse.json()).keys || [], expiresAt: Date.now() + config.auth.jwksTtlMs };
  discoveryCache.set(config.auth.issuer, value);
  return value;
}

async function verifyJwt(token, config) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "Malformed bearer token.", "invalid_token");
  let header, claims;
  try { header = JSON.parse(base64Url(parts[0]).toString("utf8")); claims = JSON.parse(base64Url(parts[1]).toString("utf8")); }
  catch { throw new HttpError(401, "Malformed bearer token.", "invalid_token"); }
  if (header.alg !== "RS256" || !header.kid) throw new HttpError(401, "Only signed RS256 OIDC tokens are accepted.", "invalid_token");
  const metadata = await oidcMetadata(config), jwk = metadata.keys.find((key) => key.kid === header.kid);
  if (!jwk) { discoveryCache.delete(config.auth.issuer); throw new HttpError(401, "Token signing key is unknown.", "invalid_token"); }
  const valid = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key: jwk, format: "jwk" }), base64Url(parts[2]));
  const now = Math.floor(Date.now() / 1000);
  if (!valid || claims.iss?.replace(/\/$/, "") !== metadata.issuer || !audienceMatches(claims.aud, config.auth.audience) || Number(claims.exp || 0) <= now || Number(claims.nbf || 0) > now + 30) throw new HttpError(401, "Bearer token validation failed.", "invalid_token");
  return claims;
}

export async function authenticate(req, config) {
  if (config.auth.mode === "desktop") {
    if (!isLoopback(req.socket.remoteAddress)) throw new HttpError(401, "Desktop mode accepts loopback clients only.", "desktop_remote_denied");
    return { userId: config.auth.desktopUser, tenantId: config.auth.desktopTenant, roles: [config.auth.desktopRole.toLowerCase()], authMode: "desktop" };
  }
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpError(401, "A bearer token is required.", "missing_token");
  const claims = await verifyJwt(match[1], config), tenantId = String(claims[config.auth.tenantClaim] || claims.tenant_id || ""), userId = String(claims.sub || "");
  if (!tenantId || !userId) throw new HttpError(403, "Token must contain subject and tenant claims.", "claims_missing");
  const roles = roleList(claims[config.auth.roleClaim]);
  return { userId, tenantId, roles: roles.length ? roles : ["viewer"], authMode: "oidc" };
}

export function safetyIdentifier(principal) { return crypto.createHash("sha256").update(`${principal.tenantId}:${principal.userId}`).digest("hex").slice(0, 32); }

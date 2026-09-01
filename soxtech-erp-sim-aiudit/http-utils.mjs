export class HttpError extends Error {
  constructor(status, message, code = "request_error") { super(message); this.status = status; this.code = code; }
}

export function isLoopback(address = "") { return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1"; }

export function assertAllowedOrigin(req, config) {
  const origin = req.headers.origin;
  if (origin && !config.appOrigins.includes(origin)) throw new HttpError(403, "Origin is not allowed.", "cors_denied");
  return origin || null;
}

export function applyHeaders(res, origin = null) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
}

export async function readJson(req, config) {
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) throw new HttpError(415, "Content-Type must be application/json.", "content_type");
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > config.bodyLimitBytes) throw new HttpError(413, "Request body is too large.", "body_too_large");
    chunks.push(chunk);
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; }
  catch { throw new HttpError(400, "Request body contains invalid JSON.", "invalid_json"); }
}

export function createRateLimiter({ windowMs, max }) {
  const buckets = new Map();
  return function check(key, overrideMax = max) {
    const now = Date.now(), current = buckets.get(key), bucket = !current || now >= current.resetAt ? { count: 0, resetAt: now + windowMs } : current;
    bucket.count += 1; buckets.set(key, bucket);
    if (buckets.size > 5000) for (const [id, value] of buckets) if (now >= value.resetAt) buckets.delete(id);
    if (bucket.count > overrideMax) throw new HttpError(429, "Rate limit exceeded. Try again later.", "rate_limited");
    return { limit: overrideMax, remaining: Math.max(0, overrideMax - bucket.count), resetAt: bucket.resetAt };
  };
}

export function rateKey(req, principal) { return `${principal?.tenantId || "public"}:${principal?.userId || req.socket.remoteAddress || "unknown"}`; }

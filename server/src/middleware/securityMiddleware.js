// Phase 8: OWASP-oriented HTTP security headers, in-memory rate limiting,
// and consistent JSON 404 handling for /api routes.

export function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=()"
  );
  next();
}

export function createRateLimiter({
  windowMs = 60 * 1000,
  max = 100,
  maxRequests,
  message = "Too many requests, please try again later",
  keyPrefix = "global",
} = {}) {
  const limitMax =
    typeof maxRequests === "number" && maxRequests > 0 ? maxRequests : max;
  const buckets = new Map();

  return function rateLimiterMiddleware(req, res, next) {
    const now = Date.now();
    if (buckets.size > 2000) {
      for (const [k, v] of buckets.entries()) {
        if (now >= v.resetAt) {
          buckets.delete(k);
        }
      }
    }

    const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
    const key = `${keyPrefix}:${clientIp}`;
    let entry = buckets.get(key);

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }

    entry.count += 1;

    const remaining = Math.max(0, limitMax - entry.count);
    res.setHeader("X-RateLimit-Limit", String(limitMax));
    res.setHeader("X-RateLimit-Remaining", String(remaining));

    if (entry.count > limitMax) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({
        success: false,
        message,
      });
    }

    next();
  };
}

export function apiNotFoundHandler(req, res) {
  return res.status(404).json({
    success: false,
    message: "API endpoint not found",
  });
}

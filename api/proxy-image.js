// Vercel Serverless Function — image proxy for Firebase Storage.
// Hardened 2026-07-11: strict parsed-hostname allowlist (a substring check like
// url.includes("firebasestorage...") is trivially bypassable, e.g.
// http://evil.example/?firebasestorage.app or http://firebasestorage.app.evil/),
// https-only, no redirect following (redirect-based SSRF), image-only passthrough
// (never echo upstream text/html from our trusted origin), and a size cap.

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: "Invalid url" });
  }

  const host = parsed.hostname.toLowerCase();
  const hostAllowed =
    host === "firebasestorage.googleapis.com" || host.endsWith(".firebasestorage.app");
  if (parsed.protocol !== "https:" || !hostAllowed) {
    return res.status(403).json({ error: "Only https Firebase Storage URLs are allowed" });
  }

  try {
    // redirect:"error" stops a valid-looking host from 3xx-redirecting to an internal/other host.
    const response = await fetch(parsed.toString(), { redirect: "error" });
    if (!response.ok) {
      return res.status(response.status).json({ error: "Upstream fetch failed" });
    }

    // Only images may pass through — otherwise a crafted upstream could serve
    // HTML/JS that would render from the trusted etprintworld.com origin.
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      return res.status(415).json({ error: "Upstream is not an image" });
    }

    const declaredLen = Number(response.headers.get("content-length") || 0);
    if (declaredLen && declaredLen > MAX_BYTES) {
      return res.status(413).json({ error: "Image too large" });
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      return res.status(413).json({ error: "Image too large" });
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(buffer);
  } catch (e) {
    return res.status(502).json({ error: "Fetch failed" });
  }
}

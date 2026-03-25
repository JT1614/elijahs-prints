export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing url parameter" });

  // Only allow Firebase Storage URLs
  if (!url.includes("firebasestorage.googleapis.com") && !url.includes("firebasestorage.app")) {
    return res.status(403).json({ error: "Only Firebase Storage URLs allowed" });
  }

  try {
    const response = await fetch(url);
    if (!response.ok) return res.status(response.status).json({ error: "Fetch failed" });

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

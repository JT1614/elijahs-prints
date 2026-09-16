// TEMPORARY (2026-09-16 session 31, third use) — re-host the 2 remaining
// broken Clicker GIFs (Frankenstein #264, Zombie Hand #266) on Firebase
// Storage. Both were converted to static JPEGs in the PRIOR session
// (2026-09-16 session 30, FOLLOW-UP 5) to fix a wrong-content-type issue —
// that conversion lost the animation, which John confirmed is a deliberate
// site feature for every Clicker product. Re-sourced fresh from each
// product's own MakerWorld sourceUrl (still the original design, verified
// genuinely multi-frame before use), re-hosted here (not hotlinked) so they
// don't reintroduce the wrong-content-type/external-dependency problem that
// broke them the first time.
//
// Fetches the source file SERVER-SIDE (given `fetchUrl`) rather than
// accepting base64 in the request body — the GIFs are multi-MB, well past
// what's safe to send through a Vercel function's own request body limit.
// DELETE this file once both uploads are confirmed; scoped to
// product-images/ only, and fetchUrl is restricted to makerworld.bblmw.com
// (the only source this session needs) to keep this from being a general
// server-side-fetch proxy.
import admin from "firebase-admin";
import crypto from "crypto";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.HAL_EXPORT_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const { path, fetchUrl, contentType } = req.body || {};
    if (!path || !fetchUrl || !contentType) {
      return res.status(400).json({ error: "path, fetchUrl, contentType required" });
    }
    if (!path.startsWith("product-images/")) {
      return res.status(403).json({ error: "Only product-images/ paths permitted" });
    }
    let host;
    try { host = new URL(fetchUrl).host; } catch { return res.status(400).json({ error: "invalid fetchUrl" }); }
    if (host !== "makerworld.bblmw.com") {
      return res.status(403).json({ error: "fetchUrl host not permitted" });
    }

    const sourceRes = await fetch(fetchUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!sourceRes.ok) return res.status(502).json({ error: `source fetch failed: ${sourceRes.status}` });
    const buffer = Buffer.from(await sourceRes.arrayBuffer());

    const bucket = admin.storage().bucket("elijahs-prints.firebasestorage.app");
    const file = bucket.file(path);
    const token = crypto.randomUUID();
    await file.save(buffer, {
      metadata: { contentType, metadata: { firebaseStorageDownloadTokens: token } },
    });
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    return res.status(200).json({ ok: true, url, bytes: buffer.length });
  } catch (e) {
    console.error("temp-storage-upload failed:", e);
    return res.status(500).json({ error: e.message });
  }
}

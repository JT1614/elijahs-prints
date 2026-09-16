// TEMPORARY (2026-09-16) — one-off admin-SDK Storage upload for 3 product images
// (264, 266, 283) whose MakerWorld source served the wrong content-type
// (application/octet-stream, not image/*, so strict email clients wouldn't
// render them at all) and were absurdly oversized (1.6-6.8MB for a thumbnail).
// Bypasses Storage security rules (admin SDK isn't subject to them) — same
// pattern as the 2026-09-04 base64-stranded-images migration in App.jsx's
// CLAUDE.md history. DELETE this file once the 3 uploads are confirmed;
// scoped to product-images/ only so the blast radius stays bounded even while it exists.
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
    const { path, base64, contentType } = req.body || {};
    if (!path || !base64 || !contentType) {
      return res.status(400).json({ error: "path, base64, contentType required" });
    }
    if (!path.startsWith("product-images/")) {
      return res.status(403).json({ error: "Only product-images/ paths permitted" });
    }
    const bucket = admin.storage().bucket("elijahs-prints.firebasestorage.app");
    const file = bucket.file(path);
    const token = crypto.randomUUID();
    const buffer = Buffer.from(base64, "base64");
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

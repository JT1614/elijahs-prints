// TEMPORARY (2026-09-16 session 31, fourth use) — upload 26 gifsicle-compressed
// Clicker GIFs (resize-fit 300x300, -O3, --lossy=80, --colors 128; frame
// count untouched, 83-96% smaller, verified visually clean). John reported
// the reverted-to-original Clicker GIFs (FOLLOW-UP 7/8) were now loading
// slowly or not at all — expected, since reverting restored their original
// 600KB-6.8MB size. This compresses them while keeping every frame, so the
// animation itself is unchanged, only the file weight. DELETE this file
// once all 26 uploads are confirmed; scoped to product-images/ only.
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

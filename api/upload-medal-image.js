// Vercel Serverless Function — TEMPORARY one-off endpoint (2026-08-22).
// Uploads a single image (POSTed as base64) to Firebase Storage under
// product-images/{id}.{ext} and returns a download-token URL in the exact format
// the app's own client-side uploadProductImage() produces. Built for the
// FootballLab Medal custom-order product addition (Tom, The Football Lab) — see
// Elijahs business/Brain/knowledge.md and CLAUDE.md "catalogue-wipe class of bug".
//
// GET  = health check only — confirms auth + Firebase Admin init. Uploads nothing.
// POST = execute — body { id, imageBase64, contentType } — uploads to Storage,
//        verifies the returned URL actually serves HTTP 200, then returns { url }.
//        No Firestore writes happen here at all (that's api/hal-briefing-export.js,
//        via its own WRITE_KEYS-gated allowlist).
//
// Auth: HAL_EXPORT_TOKEN bearer (same token as api/hal-briefing-export.js).
// REVERT (DELETE) THIS FILE after the upload is verified — same discipline as the
// 2026-07-13 migrate-label-drawings.js temp-endpoint runbook (commit 0094164 / revert
// 0e002dd), referenced in ET Print World CLAUDE.md.

import admin from "firebase-admin";
import crypto from "crypto";

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (e) {
    console.error("[upload-medal-image] Firebase Admin init failed:", e);
  }
}

// Matches the bucket every existing product-image and label-drawing URL uses.
const BUCKET = "elijahs-prints.firebasestorage.app";
// Sanity ceiling — this endpoint uploads a single product photo, not a bulk migration.
const MAX_BYTES = 5_000_000;

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.HAL_EXPORT_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!admin.apps.length) {
    return res.status(500).json({ error: "Firebase Admin not initialized" });
  }

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      note: "Auth + Firebase Admin init OK. POST { id, imageBase64, contentType } (no data: prefix on imageBase64) to upload.",
    });
  }

  try {
    const { id, imageBase64, contentType } = req.body || {};
    if (!id) return res.status(400).json({ error: "id required" });
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "imageBase64 required (base64 string, no data: prefix)" });
    }
    const buf = Buffer.from(imageBase64, "base64");
    if (buf.length < 1000) {
      return res.status(400).json({ error: `decoded image is ${buf.length} B — implausibly small, aborting` });
    }
    if (buf.length > MAX_BYTES) {
      return res.status(400).json({ error: `decoded image is ${buf.length} B — exceeds ${MAX_BYTES} B ceiling, aborting` });
    }

    const mime = contentType || "image/png";
    const ext = mime === "image/jpeg" ? "jpg" : "png";
    const token = crypto.randomUUID();
    const objectPath = `product-images/${id}.${ext}`;
    const bucket = admin.storage().bucket(BUCKET);
    await bucket.file(objectPath).save(buf, {
      resumable: false,
      contentType: mime,
      metadata: { metadata: { firebaseStorageDownloadTokens: token } },
    });
    const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;

    // Verify it actually serves before reporting success — same discipline as
    // migrate-label-drawings.js step 3 (catch token/rules mistakes immediately).
    const check = await fetch(url, { method: "GET" });
    if (check.status !== 200) {
      return res.status(502).json({ error: `Uploaded but URL check failed: HTTP ${check.status}`, url, objectPath });
    }

    return res.status(200).json({ ok: true, url, bytes: buf.length, objectPath });
  } catch (error) {
    console.error("[upload-medal-image] POST failed:", error);
    return res.status(500).json({ error: error.message || "Upload failed" });
  }
}

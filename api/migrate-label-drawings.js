// Vercel Serverless Function — TEMPORARY migration endpoint (2026-07-13).
// Moves legacy base64 labelDrawing values out of shop/products-v2 into Firebase
// Storage (label-drawings/{id}.png), replacing each with a download-token URL in
// the exact format the app's own uploadLabelDrawing() produces. Fixes the
// Firestore 1 MiB ceiling (doc was 98.5% full; 87% of it was 7 legacy drawings).
//
// GET  = dry run — reports what would be migrated, writes NOTHING.
// POST = execute — uploads all candidates, verifies each URL serves HTTP 200,
//        then performs the ONE products-v2 write, then reads it back.
//        Any failure before the write aborts with zero state change.
//
// Auth: HAL_EXPORT_TOKEN bearer (same as api/hal-briefing-export.js).
// REVERT THIS FILE after the migration is verified — same discipline as the
// 2026-07-12 temporary WRITE_KEYS restore (see ET Brain/state.md session 16).

import admin from "firebase-admin";
import crypto from "crypto";

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (e) {
    console.error("[migrate-label-drawings] Firebase Admin init failed:", e);
  }
}
const db = admin.apps.length ? admin.firestore() : null;

// Matches the bucket every existing product-image and label-drawing URL uses.
const BUCKET = "elijahs-prints.firebasestorage.app";

// Post-migration size band for the products-v2 JSON string. Measured expectation
// ~144,001 B; band is generous but blocks anything structurally wrong.
const MIN_EXPECTED = 100_000;
const MAX_EXPECTED = 400_000;
const MIN_PRODUCTS = 100; // catalogue is 130; refuse to touch anything smaller

function stripDrawing(p) {
  const { labelDrawing, ...rest } = p;
  return JSON.stringify(rest);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.HAL_EXPORT_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!db) return res.status(500).json({ error: "Firebase not initialized" });

  const report = { mode: req.method === "POST" ? "EXECUTE" : "DRY-RUN", steps: [] };
  try {
    // 1. Read + parse the live doc
    const snap = await db.collection("shop").doc("products-v2").get();
    if (!snap.exists) throw new Error("shop/products-v2 does not exist");
    const oldValue = snap.data().value;
    if (typeof oldValue !== "string") throw new Error("products-v2 .value is not a string — unexpected shape, aborting");
    const products = JSON.parse(oldValue);
    if (!Array.isArray(products) || products.length < MIN_PRODUCTS) {
      throw new Error(`Parsed ${Array.isArray(products) ? products.length : "non-array"} products — below safety floor ${MIN_PRODUCTS}, aborting`);
    }
    const candidates = products.filter((p) => typeof p.labelDrawing === "string" && p.labelDrawing.startsWith("data:"));
    report.before = { products: products.length, jsonBytes: oldValue.length, base64Drawings: candidates.length };
    report.candidates = candidates.map((p) => ({ id: p.id, name: p.name, bytes: p.labelDrawing.length }));
    report.steps.push("read+parse OK");

    if (candidates.length === 0) {
      report.note = "Nothing to migrate — idempotent no-op.";
      return res.status(200).json(report);
    }
    if (req.method === "GET") {
      const projected = products.map((p) =>
        candidates.some((c) => c.id === p.id) ? { ...p, labelDrawing: "https://firebasestorage.googleapis.com/x".padEnd(160, "x") } : p
      );
      report.projectedJsonBytes = JSON.stringify(projected).length;
      report.note = "Dry run only — nothing uploaded, nothing written.";
      return res.status(200).json(report);
    }

    // 2. EXECUTE — upload every candidate to Storage (additive; abort on any failure)
    const bucket = admin.storage().bucket(BUCKET);
    const urlById = {};
    for (const p of candidates) {
      const m = p.labelDrawing.match(/^data:(.*?);base64,(.*)$/s);
      if (!m) throw new Error(`Product ${p.id}: labelDrawing is not a parseable data URL`);
      const mime = m[1] || "image/jpeg";
      const buf = Buffer.from(m[2], "base64");
      if (buf.length < 1000) throw new Error(`Product ${p.id}: decoded drawing is ${buf.length} B — implausibly small, aborting`);
      const token = crypto.randomUUID();
      // .png path matches the app's uploadLabelDrawing/deleteLabelDrawing conventions,
      // so a future in-app replace/remove targets the same object.
      const objectPath = `label-drawings/${p.id}.png`;
      await bucket.file(objectPath).save(buf, {
        resumable: false,
        contentType: mime,
        metadata: { metadata: { firebaseStorageDownloadTokens: token } },
      });
      urlById[p.id] = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
    }
    report.steps.push(`uploaded ${candidates.length} objects`);

    // 3. Verify every new URL actually serves (catches token/rules mistakes BEFORE any write)
    report.urlChecks = [];
    for (const [id, url] of Object.entries(urlById)) {
      const r = await fetch(url, { method: "GET" });
      report.urlChecks.push({ id, status: r.status, contentType: r.headers.get("content-type"), bytes: Number(r.headers.get("content-length")) || null });
      if (r.status !== 200) throw new Error(`URL check failed for product ${id}: HTTP ${r.status} — aborting before any doc write`);
    }
    report.steps.push("all URL checks 200");

    // 4. Build the new array — ONLY labelDrawing may change, on ONLY the candidates
    const newProducts = products.map((p) => (urlById[p.id] ? { ...p, labelDrawing: urlById[p.id] } : p));
    if (newProducts.length !== products.length) throw new Error("Length drift — aborting");
    for (let i = 0; i < products.length; i++) {
      if (newProducts[i].id !== products[i].id) throw new Error(`Order/id drift at index ${i} — aborting`);
      if (stripDrawing(newProducts[i]) !== stripDrawing(products[i])) throw new Error(`Field drift beyond labelDrawing on product ${products[i].id} — aborting`);
    }
    const newValue = JSON.stringify(newProducts);
    if (newValue.length < MIN_EXPECTED || newValue.length > MAX_EXPECTED) {
      throw new Error(`New JSON is ${newValue.length} B — outside expected band ${MIN_EXPECTED}-${MAX_EXPECTED}, aborting`);
    }
    if (newValue.length >= oldValue.length) throw new Error("New JSON is not smaller than old — aborting");
    report.steps.push("assertions OK");

    // 5. The one write
    await db.collection("shop").doc("products-v2").set({
      value: newValue,
      updatedAt: new Date().toISOString(),
    });
    report.steps.push("products-v2 written");

    // 6. Read back and confirm
    const back = await db.collection("shop").doc("products-v2").get();
    const backProducts = JSON.parse(back.data().value);
    const backB64 = backProducts.filter((p) => typeof p.labelDrawing === "string" && p.labelDrawing.startsWith("data:")).length;
    report.after = {
      products: backProducts.length,
      jsonBytes: back.data().value.length,
      pctOf1MiB: +((100 * back.data().value.length) / 1048576).toFixed(1),
      base64Drawings: backB64,
      urlDrawings: backProducts.filter((p) => typeof p.labelDrawing === "string" && p.labelDrawing.startsWith("http")).length,
    };
    if (backProducts.length !== products.length || backB64 !== 0) {
      report.warning = "READ-BACK MISMATCH — inspect immediately; backup at Output/db-backups/ (2026-07-13)";
    }
    report.steps.push("read-back OK");
    return res.status(200).json(report);
  } catch (error) {
    console.error("[migrate-label-drawings] failed:", error);
    report.error = error.message || String(error);
    return res.status(500).json(report);
  }
}

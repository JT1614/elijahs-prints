// Vercel Serverless Function — Friday Briefing data export.
// Read + write endpoint for the et-friday-briefing scheduled task.
// GET:  read briefing-relevant Firestore docs (allowlisted keys), return JSON.
// POST: ledger writes during briefing run (allowlisted keys only).
//
// Auth: HAL_EXPORT_TOKEN bearer token (mirrors api/hal-export.js).
//
// Required env vars in Vercel (already set):
//   FIREBASE_SERVICE_ACCOUNT — JSON string of Firebase service account key
//   HAL_EXPORT_TOKEN — bearer token

import admin from "firebase-admin";

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (e) {
    console.error("[hal-briefing-export] Firebase Admin init failed:", e);
  }
}
const db = admin.apps.length ? admin.firestore() : null;

// Allowlisted keys the briefing needs. Only these can be read or written.
// Limits blast radius if the bearer token is ever exposed.
const READ_KEYS = [
  "products-v2",
  "assessment-v1",
  "categories-v1",
  "category-meta-v1",
  "creators-v1",
  "filaments-v1",
  "stock-targets-v1",
  "stock-events-v1",
  "stock-orders-v1",
  "offline-sales-v1",
  "orders-v1",
  "requests-v1",
  "pricing-config-v1",
  "feature-flags-v1",
];

// TEMPORARY (2026-07-12 catalogue restore): "products-v2" added for the one-off
// restore of the seeded-over catalogue. REVERT to ["assessment-v1"] immediately
// after the restore is verified — see Brain/state.md incident entry.
const WRITE_KEYS = ["assessment-v1", "products-v2"];

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.HAL_EXPORT_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!db) {
    return res.status(500).json({ error: "Firebase not initialized" });
  }

  if (req.method === "POST") {
    try {
      const { action, key, value } = req.body || {};
      if (action !== "set") {
        return res.status(400).json({ error: "Unknown action. Use action: 'set'" });
      }
      if (!WRITE_KEYS.includes(key)) {
        return res.status(403).json({
          error: `Write to '${key}' not permitted. Allowed: ${WRITE_KEYS.join(", ")}`,
        });
      }
      if (value === undefined) {
        return res.status(400).json({ error: "value required" });
      }

      const stored = typeof value === "string" ? value : JSON.stringify(value);
      await db.collection("shop").doc(key).set({
        value: stored,
        updatedAt: new Date().toISOString(),
      });

      return res.status(200).json({ ok: true, key, bytes: stored.length });
    } catch (error) {
      console.error("[hal-briefing-export] POST failed:", error);
      return res.status(500).json({ error: error.message || "Write failed" });
    }
  }

  // GET — read all allowlisted keys
  try {
    const data = {};
    const errors = [];

    await Promise.all(
      READ_KEYS.map(async (key) => {
        try {
          const snap = await db.collection("shop").doc(key).get();
          if (!snap.exists) {
            data[key] = null;
            return;
          }
          const raw = snap.data();
          let parsed = raw.value;
          if (typeof parsed === "string") {
            try {
              parsed = JSON.parse(parsed);
            } catch {
              // leave as string if not JSON
            }
          }
          data[key] = parsed;
        } catch (e) {
          errors.push({ key, error: e.message });
          data[key] = null;
        }
      })
    );

    // Also expose the requests collection (separate from shop/requests-v1 — set
    // by /api/save-request as one doc per request). Briefing slide 4 uses this.
    try {
      const reqSnap = await db
        .collection("requests")
        .orderBy("date", "desc")
        .limit(500)
        .get();
      data["requests_collection"] = reqSnap.docs.map((d) => d.data());
    } catch (e) {
      // Fallback to unordered scan
      try {
        const reqSnap = await db.collection("requests").limit(500).get();
        data["requests_collection"] = reqSnap.docs
          .map((d) => d.data())
          .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      } catch (e2) {
        errors.push({ key: "requests_collection", error: e2.message });
        data["requests_collection"] = [];
      }
    }

    // Also expose the orders collection (one doc per paid order, written by the
    // Stripe webhook). Briefing slides 7 + 9 use this for revenue/AOV/sell-through.
    // Limit 1000 since orders accumulate; this covers ~2 years at current volume.
    try {
      const ordSnap = await db.collection("orders").limit(1000).get();
      data["orders_collection"] = ordSnap.docs.map((d) => d.data());
    } catch (e) {
      errors.push({ key: "orders_collection", error: e.message });
      data["orders_collection"] = [];
    }

    return res.status(200).json({
      exported_at: new Date().toISOString(),
      data,
      errors: errors.length ? errors : undefined,
    });
  } catch (error) {
    console.error("[hal-briefing-export] GET failed:", error);
    return res.status(500).json({ error: error.message || "Export failed" });
  }
}

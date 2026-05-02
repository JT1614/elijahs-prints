// Vercel Serverless Function — diagnostic list of recent special requests.
// Uses firebase-admin to read the requests collection server-side. Recency-window
// guard limits blast radius if _tok is compromised: only returns requests created
// in the last N hours (default 24, max 168 = 7 days).
//
// Required env vars (already set):
//   FIREBASE_SERVICE_ACCOUNT — JSON string of Firebase service account key
//   EMAIL_API_TOKEN — soft auth shared with the client

import admin from "firebase-admin";

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (e) {
    console.error("[list-requests] Firebase Admin init failed:", e);
  }
}
const db = admin.apps.length ? admin.firestore() : null;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { _tok, hours } = req.body || {};

  const EXPECTED_TOKEN = process.env.EMAIL_API_TOKEN;
  if (!EXPECTED_TOKEN || _tok !== EXPECTED_TOKEN) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!db) {
    return res.status(500).json({ error: "Firebase Admin not initialised" });
  }

  // Recency-window guard — even with a leaked _tok, this endpoint cannot exfiltrate
  // historical PII. Default 24h, hard-capped at 168h (7 days).
  const windowHours = Math.min(168, Math.max(1, parseInt(hours, 10) || 24));
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  try {
    const snap = await db
      .collection("requests")
      .where("date", ">=", cutoff)
      .orderBy("date", "desc")
      .limit(50)
      .get();

    const items = snap.docs.map(d => d.data());
    return res.status(200).json({
      windowHours,
      cutoff,
      count: items.length,
      items,
    });
  } catch (e) {
    // If the orderBy fails because the date field is missing on some docs,
    // fall back to a simple unordered scan and filter in-memory.
    console.warn("[list-requests] Indexed query failed, falling back:", e.message);
    try {
      const snap = await db.collection("requests").limit(50).get();
      const items = snap.docs
        .map(d => d.data())
        .filter(r => r.date && r.date >= cutoff)
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      return res.status(200).json({
        windowHours,
        cutoff,
        count: items.length,
        fallback: true,
        items,
      });
    } catch (e2) {
      console.error("[list-requests] Fallback failed:", e2);
      return res.status(500).json({ error: "Read failed" });
    }
  }
}

// Vercel Serverless Function — admin-only list of all special requests.
// Authenticates via Firebase Auth ID token (Authorization: Bearer <token> header).
// Uses firebase-admin to verify the token AND read the collection — no Firestore
// security rule needed for either side.
//
// Required env vars (already set):
//   FIREBASE_SERVICE_ACCOUNT — JSON string of Firebase service account key

import admin from "firebase-admin";

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (e) {
    console.error("[admin-list-requests] Firebase Admin init failed:", e);
  }
}
const db = admin.apps.length ? admin.firestore() : null;
const auth = admin.apps.length ? admin.auth() : null;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Authenticate via Firebase Auth ID token. Only signed-in admin users can pass.
  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  if (!match) {
    return res.status(401).json({ error: "Missing Bearer token" });
  }
  const idToken = match[1];

  if (!auth || !db) {
    return res.status(500).json({ error: "Firebase Admin not initialised" });
  }

  try {
    await auth.verifyIdToken(idToken);
  } catch (e) {
    console.warn("[admin-list-requests] Token verification failed:", e.message);
    return res.status(403).json({ error: "Invalid or expired token" });
  }

  try {
    // Try indexed query first (newest-first)
    const snap = await db
      .collection("requests")
      .orderBy("date", "desc")
      .limit(500)
      .get();
    const items = snap.docs.map(d => d.data());
    return res.status(200).json({ count: items.length, items });
  } catch (e) {
    // Fall back to unordered scan if some docs lack the date field
    console.warn("[admin-list-requests] Indexed query failed, falling back:", e.message);
    try {
      const snap = await db.collection("requests").limit(500).get();
      const items = snap.docs
        .map(d => d.data())
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      return res.status(200).json({ count: items.length, items, fallback: true });
    } catch (e2) {
      console.error("[admin-list-requests] Fallback failed:", e2);
      return res.status(500).json({ error: "Read failed" });
    }
  }
}

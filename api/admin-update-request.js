// Vercel Serverless Function — admin-only status update for a special request.
// Authenticates via Firebase Auth ID token (Authorization: Bearer <token> header).
// Uses firebase-admin to verify the token AND write — no Firestore rule needed.
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
    console.error("[admin-update-request] Firebase Admin init failed:", e);
  }
}
const db = admin.apps.length ? admin.firestore() : null;
const auth = admin.apps.length ? admin.auth() : null;

const ALLOWED_STATUSES = ["new", "quoted", "closed"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

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
    console.warn("[admin-update-request] Token verification failed:", e.message);
    return res.status(403).json({ error: "Invalid or expired token" });
  }

  const { id, status } = req.body || {};
  if (!id || typeof id !== "string" || !id.startsWith("REQ-")) {
    return res.status(400).json({ error: "Invalid request id" });
  }
  if (!ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  try {
    await db.collection("requests").doc(id).update({ status });
    console.log("[admin-update-request] Updated:", id, "→", status);
    return res.status(200).json({ success: true, id, status });
  } catch (e) {
    console.error("[admin-update-request] Update failed:", e);
    return res.status(500).json({ error: "Update failed" });
  }
}

// Vercel Serverless Function — saves a Special Request to Firestore via firebase-admin.
// Server-side write bypasses Firestore security rules (admin SDK is privileged), so
// customer submissions land in the requests collection without a per-collection rule
// in the Firebase console. Mirrors the architecture of api/stripe-webhook.js for orders.
//
// Required env vars (already set for the Stripe webhook):
//   FIREBASE_SERVICE_ACCOUNT — JSON string of Firebase service account key
//   EMAIL_API_TOKEN — soft auth shared with the client (matches EMAILJS_CONFIG._tok)

import admin from "firebase-admin";

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (e) {
    console.error("[save-request] Firebase Admin init failed:", e);
  }
}
const db = admin.apps.length ? admin.firestore() : null;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { _tok, request } = req.body || {};

  // Soft auth — same _tok the client uses for /api/send-email. Client bundles it,
  // so this is a drive-by-spam barrier, not a real auth boundary. The strict-format
  // validation below is the actual defence (mirrors the send-email guard pattern).
  const EXPECTED_TOKEN = process.env.EMAIL_API_TOKEN;
  if (!EXPECTED_TOKEN || _tok !== EXPECTED_TOKEN) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!request || typeof request !== "object") {
    return res.status(400).json({ error: "Missing request payload" });
  }

  // Strict format validation — blocks bots even if they extract _tok from the bundle.
  // Mirrors the validation pattern in api/send-email.js for type:"order".
  const id = (request.id || "").trim();
  const name = (request.name || "").trim();
  const email = (request.email || "").trim();
  const description = (request.description || "").trim();

  if (!id.startsWith("REQ-")) {
    console.warn("[save-request] BLOCKED — bad request id:", JSON.stringify(request).slice(0, 300));
    return res.status(400).json({ error: "Invalid request id format" });
  }
  if (!name) {
    return res.status(400).json({ error: "Missing name" });
  }
  if (!email || !/.+@.+\..+/.test(email)) {
    return res.status(400).json({ error: "Invalid email" });
  }
  if (description.length < 10) {
    return res.status(400).json({ error: "Description too short" });
  }

  if (!db) {
    console.error("[save-request] Firebase Admin not initialised — request NOT saved:", id);
    return res.status(500).json({ error: "Storage unavailable" });
  }

  try {
    // Build the document — accept the client's fields but stamp server-side date + status
    // so we don't trust client clock or status manipulation.
    const doc = {
      id,
      name,
      email,
      type: request.type || "",
      description,
      modelLink: request.modelLink || "",
      size: request.size || "",
      colours: request.colours || "",
      budget: request.budget || "",
      notes: request.notes || "",
      date: new Date().toISOString(),
      status: "new",
      _createdBy: "save-request-api",
    };

    // Never overwrite an existing request: the doc id is client-supplied behind a
    // bundled soft token, so a blind .set() let a double-submit reset admin status
    // to 'new' — or a token-holder overwrite a genuine customer request wholesale.
    // Idempotent: report success without touching the stored original.
    const ref = db.collection("requests").doc(id);
    const existing = await ref.get();
    if (existing.exists) {
      console.warn("[save-request] id already exists — not overwriting:", id);
      return res.status(200).json({ success: true, id, alreadyExists: true });
    }
    await ref.set(doc);
    console.log("[save-request] Saved:", id);
    return res.status(200).json({ success: true, id });
  } catch (e) {
    console.error("[save-request] Write failed:", e);
    return res.status(500).json({ error: "Save failed" });
  }
}

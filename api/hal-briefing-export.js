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
import { randomUUID } from "crypto";

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
//
// "orders-v1" and "requests-v1" below are LEGACY/UNUSED — always empty. Real order
// and request data is NOT here; it's read separately further down as
// data.orders_collection / data.requests_collection, straight from the top-level
// Firestore "orders" / "requests" collections (one document per order/request,
// written by api/stripe-webhook.js and api/save-request.js respectively) — a
// different shape from the single-doc "shop/<key>" blobs this array drives.
// Found the hard way 2026-09-05: querying this export and pattern-matching on the
// "-v1" naming convention looks like real customer data doesn't exist. It does —
// under orders_collection/requests_collection. Check there first.
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
  "promo-codes-v1",
  "halloween-picks-v1",
];

const WRITE_KEYS = ["assessment-v1", "promo-codes-v1"]; // halloween-picks-v1 write access closed — the admin panel's HalloweenPicksEditor writes directly via the client Firebase SDK, not through this endpoint.

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

      // TEMPORARY (2026-11-27, John: load options 1, 4 and 7): appends three hard-coded DRAFT
      // products (fixed colours) with their photos. The caller supplies no data. Append-only,
      // inside a transaction, so a failed read writes nothing. Expires 18:00 UTC; removed next commit.
      if (action === "add_vacation_drafts_20261127") {
        if (Date.now() >= Date.parse("2026-11-27T18:00:00Z")) return res.status(403).json({ error: "Expired" });
        const base = { emoji: "", badge: null, available: false, status: "draft", addedDate: "2026-11-27T16:45:00.000Z", photoSource: "makerworld", noColourUplift: true };
        const drafts = [
          { ...base, id: 348, name: "Shitter's Full Sign", price: 7.5, category: ["Christmas", "Naughty List"], colors: ["Black", "White", "Red", "Latte Brown", "Marine Blue", "Silk Candy Green", "Mandarin Orange"], maxColors: 7, grams: 198, printTime: "7.3 hrs", creator: "Waldog", sourceUrl: "https://makerworld.com/en/models/3390509-shitter-s-full-funny-holiday-rv-christmas-sign#profileId-3858787", description: "Cousin Eddie's famous Christmas morning announcement, as a sign for the wall or shelf. Keyhole fittings on the back. Design by Waldog on MakerWorld." },
          { ...base, id: 349, name: "You Serious Clark? Ornament", price: 2, category: ["Christmas", "Nice List", "Naughty List"], colors: ["White", "Silk Candy Green", "Red"], maxColors: 3, grams: 23, printTime: "1.0 hrs", creator: "jclarkusaf", sourceUrl: "https://makerworld.com/en/models/718678-christmas-vacation-you-serious-clark-ornament#profileId-709396", description: "The line everyone quotes, on a tree ornament with a hanger. Design by jclarkusaf on MakerWorld." },
          { ...base, id: 350, name: "Jelly of the Month Gift Card", price: 2.5, category: ["Christmas", "Nice List", "Naughty List"], colors: ["Sage Green", "White", "Red", "Marine Blue"], maxColors: 4, grams: 44, printTime: "1.4 hrs", creator: "JP Designs", sourceUrl: "https://makerworld.com/en/models/903820-christmas-vacation-jelly-of-the-month-club#profileId-863469", description: "A pretend gift certificate for the Jelly of the Month Club, the film's famous Christmas bonus. Not a real voucher. Design by JP Designs on MakerWorld." },
        ];
        const photos = {
          348: "https://makerworld.bblmw.com/makerworld/model/USb4e320efa79947/design/6aee7af0d5e496a0.jpg",
          349: "https://makerworld.bblmw.com/makerworld/model/USe2f6adb228c0d4/design/2024-11-09_7c38cec9feee6.jpg",
          350: "https://makerworld.bblmw.com/makerworld/model/US8ea2e4b38b64ea/design/2024-12-22_b6d68cd513da18.png",
        };
        const ref = db.collection("shop").doc("products-v2");
        const readList = (snap) => {
          const raw = snap.exists ? snap.data().value : null;
          const list = typeof raw === "string" ? JSON.parse(raw) : null;
          if (!Array.isArray(list) || list.length < 200) throw new Error("Catalogue not as expected, nothing written");
          return list;
        };
        const taken = (list) => drafts.some((d) => list.some((p) => p.id === d.id || p.name === d.name));
        // Refuse before touching Storage if already added: a re-upload would change the photo links.
        if (taken(readList(await ref.get()))) return res.status(409).json({ error: "Already added, nothing written" });
        // Fetch and check every photo before uploading any.
        const buffers = {};
        for (const d of drafts) {
          const r = await fetch(photos[d.id] + "?x-oss-process=image/auto-orient,1/resize,w_1000/format,jpeg");
          const buffer = Buffer.from(await r.arrayBuffer());
          if (!r.ok || buffer.length < 1000 || buffer.length > 1500000 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
            return res.status(502).json({ error: `Photo for ${d.id} not usable: ${r.status}, ${buffer.length} bytes. Nothing written.` });
          }
          buffers[d.id] = buffer;
        }
        const bucket = admin.storage().bucket("elijahs-prints.firebasestorage.app");
        for (const d of drafts) {
          const path = `product-images/xmas-2026-${d.id}.jpg`;
          const token = randomUUID();
          await bucket.file(path).save(buffers[d.id], { metadata: { contentType: "image/jpeg", metadata: { firebaseStorageDownloadTokens: token } } });
          d.img = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
        }
        const out = await db.runTransaction(async (t) => {
          const list = readList(await t.get(ref));
          if (taken(list)) throw new Error("Already added, nothing written");
          const value = JSON.stringify([...list, ...drafts]);
          t.set(ref, { value, updatedAt: new Date().toISOString() });
          return { before: list.length, after: list.length + drafts.length, bytes: value.length };
        });
        return res.status(200).json({ ok: true, ...out });
      }
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

      // Server-side shrink guard — the v158 saveProducts protection, applied on the
      // admin-SDK path (which bypasses Firestore rules AND is pointed at products-v2
      // during the temporary-WRITE_KEYS restore runbook). A full-doc replace must not
      // silently halve a substantial store. Count = array length (products-v2) or key
      // count (assessment-v1). `force:true` in the body is the explicit override.
      const entryCount = (str) => {
        try {
          const v = JSON.parse(str);
          if (Array.isArray(v)) return v.length;
          if (v && typeof v === "object") return Object.keys(v).length;
          return null;
        } catch { return null; }
      };
      if (req.body.force !== true) {
        let prevCount = null;
        try {
          const prevSnap = await db.collection("shop").doc(key).get();
          if (prevSnap.exists) prevCount = entryCount(prevSnap.data().value);
        } catch (e) {
          // Can't verify prior state → refuse rather than risk an unguarded overwrite.
          return res.status(503).json({ error: `Shrink guard: could not read current '${key}' to verify the write is safe (${e.message}). Retry, or send force:true if intentional.` });
        }
        const newCount = entryCount(stored);
        // Fail CLOSED, not open: if the store being replaced is substantial and the
        // incoming value can't even be parsed into an array/object (newCount === null
        // — e.g. a bare string, malformed JSON), that is never a legitimate write to
        // products-v2/assessment-v1 and must be refused, not silently allowed through
        // because "we couldn't count it". Verified failure 2026-09-16 session 31: a
        // liveness-probe POST sent the raw string "__probe__" as `value`; entryCount()
        // correctly returned null for it, but the old `newCount != null` guard clause
        // then skipped the whole check and let the write proceed, overwriting all 175
        // live products with that string. Caught and restored same session — see
        // Brain/state.md 2026-09-16 — but the guard itself was the gap, not just the
        // bad test that found it.
        if (prevCount != null && prevCount >= 40 && (newCount == null || newCount < prevCount / 2)) {
          return res.status(409).json({
            error: `Shrink guard blocked write to '${key}': ${prevCount} entries → ${newCount == null ? "unparseable (not a valid array/object)" : newCount}. This is the catalogue-wipe failure shape. Send force:true only if the shrink is intended.`,
            prevCount, newCount,
          });
        }
      }

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

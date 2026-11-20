// /api/send-email.js — Vercel serverless function. The ONE door every site email goes
// through (webhook order alert, client fallback order, stock order, special request,
// and the customer "made" / "shipped" emails).
//
// Transport: Resend only, from the shop's own domain, with templates in lib/email.js.
// (Live since 2026-10-20. The old EmailJS fallback was deleted 2026-11-20 after a month
// clean, including a real customer order; rollback now means reverting that commit.)
//
// Recipients are decided HERE, never by the caller: the client token below is bundled
// into the public JS, so anyone can call this endpoint. Order/request/stock alerts go
// only to orderNotifyRecipients(); "made"/"shipped" go only to the email on the STORED
// order, rendered from the stored order. Before this, a caller could send those two
// templates to any address with any text — on our own domain that would burn
// etprintworld.com's reputation.
//
// Trusted vs untrusted callers: the Stripe webhook adds `Authorization: Bearer
// HAL_EXPORT_TOKEN` (server-only secret) and is trusted. Untrusted (public-token)
// callers sending an EP- order alert must name an order that really exists, so a
// stranger can't make a convincing fake "New Order" email from orders@etprintworld.com
// (an alert for an order that isn't in the order book is sent flagged UNVERIFIED).

import { orderNotifyRecipients, renderEmail, sendViaResend } from "../lib/email.js";

// firebase-admin is loaded lazily — only the paths that need the order store pay its
// cold-start cost. The webhook's order alert (trusted) never touches it, keeping that
// hop well inside the webhook's 8 s budget.
let _db;
async function getDb() {
  if (_db !== undefined) return _db;
  try {
    const { default: admin } = await import("firebase-admin");
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    }
    _db = admin.firestore();
  } catch (e) {
    console.error("[send-email] Firebase Admin init failed:", e);
    _db = null;
  }
  return _db;
}

const CUSTOMER_TYPES = new Set(["made", "shipped"]);
const KNOWN_TYPES = new Set(["order", "request", "made", "shipped"]);
// A customer email only goes once the order is actually in that state.
const REQUIRED_STATUS = { made: "produced", shipped: "despatched" };
// Test sends may only ever go to John — even a leaked HAL token can't make an open relay.
const TEST_ALLOWED = new Set(["johnianthompson78@outlook.com"]);
// Same customer email for the same order can't be re-sent within this window, and never
// more than MAX_SENDS times in total. Long enough to stop hammering; short enough that
// John's "un-tick and re-tick to resend" still works a couple of minutes later.
const CUSTOMER_COOLDOWN_MS = 2 * 60 * 1000;
const MAX_SENDS_PER_TYPE = 3;
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { type, templateParams, _tok, testTo } = req.body || {};

  const EXPECTED_TOKEN = process.env.EMAIL_API_TOKEN;
  if (!EXPECTED_TOKEN || _tok !== EXPECTED_TOKEN) return res.status(403).json({ error: "Forbidden" });
  if (!type || !templateParams) return res.status(400).json({ error: "Missing type or templateParams" });
  if (!KNOWN_TYPES.has(type)) return res.status(400).json({ error: "Invalid email type: " + type });

  const halToken = process.env.HAL_EXPORT_TOKEN;
  const trusted = !!halToken && (req.headers?.authorization || "") === `Bearer ${halToken}`;
  const isTest = testTo != null;
  if (isTest) {
    if (!trusted) return res.status(403).json({ error: "Forbidden (test)" });
    if (!TEST_ALLOWED.has(String(testTo).trim().toLowerCase())) return res.status(400).json({ error: "testTo not allowed" });
  }

  // Order alerts: strict format checks (blocks blank/bot payloads that pass the token).
  if (type === "order") {
    const p = templateParams;
    const order_id = (p.order_id || "").trim();
    if (!(order_id.startsWith("EP-") || order_id.startsWith("SO-"))) {
      console.warn("[send-email] BLOCKED order email — bad order_id:", JSON.stringify(p).slice(0, 300));
      return res.status(400).json({ error: "Invalid order_id format" });
    }
    if ((p.items_list || "").trim().length < 5) {
      console.warn("[send-email] BLOCKED order email — empty items_list:", JSON.stringify(p).slice(0, 300));
      return res.status(400).json({ error: "Order email items_list too short" });
    }
    if (!(p.customer_name || "").trim() || !(p.customer_email || "").trim() || !(p.total || "").trim()) {
      console.warn("[send-email] BLOCKED order email — missing customer/total:", JSON.stringify(p).slice(0, 300));
      return res.status(400).json({ error: "Order email missing customer or total" });
    }
    // Untrusted EP- alert must name a real order (client fallback runs after addOrder,
    // so a genuine one always exists). SO- stock orders aren't in `orders`; their
    // recipients are fixed to John + Elijah, so the worst case is noise to them.
    if (!trusted && order_id.startsWith("EP-")) {
      const db = await getDb();
      try {
        if (!db) throw new Error("order store unavailable");
        const snap = await db.collection("orders").doc(order_id).get();
        // Not blocked: in the rare case the webhook AND the client save both failed, this
        // alert is the only sign a real payment happened. So it still goes — but
        // flagged, which also makes a forged alert harmless.
        if (!snap.exists) {
          console.warn("[send-email] UNVERIFIED order alert — not in order book:", order_id);
          templateParams.unverified = true;
        }
      } catch (e) {
        // Can't verify → still alert (losing a real order alert is the worse failure),
        // flagged so John checks Stripe first.
        console.error("[send-email] order existence check failed:", order_id, e);
        templateParams.unverified = true;
      }
    }
  }

  // Customer emails: claim a send slot atomically from the stored order, which also
  // supplies the recipient and content. The claim happens BEFORE sending, inside a
  // transaction, so a burst of parallel calls can't all slip past the cooldown.
  let storedOrder = null;
  let orderRef = null;
  let previousStamp = null;
  if (CUSTOMER_TYPES.has(type)) {
    const orderId = String(templateParams.order_id || "").trim();
    if (!/^EP-[A-Z0-9-]{4,40}$/i.test(orderId)) return res.status(409).json({ error: "Not sent" });
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "Order store unavailable" });
    orderRef = db.collection("orders").doc(orderId);
    let refusal = null;
    try {
      await db.runTransaction(async (tx) => {
        refusal = null;
        const snap = await tx.get(orderRef);
        if (!snap.exists) { refusal = { code: 409, why: "no such order" }; return; }
        const o = { id: orderId, ...snap.data() };
        if (!EMAIL_RE.test(String(o.customer?.email || "").trim())) { refusal = { code: 409, why: "no valid customer email" }; return; }
        if (!o.status?.[REQUIRED_STATUS[type]]) { refusal = { code: 409, why: `status.${REQUIRED_STATUS[type]} not set` }; return; }
        if (!isTest) {
          const last = o._customerEmails?.[type];
          if (last && Date.now() - Date.parse(last) < CUSTOMER_COOLDOWN_MS) { refusal = { code: 429, why: "cooldown" }; return; }
          const count = Number(o._customerEmailCount?.[type] || 0);
          if (count >= MAX_SENDS_PER_TYPE) { refusal = { code: 409, why: "send cap reached" }; return; }
          previousStamp = last || null;
          tx.update(orderRef, {
            [`_customerEmails.${type}`]: new Date().toISOString(),
            [`_customerEmailCount.${type}`]: count + 1,
          });
        }
        storedOrder = o;
      });
    } catch (e) {
      // A failed read means we cannot know who to send to — refuse, never guess.
      console.error("[send-email] order claim failed:", orderId, e);
      return res.status(503).json({ error: "Order read failed" });
    }
    if (refusal) {
      console.warn(`[send-email] ${type} not sent for ${orderId}: ${refusal.why}`);
      // Same body for every refusal (doesn't reveal which order ids exist), except the
      // cooldown, which the admin screen reads as "already sent".
      return res.status(refusal.code).json(refusal.code === 429 ? { error: "Already sent recently", alreadySent: true } : { error: "Not sent" });
    }
  }

  // Recipients — server-decided only (see header).
  let recipients;
  if (isTest) recipients = [String(testTo).trim().toLowerCase()];
  else if (CUSTOMER_TYPES.has(type)) recipients = [String(storedOrder.customer.email).trim().toLowerCase()];
  else recipients = orderNotifyRecipients();
  if (recipients.length === 0) return res.status(400).json({ error: "No recipient" });

  const transport = "resend";
  const rendered = renderEmail(type, CUSTOMER_TYPES.has(type) ? storedOrder : templateParams);
  const subject = isTest ? `[TEST] ${rendered.subject}` : rendered.subject;
  // In parallel: each send is capped at 4 s, so the whole hop stays inside the
  // webhook's 8 s budget even when Resend is slow.
  const results = await Promise.all(
    recipients.map(async (to) => {
      const r = await sendViaResend({ from: rendered.from, to, subject, html: rendered.html, text: rendered.text });
      if (r.ok) console.log("[send-email] resend", type, "→", to, r.id);
      else console.error("[send-email] resend FAILED", type, "→", to, r.resendStatus || "", r.detail);
      return { ...r, via: "resend" };
    })
  );

  const failed = results.filter((r) => !r.ok);

  if (failed.length === results.length) {
    // Nothing went out: give the slot back so John's retry isn't blocked by a send that
    // never happened (single-field update, never a whole-document write).
    if (CUSTOMER_TYPES.has(type) && !isTest && orderRef) {
      try {
        const { default: admin } = await import("firebase-admin");
        await orderRef.update({
          [`_customerEmails.${type}`]: previousStamp || admin.firestore.FieldValue.delete(),
          [`_customerEmailCount.${type}`]: admin.firestore.FieldValue.increment(-1),
        });
      } catch (e) {
        console.error("[send-email] could not release claim on", storedOrder?.id, e);
      }
    }
    return res.status(500).json({
      error: `${transport} send failed`,
      resendStatus: failed[0].resendStatus,
      detail: failed[0].detail,
      transport,
      recipients: results,
    });
  }
  // A partial failure still returns 200 (the caller's primary job succeeded) but
  // `recipients` carries the per-address truth for the webhook to stamp and alarm on.
  return res.status(200).json({ success: true, partial: failed.length > 0, transport, recipients: results });
}

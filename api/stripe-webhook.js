// Vercel Serverless Function — Stripe webhook handler
// Creates orders in Firebase server-side when payment succeeds
// This file goes in: elijahs-prints/api/stripe-webhook.js
//
// Required env vars in Vercel:
//   STRIPE_SECRET_KEY — already set
//   STRIPE_WEBHOOK_SECRET — from Stripe Dashboard > Webhooks > Signing secret
//   FIREBASE_SERVICE_ACCOUNT — JSON string of Firebase service account key

import Stripe from "stripe";
import admin from "firebase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Initialize Firebase Admin (once — reused across invocations)
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (e) {
    console.error("Firebase Admin init failed:", e);
  }
}
const db = admin.apps.length ? admin.firestore() : null;

// Disable Vercel's body parser — Stripe needs the raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

// Read raw body from request stream
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Reconstruct order data from chunked metadata
function getOrderFromMetadata(metadata) {
  const numChunks = parseInt(metadata.order_chunks || "0");
  if (numChunks === 0) return null;
  let orderJson = "";
  for (let i = 0; i < numChunks; i++) {
    orderJson += metadata[`order_data_${i}`] || "";
  }
  try {
    return JSON.parse(orderJson);
  } catch (e) {
    console.error("Failed to parse order metadata:", e);
    return null;
  }
}

// Send order email notification via existing EmailJS endpoint
async function sendEmailNotification(order) {
  try {
    const itemsList = order.items
      .map((i) =>
        i.isTip
          ? `🧡 Tip: £${i.price.toFixed(2)}`
          : `${i.qty}× ${i.name}${i.personalizedName ? ` "${i.personalizedName}"` : ""} (${(i.selectedColors || []).join(" + ")})${i.hasKeyring ? " + Keyring" : ""}`
      )
      .join("\n");

    const isPickup = order.shipping?.id?.startsWith("collection") || false;
    const address = isPickup && order.shipping.id !== "collection-local"
      ? `${order.shipping.icon || "🎒"} ${order.shipping.name || "School collection"}`
      : [
          order.customer.address1,
          order.customer.address2,
          order.customer.city,
          order.customer.county,
          order.customer.postcode,
        ]
          .filter(Boolean)
          .join(", ");

    // Prefer the stable public production domain over VERCEL_URL. VERCEL_URL is the
    // PER-DEPLOYMENT hostname, which Deployment Protection can 401 — and a 401 here
    // used to be invisible because nothing checked the response (fixed below).
    // www is verified reachable; the apex only 307-redirects to it, so use www direct.
    const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://www.etprintworld.com";

    // Hard timeout so an unresponsive email hop can never hold the webhook open past
    // Stripe's own timeout — we must always get our 200 back to Stripe.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const resp = await fetch(`${origin}/api/send-email`, {
      signal: ac.signal,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "order",
        _tok: "ep_email_2026_s3cure",
        templateParams: {
          to_email: "johnianthompson78@outlook.com, etprintworld@outlook.com",
          order_id: order.id,
          customer_name: order.customer.name,
          customer_email: order.customer.email,
          customer_phone: order.customer.phone || "Not provided",
          shipping_method: order.shipping.name,
          items_list: itemsList,
          subtotal: `£${order.subtotal.toFixed(2)}`,
          shipping_cost:
            order.shippingCost === 0
              ? "FREE"
              : `£${order.shippingCost.toFixed(2)}`,
          total: `£${order.total.toFixed(2)}`,
          address: address,
        },
      }),
    });
    clearTimeout(timer);

    // A non-2xx here used to be logged as SUCCESS — fetch does not throw on 4xx/5xx.
    // That is how a 403/400/500 from /api/send-email (or EmailJS behind it) became a
    // silently missing order notification. Read the status, say what actually happened.
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error(
        "📧 Webhook: order email REJECTED for", order.id,
        "— HTTP", resp.status, body.slice(0, 300)
      );
      return { ok: false, error: `HTTP ${resp.status} ${body.slice(0, 160)}`.trim() };
    }
    console.log("📧 Webhook: order email sent for", order.id);
    return { ok: true };
  } catch (e) {
    // Email failure must not block order creation — but it must not be invisible either.
    console.error("📧 Webhook: email send failed for", order.id, e);
    return { ok: false, error: String((e && e.message) || e).slice(0, 160) };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let event;

  try {
    const rawBody = await getRawBody(req);
    const sig = req.headers["stripe-signature"];

    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      console.error("STRIPE_WEBHOOK_SECRET not configured");
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Handle checkout.session.completed
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    try {
      // Reconstruct order data from session metadata
      const orderData = getOrderFromMetadata(session.metadata);

      if (!orderData) {
        console.error("Webhook: no order data in session metadata", session.id);
        return res.status(200).json({ received: true, warning: "No order data in metadata" });
      }

      // Build the order document
      const isTipOnly =
        orderData.items &&
        orderData.items.length > 0 &&
        orderData.items.every((i) => i.isTip);

      // Reconcile against what Stripe ACTUALLY captured — a defence-in-depth backstop
      // to the server-side pricing in create-checkout-session.js. The signature check
      // proves the event is genuine; this proves the amount is right. A mismatch (or a
      // session that wasn't actually paid) is flagged needsReview and NOT auto-fulfilled.
      const expectedPence = parseInt(session.metadata?.expected_total_pence || "0", 10);
      const amountPaid = typeof session.amount_total === "number" ? session.amount_total : null;
      const paidOk = session.payment_status === "paid";
      const amountOk = expectedPence > 0 && amountPaid === expectedPence;
      const needsReview = !paidOk || !amountOk;
      if (needsReview) {
        console.error(
          "⚠️ Webhook: payment reconciliation FAILED for", session.id,
          "— payment_status:", session.payment_status,
          "amount_total(pence):", amountPaid, "expected(pence):", expectedPence,
          "→ order flagged needsReview, NOT auto-fulfilled"
        );
      }

      const order = {
        // Stable fallback id: derive from the Stripe session (constant across
        // redeliveries) rather than Date.now(), which minted a NEW duplicate order
        // on every redelivery/resend.
        id: orderData.orderId || "EP-" + session.id.slice(-12).toUpperCase(),
        date: new Date().toISOString(),
        customer: orderData.customer,
        shipping: orderData.shipping,
        items: orderData.items,
        subtotal: orderData.subtotal,
        promoCode: orderData.promoCode || null,
        discountAmount: orderData.discountAmount || 0,
        shippingCost: orderData.shippingCost,
        stripeFee: orderData.stripeFee,
        // Authoritative total = what Stripe captured, not the client-claimed value.
        total: amountPaid != null ? amountPaid / 100 : orderData.total,
        status: needsReview
          ? { paid: false, produced: false, labelPrinted: false, despatched: false, needsReview: true }
          : isTipOnly
            ? { paid: true, produced: true, labelPrinted: true, despatched: true }
            : { paid: true, produced: false, labelPrinted: false, despatched: false },
        _createdBy: "stripe-webhook",
        _stripeSessionId: session.id,
      };

      // Write to Firebase inside a transaction so a Stripe REDELIVERY (secret
      // rotation → ~3-day retries, or a dashboard "Resend") can never reset a
      // progressed order's fulfilment flags or restamp its date. setDoc was only
      // idempotent for identical payloads — a redelivery after admin ticked
      // produced/labelPrinted/despatched used to full-replace it back to day-one.

      // Whether this invocation should actually send the notification, and where to
      // stamp the outcome. A Stripe REDELIVERY of an already-notified order must not
      // email John a second time; an order whose email never went out still should.
      let orderRef = null;
      let shouldEmail = false;

      if (db) {
        const ref = db.collection("orders").doc(order.id);
        orderRef = ref;
        await db.runTransaction(async (tx) => {
          // Reset first: a Firestore transaction callback can be RETRIED, and a value
          // set on an earlier attempt would otherwise leak into the final decision.
          shouldEmail = false;
          const snap = await tx.get(ref);
          if (!snap.exists) { tx.set(ref, order); shouldEmail = true; return; }
          const cur = snap.data() || {};
          const progressed = cur.status?.produced || cur.status?.labelPrinted || cur.status?.despatched;
          if (progressed) return; // already in fulfilment — leave entirely as-is
          // Exists, not progressed: notify only if the notification never got out.
          shouldEmail = cur._emailSent !== true;
          // Keep the original date/id, reconcile the authoritative total +
          // paid/needsReview status only, never overwrite wholesale.
          tx.set(ref, { total: order.total, status: order.status, _reconciledBy: "stripe-webhook" }, { merge: true });
        });
        console.log("✅ Webhook: order saved/reconciled in Firebase:", order.id);

        // Mark a per-customer promo code (promo-codes-v1) used — ONLY here, on a
        // genuinely paid session, never at checkout-session creation (a created
        // session doesn't mean the customer actually paid). paidOk alone gates
        // this (not amountOk) — a real payment happened using this code
        // regardless of any separate amount-reconciliation concern, which is an
        // order-fulfilment question, not a "was the code redeemed" question.
        // Transactional read-check-write so a Stripe redelivery of the same event
        // can never re-mark an already-used code or race a second checkout.
        const personalCode = session.metadata?.personal_promo_code;
        if (paidOk && personalCode) {
          const promoRef = db.collection("shop").doc("promo-codes-v1");
          try {
            await db.runTransaction(async (tx) => {
              const snap = await tx.get(promoRef);
              if (!snap.exists) return;
              let data = snap.data().value;
              if (typeof data === "string") {
                try { data = JSON.parse(data); } catch { return; }
              }
              if (!data || typeof data !== "object" || !data[personalCode] || data[personalCode].used) {
                return; // unknown, or already marked used — no-op either way
              }
              data[personalCode] = {
                ...data[personalCode],
                used: true,
                usedAt: new Date().toISOString(),
                orderId: order.id,
              };
              tx.set(promoRef, { value: JSON.stringify(data), updatedAt: new Date().toISOString() });
            });
            console.log("🎟️ Webhook: promo code marked used:", personalCode, "→", order.id);
          } catch (e) {
            // Never fail the whole webhook over this — the order itself is already
            // saved correctly above. Worst case a code could be reused once more;
            // logged loudly so it's actually seen, not silently swallowed.
            console.error("⚠️ Webhook: failed to mark promo code used:", personalCode, e);
          }
        }
      } else {
        console.error("Webhook: Firebase not initialised — order NOT saved:", order.id);
        // Still return 200 so Stripe doesn't retry endlessly
        return res.status(200).json({ received: true, error: "Firebase not available" });
      }

      // Send the notification BEFORE responding — do NOT go back to fire-and-forget.
      // On Vercel/Lambda the execution context is frozen the instant the response is
      // sent, so an un-awaited fetch is killed mid-flight. That is exactly how an order
      // could be saved perfectly and John never hear about it (EP-MU9G5YS0, 2026-09-20).
      // sendEmailNotification is timeout-capped (8s) and never throws, so Stripe still
      // always gets its 200 well inside the webhook timeout.
      if (shouldEmail) {
        const emailResult = await sendEmailNotification(order);
        // Close the loop: record the outcome ON the order document, so a failed
        // notification is visible in the DATA (admin order book / Friday briefing),
        // not only in a Vercel log nobody reads. This is what makes the next failure
        // findable instead of silent.
        if (orderRef) {
          try {
            await orderRef.set(
              emailResult.ok
                ? { _emailSent: true, _emailSentAt: new Date().toISOString() }
                : {
                    _emailSent: false,
                    _emailError: emailResult.error,
                    _emailFailedAt: new Date().toISOString(),
                  },
              { merge: true }
            );
          } catch (e) {
            console.error("⚠️ Webhook: could not stamp email status on", order.id, e);
          }
        }
      } else {
        console.log(
          "📧 Webhook: notification skipped for", order.id,
          "— already sent, or order already in fulfilment"
        );
      }
    } catch (e) {
      console.error("Webhook: order creation failed:", e);
      // Return 200 anyway — Stripe retries on non-2xx which could cause duplicate attempts
      // The client-side backup will catch this case
      return res.status(200).json({ received: true, error: e.message });
    }
  }

  return res.status(200).json({ received: true });
}

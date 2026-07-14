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
          : `${i.qty}× ${i.name} (${(i.selectedColors || []).join(" + ")})`
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

    const origin = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://etprintworld.com";

    await fetch(`${origin}/api/send-email`, {
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
    console.log("📧 Webhook: order email sent for", order.id);
  } catch (e) {
    // Email failure should not block order creation
    console.error("📧 Webhook: email send failed:", e);
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
      if (db) {
        const ref = db.collection("orders").doc(order.id);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) { tx.set(ref, order); return; }
          const cur = snap.data() || {};
          const progressed = cur.status?.produced || cur.status?.labelPrinted || cur.status?.despatched;
          if (progressed) return; // already in fulfilment — leave entirely as-is
          // Exists but not progressed: keep the original date/id, reconcile the
          // authoritative total + paid/needsReview status only, never overwrite wholesale.
          tx.set(ref, { total: order.total, status: order.status, _reconciledBy: "stripe-webhook" }, { merge: true });
        });
        console.log("✅ Webhook: order saved/reconciled in Firebase:", order.id);
      } else {
        console.error("Webhook: Firebase not initialised — order NOT saved:", order.id);
        // Still return 200 so Stripe doesn't retry endlessly
        return res.status(200).json({ received: true, error: "Firebase not available" });
      }

      // Send email notification (fire-and-forget — don't block webhook response)
      sendEmailNotification(order).catch((e) =>
        console.error("Webhook email failed:", e)
      );
    } catch (e) {
      console.error("Webhook: order creation failed:", e);
      // Return 200 anyway — Stripe retries on non-2xx which could cause duplicate attempts
      // The client-side backup will catch this case
      return res.status(200).json({ received: true, error: e.message });
    }
  }

  return res.status(200).json({ received: true });
}

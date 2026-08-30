// Vercel Serverless Function — creates a Stripe Checkout Session.
//
// SECURITY (rewritten 2026-07-11): every monetary value is recomputed SERVER-SIDE
// from the trusted Firestore catalogue. The previous version charged whatever
// price / shipping / fee / discount the browser POSTed, so a crafted request
// could buy real goods for pennies or apply an arbitrary discount. Client-supplied
// prices, shipping cost, card fee and discount amount are now IGNORED — only the
// item id + quantity (+ tip amount + customer details + chosen shipping id + promo
// CODE) are taken from the client; the amounts are derived here from server data.
//
// Required env vars in Vercel:
//   STRIPE_SECRET_KEY
//   FIREBASE_SERVICE_ACCOUNT — JSON string of the Firebase service-account key
import Stripe from "stripe";
import admin from "firebase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    });
  } catch (e) {
    console.error("[create-checkout-session] Firebase Admin init failed:", e);
  }
}
const db = admin.apps.length ? admin.firestore() : null;

// --- Trusted money config — mirrors src/App.jsx (single source of truth is the
//     client for DISPLAY; this server copy is authoritative for CHARGING). ---
const SHIPPING_OPTIONS = {
  "collection-school": { name: "School drop-off", price: 0, pickup: true },
  "collection-local": { name: "Free local delivery", price: 0, pickup: true },
  standard: { name: "Royal Mail Tracked 48", price: 3.49, pickup: false },
};
const FREE_SHIPPING_THRESHOLD = 30;
const PROMO_CODES = { GWERN10: { rate: 0.1 } };
const TIP_MAX = 1000;
const QTY_MAX = 1000;
const getStripeFee = (amount) => Math.ceil((0.2 + amount * 0.015) * 100) / 100;
const round2 = (n) => Math.round(n * 100) / 100;

// --- Filament colour-tier price uplift — mirrors src/App.jsx getFilamentTier /
// highestTier / applyTierUplift / getTierPrice. Added 2026-08-30, found while
// reviewing FootballLab's trophies (3 of their 4 finish options are premium Silk+
// filaments): this endpoint recomputed price from prod.price (+ keyring) only and
// never knew a "premium"/"glow" filament selection should uplift the price by
// 30%/50% — the SAME class of gap as the quantityTiers/keyringPrice fixes above,
// just for a pricing feature that predates both of them. Every order where the
// customer picked a premium or glow colour was silently charged the base price.
// Interaction with bulk quantityTiers is a genuine judgement call with no prior
// precedent (no tiered product has ever also offered a premium colour before the
// FootballLab trophies) — this applies the uplift to whichever unit rate is in
// play (base price or the matched tier's rate), consistent with how every other
// product on the site already treats "premium colour always adds the uplift".
// Flagged to John: confirm this is the intended behaviour for bulk trophy orders.
function getFilamentTier(f) {
  if (!f) return "standard";
  if (f.tier) return f.tier;
  if (f.premium) return "premium";
  return "standard";
}
const COLOUR_TIER_RANK = { standard: 0, premium: 1, glow: 2 };
function highestColourTier(selectedColors, filaments) {
  return (selectedColors || []).reduce((acc, c) => {
    const t = getFilamentTier(filaments[c]);
    return COLOUR_TIER_RANK[t] > COLOUR_TIER_RANK[acc] ? t : acc;
  }, "standard");
}
function applyColourTierUplift(basePrice, tier) {
  if (tier === "premium") return basePrice * 1.30;
  if (tier === "glow") return basePrice * 1.5;
  return basePrice;
}
function getColourTierPrice(basePrice, selectedColors, filaments) {
  const tier = highestColourTier(selectedColors, filaments);
  if (tier === "standard") return basePrice;
  return Math.ceil(applyColourTierUplift(basePrice, tier) * 20) / 20; // round UP to nearest 5p, matches client
}

async function loadTrustedProducts() {
  if (!db) return null;
  const snap = await db.collection("shop").doc("products-v2").get();
  if (!snap.exists) return null;
  let parsed = snap.data().value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  return Array.isArray(parsed) ? parsed : null;
}

async function loadTrustedFilaments() {
  if (!db) return {};
  const snap = await db.collection("shop").doc("filaments-v1").get();
  if (!snap.exists) return {};
  let parsed = snap.data().value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return {}; }
  }
  return parsed && typeof parsed === "object" ? parsed : {};
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { items, shipping, customerEmail, customerName, promoCode, orderData } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No items in cart" });
    }

    const [products, filaments] = await Promise.all([loadTrustedProducts(), loadTrustedFilaments()]);
    if (!products) {
      return res.status(503).json({ error: "Catalogue unavailable — please try again in a moment" });
    }
    const byId = new Map(products.map((p) => [String(p.id), p]));

    // --- Recompute every line item from trusted prices ---
    const lineItems = [];
    const trustedItems = [];
    let subtotal = 0; // includes tips
    let productSubtotal = 0; // excludes tips (promo + free-shipping basis)

    for (const it of items) {
      const qty = Math.floor(Number(it.qty) || 0);
      if (qty < 1 || qty > QTY_MAX) {
        return res.status(400).json({ error: "Invalid quantity" });
      }

      if (it.isTip) {
        // A tip is a donation TO the shop — the customer legitimately chooses the
        // amount, so the client value is allowed (only sanity-bounded).
        const tip = round2(Number(it.price) || 0);
        if (!(tip > 0) || tip > TIP_MAX) {
          return res.status(400).json({ error: "Invalid tip amount" });
        }
        subtotal += tip * qty;
        lineItems.push({
          price_data: { currency: "gbp", product_data: { name: it.name || "Tip" }, unit_amount: Math.round(tip * 100) },
          quantity: qty,
        });
        trustedItems.push({ name: it.name || "Tip", price: tip, qty, isTip: true });
        continue;
      }

      const prod = byId.get(String(it.id));
      if (!prod) {
        return res.status(400).json({ error: `Product not available: ${String(it.name || it.id).slice(0, 60)}` });
      }
      if (prod.available === false) {
        return res.status(400).json({ error: `Product unavailable: ${String(prod.name).slice(0, 60)}` });
      }

      // Bulk quantity-tier pricing (found 2026-08-27 while fixing the client cart bug —
      // this endpoint never knew quantityTiers existed, so ANY bulk order was silently
      // recomputed at the full base price x qty, e.g. a 50-unit £50 order would have been
      // charged £125). If this exact qty matches a defined tier, price the WHOLE line as
      // that tier's total, computed before rounding: Stripe's unit_amount is whole pence,
      // and rounding a fractional-penny tier rate first (e.g. £0.625 -> £0.63) overcharges
      // once multiplied back up (63p x 200 = £126, not £125). Non-tier lines are untouched.
      const tier = Array.isArray(prod.quantityTiers)
        ? prod.quantityTiers.find((t) => Number(t.qty) === qty)
        : null;

      // Keyring add-on (found 2026-08-29 while adding the toggle — same class of gap as
      // the quantityTiers bug above: this endpoint must know about EVERY pricing feature,
      // not just base price, or it silently falls back to charging as if the add-on
      // wasn't requested). The client sends only a boolean WANT (it.hasKeyring); the PRICE
      // is always trusted from the catalogue's own keyringPrice, never from the client.
      // Folded into the per-unit rate BEFORE rounding (same fractional-penny-safe pattern
      // as the tier math below) so it's a flat, never-discounted per-unit cost — it must
      // scale 1:1 with qty even at a bulk-price break (John: "the 7p is 100% variable").
      const keyringWanted = !!it.hasKeyring && Number(prod.keyringPrice) > 0;
      const keyringUnitPrice = keyringWanted ? Number(prod.keyringPrice) : 0;

      // Colour-tier uplift applies to whichever unit rate is in play — the base price,
      // or the matched bulk tier's rate — BEFORE the keyring add-on (which is always a
      // flat, un-uplifted pass-through cost regardless of colour).
      const baseUnitRate = tier ? Number(tier.pricePerUnit) : Number(prod.price);
      const unitRate = getColourTierPrice(baseUnitRate, it.selectedColors, filaments);

      let price, lineAmount, stripeQty;
      if (tier) {
        lineAmount = round2(qty * (unitRate + keyringUnitPrice));
        price = round2(lineAmount / qty); // display/record only — the trusted charge is lineAmount
        stripeQty = 1; // one Stripe "unit" = the whole bundle, priced at its exact total
      } else {
        price = round2(unitRate + keyringUnitPrice);
        lineAmount = round2(price * qty);
        stripeQty = qty;
      }
      if (!(lineAmount >= 0)) {
        return res.status(400).json({ error: `Product has no valid price: ${String(prod.name).slice(0, 60)}` });
      }
      subtotal += lineAmount;
      productSubtotal += lineAmount;
      lineItems.push({
        price_data: {
          currency: "gbp",
          product_data: {
            name: (tier ? `${prod.name} — ${tier.label || qty + " pack"}` : prod.name) + (keyringWanted ? " + Keyring" : ""),
            description: it.selectedColors ? `Colour: ${(it.selectedColors || []).join(" + ")}` : undefined,
          },
          unit_amount: Math.round((tier ? lineAmount : price) * 100),
        },
        quantity: stripeQty,
      });
      trustedItems.push({ id: prod.id, name: prod.name, price, qty, selectedColors: it.selectedColors || [], ...(keyringWanted ? { hasKeyring: true } : {}) });
    }
    subtotal = round2(subtotal);
    productSubtotal = round2(productSubtotal);

    // --- Promo — validate the CODE against the server registry; derive the amount ---
    let discountAmount = 0;
    let appliedPromoCode = null;
    if (promoCode) {
      const promo = PROMO_CODES[String(promoCode).trim().toUpperCase()];
      if (promo) {
        appliedPromoCode = String(promoCode).trim().toUpperCase();
        discountAmount = Math.min(round2(productSubtotal * promo.rate), productSubtotal);
      }
      // Unknown code → silently no discount (client already validated; never trust it).
    }

    // --- Shipping — validate id; compute cost server-side ---
    const shipOpt = SHIPPING_OPTIONS[shipping?.id];
    if (!shipOpt) {
      return res.status(400).json({ error: "Invalid shipping option" });
    }
    const qualifiesFree = productSubtotal >= FREE_SHIPPING_THRESHOLD;
    const shippingCost = shipOpt.pickup ? 0 : qualifiesFree ? 0 : shipOpt.price;
    if (shippingCost > 0) {
      lineItems.push({
        price_data: { currency: "gbp", product_data: { name: `Shipping: ${shipOpt.name}` }, unit_amount: Math.round(shippingCost * 100) },
        quantity: 1,
      });
    }

    // --- Card fee — server-side (same formula as the client display) ---
    const subtotalAfterDiscount = round2(subtotal - discountAmount);
    const stripeFee = getStripeFee(subtotalAfterDiscount + shippingCost);
    if (stripeFee > 0) {
      lineItems.push({
        price_data: { currency: "gbp", product_data: { name: "Card processing fee" }, unit_amount: Math.round(stripeFee * 100) },
        quantity: 1,
      });
    }

    const total = round2(subtotalAfterDiscount + shippingCost + stripeFee);
    const expectedTotalPence = Math.round(total * 100);

    // --- Discount coupon (Stripe applies it natively) using the SERVER amount ---
    let discounts;
    if (appliedPromoCode && discountAmount > 0) {
      try {
        const coupon = await stripe.coupons.create({
          amount_off: Math.round(discountAmount * 100),
          currency: "gbp",
          duration: "once",
          name: `${appliedPromoCode} (-£${discountAmount.toFixed(2)})`,
        });
        discounts = [{ coupon: coupon.id }];
      } catch (e) {
        console.error("Coupon creation failed for", appliedPromoCode, "—", e.message);
      }
    }

    // --- Order data for the webhook: customer details come from the client (their
    //     own info), but ALL money fields are the server-computed trusted values. ---
    const trustedOrderData = {
      orderId: orderData?.orderId,
      customer: orderData?.customer || {},
      shipping: { id: shipping.id, name: shipOpt.name },
      items: trustedItems,
      subtotal,
      productSubtotal,
      shippingCost,
      stripeFee,
      total,
      promoCode: appliedPromoCode,
      discountAmount,
    };

    const metadata = {
      customer_name: customerName || trustedOrderData.customer.name || "",
      shipping_method: shipOpt.name,
      shipping_id: shipping.id,
      expected_total_pence: String(expectedTotalPence),
    };
    if (appliedPromoCode) metadata.promo_code = appliedPromoCode;
    if (discountAmount) metadata.discount_amount = String(discountAmount);

    const orderJson = JSON.stringify(trustedOrderData);
    const CHUNK_SIZE = 490;
    const numChunks = Math.ceil(orderJson.length / CHUNK_SIZE);
    metadata.order_chunks = String(numChunks);
    for (let i = 0; i < numChunks; i++) {
      metadata[`order_data_${i}`] = orderJson.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    }

    const origin =
      req.headers.origin ||
      req.headers.referer?.replace(/\/$/, "") ||
      "https://etprintworld.com";

    const sessionParams = {
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: customerEmail,
      line_items: lineItems,
      metadata,
      success_url: `${origin}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}?payment=cancelled`,
    };
    if (discounts) sessionParams.discounts = discounts;

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("Stripe session error:", error);
    return res.status(500).json({ error: error.message || "Failed to create checkout session" });
  }
}

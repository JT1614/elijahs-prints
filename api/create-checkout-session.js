// Vercel Serverless Function — creates a Stripe Checkout Session
// This file goes in: elijahs-prints/api/create-checkout-session.js
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { items, shipping, customerEmail, customerName, stripeFee, orderData, promoCode, discountAmount } = req.body;

    // Build line items for Stripe (always at full price — discount applied via Stripe coupon below)
    const lineItems = items.map((item) => ({
      price_data: {
        currency: "gbp",
        product_data: {
          name: item.name,
          description: item.selectedColors
            ? `Colour: ${item.selectedColors.join(" + ")}`
            : undefined,
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.qty,
    }));

    // Add shipping as a line item (if not free)
    if (shipping && shipping.price > 0) {
      lineItems.push({
        price_data: {
          currency: "gbp",
          product_data: { name: `Shipping: ${shipping.name}` },
          unit_amount: Math.round(shipping.price * 100),
        },
        quantity: 1,
      });
    }

    // Add card fee as a line item (already computed client-side on discounted subtotal)
    if (stripeFee && stripeFee > 0) {
      lineItems.push({
        price_data: {
          currency: "gbp",
          product_data: { name: "Card processing fee" },
          unit_amount: Math.round(stripeFee * 100),
        },
        quantity: 1,
      });
    }

    // Build a Stripe coupon when a promo discount is applied. Stripe handles the math
    // and shows the discount line natively in checkout.
    let discounts;
    if (promoCode && discountAmount && discountAmount > 0) {
      try {
        const coupon = await stripe.coupons.create({
          amount_off: Math.round(discountAmount * 100),
          currency: "gbp",
          duration: "once",
          name: `${promoCode} (-£${discountAmount.toFixed(2)})`,
        });
        discounts = [{ coupon: coupon.id }];
      } catch (e) {
        // If coupon creation fails, log and continue without discount rather than blocking checkout.
        console.error("Coupon creation failed for", promoCode, "—", e.message);
      }
    }

    // Store full order data as chunked metadata (values limited to 500 chars each)
    const metadata = {
      customer_name: customerName,
      shipping_method: shipping?.name || "Collection",
      shipping_id: shipping?.id || "collection",
    };
    if (promoCode) metadata.promo_code = promoCode;
    if (discountAmount) metadata.discount_amount = String(discountAmount);

    if (orderData) {
      const orderJson = JSON.stringify(orderData);
      const CHUNK_SIZE = 490;
      const numChunks = Math.ceil(orderJson.length / CHUNK_SIZE);
      metadata.order_chunks = String(numChunks);
      for (let i = 0; i < numChunks; i++) {
        metadata[`order_data_${i}`] = orderJson.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      }
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

// Vercel Serverless Function — Hal Export endpoint
// Export + update endpoint for the ET overnight print cycle.
// GET: read-only export of orders, stock, products, filaments.
// POST: mark stock order items as ticked (printed).
// Called nightly by Scripts/fetch-et-live-data.js before the print cycle runs.
//
// Required env vars in Vercel:
//   FIREBASE_SERVICE_ACCOUNT — JSON string of Firebase service account key (already set)
//   HAL_EXPORT_TOKEN — bearer token for auth (set by John)

import admin from "firebase-admin";

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

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Auth check
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.HAL_EXPORT_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!db) {
    return res.status(500).json({ error: "Firebase not initialized" });
  }

  // POST: mark stock order items as ticked (printed)
  if (req.method === "POST") {
    try {
      const { action, productId, colour, count } = req.body || {};
      if (action !== "tick_stock") {
        return res.status(400).json({ error: "Unknown action. Use action: 'tick_stock'" });
      }
      if (!productId) {
        return res.status(400).json({ error: "productId required" });
      }

      const stockDoc = await db.collection("shop").doc("stock-orders-v1").get();
      if (!stockDoc.exists) {
        return res.status(404).json({ error: "No stock orders found" });
      }

      const raw = stockDoc.data();
      const parsed = typeof raw.value === "string" ? JSON.parse(raw.value) : raw.value;
      const orders = Array.isArray(parsed) ? parsed : [];

      // Find unticked items matching productId + colour in active orders, tick up to count
      let ticked = 0;
      const toTick = count || 1;
      for (const so of orders) {
        if (so.status !== "active") continue;
        for (const item of so.items || []) {
          if (item.productId === productId && !item.ticked) {
            if (colour && item.colour !== colour) continue;
            item.ticked = true;
            ticked++;
            if (ticked >= toTick) break;
          }
        }
        if (ticked >= toTick) break;
      }

      // Write back
      await db.collection("shop").doc("stock-orders-v1").set({
        value: JSON.stringify(orders),
        updatedAt: new Date().toISOString(),
      });

      return res.status(200).json({ ticked, productId, colour, requested: toTick });
    } catch (error) {
      console.error("Stock update failed:", error);
      return res.status(500).json({ error: error.message || "Update failed" });
    }
  }

  // GET: export
  try {
    // 1. Orders — paid but not yet produced
    const ordersSnap = await db.collection("orders").get();
    const orders = [];
    ordersSnap.forEach((doc) => {
      const o = doc.data();
      if (o.status?.paid && !o.status?.produced) {
        orders.push({
          id: o.id || doc.id,
          date: o.date || null,
          items: (o.items || []).map((item) => ({
            productId: item.id,
            name: item.name,
            qty: item.qty,
            selectedColors: item.selectedColors || [],
            category: item.category || null,
          })),
          status: o.status,
        });
      }
    });

    // 2. Stock orders from shop/stock-orders-v1 (value is JSON string)
    const stockDoc = await db.collection("shop").doc("stock-orders-v1").get();
    let stockOrders = [];
    if (stockDoc.exists) {
      const raw = stockDoc.data();
      const parsed = typeof raw.value === "string" ? JSON.parse(raw.value) : raw.value;
      const items = Array.isArray(parsed) ? parsed : [];
      // Each item in a stock order = 1 unit to produce (no qty field).
      // Aggregate by productId + colour to get totals.
      const agg = {};
      items
        .filter((so) => so.status === "active")
        .forEach((so) =>
          (so.items || []).forEach((item) => {
            const key = `${item.productId}::${item.colour || "any"}`;
            if (!agg[key]) {
              agg[key] = {
                product_id: item.productId,
                product_name: item.productName || null,
                colour: item.colour || null,
                target: 0,
                current: 0,
              };
            }
            agg[key].target += 1;
            if (item.ticked) agg[key].current += 1;
          })
        );
      stockOrders = Object.values(agg);
    }

    // 3. Products from shop/products-v2 (value is JSON string)
    const productsDoc = await db.collection("shop").doc("products-v2").get();
    let products = [];
    if (productsDoc.exists) {
      const raw = productsDoc.data();
      const parsed = typeof raw.value === "string" ? JSON.parse(raw.value) : raw.value;
      const items = Array.isArray(parsed) ? parsed : [];
      products = items
        .filter((p) => p.available !== false)
        .map((p) => ({
          id: p.id,
          name: p.name,
          grams: p.grams || null,
          printTime: p.printTime || null,
          compatibleColours: p.colors || null,
          category: p.category || null,
          sourceFile: p.sourceUrl || null,
        }));
    }

    // 4. Filament colour map from shop/filaments-v1
    const filDoc = await db.collection("shop").doc("filaments-v1").get();
    let filaments = [];
    if (filDoc.exists) {
      const raw = filDoc.data();
      let parsed = raw.value;
      // Value may be double-stringified or a plain string
      if (typeof parsed === "string") {
        try { parsed = JSON.parse(parsed); } catch (e) { /* not JSON */ }
      }
      if (typeof parsed === "string") {
        try { parsed = JSON.parse(parsed); } catch (e) { /* still not JSON */ }
      }
      // Filaments stored as object keyed by name: { "Bright Green": { hex, type }, ... }
      if (Array.isArray(parsed)) {
        filaments = parsed
          .filter((f) => f.available !== false)
          .map((f) => ({ name: f.name, hex: f.hex, type: f.type || null }));
      } else if (parsed && typeof parsed === "object") {
        filaments = Object.entries(parsed).map(([name, val]) => ({
          name,
          hex: val.hex || null,
          type: val.type || null,
        }));
      }
    }

    return res.status(200).json({
      exported_at: new Date().toISOString(),
      orders,
      stockOrders,
      products,
      filaments,
    });
  } catch (error) {
    console.error("Hal export failed:", error);
    return res.status(500).json({ error: error.message || "Export failed" });
  }
}

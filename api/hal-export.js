// Vercel Serverless Function — Hal Export endpoint
// Read-only export of orders, stock, and products for the ET overnight print cycle.
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
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
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
      stockOrders = items
        .filter((so) => so.status === "active")
        .flatMap((so) =>
          (so.items || []).map((item) => ({
            product_id: item.productId,
            product_name: item.productName || null,
            colour: item.colour || null,
            target: item.qty || 0,
            current: item.ticked ? item.qty : 0,
          }))
        );
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

    return res.status(200).json({
      exported_at: new Date().toISOString(),
      orders,
      stockOrders,
      products,
    });
  } catch (error) {
    console.error("Hal export failed:", error);
    return res.status(500).json({ error: error.message || "Export failed" });
  }
}

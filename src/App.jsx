import React, { useState, useEffect, useMemo, useCallback } from "react";

/* ═══════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════ */
const DEFAULT_FILAMENTS = {
  "Bright Green":      { hex: "#b5cc18", type: "PLA Basic" },
  "Red":               { hex: "#d63031", type: "PLA Basic" },
  "Matte Orange":      { hex: "#e67e22", type: "PLA Matte" },
  "Matte Charcoal":    { hex: "#2d3436", type: "PLA Matte" },
  "Rose Gold Silk":    { hex: "#b76e79", type: "PLA Silk+", premium: true },
  "Matte Marine Blue": { hex: "#2e86de", type: "PLA Matte" },
  "Turquoise":         { hex: "#00cec9", type: "PLA Basic" },
  "Ocean to Meadow":   { hex: "linear-gradient(135deg, #0984e3, #00b894)", type: "PLA Gradient", premium: true },
  "Matte Ash Gray":    { hex: "#a4b0be", type: "PLA Matte" },
  "Matte Desert Tan":  { hex: "#c8b88a", type: "PLA Matte" },
  "Sunflower Yellow":  { hex: "#f9ca24", type: "PLA Basic" },
  "Silk Green":        { hex: "#1fab89", type: "ELEGOO Silk", premium: true },
  "Silk Copper":       { hex: "#b45a30", type: "ELEGOO Silk", premium: true },
  "Rainbow":           { hex: "linear-gradient(135deg, #e74c3c, #f39c12, #2ecc71, #3498db, #9b59b6)", type: "Reprapper PLA", premium: true },
  "Matte White":       { hex: "#f0f0f0", type: "PLA Matte" },
  "Dark Brown":        { hex: "#4a2c12", type: "PLA Basic" },
};
let FILAMENTS = { ...DEFAULT_FILAMENTS };
let ALL_COLORS = Object.keys(FILAMENTS);

/* ═══════════════════════════════════════════════
   FIREBASE CONFIG — Fill these in to use Firestore
   Leave as empty strings to use Claude artifact storage
   ═══════════════════════════════════════════════ */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAP6zVnDQ9RSvWfmgjKWWHKV-8SA_B4e2k",
  authDomain: "elijahs-prints.firebaseapp.com",
  projectId: "elijahs-prints",
  storageBucket: "elijahs-prints.firebasestorage.app",
  messagingSenderId: "66107920349",
  appId: "1:66107920349:web:cdbfbeabd079d32ed07034",
};
const USE_FIREBASE = FIREBASE_CONFIG.apiKey !== "";

/* ═══════════════════════════════════════════════
   FIRESTORE SECURITY RULES — paste these into
   Firebase Console → Firestore → Rules:
   ─────────────────────────────────────────────
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /shop/{docId} {
         allow read: true;
         allow write: if request.auth != null;
       }
       match /orders/{orderId} {
         allow create: true;
         allow read, update, delete: if request.auth != null;
       }
     }
   }
   ─────────────────────────────────────────────
   Products & filaments: anyone can read (shop works),
   only signed-in admin can edit.
   Orders: customers can place orders (create),
   only admin can view/update/delete them.
   ═══════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════
   STORAGE LAYER (auto-selects Firebase or Claude)
   ═══════════════════════════════════════════════ */
let _fb = null; // lazy-loaded firebase refs

async function getFirebase() {
  if (_fb) return _fb;
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.3.0/firebase-app.js");
  const { getFirestore, doc, getDoc, setDoc, collection, getDocs, updateDoc } = await import("https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js");
  const { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/11.3.0/firebase-auth.js");
  const { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } = await import("https://www.gstatic.com/firebasejs/11.3.0/firebase-storage.js");
  const app = initializeApp(FIREBASE_CONFIG);
  const db = getFirestore(app);
  const auth = getAuth(app);
  const storage = getStorage(app);
  _fb = { db, doc, getDoc, setDoc, collection, getDocs, updateDoc, auth, signInWithEmailAndPassword, signOut, onAuthStateChanged, storage, ref, uploadBytes, getDownloadURL, deleteObject };
  return _fb;
}

async function firebaseSignIn(email, password) {
  const { auth, signInWithEmailAndPassword } = await getFirebase();
  return signInWithEmailAndPassword(auth, email, password);
}

async function firebaseSignOut() {
  const { auth, signOut } = await getFirebase();
  return signOut(auth);
}

async function firebaseOnAuth(callback) {
  const { auth, onAuthStateChanged } = await getFirebase();
  return onAuthStateChanged(auth, callback);
}

async function storageGet(key) {
  if (USE_FIREBASE) {
    const { db, doc, getDoc } = await getFirebase();
    const snap = await getDoc(doc(db, "shop", key));
    return snap.exists() ? snap.data().value : null;
  }
  try {
    const r = await window.storage.get(key);
    return r ? r.value : null;
  } catch { return null; }
}

async function storageSet(key, value) {
  if (USE_FIREBASE) {
    const { db, doc, setDoc } = await getFirebase();
    await setDoc(doc(db, "shop", key), { value, updatedAt: new Date().toISOString() });
    return;
  }
  try { await window.storage.set(key, value); } catch (e) { console.error("Storage set failed:", e); }
}

/* ═══════════════════════════════════════════════
   DATA HELPERS (use storageGet/storageSet)
   ═══════════════════════════════════════════════ */
async function loadFilaments() {
  try {
    const r = await storageGet("filaments-v1");
    return r ? JSON.parse(r) : null;
  } catch { return null; }
}
async function saveFilaments(f) {
  try { await storageSet("filaments-v1", JSON.stringify(f)); } catch (e) { console.error("Save filaments failed:", e); }
}
async function loadCategories() {
  try {
    const r = await storageGet("categories-v1");
    return r ? JSON.parse(r) : null;
  } catch { return null; }
}
async function saveCategories(cats) {
  try { await storageSet("categories-v1", JSON.stringify(cats)); } catch (e) { console.error("Save categories failed:", e); }
}
async function loadCategoryMeta() {
  try {
    const r = await storageGet("category-meta-v1");
    return r ? JSON.parse(r) : null;
  } catch { return null; }
}
async function saveCategoryMeta(meta) {
  try { await storageSet("category-meta-v1", JSON.stringify(meta)); } catch (e) { console.error("Save category meta failed:", e); }
}
const DEFAULT_CATEGORY_META = {
  "Key Rings": { audience: "kids", hasDimensions: false },
  "Fidgets & Toys": { audience: "kids", hasDimensions: false },
  "Clickers": { audience: "kids", hasDimensions: false },
  "Planters": { audience: "adult", hasDimensions: true },
  "Bird Feeders": { audience: "adult", hasDimensions: false },
  "Household": { audience: "adult", hasDimensions: false },
};
async function loadCreators() {
  try {
    console.log("loadCreators: step 1 — calling storageGet");
    const r = await storageGet("creators-v1");
    console.log("loadCreators: step 2 — storageGet returned:", r ? "data (" + r.length + " chars)" : "null");
    if (!r) { return { data: null, debug: "📭 No creators document found in Firebase (key: creators-v1). Import the CSV to get started." }; }
    const parsed = JSON.parse(r);
    console.log("loadCreators: step 3 — parsed OK:", parsed.length, "creators");
    return { data: parsed, debug: "✅ Loaded " + parsed.length + " creators from Firebase" };
  } catch (e) {
    console.error("Load creators failed:", e);
    return { data: null, debug: "❌ Firebase read error: " + (e && e.message ? e.message : String(e)) };
  }
}
async function saveCreators(creators) {
  try { await storageSet("creators-v1", JSON.stringify(creators)); } catch (e) { console.error("Save creators failed:", e); throw e; }
}
const SHIPPING_OPTIONS = [
  { id: "collection", name: "School Collection", description: "Elijah will drop it off at school — free!", price: 0, icon: "🎒" },
  { id: "standard", name: "Royal Mail Tracked 48", description: "2–3 working days · tracked delivery", price: 3.49, icon: "📦" },
];
const FREE_SHIPPING_THRESHOLD = 30;
function getStripeFee(amount) {
  return Math.ceil((0.20 + amount * 0.015) * 100) / 100;
}
const PREMIUM_UPLIFT = 0.30; // 30% price increase for premium filaments
function getPremiumPrice(basePrice, selectedColors) {
  const hasPremium = selectedColors.some(c => FILAMENTS[c]?.premium);
  if (!hasPremium) return basePrice;
  const uplifted = basePrice * (1 + PREMIUM_UPLIFT);
  return Math.ceil(uplifted * 20) / 20; // Round up to nearest 5p
}
/* ───────────────────────────────────────────────
   STRIPE CONFIG — Fill in your publishable key
   ─────────────────────────────────────────────── */
const STRIPE_CONFIG = {
  publishableKey: "pk_test_51T3XclAA5p18B2vj1TyBnVblUN2qsJjnbkI7ogffH71Owx2Fr5CBPkhcoODaIWWIhluD7GPrUtQiaDNEIoFC8iVA00wENZaAwi",
};
const USE_STRIPE = STRIPE_CONFIG.publishableKey !== "";
const DEFAULT_CATEGORIES = ["Key Rings", "Fidgets & Toys", "Planters", "Bird Feeders", "Household", "Clickers", "Coasters"];
let categories = [...DEFAULT_CATEGORIES];
const BADGE_OPTIONS = [null, "Popular", "Best Seller", "New", "Premium"];
const APP_VERSION = "v83 · 2026-03-06";

/* ═══════════════════════════════════════════════
   AUTO-BADGE COMPUTATION
   Priority: NEW > Best Seller > Popular > Premium
   ═══════════════════════════════════════════════ */
function computeAutoBadges(products, orders) {
  if (!products || !products.length) return {};
  const now = Date.now();
  const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
  const ONE_MONTH = 30 * 24 * 60 * 60 * 1000;

  // Count all-time sales per product
  const allTimeSales = {};
  const lastMonthSales = {};
  (orders || []).forEach(order => {
    const orderDate = new Date(order.date).getTime();
    const isLastMonth = (now - orderDate) <= ONE_MONTH;
    (order.items || []).forEach(item => {
      if (item.isTip) return;
      allTimeSales[item.id] = (allTimeSales[item.id] || 0) + (item.qty || 1);
      if (isLastMonth) lastMonthSales[item.id] = (lastMonthSales[item.id] || 0) + (item.qty || 1);
    });
  });

  // Best Seller: #1 all-time (must have at least 1 sale)
  const bestSellerId = Object.entries(allTimeSales).sort((a, b) => b[1] - a[1])[0]?.[0];

  // Popular: top 5 by last-month sales (exclude #1 best seller to avoid overlap)
  const popularIds = Object.entries(lastMonthSales)
    .filter(([id]) => id !== bestSellerId)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .filter(([, count]) => count > 0)
    .map(([id]) => id);

  // Premium: any "Dragon" product + top 5 most expensive
  const sortedByPrice = [...products].sort((a, b) => b.price - a.price);
  const top5Expensive = sortedByPrice.slice(0, 5).map(p => String(p.id));
  const premiumIds = new Set([
    ...products.filter(p => /dragon/i.test(p.name)).map(p => String(p.id)),
    ...top5Expensive,
  ]);

  // Compute badge per product (priority: NEW > Best Seller > Popular > Premium)
  const badges = {};
  products.forEach(p => {
    const pid = String(p.id);
    const addedDate = p.addedDate ? new Date(p.addedDate).getTime() : 0;
    const isNew = addedDate && (now - addedDate) <= TWO_WEEKS;

    if (isNew) { badges[p.id] = "New"; return; }
    if (pid === String(bestSellerId) && allTimeSales[pid] > 0) { badges[p.id] = "Best Seller"; return; }
    if (popularIds.includes(pid)) { badges[p.id] = "Popular"; return; }
    if (premiumIds.has(pid)) { badges[p.id] = "Premium"; return; }
  });
  return badges;
}
const TIP_OPTIONS = [
  { amount: 2, label: "£2", emoji: "🎉" },
  { amount: 5, label: "£5", emoji: "🔥" },
  { amount: 10, label: "£10", emoji: "💎" },
];
const FALLBACK_ADMIN_PASSWORD = "elijah3d"; // Only used when Firebase is NOT configured

/* ═══════════════════════════════════════════════
   DEFAULT PRODUCTS (seed data)
   ═══════════════════════════════════════════════ */
const SEED_PRODUCTS = [
  { id: 100, name: "Tiny Character Figure", price: 1.00, category: "Fidgets & Toys", description: "Ultra-tiny detailed character figure. Smaller than a 50p coin!", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "30 min", grams: 3, available: true, maxColors: 1 },
  { id: 101, name: "Spiral Cone Ornament", price: 1.00, category: "Fidgets & Toys", description: "Stunning multi-colour spiral cone with layered petal design.", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "6 hrs", grams: 80, available: true, maxColors: 1 },
  { id: 102, name: "Frog Planter", price: 1.00, category: "Planters", description: "Adorable frog planter. Perfect for succulents!", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "5 hrs", grams: 120, available: true, maxColors: 1 },
  { id: 103, name: "Brick Block Keychain", price: 1.00, category: "Key Rings", description: "Classic building brick keychain with authentic stud detail.", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "1 hr", grams: 15, available: true, maxColors: 1 },
  { id: 104, name: "Skull Chain Keychain", price: 1.00, category: "Key Rings", description: "Four graduated skulls on a chain. Looks incredible in silk filaments!", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "1.5 hrs", grams: 18, available: true, maxColors: 1 },
  { id: 105, name: "Skeleton Hoodie Keychain", price: 1.00, category: "Key Rings", description: "Cute skeleton character in a hoodie with lobster clasp.", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "2 hrs", grams: 20, available: true, maxColors: 1 },
  { id: 106, name: "Flexi Skeleton Keychain", price: 1.00, category: "Key Rings", description: "Fully articulated flexi skeleton with movable joints.", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "1.5 hrs", grams: 15, available: true, maxColors: 1 },
  { id: 107, name: "Demogorgon Keychain", price: 1.00, category: "Key Rings", description: "Articulated Demogorgon figure with opening flower head.", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "2 hrs", grams: 20, available: true, maxColors: 1 },
  { id: 108, name: "Mini Dinosaur", price: 1.00, category: "Key Rings", description: "Cute mini dinosaur figure. Tiny and adorable!", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "45 min", grams: 8, available: true, maxColors: 1 },
  { id: 109, name: "Hexagonal Honeycomb Cube", price: 1.00, category: "Fidgets & Toys", description: "Mesmerising honeycomb cube made of individual hexagons.", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "8 hrs", grams: 150, available: true, maxColors: 1 },
  { id: 110, name: "Baby Alien Figure", price: 1.00, category: "Fidgets & Toys", description: "Detailed baby alien character bust with robe and big ears.", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "3 hrs", grams: 45, available: true, maxColors: 1 },
  { id: 111, name: "Articulated Crystal Dragon", price: 1.00, category: "Fidgets & Toys", description: "Articulated crystal dragon with spiky scales. Fully flexible!", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "5 hrs", grams: 60, available: true, maxColors: 1 },
  { id: 112, name: "Desk Organiser", price: 1.00, category: "Planters", description: "Two-tone desk organiser with pen tubes and storage compartment.", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "6 hrs", grams: 100, available: true, maxColors: 1 },
  { id: 113, name: "Money Block", price: 1.00, category: "Fidgets & Toys", description: "3D printed novelty 100 money block. Great desk ornament!", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "2 hrs", grams: 30, available: true, maxColors: 1 },
  { id: 114, name: "Rocktopus", price: 1.00, category: "Fidgets & Toys", description: "Articulated octopus with a detailed head. Tentacles really move!", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "7 hrs", grams: 120, available: true, maxColors: 1 },
  { id: 115, name: "T-Rex Skull", price: 1.00, category: "Fidgets & Toys", description: "Detailed T-Rex dinosaur skull with opening jaw. Museum quality!", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "6 hrs", grams: 80, available: true, maxColors: 1 },
  { id: 116, name: "Emerging Figure Bust", price: 1.00, category: "Fidgets & Toys", description: "Dramatic figure emerging from the surface. Detailed portrait bust.", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "4 hrs", grams: 60, available: true, maxColors: 1 },
  { id: 117, name: "Diamond Lattice Planter", price: 1.00, category: "Planters", description: "Elegant diamond lattice planter with matching saucer. Great for cacti!", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "5 hrs", grams: 110, available: true, maxColors: 1 },
  { id: 118, name: "Remote Control Holder", price: 1.00, category: "Household", description: "Stylish 3-compartment remote control holder with geometric pattern. Keeps your living room tidy!", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "5 hrs", grams: 120, available: true, maxColors: 1 },
  { id: 119, name: "Winged Crystal Dragon", price: 1.00, category: "Fidgets & Toys", description: "Stunning articulated dragon with spread wings and crystal-shard scales. Fully flexible body and tail!", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "8 hrs", grams: 100, available: true, maxColors: 1 },
];

/* ═══════════════════════════════════════════════
   STORAGE
   ═══════════════════════════════════════════════ */
async function loadProducts() {
  try {
    const r = await storageGet("products-v2");
    return r ? JSON.parse(r) : null;
  } catch { return null; }
}
async function saveProducts(products) {
  try { await storageSet("products-v2", JSON.stringify(products)); } catch (e) { console.error("Save failed:", e); }
}

/* ═══════════════════════════════════════════════
   ORDER STORAGE (per-document in Firebase for security)
   ═══════════════════════════════════════════════ */
async function loadOrders() {
  if (USE_FIREBASE) {
    try {
      const { db, collection, getDocs } = await getFirebase();
      const snap = await getDocs(collection(db, "orders"));
      return snap.docs.map(d => d.data());
    } catch (e) { console.error("Load orders failed:", e); return []; }
  }
  try {
    const r = await storageGet("orders-v1");
    return r ? JSON.parse(r) : [];
  } catch { return []; }
}
async function addOrder(order) {
  if (USE_FIREBASE) {
    try {
      const { db, doc, setDoc } = await getFirebase();
      await setDoc(doc(db, "orders", order.id), order);
    } catch (e) { console.error("Add order failed:", e); }
    return;
  }
  try {
    const existing = await loadOrders();
    await storageSet("orders-v1", JSON.stringify([...existing, order]));
  } catch (e) { console.error("Add order failed:", e); }
}
async function updateOrderStatus(orderId, status) {
  if (USE_FIREBASE) {
    try {
      const { db, doc, updateDoc } = await getFirebase();
      await updateDoc(doc(db, "orders", orderId), { status });
    } catch (e) { console.error("Update order failed:", e); }
    return;
  }
  try {
    const orders = await loadOrders();
    const updated = orders.map(o => o.id === orderId ? { ...o, status } : o);
    await storageSet("orders-v1", JSON.stringify(updated));
  } catch (e) { console.error("Update order failed:", e); }
}

/* ═══════════════════════════════════════════════
   EMAIL NOTIFICATION (EmailJS)
   Setup: 1) Sign up free at emailjs.com
          2) Create an email service (connect Outlook)
          3) Create a template with variables:
             {{order_id}} {{customer_name}} {{customer_email}}
             {{customer_phone}} {{shipping_method}} {{items_list}}
             {{subtotal}} {{shipping_cost}} {{total}} {{address}}
          4) Replace the IDs below
   ═══════════════════════════════════════════════ */
const EMAILJS_CONFIG = {
  recipientEmail: "johnianthompson@outlook.com, etprintworld@outlook.com",
  enabled: true,
  // Credentials moved server-side to /api/send-email — no longer exposed in frontend
  _tok: "ep_email_2026_s3cure",  // Must match EMAIL_API_TOKEN in Vercel env vars
};

async function sendOrderEmail(order) {
  if (!EMAILJS_CONFIG.enabled) {
    console.log("📧 Email notification (demo mode — configure EmailJS to enable):", order);
    return;
  }
  // Guard: don't send email for blank/bot orders
  const realItems = (order.items || []).filter(i => !i.isTip && i.name && i.id);
  if (realItems.length === 0 && !(order.items || []).some(i => i.isTip)) {
    console.warn("📧 Email blocked — order has no real items (likely bot)");
    return;
  }
  try {
    const itemsList = order.items.map(i =>
      i.isTip ? `🧡 Tip: £${i.price.toFixed(2)}` : `${i.qty}× ${i.name} (${i.selectedColors.join(" + ")})`
    ).join("\n");
    const address = order.shipping.id === "collection"
      ? "🎒 School collection"
      : [order.customer.address1, order.customer.address2, order.customer.city, order.customer.county, order.customer.postcode].filter(Boolean).join(", ");
    await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "order",
        _tok: EMAILJS_CONFIG._tok,
        templateParams: {
          to_email: EMAILJS_CONFIG.recipientEmail,
          order_id: order.id,
          customer_name: order.customer.name,
          customer_email: order.customer.email,
          customer_phone: order.customer.phone || "Not provided",
          shipping_method: order.shipping.name,
          items_list: itemsList,
          subtotal: `£${order.subtotal.toFixed(2)}`,
          shipping_cost: order.shippingCost === 0 ? "FREE" : `£${order.shippingCost.toFixed(2)}`,
          total: `£${order.total.toFixed(2)}`,
          address: address,
        },
      }),
    });
    console.log("📧 Order email sent successfully");
  } catch (e) {
    console.error("📧 Email send failed:", e);
  }
}
async function sendShippedEmail(order) {
  if (!EMAILJS_CONFIG.enabled) return;
  try {
    const itemsList = order.items.map(i =>
      i.isTip ? `🧡 Tip: £${i.price.toFixed(2)}` : `${i.qty}× ${i.name} (${i.selectedColors.join(" + ")})`
    ).join("\n");
    const isCollection = order.shipping?.id === "collection";
    await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "shipped",
        _tok: EMAILJS_CONFIG._tok,
        templateParams: {
          to_email: order.customer.email,
          order_id: order.id,
          customer_name: order.customer.name.split(" ")[0],
          order_items: itemsList,
          delivery_method: isCollection ? "handed over at school" : "shipped",
          delivery_message: isCollection
            ? "Elijah will bring it to school — keep an eye out!"
            : "Your order is on its way via Royal Mail Tracked 48. It should arrive within 2-3 working days.",
        },
      }),
    });
    console.log("📧 Shipped email sent to", order.customer.email);
  } catch (e) {
    console.error("📧 Shipped email failed:", e);
  }
}

async function sendMadeEmail(order) {
  if (!EMAILJS_CONFIG.enabled) return;
  try {
    const itemsList = order.items.map(i =>
      i.isTip ? `🧡 Tip: £${i.price.toFixed(2)}` : `${i.qty}× ${i.name} (${i.selectedColors.join(" + ")})`
    ).join("\n");
    await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "made",
        _tok: EMAILJS_CONFIG._tok,
        templateParams: {
          to_email: order.customer.email,
          order_id: order.id,
          customer_name: order.customer.name.split(" ")[0],
          order_items: itemsList,
        },
      }),
    });
    console.log("📧 Made email sent to", order.customer.email);
  } catch (e) {
    console.error("📧 Made email failed:", e);
  }
}

async function sendRequestEmail(request) {
  if (!EMAILJS_CONFIG.enabled) {
    console.log("📧 Special request email (demo mode):", request);
    return;
  }
  try {
    await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "request",
        _tok: EMAILJS_CONFIG._tok,
        templateParams: {
          to_email: EMAILJS_CONFIG.recipientEmail,
          request_id: request.id,
          customer_name: request.name,
          customer_email: request.email,
          item_type: request.type,
          description: request.description,
          model_link: request.modelLink || "None provided",
          size_pref: request.size,
          colour_pref: request.colours || "No preference",
          budget: request.budget,
          extra_notes: request.notes || "None",
        },
      }),
    });
    console.log("📧 Request email sent successfully");
  } catch (e) {
    console.error("📧 Request email send failed:", e);
  }
}

/* ═══════════════════════════════════════════════
   IMAGE COMPRESSION
   ═══════════════════════════════════════════════ */
function compressImage(file, maxWidth = 400, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ratio = Math.min(maxWidth / img.width, maxWidth / img.height, 1);
        canvas.width = img.width * ratio;
        canvas.height = img.height * ratio;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ═══════════════════════════════════════════════
   PRODUCT IMAGE STORAGE (Firebase Storage)
   ═══════════════════════════════════════════════ */
function dataURLtoBlob(dataURL) {
  const [header, data] = dataURL.split(",");
  const mime = header.match(/:(.*?);/)[1];
  const bytes = atob(data);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function uploadProductImage(productId, dataURL) {
  if (!USE_FIREBASE) return dataURL; // fallback: keep base64 if no Firebase
  try {
    const { storage, ref, uploadBytes, getDownloadURL } = await getFirebase();
    const blob = dataURLtoBlob(dataURL);
    const imageRef = ref(storage, `product-images/${productId}.jpg`);
    await uploadBytes(imageRef, blob, { contentType: "image/jpeg" });
    return await getDownloadURL(imageRef);
  } catch (e) {
    console.error("Image upload failed:", e);
    return dataURL; // fallback to base64 if upload fails
  }
}

async function deleteProductImage(productId) {
  if (!USE_FIREBASE) return;
  try {
    const { storage, ref, deleteObject } = await getFirebase();
    const imageRef = ref(storage, `product-images/${productId}.jpg`);
    await deleteObject(imageRef);
  } catch (e) {
    console.error("Image delete failed (may not exist):", e);
  }
}

/* ═══════════════════════════════════════════════
   SHARED COMPONENTS
   ═══════════════════════════════════════════════ */
const S = {
  font: "'DM Sans', sans-serif",
  fontHead: "'Space Grotesk', sans-serif",
  fontMono: "'IBM Plex Mono', monospace",
  teal: "#00c9a7",
  purple: "#845ef7",
  dark: "#0e0e1f",
  card: "rgba(255,255,255,0.03)",
  border: "rgba(255,255,255,0.08)",
  text: "#e8e8e8",
  muted: "rgba(255,255,255,0.4)",
  dimmer: "rgba(255,255,255,0.25)",
};

function ColorSwatch({ name, selected, onClick, size = 22, disabled }) {
  const fil = FILAMENTS[name]; if (!fil) return null;
  return (
    <button className="ep-swatch" onClick={disabled ? undefined : onClick} title={`${name} (${fil.type})`} disabled={disabled} style={{
      width: size, height: size, borderRadius: "50%", cursor: disabled ? "default" : "pointer", flexShrink: 0,
      background: fil.hex, border: selected ? "2.5px solid #00c9a7" : "2px solid rgba(255,255,255,0.15)",
      outline: selected ? "2px solid rgba(0,201,167,0.3)" : "none", outlineOffset: 1,
      transition: "all 0.2s", transform: selected ? "scale(1.15)" : "scale(1)", padding: 0,
      boxShadow: selected ? "0 0 8px rgba(0,201,167,0.3)" : "none", opacity: disabled ? 0.3 : 1,
    }}>
      {fil.premium && !selected && !disabled && <span style={{ position: "absolute", top: -4, right: -4, fontSize: 8 }}>✨</span>}
    </button>
  );
}

function Badge({ text }) {
  const bg = { "Best Seller": "#ff6b35", Popular: "#00c9a7", New: "#845ef7", Premium: "#ffd43b" };
  const fg = { Premium: "#1a1a2e" };
  return <span style={{ background: bg[text] || "#666", color: fg[text] || "#fff", padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", position: "absolute", top: 12, right: 12, zIndex: 2 }}>{text}</span>;
}

function Tooltip({ text, children, position = "bottom" }) {
  const [show, setShow] = useState(false);
  const posStyle = position === "bottom"
    ? { top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" }
    : position === "top"
    ? { bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" }
    : position === "left"
    ? { right: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" }
    : { left: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" };
  return (
    <div style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div style={{
          position: "absolute", ...posStyle, zIndex: 9999,
          background: "#1a1a35", border: "1px solid rgba(132,94,247,0.35)",
          borderRadius: 10, padding: "10px 14px", width: 240,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)", pointerEvents: "none",
          animation: "fadeIn 0.15s ease",
        }}>
          <p style={{ fontSize: 12, color: "#e8e8f0", lineHeight: 1.6, margin: 0, fontFamily: "'Inter', sans-serif" }}
            dangerouslySetInnerHTML={{ __html: text }} />
        </div>
      )}
    </div>
  );
}

function ProductImage({ product, hovered }) {
  const [err, setErr] = useState(false);
  const hasImg = product.img && !err;
  return (
    <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, rgba(0,201,167,0.05), rgba(132,94,247,0.05))", position: "relative", overflow: "hidden" }}>
      {hasImg ? <img src={product.img} alt={product.name} onError={() => setErr(true)} style={{ width: "100%", height: "100%", objectFit: "contain", transition: "transform 0.4s", transform: hovered ? "scale(1.08)" : "scale(1)", padding: 8 }} />
      : <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, transition: "transform 0.4s", transform: hovered ? "scale(1.05)" : "scale(1)" }}>
          <span style={{ fontSize: 42, opacity: 0.3 }}>📷</span>
          <span style={{ fontSize: 10, color: S.dimmer, fontFamily: S.fontHead }}>No photo yet</span>
        </div>}
      <div style={{ position: "absolute", bottom: 8, left: 12, fontSize: 10, color: S.dimmer, fontFamily: S.fontMono }}>⏱ {product.printTime} · {product.grams}g</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   PRODUCT CARD (shop)
   ═══════════════════════════════════════════════ */
function ProductCard({ product, onAddToCart, cartAnimation }) {
  const maxC = product.maxColors || 1;
  const [selectedColors, setSelectedColors] = useState([product.colors[0]]);
  const [hovered, setHovered] = useState(false);
  const [sameColour, setSameColour] = useState(false);
  const toggleColor = (color) => {
    if (maxC === 1) { setSelectedColors([color]); return; }
    if (sameColour) { setSelectedColors(Array(maxC).fill(color)); return; }
    if (selectedColors.includes(color)) { if (selectedColors.length > 1) setSelectedColors(selectedColors.filter(c => c !== color)); }
    else { if (selectedColors.length < maxC) setSelectedColors([...selectedColors, color]); else setSelectedColors([...selectedColors.slice(1), color]); }
  };
  const handleSameToggle = () => {
    const next = !sameColour;
    setSameColour(next);
    if (next) setSelectedColors(Array(maxC).fill(selectedColors[0]));
    else setSelectedColors([selectedColors[0]]);
  };
  const canAdd = selectedColors.length >= Math.min(maxC, product.colors.length);
  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{
      background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, overflow: "hidden", position: "relative",
      transition: "all 0.4s cubic-bezier(0.16,1,0.3,1)", transform: hovered ? "translateY(-6px)" : "translateY(0)",
      boxShadow: hovered ? "0 20px 60px rgba(0,201,167,0.15), 0 0 0 1px rgba(0,201,167,0.2)" : "0 4px 20px rgba(0,0,0,0.2)",
    }}>
      {product.badge && <Badge text={product.badge} />}
      <ProductImage product={product} hovered={hovered} />
      <div style={{ padding: "14px 16px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: S.text, fontFamily: S.fontHead, lineHeight: 1.3 }}>{product.name}</h3>
          <span style={{ fontSize: 16, fontWeight: 800, color: S.teal, fontFamily: S.fontMono, whiteSpace: "nowrap", marginLeft: 8 }}>{selectedColors.some(c => FILAMENTS[c]?.premium) ? <><span style={{ textDecoration: "line-through", opacity: 0.4, fontSize: 12 }}>£{product.price.toFixed(2)}</span> £{getPremiumPrice(product.price, selectedColors).toFixed(2)}</> : `£${product.price.toFixed(2)}`}</span>
        </div>
        <p style={{ margin: "0 0 10px", fontSize: 12, lineHeight: 1.5, color: S.muted }}>{product.widthMm && product.heightMm ? `${product.widthMm}mm wide × ${product.heightMm}mm tall. ` : ""}{product.description}</p>
        {maxC > 1 && <div style={{ fontSize: 11, color: S.purple, fontFamily: S.fontMono, fontWeight: 600, marginBottom: 6, background: "rgba(132,94,247,0.08)", padding: "4px 8px", borderRadius: 6, display: "inline-block", border: "1px solid rgba(132,94,247,0.15)" }}>Pick {maxC} colours</div>}
        {maxC > 1 && (
          <button onClick={handleSameToggle} style={{
            display: "flex", alignItems: "center", gap: 6, marginBottom: 6, padding: "4px 0",
            background: "none", border: "none", cursor: "pointer", fontSize: 11, color: sameColour ? S.teal : S.dimmer,
            fontFamily: S.fontHead, fontWeight: 600, transition: "color 0.2s",
          }}>
            <div style={{
              width: 28, height: 16, borderRadius: 8, position: "relative", transition: "background 0.2s",
              background: sameColour ? S.teal : "rgba(255,255,255,0.1)",
            }}>
              <div style={{ width: 12, height: 12, borderRadius: 6, background: "#fff", position: "absolute", top: 2, left: sameColour ? 14 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
            </div>
            Same colour for all
          </button>
        )}
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 4 }}>
          {product.colors.map((c, i) => <ColorSwatch key={i} name={c} selected={selectedColors.includes(c)} onClick={() => toggleColor(c)} size={20} />)}
        </div>
        <div style={{ fontSize: 10, color: S.dimmer, marginTop: 4, marginBottom: 4 }}>
          {sameColour && maxC > 1
            ? <span><span style={{ fontWeight: 600, color: S.muted }}>{selectedColors[0]}</span> × {maxC}</span>
            : selectedColors.map((c, i) => <span key={i}>{i > 0 && " + "}<span style={{ fontWeight: 600, color: S.muted }}>{c}</span></span>)
          }
        </div>
        <button onClick={() => canAdd && onAddToCart(product, selectedColors)} disabled={!canAdd} style={{
          width: "100%", padding: "10px 0", borderRadius: 10, border: "none", marginTop: 6,
          background: cartAnimation === product.id ? S.teal : canAdd ? "linear-gradient(135deg, rgba(0,201,167,0.15), rgba(0,201,167,0.08))" : "rgba(255,255,255,0.03)",
          color: cartAnimation === product.id ? "#1a1a2e" : canAdd ? S.teal : "rgba(255,255,255,0.2)",
          fontSize: 12, fontWeight: 700, cursor: canAdd ? "pointer" : "default",
          fontFamily: S.fontHead, letterSpacing: "0.5px", textTransform: "uppercase",
        }}>{cartAnimation === product.id ? "✓ Added!" : !canAdd ? `Select ${maxC} colours` : "Add to Cart"}</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   ADMIN: Product Editor Modal
   ═══════════════════════════════════════════════ */
function ProductEditor({ product, onSave, onDelete, onCancel, isNew, creators = [], categoryMeta = {} }) {
  const [p, setP] = useState({ ...product });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (key, val) => setP(prev => ({ ...prev, [key]: val }));
  const toggleColor = (color) => {
    const cur = p.colors || [];
    set("colors", cur.includes(color) ? cur.filter(c => c !== color) : [...cur, color]);
  };

  const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, fontSize: 14, border: `1px solid ${S.border}`, background: "rgba(255,255,255,0.04)", color: S.text, fontFamily: S.font, outline: "none", boxSizing: "border-box" };
  const labelStyle = { fontSize: 11, fontWeight: 600, color: S.muted, fontFamily: S.fontHead, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4, display: "block" };
  const sectionStyle = { marginBottom: 20 };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={onCancel} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }} />
      <div style={{ position: "relative", width: "min(640px, 100%)", maxHeight: "85vh", overflow: "auto", background: "#151530", border: `1px solid ${S.border}`, borderRadius: 20, padding: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h3 style={{ fontSize: 20, fontWeight: 800, fontFamily: S.fontHead, color: S.text, margin: 0 }}>{isNew ? "➕ Add New Product" : `✏️ Edit: ${product.name}`}</h3>
          <button onClick={onCancel} style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${S.border}`, color: "#aaa", width: 36, height: 36, borderRadius: "50%", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>

        {/* Product photo upload */}
        <div style={sectionStyle}>
          <label style={labelStyle}>Product Photo</label>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <label style={{
              width: 120, height: 120, borderRadius: 14, cursor: "pointer", flexShrink: 0, overflow: "hidden",
              border: `2px dashed ${p.img ? "transparent" : "rgba(255,255,255,0.15)"}`,
              background: p.img ? "none" : "rgba(255,255,255,0.02)",
              display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 4,
              transition: "all 0.2s", position: "relative",
            }}>
              {p.img ? (
                <img src={p.img} alt="Product" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <>
                  <span style={{ fontSize: 28, opacity: 0.4 }}>📷</span>
                  <span style={{ fontSize: 10, color: S.dimmer, fontFamily: S.fontHead, textAlign: "center" }}>Click to upload</span>
                </>
              )}
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const compressed = await compressImage(file);
                  set("img", compressed); // show preview immediately
                  const url = await uploadProductImage(p.id || Date.now(), compressed);
                  if (url !== compressed) set("img", url); // replace base64 with URL
                } catch(err) { console.error("Image upload failed:", err); }
                e.target.value = "";
              }} />
            </label>
            <div style={{ flex: 1 }}>
              {p.img && (
                <button onClick={() => { deleteProductImage(p.id); set("img", ""); }} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(255,107,107,0.3)", background: "rgba(255,107,107,0.08)", color: "#ff6b6b", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead, marginBottom: 8 }}>✕ Remove photo</button>
              )}
              <p style={{ fontSize: 11, color: S.dimmer, lineHeight: 1.5, margin: 0 }}>
                {p.img ? "Photo uploaded and compressed. Click the image to replace it." : "Upload a photo of the printed product. JPG or PNG, any size — it'll be compressed automatically."}
              </p>
            </div>
          </div>
        </div>

        {/* Row: name + category */}
        <div className="ep-editor-2col" style={{ ...sectionStyle, display: "grid", gridTemplateColumns: "1fr 180px", gap: 12 }}>
          <div><label style={labelStyle}>Product Name *</label><input style={inputStyle} value={p.name} onChange={e => set("name", e.target.value)} placeholder="Product name" /></div>
          <div>
            <label style={labelStyle}>Category *</label>
            <select value={p.category} onChange={e => set("category", e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Description */}
        <div style={sectionStyle}>
          <label style={labelStyle}>Description</label>
          <textarea style={{ ...inputStyle, height: 64, resize: "vertical" }} value={p.description} onChange={e => set("description", e.target.value)} />
        </div>

        {/* Dimensions — only shown when category has hasDimensions enabled */}
        {(categoryMeta[p.category] || {}).hasDimensions && (
          <div className="ep-editor-2col" style={{ ...sectionStyle, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={labelStyle}>Width (mm)</label><input style={inputStyle} type="number" min="0" value={p.widthMm || ""} onChange={e => set("widthMm", parseInt(e.target.value) || 0)} placeholder="e.g. 95" /></div>
            <div><label style={labelStyle}>Height (mm)</label><input style={inputStyle} type="number" min="0" value={p.heightMm || ""} onChange={e => set("heightMm", parseInt(e.target.value) || 0)} placeholder="e.g. 110" /></div>
          </div>
        )}

        {/* Row: price, grams, print time, badge */}
        <div className="ep-editor-2col" style={{ ...sectionStyle, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
          <div><label style={labelStyle}>Price (£) *</label><input style={inputStyle} type="number" step="0.05" min="0" value={p.price} onChange={e => set("price", parseFloat(e.target.value) || 0)} /></div>
          <div><label style={labelStyle}>Weight (g)</label><input style={inputStyle} type="number" min="0" value={p.grams} onChange={e => set("grams", parseInt(e.target.value) || 0)} /></div>
          <div><label style={labelStyle}>Print Time</label><input style={inputStyle} value={p.printTime} onChange={e => set("printTime", e.target.value)} placeholder="e.g. 2 hrs" /></div>
          <div>
            <label style={labelStyle}>Badge (auto)</label>
            <Tooltip position="bottom" text="Badges are assigned automatically based on order history and product attributes:<br/><br/>🆕 <strong>NEW</strong> — added in the last 14 days<br/>🏆 <strong>Best Seller</strong> — most ordered product<br/>🔥 <strong>Popular</strong> — ordered 3+ times<br/>⭐ <strong>Premium</strong> — manually set<br/><br/>You cannot edit this — it updates itself.">
            <div style={{ ...inputStyle, display: "flex", alignItems: "center", background: "rgba(255,255,255,0.02)", cursor: "default" }}>
              <span style={{ fontSize: 13, color: S.dimmer }}>{p._autoBadge || "—"}</span>
            </div>
            </Tooltip>
          </div>
        </div>

        {/* Available Colours */}
        <div style={sectionStyle}>
          <label style={labelStyle}>Available Colours ({(p.colors || []).length} selected)</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button onClick={() => set("colors", [...ALL_COLORS])} style={{ padding: "4px 12px", borderRadius: 8, border: `1px solid rgba(0,201,167,0.3)`, background: "rgba(0,201,167,0.08)", color: S.teal, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead }}>Select All</button>
            <button onClick={() => set("colors", [])} style={{ padding: "4px 12px", borderRadius: 8, border: `1px solid rgba(255,107,107,0.3)`, background: "rgba(255,107,107,0.08)", color: "#ff6b6b", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead }}>Deselect All</button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
            {ALL_COLORS.map(color => {
              const on = (p.colors || []).includes(color);
              return (
                <button key={color} onClick={() => toggleColor(color)} style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "5px 10px 5px 6px", borderRadius: 20, cursor: "pointer",
                  border: on ? "1px solid rgba(0,201,167,0.3)" : `1px solid rgba(255,255,255,0.06)`,
                  background: on ? "rgba(0,201,167,0.08)" : "rgba(255,255,255,0.02)", opacity: on ? 1 : 0.4, transition: "all 0.2s",
                }}>
                  <div style={{ width: 14, height: 14, borderRadius: "50%", background: FILAMENTS[color].hex, border: "1px solid rgba(255,255,255,0.15)", flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: on ? S.text : S.muted, whiteSpace: "nowrap" }}>{color}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Max colours customer picks */}
        <div style={sectionStyle}>
          <label style={labelStyle}>Customer picks how many colours?</label>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            {[1, 2, 3, 4].map(n => (
              <button key={n} onClick={() => set("maxColors", n)} style={{
                width: 42, height: 42, borderRadius: 10, cursor: "pointer", fontSize: 16, fontWeight: 700, fontFamily: S.fontMono,
                border: p.maxColors === n ? `2px solid ${S.purple}` : `1px solid ${S.border}`,
                background: p.maxColors === n ? "rgba(132,94,247,0.15)" : "rgba(255,255,255,0.02)",
                color: p.maxColors === n ? S.purple : S.dimmer,
              }}>{n}</button>
            ))}
          </div>
        </div>

        {/* Product Status */}
        <div style={sectionStyle}>
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
            Product Status
            <Tooltip position="right" text="Controls where this product is in its lifecycle:<br/><br/>📝 <strong>Draft</strong> — just imported, needs review<br/>✅ <strong>Approved</strong> — reviewed and approved<br/>🟢 <strong>Live</strong> — visible to customers<br/>⏸ <strong>Paused</strong> — hidden (seasonal etc.)<br/><br/>Only <strong>Live</strong> products appear in the shop.">
              <span style={{ fontSize: 11, color: S.purple, fontFamily: S.fontHead, cursor: "help", border: `1px solid ${S.purple}`, borderRadius: "50%", width: 16, height: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, opacity: 0.8 }}>?</span>
            </Tooltip>
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            {[
              { value: "draft", label: "📝 Draft", desc: "Imported, not reviewed", col: "#f59f00" },
              { value: "approved", label: "✅ Approved", desc: "Reviewed and approved", col: "#845ef7" },
              { value: "live", label: "🟢 Live", desc: "Visible in shop", col: "#51cf66" },
              { value: "paused", label: "⏸ Paused", desc: "Hidden — seasonal etc", col: "#868e96" },
            ].map(({ value, label, desc, col }) => {
              const active = (p.status || (p.available !== false ? "live" : "paused")) === value;
              return (
                <button key={value} onClick={() => { set("status", value); set("available", value === "live"); }} style={{ padding: "8px 14px", borderRadius: 12, border: active ? `2px solid ${col}` : `1px solid ${S.border}`, background: active ? `${col}18` : "rgba(255,255,255,0.02)", cursor: "pointer", textAlign: "left", transition: "all 0.2s", minWidth: 130 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: active ? col : S.muted, fontFamily: S.fontHead }}>{label}</div>
                  <div style={{ fontSize: 10, color: S.dimmer, marginTop: 2 }}>{desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Source Reference (admin only) */}
        <div style={sectionStyle}>
          <label style={labelStyle}>🔒 Source Reference (admin only — not shown to customers)</label>
          <input style={{ ...inputStyle, marginBottom: 8 }} value={p.sourceRef || ""} onChange={e => set("sourceRef", e.target.value)} placeholder="e.g. Kumiko Planter Large by Foxwood" />
          <label style={labelStyle}>🔗 Source URL (MakerWorld link — clickable in Order Book)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...inputStyle, flex: 1 }} value={p.sourceUrl || ""} onChange={e => set("sourceUrl", e.target.value)} placeholder="e.g. https://makerworld.com/en/models/569100" />
            {p.sourceUrl && <button onClick={() => window.open(p.sourceUrl, "_blank")} style={{ padding: "8px 14px", borderRadius: 10, border: `1px solid rgba(0,201,167,0.3)`, background: "rgba(0,201,167,0.08)", color: S.teal, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead, whiteSpace: "nowrap" }}>🔗 Open</button>}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: S.muted, marginBottom: 4, fontFamily: S.fontHead, fontWeight: 600 }}>CREATOR</div>
              <input style={inputStyle} value={p.creator || ""} onChange={e => set("creator", e.target.value)} placeholder="e.g. helloadorable" list="creator-datalist" />
              <datalist id="creator-datalist">{creators.map(c => <option key={c.id} value={c.name} />)}</datalist>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: S.muted, marginBottom: 4, fontFamily: S.fontHead, fontWeight: 600 }}>PHOTO SOURCE</div>
              <select style={{ ...inputStyle, cursor: "pointer" }} value={p.photoSource || "own"} onChange={e => set("photoSource", e.target.value)}>
                <option value="own">&#x2705; Own photo</option>
                <option value="makerworld">&#x26A0;&#xFE0F; MakerWorld</option>
              </select>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 12, justifyContent: "space-between", paddingTop: 16, borderTop: `1px solid ${S.border}` }}>
          <div>
            {!isNew && !confirmDelete && (
              <button onClick={() => setConfirmDelete(true)} style={{ padding: "10px 20px", borderRadius: 10, border: "1px solid rgba(255,107,107,0.3)", background: "rgba(255,107,107,0.08)", color: "#ff6b6b", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead }}>🗑 Delete Product</button>
            )}
            {confirmDelete && (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "#ff6b6b", fontWeight: 600 }}>Are you sure?</span>
                <button onClick={() => { onDelete(product.id); onCancel(); }} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#ff6b6b", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead }}>Yes, delete</button>
                <button onClick={() => setConfirmDelete(false)} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${S.border}`, background: "transparent", color: S.muted, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onCancel} style={{ padding: "10px 24px", borderRadius: 10, border: `1px solid ${S.border}`, background: "transparent", color: S.muted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}>Cancel</button>
            <button onClick={() => { if (p.name && p.price >= 0 && (p.colors || []).length > 0) onSave(p); }} style={{ padding: "10px 28px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${S.teal}, #00a88a)`, color: "#1a1a2e", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: S.fontHead, boxShadow: "0 4px 16px rgba(0,201,167,0.25)" }}>{isNew ? "Add Product" : "Save Changes"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   ORDER BOOK
   ═══════════════════════════════════════════════ */
function OrderBook({ orders, onUpdateOrder, products, onEditProduct, categoryMeta }) {
  const [elijahPhoto, setElijahPhoto] = useState(null);

  // Load Elijah's photo from Firebase on mount
  useEffect(() => {
    storageGet("elijah-photo").then(p => { if (p) setElijahPhoto(p); });
  }, []);

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file, 400, 0.75);
      setElijahPhoto(compressed);
      await storageSet("elijah-photo", compressed);
    } catch (err) { console.error("Photo upload failed:", err); }
    e.target.value = "";
  };

  // Sort: undespatched first (by date oldest first), then despatched at bottom
  const sorted = useMemo(() => {
    return [...orders].sort((a, b) => {
      const aD = a.status.despatched ? 1 : 0;
      const bD = b.status.despatched ? 1 : 0;
      if (aD !== bD) return aD - bD; // undespatched first
      return new Date(a.date) - new Date(b.date); // oldest first within group
    });
  }, [orders]);

  const stats = useMemo(() => ({
    total: orders.length,
    toProduce: orders.filter(o => !o.status.produced && !o.status.despatched).length,
    toLabel: orders.filter(o => o.status.produced && !o.status.labelPrinted && !o.status.despatched).length,
    toDispatch: orders.filter(o => o.status.produced && o.status.labelPrinted && !o.status.despatched).length,
    done: orders.filter(o => o.status.despatched).length,
    revenue: orders.reduce((s, o) => s + o.total, 0),
  }), [orders]);

  const toggleStatus = async (orderId, field) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const newStatus = { ...order.status, [field]: !order.status[field] };
    // Ensure labelPrinted field exists for older orders
    if (newStatus.labelPrinted === undefined) newStatus.labelPrinted = false;
    // Auto-logic: if despatching, also mark produced and labelled
    if (field === "despatched" && !order.status.despatched) { newStatus.produced = true; newStatus.labelPrinted = true; }
    // If labelling, also mark produced
    if (field === "labelPrinted" && !order.status.labelPrinted) newStatus.produced = true;
    // If un-producing, also un-label and un-despatch
    if (field === "produced" && order.status.produced) { newStatus.despatched = false; newStatus.labelPrinted = false; }
    // If un-labelling, also un-despatch
    if (field === "labelPrinted" && order.status.labelPrinted) newStatus.despatched = false;
    onUpdateOrder(orderId, newStatus);
  };

  const formatDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };

  const Checkbox = ({ checked, onChange, color = S.teal }) => (
    <button onClick={onChange} style={{
      width: 22, height: 22, borderRadius: 6, border: checked ? `2px solid ${color}` : `2px solid rgba(255,255,255,0.15)`,
      background: checked ? color : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
      transition: "all 0.2s", flexShrink: 0,
    }}>
      {checked && <span style={{ color: "#1a1a2e", fontSize: 13, fontWeight: 800, lineHeight: 1 }}>✓</span>}
    </button>
  );

  /* ── Label printing for Avery J8165 (2×4, 99.1mm × 67.7mm) ── */
  const printLabels = (order, isTest = false) => {
    const availProducts = (products || []).filter(p => p.available !== false);
    const orderItemIds = order.items.filter(i => !i.isTip).map(i => i.id);
    
    // Look up categories from products list (order items don't carry category)
    const orderCategories = order.items.filter(i => !i.isTip).map(i => {
      const prod = (products || []).find(p => p.id === i.id);
      return prod ? prod.category : (i.category || "");
    }).filter(Boolean);
    const mainCategory = orderCategories[0] || "";
    
    // Determine audience from order categories using categoryMeta
    const orderAudiences = orderCategories.map(c => (categoryMeta[c] || {}).audience).filter(Boolean);
    const orderAudience = orderAudiences[0] || null; // kids or adult
    
    // Filter available products by same audience for recommendations
    const audienceProducts = orderAudience
      ? availProducts.filter(p => (categoryMeta[p.category] || {}).audience === orderAudience)
      : availProducts;

    // Build deduplicated recommendation list
    const used = new Set(orderItemIds);
    const pickProduct = (candidates) => {
      const available = candidates.filter(p => !used.has(p.id));
      if (available.length === 0) return null;
      const pick = available[Math.floor(Math.random() * available.length)];
      used.add(pick.id);
      return pick;
    };

    // Label 4: Same category (within audience)
    const rangeProduct = pickProduct(audienceProducts.filter(p => p.category === mainCategory));
    // Label 5: Most popular (within audience, badged first, then any)
    const badged = audienceProducts.filter(p => p.badge === "Best Seller" || p.badge === "Popular");
    const popularProduct = pickProduct(badged.length > 0 ? badged : audienceProducts);
    // Label 6: Newest (within audience, highest ID)
    const newestSorted = [...audienceProducts].sort((a, b) => b.id - a.id);
    const newProduct1 = pickProduct(newestSorted);
    // Label 7: Second newest
    const newProduct2 = pickProduct(newestSorted);

    // Address
    const addr = order.shipping?.id === "collection"
      ? "🎒 School Collection"
      : [order.customer.address1, order.customer.address2, order.customer.city, order.customer.county, order.customer.postcode].filter(Boolean).join("\n");
    const isPostal = order.shipping?.id !== "collection";

    // Items list
    const itemsList = order.items.filter(i => !i.isTip).map(i => `${i.qty}× ${i.name} (${i.selectedColors.join(" + ")})`).join("\n");
    const tipItem = order.items.find(i => i.isTip);
    const orderDate = new Date(order.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

    // Elijah's photo
    const photoSrc = elijahPhoto || "";

    // Product label HTML helper
    const productLabel = (product, heading) => {
      if (!product) return `<div class="label"><div class="label-inner product-label"><div class="accent-bar"></div><div class="heading">${heading}</div><div class="sub" style="margin:auto;text-align:center;">More coming soon!</div><div class="url">etprintworld.com</div></div></div>`;
      const imgHtml = product.img ? `<img src="${product.img}" class="prod-img" />` : `<div class="prod-placeholder">📷</div>`;
      return `<div class="label"><div class="label-inner product-label">
        <div class="accent-bar"></div>
        <div class="heading">${heading}</div>
        <div class="prod-row">${imgHtml}<div class="prod-info">
          <div class="prod-name">${product.name}</div>
          <div class="prod-price">£${product.price.toFixed(2)}</div>
          <div class="prod-desc">${product.description || ""}</div>
        </div></div>
        <div class="url">etprintworld.com</div>
      </div></div>`;
    };

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Labels — ${order.id}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: A4; margin: 0; }
  body { width: 210mm; height: 297mm; font-family: 'DM Sans', sans-serif; }
  .sheet { width: 210mm; height: 297mm; padding: 13mm 5.9mm; display: grid; grid-template-columns: 99.1mm 99.1mm; grid-template-rows: repeat(4, 67.7mm); }
  .label { width: 99.1mm; height: 67.7mm; overflow: hidden; padding: 3mm; }
  .label-inner { width: 100%; height: 100%; border: 0.3mm dashed #ccc; border-radius: 3mm; padding: 4mm; display: flex; flex-direction: column; position: relative; overflow: hidden; }
  .heading { font-family: 'Space Grotesk', sans-serif; font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #00c9a7; margin-bottom: 2mm; }
  .sub { font-size: 8pt; color: #666; }
  .url { font-family: 'Space Grotesk', sans-serif; font-size: 6.5pt; color: #00c9a7; font-weight: 600; margin-top: auto; }

  /* Teal accent bar for product labels */
  .accent-bar { position: absolute; top: 0; left: 0; right: 0; height: 1.5mm; background: #00c9a7; border-radius: 3mm 3mm 0 0; }

  /* Label 1: Address */
  .address-label .from { font-size: 7.5pt; color: #00c9a7; font-weight: 700; font-family: 'Space Grotesk', sans-serif; margin-bottom: 3mm; }
  .address-label .to-name { font-size: 12pt; font-weight: 700; margin-bottom: 1.5mm; }
  .address-label .to-addr { font-size: 9.5pt; color: #333; white-space: pre-line; line-height: 1.5; }

  /* Label 2: Thank you — DARK MODE */
  .thankyou-label { background: #1a1a2e; border-radius: 3mm; text-align: center; justify-content: center; align-items: center; border: none !important; }
  .thankyou-label .emoji { font-size: 20pt; margin-bottom: 2mm; }
  .thankyou-label .msg { font-family: 'Space Grotesk', sans-serif; font-size: 12pt; font-weight: 800; color: #ffffff; margin-bottom: 2mm; }
  .thankyou-label .submsg { font-size: 8.5pt; color: #ffffff; font-style: italic; line-height: 1.5; max-width: 72mm; }
  .thankyou-label .banned-tagline { font-size: 8pt; color: #ffffff; line-height: 1.4; margin-top: 2mm; max-width: 72mm; }
  .thankyou-label .banned-tagline b { color: #00c9a7; font-weight: 800; text-transform: uppercase; }
  .thankyou-label .url { color: #00c9a7; background: rgba(255,255,255,0.92); padding: 0.3mm 2mm; border-radius: 1mm; display: inline-block; }

  /* Label 3: Order details */
  .order-label .ref { font-family: 'Space Grotesk', sans-serif; font-size: 10pt; font-weight: 800; color: #00c9a7; margin-bottom: 1mm; }
  .order-label .date { font-size: 7pt; color: #999; margin-bottom: 2mm; }
  .order-label .items { font-size: 7.5pt; color: #333; line-height: 1.5; white-space: pre-line; flex: 1; }
  .order-label .total { font-family: 'Space Grotesk', sans-serif; font-size: 9pt; font-weight: 800; color: #1a1a2e; margin-top: 1mm; }

  /* Product labels */
  .product-label { padding-top: 5.5mm; }
  .product-label .prod-row { display: flex; gap: 3mm; flex: 1; align-items: center; }
  .product-label .prod-img { width: 38mm; height: 38mm; object-fit: contain; border-radius: 3mm; background: #f5f5f5; }
  .product-label .prod-placeholder { width: 38mm; height: 38mm; border-radius: 3mm; background: #f0f0f0; display: flex; align-items: center; justify-content: center; font-size: 18pt; }
  .product-label .prod-name { font-family: 'Space Grotesk', sans-serif; font-size: 9pt; font-weight: 700; color: #1a1a2e; margin-bottom: 0.5mm; }
  .product-label .prod-price { font-size: 10pt; font-weight: 800; color: #00c9a7; font-family: 'Space Grotesk', sans-serif; margin-bottom: 0.5mm; }
  .product-label .prod-desc { font-size: 6.5pt; color: #888; line-height: 1.35; }

  /* Label 8: Elijah — DARK MODE with full-bleed photo */
  .elijah-label { background: #1a1a2e; border-radius: 3mm; border: none !important; overflow: hidden; padding: 0 !important; position: relative; }
  .elijah-label .photo-bg { width: 100%; height: 100%; object-fit: cover; border-radius: 3mm; display: block; }
  .elijah-label .overlay { position: absolute; bottom: 0; left: 0; right: 0; padding: 2.5mm 3mm; background: linear-gradient(transparent, rgba(26,26,46,0.6) 25%, rgba(26,26,46,0.95)); display: flex; justify-content: space-between; align-items: flex-end; text-shadow: 0 1px 3px rgba(0,0,0,0.6); }
  .elijah-label .tagline { font-size: 8pt; color: #ffffff; font-style: italic; line-height: 1.3; font-family: 'DM Sans', sans-serif; flex: 1; }
  .elijah-label .tagline b { color: #00c9a7; font-weight: 800; font-style: normal; text-transform: uppercase; background: rgba(255,255,255,0.92); padding: 0.3mm 1.5mm; border-radius: 1mm; text-shadow: none; }
  .elijah-label .url { color: #00c9a7; font-size: 6.5pt; font-family: 'Space Grotesk', sans-serif; font-weight: 600; margin-left: 3mm; white-space: nowrap; margin-top: 0; background: rgba(255,255,255,0.92); padding: 0.3mm 2mm; border-radius: 1mm; text-shadow: none; }
  .elijah-no-photo { font-size: 18pt; margin-bottom: 2mm; }

  @media print {
    .label-inner { border: none !important; }
    .thankyou-label, .elijah-label { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style></head><body>
<div class="sheet">
  <!-- Label 1: Shipping Address -->
  <div class="label"><div class="label-inner address-label">
    <div class="from">FROM: etprintworld.com</div>
    <div class="heading">DELIVER TO</div>
    <div class="to-name">${order.customer.name}</div>
    <div class="to-addr">${isPostal ? addr : "🎒 School Collection"}</div>
  </div></div>

  <!-- Label 2: Thank You (dark mode) -->
  <div class="label"><div class="label-inner thankyou-label">
    <div class="emoji">🧡</div>
    <div class="msg">Thanks for your order!</div>
    <div class="submsg">I got <b style="color:#00c9a7;font-weight:800;text-transform:uppercase;background:rgba(255,255,255,0.92);padding:0.3mm 1.5mm;border-radius:1mm;">BANNED</b> from selling 3D prints at school,<br/>so I built this website instead!</div>
    <div class="url" style="margin-top: 2mm;">etprintworld.com</div>
    <div class="banned-tagline">Every product is 3D printed by Elijah, age 10, on his Bambu Lab P1S right here in Wales.</div>
  </div></div>

  <!-- Label 3: Order Details -->
  <div class="label"><div class="label-inner order-label">
    <div class="heading">YOUR ORDER</div>
    <div class="ref">${order.id}</div>
    <div class="date">${orderDate}</div>
    <div class="items">${itemsList}${tipItem ? "\n🧡 Tip: £" + tipItem.price.toFixed(2) : ""}</div>
    <div class="total">Total: £${order.total.toFixed(2)}</div>
  </div></div>

  <!-- Label 4: You might also like (same category) -->
  ${productLabel(rangeProduct, "YOU MIGHT ALSO LIKE")}

  <!-- Label 5: Most Popular -->
  ${productLabel(popularProduct, "⭐ OUR MOST POPULAR")}

  <!-- Label 6: Just Arrived -->
  ${productLabel(newProduct1, "🆕 JUST ARRIVED")}

  <!-- Label 7: Also New -->
  ${productLabel(newProduct2, "🆕 ALSO NEW")}

  <!-- Label 8: Elijah / Brand (full-bleed photo) -->
  <div class="label"><div class="label-inner elijah-label">
    ${photoSrc ? `<img src="${photoSrc}" class="photo-bg" />
    <div class="overlay">
      <span class="tagline">I got <b>BANNED</b> from selling 3D prints at school — so I built this website instead.</span>
      <span class="url">etprintworld.com</span>
    </div>` : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:4mm;">
    <div class="elijah-no-photo">⬡</div>
    <div style="font-family:'Space Grotesk',sans-serif;font-size:10pt;font-weight:800;color:#fff;margin-bottom:1mm;">Elijah's Print World</div>
    <div class="tagline" style="max-width:70mm;margin-bottom:2mm;text-align:center;color:#ffffff;">I got <b>BANNED</b> from selling 3D prints at school — so I built this website instead.</div>
    <div style="font-size:6.5pt;color:#00c9a7;font-weight:600;background:rgba(255,255,255,0.92);padding:0.3mm 2mm;border-radius:1mm;display:inline-block;">etprintworld.com</div>
    </div>`}
  </div></div>
</div>
<script>window.onload = () => { window.print(); }</script>
</body></html>`;

    const win = window.open("", "_blank", "width=800,height=1000");
    if (win) { win.document.write(html); win.document.close(); }

    // Mark as label printed (skip for test prints)
    if (!isTest && !order.status.labelPrinted) {
      const newStatus = { ...order.status, labelPrinted: true };
      onUpdateOrder(order.id, newStatus);
    }
  };

  if (orders.length === 0) return (
    <div style={{ textAlign: "center", padding: "80px 24px", color: S.dimmer }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>📦</div>
      <p style={{ fontSize: 16, fontFamily: S.fontHead, fontWeight: 600 }}>No orders yet</p>
      <p style={{ fontSize: 13, marginTop: 8 }}>Orders will appear here as customers check out</p>
    </div>
  );

  return (
    <div>
      {/* Stats bar */}
      <div className="ep-stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "To Make", value: stats.toProduce, color: "#ff6b35", icon: "🔨" },
          { label: "To Label", value: stats.toLabel, color: "#f59f00", icon: "🏷️" },
          { label: "To Send", value: stats.toDispatch, color: S.purple, icon: "📦" },
          { label: "Complete", value: stats.done, color: S.teal, icon: "✅" },
          { label: "Revenue", value: `£${stats.revenue.toFixed(2)}`, color: "#ffd43b", icon: "💰" },
        ].map((s, i) => (
          <div key={i} style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, fontFamily: S.fontMono }}>{s.value}</div>
            <div style={{ fontSize: 11, color: S.dimmer, fontFamily: S.fontHead, textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Batch print & test buttons */}
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {stats.toLabel > 0 && (
          <button onClick={() => {
            const unlabelled = sorted.filter(o => o.status.produced && !o.status.labelPrinted && !o.status.despatched);
            unlabelled.forEach(o => printLabels(o));
          }} style={{
            padding: "10px 20px", borderRadius: 10, border: "none", cursor: "pointer",
            background: "linear-gradient(135deg, #f59f00, #f08c00)", color: "#1a1a2e",
            fontSize: 13, fontWeight: 700, fontFamily: S.fontHead, display: "flex", alignItems: "center", gap: 8,
          }}>🏷️ Print All Labels ({stats.toLabel})</button>
        )}
        {stats.toLabel > 0 && (
          <span style={{ fontSize: 11, color: S.dimmer }}>Prints one sheet per order — {stats.toLabel} {stats.toLabel === 1 ? "sheet" : "sheets"} total</span>
        )}
        <button onClick={() => {
          const testOrder = {
            id: "EP-TEST123",
            date: new Date().toISOString(),
            customer: { name: "Test Customer", email: "test@example.com", phone: "07700 900000", address1: "42 Sample Street", address2: "", city: "Wrexham", county: "Clwyd", postcode: "LL11 1AA" },
            shipping: { id: "standard", name: "Royal Mail Tracked 48" },
            items: [{ id: 999, name: "Test Product", qty: 2, selectedColors: ["Matte Charcoal", "Turquoise"], price: 4.50, category: "Key Rings", isTip: false }],
            total: 12.49,
            status: { paid: true, produced: true, labelPrinted: false, despatched: false },
          };
          printLabels(testOrder, true);
        }} style={{
          padding: "10px 20px", borderRadius: 10, border: `1px solid ${S.border}`, cursor: "pointer",
          background: "rgba(255,255,255,0.03)", color: S.muted,
          fontSize: 13, fontWeight: 600, fontFamily: S.fontHead, display: "flex", alignItems: "center", gap: 8, marginLeft: stats.toLabel > 0 ? "auto" : 0,
        }}>🖨️ Test Print</button>
      </div>

      {/* Elijah's photo for labels */}
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12, background: S.card, border: `1px solid ${S.border}`, borderRadius: 12, padding: "10px 16px" }}>
        <label style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
          {elijahPhoto ? (
            <img src={elijahPhoto} alt="Elijah" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover" }} />
          ) : (
            <div style={{ width: 40, height: 40, borderRadius: 8, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📷</div>
          )}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: S.text, fontFamily: S.fontHead }}>{elijahPhoto ? "Elijah's photo ✓" : "Upload Elijah's photo"}</div>
            <div style={{ fontSize: 10, color: S.dimmer }}>Used on the brand label (label 8)</div>
          </div>
          <input type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoUpload} />
        </label>
        {elijahPhoto && (
          <button onClick={async () => { setElijahPhoto(null); await storageSet("elijah-photo", ""); }} style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 8, border: `1px solid ${S.border}`, background: "transparent", color: S.dimmer, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}>Remove</button>
        )}
      </div>

      {/* Column headers */}
      <div className="ep-order-header" style={{ display: "grid", gridTemplateColumns: "1fr 70px 70px 70px 70px", gap: 8, padding: "0 16px 8px", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: S.dimmer, fontFamily: S.fontHead, textTransform: "uppercase", letterSpacing: "0.5px" }}>Order</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: S.dimmer, fontFamily: S.fontHead, textTransform: "uppercase", letterSpacing: "0.5px", textAlign: "center" }}>Paid</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: S.dimmer, fontFamily: S.fontHead, textTransform: "uppercase", letterSpacing: "0.5px", textAlign: "center" }}>Made</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: S.dimmer, fontFamily: S.fontHead, textTransform: "uppercase", letterSpacing: "0.5px", textAlign: "center" }}>Label</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: S.dimmer, fontFamily: S.fontHead, textTransform: "uppercase", letterSpacing: "0.5px", textAlign: "center" }}>Sent</span>
      </div>

      {/* Order rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sorted.map(order => {
          const allDone = order.status.despatched;
          return (
            <div key={order.id} className="ep-order-row" style={{
              background: S.card, border: `1px solid ${S.border}`, borderRadius: 14, padding: "14px 16px",
              opacity: allDone ? 0.45 : 1, transition: "opacity 0.3s",
              display: "grid", gridTemplateColumns: "1fr 70px 70px 70px 70px", gap: 8, alignItems: "center",
            }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: S.teal, fontFamily: S.fontMono }}>{order.id}</span>
                  <span style={{ fontSize: 11, color: S.dimmer }}>{formatDate(order.date)}</span>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: order.shipping.id === "collection" ? "rgba(0,201,167,0.1)" : "rgba(132,94,247,0.1)", color: order.shipping.id === "collection" ? S.teal : S.purple, fontWeight: 600, fontFamily: S.fontHead }}>{order.shipping.id === "collection" ? "🎒 Collection" : `📦 ${order.shipping.name}`}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: S.text, fontFamily: S.fontHead, marginBottom: 2 }}>{order.customer.name}</div>
                <div style={{ fontSize: 11, color: S.muted, marginBottom: 6 }}>{order.customer.email}{order.customer.phone ? ` · ${order.customer.phone}` : ""}</div>
                {order.shipping.id !== "collection" && order.customer.address1 && (
                  <div style={{ fontSize: 11, color: S.dimmer, marginBottom: 6 }}>{[order.customer.address1, order.customer.address2, order.customer.city, order.customer.county, order.customer.postcode].filter(Boolean).join(", ")}</div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {order.items.map((item, i) => (
                    <div key={i} style={{ fontSize: 12, color: S.muted, display: "flex", alignItems: "center", gap: 6 }}>
                      {item.isTip ? (
                        <span style={{ color: S.teal, fontWeight: 600 }}>🧡 Tip: £{item.price.toFixed(2)}</span>
                      ) : (<>
                        <span style={{ fontWeight: 600, color: S.text }}>{item.qty}×</span>
                        <span onClick={() => { const prod = products.find(p => p.id === item.id); if (prod && onEditProduct) onEditProduct(prod); }} style={{ cursor: "pointer", color: S.text, textDecoration: "underline", textDecorationColor: "rgba(255,255,255,0.15)", textUnderlineOffset: 2 }}>{item.name}</span>
                        <span style={{ fontSize: 10, color: S.dimmer }}>({item.selectedColors.join(" + ")})</span>
                        {(() => { const prod = products.find(p => p.id === item.id); if (!prod?.sourceRef) return null; return prod.sourceUrl ? <a href={prod.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#f59f00", background: "rgba(245,159,0,0.1)", padding: "1px 6px", borderRadius: 6, fontFamily: S.fontHead, fontWeight: 600, marginLeft: 2, textDecoration: "none" }} title={`Open: ${prod.sourceRef}`}>🔗 {prod.sourceRef}</a> : <span style={{ fontSize: 9, color: "#f59f00", background: "rgba(245,159,0,0.1)", padding: "1px 6px", borderRadius: 6, fontFamily: S.fontHead, fontWeight: 600, marginLeft: 2 }} title={prod.sourceRef}>🔒 {prod.sourceRef}</span>; })()}
                      </>)}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: S.teal, fontFamily: S.fontMono, marginTop: 6 }}>£{order.total.toFixed(2)}</div>
              </div>
              <div className="ep-order-check" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6 }}>
                <Checkbox checked={order.status.paid} onChange={() => toggleStatus(order.id, "paid")} color={S.teal} />
                <span className="ep-check-label" style={{ display: "none", fontSize: 11, color: S.teal, fontWeight: 600, fontFamily: S.fontHead }}>Paid</span>
              </div>
              <div className="ep-order-check" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6 }}>
                <Checkbox checked={order.status.produced} onChange={() => toggleStatus(order.id, "produced")} color="#ff6b35" />
                <span className="ep-check-label" style={{ display: "none", fontSize: 11, color: "#ff6b35", fontWeight: 600, fontFamily: S.fontHead }}>Made</span>
              </div>
              <div className="ep-order-check" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6 }}>
                <Tooltip position="left" text="Prints an Avery J8165 label sheet (8 labels/A4) on your Canon MX535.<br/><br/>Opens a print-ready page automatically. Also marks the order as Label Printed.">
                <button onClick={() => printLabels(order)} title="Print label sheet" style={{
                  width: 22, height: 22, borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  border: (order.status.labelPrinted || order.status.despatched) ? "2px solid #f59f00" : "2px solid rgba(255,255,255,0.15)",
                  background: (order.status.labelPrinted || order.status.despatched) ? "#f59f00" : "transparent", transition: "all 0.2s", flexShrink: 0, padding: 0, fontSize: 11,
                }}>{(order.status.labelPrinted || order.status.despatched) ? <span style={{ color: "#1a1a2e", fontSize: 13, fontWeight: 800, lineHeight: 1 }}>✓</span> : "🏷️"}</button>
                </Tooltip>
                <span className="ep-check-label" style={{ display: "none", fontSize: 11, color: "#f59f00", fontWeight: 600, fontFamily: S.fontHead }}>Label</span>
              </div>
              <div className="ep-order-check" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6 }}>
                <Checkbox checked={order.status.despatched} onChange={() => toggleStatus(order.id, "despatched")} color={S.purple} />
                <span className="ep-check-label" style={{ display: "none", fontSize: 11, color: S.purple, fontWeight: 600, fontFamily: S.fontHead }}>Sent</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   ADMIN PANEL
   ═══════════════════════════════════════════════ */
function AdminPanel({ products, onSave, onLogout, orders, onUpdateOrders, onSaveFilaments, onSaveCategories, categoryMeta, onSaveCategoryMeta, autoBadges }) {
  const [filter, setFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [editing, setEditing] = useState(null);
  const [addingNew, setAddingNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [adminTab, setAdminTab] = useState("orders");
  const [creators, setCreators] = useState([]);
  const [creatorsDebug, setCreatorsDebug] = useState("⏳ Loading creators...");
  const [exporting, setExporting] = useState(false);

  /* ── Load creators from Firebase on mount ── */
  useEffect(() => {
    (async () => {
      try {
        setCreatorsDebug("Step 1: calling storageGet...");
        const r = await storageGet("creators-v1");
        setCreatorsDebug("Step 2: storageGet returned " + (r ? r.length + " chars" : "null"));
        if (!r) { setCreatorsDebug("📭 No creators document in Firebase. Import CSV to start."); return; }
        const parsed = JSON.parse(r);
        setCreators(parsed);
        setCreatorsDebug("✅ Loaded " + parsed.length + " creators from Firebase");
      } catch (e) {
        setCreatorsDebug("❌ Error: " + (e && e.message ? e.message : String(e)));
      }
    })();
  }, []);

  /* ── Export Data to Excel ── */
  const exportData = async () => {
    setExporting(true);
    try {
      if (!window.XLSX) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const XLSX = window.XLSX;
      const wb = XLSX.utils.book_new();

      /* Products tab */
      const prodRows = products.map(p => ({
        "ID": p.id,
        "Name": p.name,
        "Category": p.category,
        "Price (£)": p.price,
        "Weight (g)": p.grams,
        "Print Time": p.printTime,
        "Description": p.description,
        "Available": p.available ? "Yes" : "No",
        "Max Colours": p.maxColors,
        "Colours": (p.colors || []).join(", "),
        "Badge": p.badge || "",
        "Source Ref": p.sourceRef || "",
        "Source URL": p.sourceUrl || "",
        "Added Date": p.addedDate || "",
        "── LICENCE AUDIT ──": "",
        "Creator": p.creator || "",
        "Licence Type": "",
        "Commercial Available?": "",
        "Monthly Cost": "",
        "Action Required": "",
        "Notes": "",
      }));
      const wsProd = XLSX.utils.json_to_sheet(prodRows);
      wsProd["!cols"] = [
        { wch: 8 }, { wch: 28 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
        { wch: 50 }, { wch: 10 }, { wch: 12 }, { wch: 60 }, { wch: 12 },
        { wch: 30 }, { wch: 50 }, { wch: 20 }, { wch: 20 },
        { wch: 20 }, { wch: 18 }, { wch: 22 }, { wch: 14 }, { wch: 20 }, { wch: 30 },
      ];
      XLSX.utils.book_append_sheet(wb, wsProd, "Products");

      /* Orders tab */
      const orderRows = orders.map(o => ({
        "Order ID": o.id,
        "Date": o.date ? new Date(o.date).toLocaleDateString("en-GB") : "",
        "Customer": o.customer?.name || "",
        "Email": o.customer?.email || "",
        "Phone": o.customer?.phone || "",
        "Address": [o.customer?.address1, o.customer?.address2, o.customer?.city, o.customer?.county, o.customer?.postcode].filter(Boolean).join(", "),
        "Shipping": o.shipping?.name || "",
        "Items": (o.items || []).map(i => `${i.qty}x ${i.name} (${(i.selectedColors || []).join("/")})`).join("; "),
        "Total (£)": o.total,
        "Paid": o.status?.paid ? "Yes" : "No",
        "Produced": o.status?.produced ? "Yes" : "No",
        "Label Printed": o.status?.labelPrinted ? "Yes" : "No",
        "Despatched": o.status?.despatched ? "Yes" : "No",
      }));
      const wsOrd = XLSX.utils.json_to_sheet(orderRows);
      wsOrd["!cols"] = [
        { wch: 14 }, { wch: 12 }, { wch: 20 }, { wch: 28 }, { wch: 16 }, { wch: 50 },
        { wch: 22 }, { wch: 60 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 12 },
      ];
      XLSX.utils.book_append_sheet(wb, wsOrd, "Orders");

      /* Colours tab */
      const colourRows = ALL_COLORS.map(name => {
        const f = FILAMENTS[name];
        return {
          "Colour Name": name,
          "Hex": f?.hex || "",
          "Type": f?.type || "",
          "Premium": f?.premium ? "Yes" : "No",
          "Used By Products": products.filter(p => (p.colors || []).includes(name)).length,
        };
      });
      const wsCol = XLSX.utils.json_to_sheet(colourRows);
      wsCol["!cols"] = [{ wch: 22 }, { wch: 50 }, { wch: 18 }, { wch: 10 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, wsCol, "Colours");

      /* Categories tab */
      const catRows = categories.map(cat => ({
        "Category": cat,
        "Product Count": products.filter(p => p.category === cat).length,
        "Products": products.filter(p => p.category === cat).map(p => p.name).join(", "),
      }));
      const wsCat = XLSX.utils.json_to_sheet(catRows);
      wsCat["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 80 }];
      XLSX.utils.book_append_sheet(wb, wsCat, "Categories");

      /* Download */
      const date = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `ET-Print-World-Export-${date}.xlsx`);
      setSavedMsg("Exported!"); setTimeout(() => setSavedMsg(""), 3000);
    } catch (err) {
      console.error("Export failed:", err);
      alert("Export failed: " + err.message);
    }
    setExporting(false);
  };
  const [newColourName, setNewColourName] = useState("");
  const [newColourHex, setNewColourHex] = useState("#888888");
  const [newColourType, setNewColourType] = useState("PLA Basic");
  const [newColourPremium, setNewColourPremium] = useState(false);
 const [editingColour, setEditingColour] = useState(null);
  const [newCatName, setNewCatName] = useState("");
  const [editingCat, setEditingCat] = useState(null);
  const [editCatName, setEditCatName] = useState("");
  const [importingJSON, setImportingJSON] = useState(false);
  const [importText, setImportText] = useState("");
  const [migratingImages, setMigratingImages] = useState(false);
  const [migrationMsg, setMigrationMsg] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerLoading, setScannerLoading] = useState(false);
  const [scannerResult, setScannerResult] = useState(null);
  const [scannerImage, setScannerImage] = useState(null);
  const [scannerMode, setScannerMode] = useState("match");

  /* ── Filament Scanner ── */
  const analyseFilament = async (base64Data, mediaType) => {
    setScannerLoading(true);
    setScannerResult(null);
    const existingColours = Object.entries(FILAMENTS).map(([name, f]) => ({
      name, hex: f.hex, type: f.type, premium: !!f.premium,
    }));
    const modeInstruction = scannerMode === "match"
      ? `This image is a FILAMENT SPOOL. Use MATCH mode — identify the filament colour and match it against the existing library.`
      : `This image is FILAMENT PACKAGING/BOX. Use SCAN mode — read all details from the packaging.`;
    try {
      const response = await fetch("/api/scan-filament", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64Data, mediaType, existingColours, modeInstruction }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Scan failed");
      const text = data.content.map(i => i.text || "").join("\n");
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setScannerResult(parsed);
    } catch (err) {
      console.error("Filament scan error:", err);
      setScannerResult({ error: "Analysis failed — try again or use a different photo." });
    }
    setScannerLoading(false);
  };

  const handleScanUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const max = 800;
        let w = img.width, h = img.height;
        if (w > max || h > max) {
          if (w > h) { h = Math.round(h * max / w); w = max; }
          else { w = Math.round(w * max / h); h = max; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL("image/jpeg", 0.8);
        const base64 = compressed.split(",")[1];
        setScannerImage(compressed);
        analyseFilament(base64, "image/jpeg");
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };



  const newProduct = { id: 0, name: "", price: 0, category: categories[0] || "Key Rings", description: "", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "1 hr", grams: 10, available: true, status: "live", maxColors: 1, addedDate: new Date().toISOString(), sourceRef: "", sourceUrl: "", creator: "", photoSource: "own" };

  const pendingOrders = orders.filter(o => !o.status.despatched).length;

  const displayCategories = ["All", ...categories];
  const STATUS_OPTIONS = ["All", "draft", "approved", "live", "paused"];
  const STATUS_LABELS = { All: "All", draft: "📝 Draft", approved: "✅ Approved", live: "🟢 Live", paused: "⏸ Paused" };
  const STATUS_COLORS = { All: S.muted, draft: "#f59f00", approved: "#845ef7", live: "#51cf66", paused: "#868e96" };
  const getProductStatus = p => { const s = p.status || (p.available !== false ? "live" : "paused"); return s === "photo_needed" ? "approved" : s === "removed" ? "paused" : s; };
  const draftCount = products.filter(p => getProductStatus(p) === "draft").length;
  const filteredByStatus = statusFilter === "All" ? products : products.filter(p => getProductStatus(p) === statusFilter);
  const filtered = filter === "All" ? filteredByStatus : filteredByStatus.filter(p => p.category === filter);

  const migrateImages = async () => {
    const base64Products = products.filter(p => p.img && p.img.startsWith("data:"));
    if (base64Products.length === 0) { setMigrationMsg("✅ No base64 images to migrate — all clean!"); setTimeout(() => setMigrationMsg(""), 3000); return; }
    if (!window.confirm(`Migrate ${base64Products.length} product image${base64Products.length !== 1 ? "s" : ""} to Firebase Storage? This will shrink your database and fix save issues.`)) return;
    setMigratingImages(true);
    setMigrationMsg(`⏳ Migrating 0/${base64Products.length}...`);
    let migrated = 0;
    let failed = 0;
    const updated = [...products];
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].img && updated[i].img.startsWith("data:")) {
        try {
          const url = await uploadProductImage(updated[i].id, updated[i].img);
          if (url !== updated[i].img) {
            updated[i] = { ...updated[i], img: url };
            migrated++;
          } else { failed++; }
        } catch (e) { failed++; console.error("Migration failed for product " + updated[i].id, e); }
        setMigrationMsg(`⏳ Migrating ${migrated + failed}/${base64Products.length}...`);
      }
    }
    await onSave(updated);
    setMigratingImages(false);
    setMigrationMsg(`✅ Migrated ${migrated} image${migrated !== 1 ? "s" : ""}${failed > 0 ? `, ${failed} failed` : ""}`);
    setTimeout(() => setMigrationMsg(""), 5000);
  };

  const handleSaveProduct = async (updated) => {
    setSaving(true);
    let next;
    if (addingNew) {
      const maxId = products.reduce((m, p) => Math.max(m, p.id), 0);
      next = [...products, { ...updated, id: maxId + 1 }];
    } else {
      next = products.map(p => p.id === updated.id ? updated : p);
    }
    await onSave(next);
    setEditing(null); setAddingNew(false); setSaving(false);
    setSavedMsg("Saved!"); setTimeout(() => setSavedMsg(""), 2000);
  };

  const handleDelete = async (id) => {
    setSaving(true);
    await onSave(products.filter(p => p.id !== id));
    setSaving(false);
    setSavedMsg("Deleted!"); setTimeout(() => setSavedMsg(""), 2000);
  };


  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px 80px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 800, fontFamily: S.fontHead, color: S.text, margin: 0 }}>🔧 Admin Panel</h2>
          <p style={{ fontSize: 13, color: S.muted, margin: "4px 0 0" }}>{products.filter(p => p.available).length} products live{draftCount > 0 ? ` · ${draftCount} draft` : ""} · {orders.length} orders</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {savedMsg && <span style={{ color: S.teal, fontWeight: 700, fontFamily: S.fontHead, fontSize: 14 }}>✓ {savedMsg}</span>}
          <Tooltip position="bottom" text="Downloads a full Excel spreadsheet (.xlsx) with four tabs: Products, Orders, Colours, and Categories.<br/><br/>Useful for records, the licence audit tracker, or sharing data with Claude for analysis.">
            <button onClick={exportData} disabled={exporting} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid rgba(0,201,167,0.3)`, background: "rgba(0,201,167,0.08)", color: S.teal, fontSize: 14, fontWeight: 700, cursor: exporting ? "wait" : "pointer", fontFamily: S.fontHead, opacity: exporting ? 0.5 : 1 }}>{exporting ? "⏳ Exporting…" : "📊 Export Data"}</button>
          </Tooltip>
          <span style={{ fontSize: 10, color: S.dimmer, fontFamily: S.fontMono, opacity: 0.6 }}>{APP_VERSION}</span>
          <button onClick={onLogout} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.muted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}>Log Out</button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "rgba(255,255,255,0.02)", borderRadius: 12, padding: 4, border: `1px solid ${S.border}` }}>
        {[
          { id: "orders", label: "📦 Order Book", count: pendingOrders },
          { id: "products", label: "🏷️ Products", count: products.length },
{ id: "colours", label: "🎨 Colours", count: ALL_COLORS.length },
          { id: "categories", label: "📂 Categories", count: categories.length },
          { id: "creators", label: "👤 Creators", count: creators.length },
        ].map(tab => (

           
          <button key={tab.id} onClick={() => setAdminTab(tab.id)} style={{
            flex: 1, padding: "12px 16px", borderRadius: 10, border: "none", cursor: "pointer",
            background: adminTab === tab.id ? "rgba(0,201,167,0.1)" : "transparent",
            color: adminTab === tab.id ? S.teal : S.muted,
            fontSize: 14, fontWeight: 700, fontFamily: S.fontHead, transition: "all 0.2s",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            {tab.label}
            {tab.count > 0 && (
              <span style={{
                fontSize: 11, fontFamily: S.fontMono, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                background: adminTab === tab.id ? S.teal : "rgba(255,255,255,0.08)",
                color: adminTab === tab.id ? "#1a1a2e" : S.dimmer,
              }}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Orders tab */}
      {adminTab === "orders" && (
        <OrderBook orders={orders} onUpdateOrder={onUpdateOrders} products={products} onEditProduct={(product) => setEditing(product)} categoryMeta={categoryMeta} />
      )}

      {/* Products tab */}
      {adminTab === "products" && (<>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16, gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {migrationMsg && <span style={{ fontSize: 12, fontFamily: S.fontHead, color: migrationMsg.startsWith("✅") ? "#51cf66" : S.teal, fontWeight: 600 }}>{migrationMsg}</span>}
          {products.some(p => p.img && p.img.startsWith("data:")) && (
            <Tooltip position="bottom" text="Move product photos from database to Firebase Storage. This fixes save failures caused by oversized database documents and speeds up the site.">
              <button onClick={migrateImages} disabled={migratingImages} style={{ padding: "10px 20px", borderRadius: 10, border: "1px solid rgba(255,165,0,0.3)", background: "rgba(255,165,0,0.08)", color: "#ffa500", fontSize: 14, fontWeight: 700, cursor: migratingImages ? "wait" : "pointer", fontFamily: S.fontHead, opacity: migratingImages ? 0.5 : 1 }}>{migratingImages ? "⏳ Migrating…" : "🖼️ Migrate Images"}</button>
            </Tooltip>
          )}
          <Tooltip position="bottom" text="Paste a JSON block or array generated by Claude to import one or many products.<br/><br/><strong>Process:</strong> Claude generates JSON → copy it → click here → paste → Import Product(s) → then upload photos in the product editor.">
            <button onClick={() => { setImportText(""); setImportingJSON(true); }} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.teal, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead }}>📋 Import JSON</button>
          </Tooltip>
          <Tooltip position="bottom" text="Manually create a new product from scratch. Use <strong>Import JSON</strong> instead if Claude has generated a product for you — it's much faster.">
            <button onClick={() => setAddingNew(true)} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${S.purple}, #6c3ce0)`, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead, boxShadow: "0 4px 16px rgba(132,94,247,0.3)" }}>+ Add Product</button>
          </Tooltip>
        </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: S.dimmer, fontFamily: S.fontHead, fontWeight: 600, marginRight: 4 }}>STATUS</span>
        {STATUS_OPTIONS.map(s => {
          const count = s === "All" ? products.length : products.filter(p => getProductStatus(p) === s).length;
          const col = STATUS_COLORS[s];
          const active = statusFilter === s;
          return (
            <button key={s} onClick={() => setStatusFilter(s)} style={{ padding: "5px 12px", borderRadius: 20, border: active ? `1.5px solid ${col}` : `1px solid ${S.border}`, background: active ? `${col}18` : "rgba(255,255,255,0.02)", color: active ? col : S.muted, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead, display: "flex", alignItems: "center", gap: 5 }}>
              {STATUS_LABELS[s]}{count > 0 && s !== "All" && <span style={{ background: active ? `${col}30` : "rgba(255,255,255,0.06)", borderRadius: 8, padding: "0 5px", fontSize: 10 }}>{count}</span>}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
        {displayCategories.map(cat => (
          <button key={cat} onClick={() => setFilter(cat)} style={{ padding: "7px 14px", borderRadius: 20, border: filter === cat ? `1.5px solid ${S.purple}` : `1px solid ${S.border}`, background: filter === cat ? "rgba(132,94,247,0.1)" : "rgba(255,255,255,0.02)", color: filter === cat ? S.purple : S.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}>{cat}</button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map(product => (
          <button key={product.id} onClick={() => setEditing(product)} style={{
            display: "flex", gap: 14, alignItems: "center", padding: "14px 16px", borderRadius: 14, cursor: "pointer", textAlign: "left", width: "100%",
            background: S.card, border: `1px solid ${S.border}`, opacity: product.available ? 1 : 0.45, transition: "all 0.2s",
          }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0, overflow: "hidden", background: "linear-gradient(135deg, rgba(0,201,167,0.08), rgba(132,94,247,0.08))", display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${S.border}` }}>
              {product.img ? <img src={product.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 22 }}>{product.emoji || "📷"}</span>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: S.text, fontFamily: S.fontHead }}>{product.name}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: S.teal, fontFamily: S.fontMono }}>£{product.price.toFixed(2)}</span>
                <span style={{ fontSize: 11, color: S.dimmer }}>{product.grams}g</span>
                {autoBadges[product.id] && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "rgba(0,201,167,0.1)", color: S.teal, fontWeight: 600, fontFamily: S.fontHead }}>{autoBadges[product.id]}</span>}
                {(() => { const st = getProductStatus(product); if (st === "live") return null; const col = STATUS_COLORS[st]; return <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: `${col}18`, color: col, fontWeight: 700, fontFamily: S.fontHead }}>{STATUS_LABELS[st]}</span>; })()}
                {product.maxColors > 1 && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "rgba(132,94,247,0.1)", color: S.purple, fontWeight: 600 }}>{product.maxColors} colours</span>}
              </div>
              <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                {product.colors.slice(0, 8).map((c, i) => <div key={i} style={{ width: 12, height: 12, borderRadius: "50%", background: FILAMENTS[c]?.hex || "#666", border: "1px solid rgba(255,255,255,0.1)" }} />)}
                {product.colors.length > 8 && <span style={{ fontSize: 10, color: S.dimmer, alignSelf: "center" }}>+{product.colors.length - 8}</span>}
              </div>
            </div>
            <span style={{ fontSize: 11, color: S.dimmer, fontFamily: S.fontHead, whiteSpace: "nowrap" }}>{product.category}</span>
            <span style={{ color: S.dimmer, fontSize: 16 }}>›</span>
          </button>
        ))}
      </div>
      </>)}

      {/* Colours tab */}
      {adminTab === "colours" && (
        <div>
          <p style={{ fontSize: 13, color: S.muted, marginBottom: 20, lineHeight: 1.6 }}>
            Manage your filament library. Every colour here is automatically available on <strong style={{ color: S.text }}>all products</strong>.
          </p>

          {/* Filament Scanner — inline panel */}
          <div style={{ marginBottom: 24, borderRadius: 16, border: `1px solid ${scannerOpen ? "rgba(132,94,247,0.3)" : S.border}`, background: scannerOpen ? "rgba(132,94,247,0.03)" : S.card, overflow: "hidden", transition: "all 0.3s" }}>
            <button onClick={() => { setScannerOpen(!scannerOpen); if (!scannerOpen) { setScannerResult(null); setScannerImage(null); } }} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "14px 20px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20 }}>📷</span>
                <span style={{ fontSize: 15, fontWeight: 700, fontFamily: S.fontHead, color: scannerOpen ? S.purple : S.text }}>Filament Scanner</span>
              </div>
              <span style={{ fontSize: 18, color: S.muted, transform: scannerOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>▾</span>
            </button>

            {scannerOpen && (
              <div style={{ padding: "0 20px 20px" }}>
                {/* Mode toggle tabs */}
                <div style={{ display: "flex", gap: 0, marginBottom: 16, borderRadius: 12, overflow: "hidden", border: `1px solid ${S.border}` }}>
                  <Tooltip position="top" text="<strong>Match Spool:</strong> Take a photo of an existing filament spool to identify which colour in your library it matches. Great when spools lose their labels.">
                  <button onClick={() => { setScannerMode("match"); setScannerResult(null); setScannerImage(null); }} style={{ flex: 1, padding: "10px 16px", border: "none", background: scannerMode === "match" ? "rgba(0,201,167,0.12)" : "transparent", color: scannerMode === "match" ? S.teal : S.muted, fontSize: 13, fontWeight: 700, fontFamily: S.fontHead, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.2s" }}>
                    <span>🎯</span> Match Spool
                  </button>
                  </Tooltip>
                  <Tooltip position="top" text="<strong>Scan Box:</strong> Photograph a filament box or packaging to automatically read the colour name, brand, and material — and add it to your colour library.">
                  <button onClick={() => { setScannerMode("scan"); setScannerResult(null); setScannerImage(null); }} style={{ flex: 1, padding: "10px 16px", border: "none", borderLeft: `1px solid ${S.border}`, background: scannerMode === "scan" ? "rgba(132,94,247,0.12)" : "transparent", color: scannerMode === "scan" ? S.purple : S.muted, fontSize: 13, fontWeight: 700, fontFamily: S.fontHead, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.2s" }}>
                    <span>📦</span> Scan Box
                  </button>
                  </Tooltip>
                </div>

                <p style={{ fontSize: 12, color: S.dimmer, marginBottom: 14, lineHeight: 1.5 }}>
                  {scannerMode === "match"
                    ? "Take a photo of a filament spool to identify it against your colour library."
                    : "Photograph a filament box or packaging to read the colour, brand, and material details."}
                </p>

                {/* Upload area */}
                {!scannerImage && !scannerLoading && (
                  <div style={{ display: "flex", gap: 10 }}>
                    <label style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: "24px 12px", borderRadius: 14, border: `2px dashed ${S.border}`, background: "rgba(255,255,255,0.02)", cursor: "pointer", transition: "all 0.2s" }}>
                      <div style={{ fontSize: 28, opacity: 0.6 }}>📷</div>
                      <div style={{ fontSize: 12, color: scannerMode === "match" ? S.teal : S.purple, fontFamily: S.fontHead, fontWeight: 600 }}>Take Photo</div>
                      <div style={{ fontSize: 10, color: S.dimmer }}>Open camera</div>
                      <input type="file" accept="image/*" capture="environment" onChange={handleScanUpload} style={{ display: "none" }} />
                    </label>
                    <label style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: "24px 12px", borderRadius: 14, border: `2px dashed ${S.border}`, background: "rgba(255,255,255,0.02)", cursor: "pointer", transition: "all 0.2s" }}>
                      <div style={{ fontSize: 28, opacity: 0.6 }}>📁</div>
                      <div style={{ fontSize: 12, color: scannerMode === "match" ? S.teal : S.purple, fontFamily: S.fontHead, fontWeight: 600 }}>Upload Photo</div>
                      <div style={{ fontSize: 10, color: S.dimmer }}>From gallery or files</div>
                      <input type="file" accept="image/*" onChange={handleScanUpload} style={{ display: "none" }} />
                    </label>
                  </div>
                )}

                {/* Loading state */}
                {scannerLoading && (
                  <div style={{ textAlign: "center", padding: "24px 0" }}>
                    {scannerImage && <img src={scannerImage} alt="Uploaded" style={{ width: "100%", maxHeight: 180, objectFit: "contain", borderRadius: 12, marginBottom: 14, opacity: 0.6 }} />}
                    <div style={{ display: "inline-block", width: 24, height: 24, border: `3px solid ${S.border}`, borderTopColor: scannerMode === "match" ? S.teal : S.purple, borderRadius: "50%", animation: "spin 0.8s linear infinite", marginBottom: 10 }} />
                    <p style={{ fontSize: 13, color: scannerMode === "match" ? S.teal : S.purple, fontFamily: S.fontHead, fontWeight: 600 }}>{scannerMode === "match" ? "Matching filament..." : "Reading packaging..."}</p>
                    <p style={{ fontSize: 11, color: S.dimmer }}>Analysing your photo</p>
                  </div>
                )}

                {/* Error result */}
                {scannerResult?.error && (
                  <div>
                    {scannerImage && <img src={scannerImage} alt="Uploaded" style={{ width: "100%", maxHeight: 180, objectFit: "contain", borderRadius: 12, marginBottom: 14 }} />}
                    <div style={{ background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.2)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
                      <p style={{ fontSize: 13, color: "#ff6b6b", fontWeight: 600, margin: 0 }}>{scannerResult.error}</p>
                    </div>
                    <button onClick={() => { setScannerResult(null); setScannerImage(null); }} style={{ width: "100%", padding: "10px 16px", borderRadius: 12, border: `1px solid ${S.border}`, background: S.card, color: S.text, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}>Try Again</button>
                  </div>
                )}

                {/* MATCH result (spool identified) */}
                {scannerResult?.mode === "match" && (
                  <div>
                    {scannerImage && <img src={scannerImage} alt="Uploaded" style={{ width: "100%", maxHeight: 180, objectFit: "contain", borderRadius: 12, marginBottom: 14 }} />}
                    {scannerResult.visibleInfo && (
                      <div style={{ fontSize: 11, color: S.dimmer, fontFamily: S.fontMono, marginBottom: 10, padding: "6px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
                        📝 Visible on spool: {scannerResult.visibleInfo}
                      </div>
                    )}
                    <h4 style={{ fontSize: 14, fontWeight: 700, fontFamily: S.fontHead, color: S.teal, marginBottom: 10, marginTop: 0 }}>
                      {scannerResult.matches?.length > 0 ? "🎯 Matches Found" : "❌ No Match Found"}
                    </h4>
                    {scannerResult.matches?.map((m, i) => {
                      const fil = FILAMENTS[m.name];
                      return (
                        <div key={i} onClick={() => {
                          setNewColourName(m.name);
                          setNewColourHex(fil?.hex || scannerResult.hexEstimate || "#888888");
                          setNewColourType(fil?.type || scannerResult.suggestedType || "PLA Basic");
                          setNewColourPremium(fil?.premium || scannerResult.suggestedPremium || false);
                          setEditingColour(null);
                          setScannerResult(null); setScannerImage(null); setScannerOpen(false);
                        }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, background: i === 0 ? "rgba(0,201,167,0.06)" : "rgba(255,255,255,0.02)", border: `1px solid ${i === 0 ? "rgba(0,201,167,0.2)" : S.border}`, marginBottom: 6, cursor: "pointer", transition: "all 0.15s" }}>
                          {fil && <div style={{ width: 32, height: 32, borderRadius: 8, background: fil.hex, border: "2px solid rgba(255,255,255,0.12)", flexShrink: 0 }} />}
                          {!fil && scannerResult.hexEstimate && <div style={{ width: 32, height: 32, borderRadius: 8, background: scannerResult.hexEstimate, border: "2px solid rgba(255,255,255,0.12)", flexShrink: 0 }} />}
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: S.text, fontFamily: S.fontHead }}>{m.name}</div>
                            <div style={{ fontSize: 10, color: S.dimmer, fontFamily: S.fontMono }}>{fil?.type || scannerResult.suggestedType || "Unknown"}{(fil?.premium || scannerResult.suggestedPremium) ? " ✦" : ""}</div>
                            <div style={{ fontSize: 10, color: S.muted, marginTop: 2 }}>{m.reason}</div>
                          </div>
                          <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, fontWeight: 700, fontFamily: S.fontMono, textTransform: "uppercase",
                            background: m.confidence === "high" ? "rgba(0,201,167,0.12)" : m.confidence === "medium" ? "rgba(249,202,36,0.12)" : "rgba(255,107,107,0.08)",
                            color: m.confidence === "high" ? S.teal : m.confidence === "medium" ? "#f9ca24" : "#ff6b6b",
                          }}>{m.confidence}</span>
                        </div>
                      );
                    })}
                    {(!scannerResult.matches || scannerResult.matches.length === 0) && scannerResult.estimatedColour && (
                      <div onClick={() => {
                        setNewColourName(scannerResult.estimatedColour);
                        setNewColourHex(scannerResult.hexEstimate || "#888888");
                        setNewColourType(scannerResult.suggestedType || "PLA Basic");
                        setNewColourPremium(scannerResult.suggestedPremium || false);
                        setEditingColour(null);
                        setScannerResult(null); setScannerImage(null); setScannerOpen(false);
                      }} style={{ padding: "10px 14px", borderRadius: 12, background: "rgba(132,94,247,0.06)", border: "1px solid rgba(132,94,247,0.2)", cursor: "pointer", transition: "all 0.15s" }}>
                        <p style={{ fontSize: 12, color: S.muted, margin: 0 }}>Best guess: <strong style={{ color: S.text }}>{scannerResult.estimatedColour}</strong> — tap to add to library</p>
                        {scannerResult.hexEstimate && <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6 }}><div style={{ width: 14, height: 14, borderRadius: 4, background: scannerResult.hexEstimate, border: "1px solid rgba(255,255,255,0.15)" }} /><span style={{ fontSize: 11, color: S.dimmer, fontFamily: S.fontMono }}>{scannerResult.hexEstimate}</span></div>}
                      </div>
                    )}
                    <p style={{ fontSize: 10, color: S.dimmer, marginTop: 8, marginBottom: 0, textAlign: "center" }}>Tap a result to pre-fill the colour form</p>
                    <button onClick={() => { setScannerResult(null); setScannerImage(null); }} style={{ width: "100%", marginTop: 10, padding: "10px 16px", borderRadius: 12, border: `1px solid ${S.border}`, background: S.card, color: S.text, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}>Scan Another</button>
                  </div>
                )}

                {/* SCAN result (box/packaging identified) */}
                {scannerResult?.mode === "scan" && (
                  <div>
                    {scannerImage && <img src={scannerImage} alt="Uploaded" style={{ width: "100%", maxHeight: 180, objectFit: "contain", borderRadius: 12, marginBottom: 14 }} />}

                    {/* Details read from packaging */}
                    <div style={{ fontSize: 11, color: S.dimmer, fontFamily: S.fontMono, marginBottom: 14, padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 10, lineHeight: 1.6 }}>
                      📦 <strong style={{ color: S.muted }}>Scanned:</strong> {scannerResult.allDetailsRead || `${scannerResult.brand} — ${scannerResult.colourName} (${scannerResult.material} ${scannerResult.finish})`}
                    </div>

                    {/* Existing match found */}
                    {scannerResult.existingMatch && FILAMENTS[scannerResult.existingMatch] && (
                      <div style={{ background: "rgba(0,201,167,0.06)", border: "1px solid rgba(0,201,167,0.2)", borderRadius: 14, padding: 14, marginBottom: 14, textAlign: "center" }}>
                        <div style={{ fontSize: 20, marginBottom: 6 }}>✅</div>
                        <div style={{ fontSize: 14, fontWeight: 700, fontFamily: S.fontHead, color: S.teal, marginBottom: 4 }}>Already in your library!</div>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 10, background: S.card, border: `1px solid ${S.border}`, marginTop: 6 }}>
                          <div style={{ width: 24, height: 24, borderRadius: 6, background: FILAMENTS[scannerResult.existingMatch].hex, border: "2px solid rgba(255,255,255,0.12)" }} />
                          <div style={{ textAlign: "left" }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: S.text, fontFamily: S.fontHead }}>{scannerResult.existingMatch}</div>
                            <div style={{ fontSize: 10, color: S.dimmer, fontFamily: S.fontMono }}>{FILAMENTS[scannerResult.existingMatch].type}</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* New colour — prefill form */}
                    {!scannerResult.existingMatch && (
                      <div style={{ background: "rgba(132,94,247,0.06)", border: "1px solid rgba(132,94,247,0.2)", borderRadius: 14, padding: 14, marginBottom: 14 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, fontFamily: S.fontHead, color: S.purple, marginBottom: 10 }}>🆕 New colour detected!</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
                          <div><span style={{ color: S.dimmer, fontFamily: S.fontMono, fontSize: 10 }}>SUGGESTED NAME</span><br /><strong style={{ color: S.text }}>{scannerResult.suggestedName}</strong></div>
                          <div><span style={{ color: S.dimmer, fontFamily: S.fontMono, fontSize: 10 }}>TYPE</span><br /><strong style={{ color: S.text }}>{scannerResult.suggestedType}</strong></div>
                          <div><span style={{ color: S.dimmer, fontFamily: S.fontMono, fontSize: 10 }}>HEX ESTIMATE</span><br /><div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 16, height: 16, borderRadius: 4, background: scannerResult.hexEstimate, border: "1px solid rgba(255,255,255,0.15)" }} /><strong style={{ color: S.text, fontFamily: S.fontMono }}>{scannerResult.hexEstimate}</strong></div></div>
                          <div><span style={{ color: S.dimmer, fontFamily: S.fontMono, fontSize: 10 }}>PREMIUM</span><br /><strong style={{ color: S.text }}>{scannerResult.premium ? "Yes ✦" : "No"}</strong></div>
                        </div>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => { setScannerResult(null); setScannerImage(null); }} style={{ flex: 1, padding: "10px 16px", borderRadius: 12, border: `1px solid ${S.border}`, background: S.card, color: S.text, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}>Scan Another</button>
                      {!scannerResult.existingMatch ? (
                        <button onClick={() => {
                          setNewColourName(scannerResult.suggestedName || "");
                          setNewColourHex(scannerResult.hexEstimate || "#888888");
                          setNewColourType(scannerResult.suggestedType || "PLA Basic");
                          setNewColourPremium(!!scannerResult.premium);
                          setEditingColour(null);
                          setScannerResult(null); setScannerImage(null); setScannerOpen(false);
                        }} style={{ flex: 1, padding: "10px 16px", borderRadius: 12, border: "none", background: `linear-gradient(135deg, ${S.purple}, #6c5ce7)`, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead }}>Add to Library →</button>
                      ) : (
                        <button onClick={() => { setScannerResult(null); setScannerImage(null); }} style={{ flex: 1, padding: "10px 16px", borderRadius: 12, border: "none", background: `linear-gradient(135deg, ${S.teal}, #00a88a)`, color: "#1a1a2e", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead }}>Done</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Add / Edit colour form */}
          <div style={{ background: S.card, border: `1px solid ${editingColour ? S.teal : S.border}`, borderRadius: 16, padding: 20, marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, fontFamily: S.fontHead, color: editingColour ? S.teal : S.text, margin: "0 0 16px" }}>
              {editingColour ? `✏️ Editing: ${editingColour}` : "+ Add New Colour"}
            </h3>
            <div className="ep-colour-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: S.dimmer, fontFamily: S.fontMono, textTransform: "uppercase", display: "block", marginBottom: 4 }}>Colour Name</label>
                <input value={newColourName} onChange={e => setNewColourName(e.target.value)} placeholder="e.g. Sky Blue" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${S.border}`, background: "rgba(255,255,255,0.04)", color: S.text, fontSize: 14, fontFamily: S.font, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: S.dimmer, fontFamily: S.fontMono, textTransform: "uppercase", display: "block", marginBottom: 4 }}>Hex Colour</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="color" value={newColourHex.startsWith("#") ? newColourHex : "#888888"} onChange={e => setNewColourHex(e.target.value)} style={{ width: 44, height: 40, border: "none", borderRadius: 8, cursor: "pointer", background: "transparent" }} />
                  <input value={newColourHex} onChange={e => setNewColourHex(e.target.value)} placeholder="#hex or linear-gradient(...)" style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: `1px solid ${S.border}`, background: "rgba(255,255,255,0.04)", color: S.text, fontSize: 13, fontFamily: S.fontMono, outline: "none", boxSizing: "border-box" }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: S.dimmer, fontFamily: S.fontMono, textTransform: "uppercase", display: "block", marginBottom: 4 }}>Filament Type</label>
                <select value={newColourType} onChange={e => setNewColourType(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.text, fontSize: 14, fontFamily: S.font, outline: "none", boxSizing: "border-box" }}>
                  {["PLA Basic", "PLA Matte", "PLA Silk+", "PLA Gradient", "ELEGOO Silk", "Reprapper PLA", "PETG", "TPU"].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: S.muted, cursor: "pointer", userSelect: "none" }}>
                  <input type="checkbox" checked={newColourPremium} onChange={e => setNewColourPremium(e.target.checked)} style={{ width: 18, height: 18, accentColor: S.teal }} />
                  Premium (+£3/kg)
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  {editingColour && (
                    <button
                      onClick={() => {
                        setEditingColour(null);
                        setNewColourName(""); setNewColourHex("#888888"); setNewColourType("PLA Basic"); setNewColourPremium(false);
                      }}
                      style={{ padding: "10px 16px", borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.muted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}
                    >Cancel</button>
                  )}
                  <button
                    onClick={() => {
                      const name = newColourName.trim();
                      if (!name) return;
                      if (editingColour) {
                        // Editing existing colour — check for name collision
                        if (name !== editingColour && FILAMENTS[name]) { alert("A colour with that name already exists!"); return; }
                        const updated = {};
                        // Rebuild object preserving order, replacing the edited entry
                        Object.keys(FILAMENTS).forEach(key => {
                          if (key === editingColour) {
                            updated[name] = { hex: newColourHex, type: newColourType, ...(newColourPremium ? { premium: true } : {}) };
                          } else {
                            updated[key] = FILAMENTS[key];
                          }
                        });
                        // Update product colour references if name changed
                        if (name !== editingColour) {
                          const updatedProducts = products.map(p => ({
                            ...p,
                            colors: p.colors.map(c => c === editingColour ? name : c),
                          }));
                          onSave(updatedProducts);
                        }
                        onSaveFilaments(updated);
                        setEditingColour(null);
                        setSavedMsg("Colour updated!"); setTimeout(() => setSavedMsg(""), 2000);
                      } else {
                        // Adding new colour
                        if (FILAMENTS[name]) { alert("Colour already exists!"); return; }
                        const updated = { ...FILAMENTS, [name]: { hex: newColourHex, type: newColourType, ...(newColourPremium ? { premium: true } : {}) } };
                        onSaveFilaments(updated);
                        setSavedMsg("Colour added!"); setTimeout(() => setSavedMsg(""), 2000);
                      }
                      setNewColourName(""); setNewColourHex("#888888"); setNewColourType("PLA Basic"); setNewColourPremium(false);
                    }}
                    disabled={!newColourName.trim()}
                    style={{
                      padding: "10px 20px", borderRadius: 10, border: "none",
                      background: newColourName.trim() ? `linear-gradient(135deg, ${S.teal}, #00a88a)` : "rgba(255,255,255,0.05)",
                      color: newColourName.trim() ? "#1a1a2e" : S.dimmer,
                      fontSize: 14, fontWeight: 700, cursor: newColourName.trim() ? "pointer" : "not-allowed", fontFamily: S.fontHead,
                    }}
                  >{editingColour ? "Save Changes" : "Add Colour"}</button>
                </div>
              </div>
            </div>
          </div>

          {/* Existing colours grid */}
          <div className="ep-admin-colours-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
            {ALL_COLORS.map(name => {
              const f = FILAMENTS[name];
              const isEditing = editingColour === name;
              return (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, background: isEditing ? "rgba(0,201,167,0.06)" : S.card, border: `1px solid ${isEditing ? S.teal : S.border}` }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: f.hex, border: "2px solid rgba(255,255,255,0.12)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: S.text, fontFamily: S.fontHead, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
                    <div style={{ fontSize: 11, color: S.dimmer, fontFamily: S.fontMono }}>
                      {f.type}{f.premium ? " ✦" : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setEditingColour(name);
                      setNewColourName(name);
                      setNewColourHex(f.hex);
                      setNewColourType(f.type);
                      setNewColourPremium(!!f.premium);
                    }}
                    title="Edit colour"
                    style={{ width: 28, height: 28, borderRadius: 8, border: "none", background: "rgba(0,201,167,0.08)", color: S.teal, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                  >✏️</button>
                  <button
                    onClick={() => {
                      if (!confirm(`Remove "${name}" from the filament library?`)) return;
                      const updated = { ...FILAMENTS };
                      delete updated[name];
                      onSaveFilaments(updated);
                      if (editingColour === name) { setEditingColour(null); setNewColourName(""); setNewColourHex("#888888"); setNewColourType("PLA Basic"); setNewColourPremium(false); }
                      setSavedMsg("Colour removed!"); setTimeout(() => setSavedMsg(""), 2000);
                    }}
                    title="Remove colour"
                    style={{ width: 28, height: 28, borderRadius: 8, border: "none", background: "rgba(255,107,107,0.08)", color: "#ff6b6b", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                  >×</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
{adminTab === "categories" && (
        <div style={{ background: S.card, borderRadius: 16, padding: 24, border: `1px solid ${S.border}` }}>
          <p style={{ fontSize: 13, color: S.muted, marginBottom: 20 }}>
            Manage your product categories. Each category can be tagged as Kids or Adult (used for label printing) and optionally require product dimensions.
          </p>
          {/* Add new category */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="New category name" onKeyDown={e => { if (e.key === "Enter" && newCatName.trim()) { const n = newCatName.trim(); if (!categories.includes(n)) { onSaveCategories([...categories, n]); setNewCatName(""); } }}} style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: `1px solid ${S.border}`, background: "rgba(255,255,255,0.03)", color: S.text, fontSize: 14, fontFamily: S.font, outline: "none" }} />
            <button onClick={() => { const n = newCatName.trim(); if (n && !categories.includes(n)) { onSaveCategories([...categories, n]); setNewCatName(""); } }} disabled={!newCatName.trim() || categories.includes(newCatName.trim())} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: newCatName.trim() && !categories.includes(newCatName.trim()) ? `linear-gradient(135deg, ${S.teal}, #00b894)` : "rgba(255,255,255,0.05)", color: newCatName.trim() && !categories.includes(newCatName.trim()) ? "#1a1a2e" : S.dimmer, fontSize: 14, fontWeight: 700, cursor: newCatName.trim() ? "pointer" : "default", fontFamily: S.fontHead }}>+ Add</button>
          </div>
          {/* Category list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {categories.map((cat, idx) => {
              const count = products ? products.filter(p => p.category === cat).length : 0;
              const isEditing = editingCat === idx;
              const meta = categoryMeta[cat] || { audience: "kids", hasDimensions: false };
              return (
                <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: `1px solid ${S.border}`, flexWrap: "wrap" }}>
                  {isEditing ? (
                    <>
                      <input value={editCatName} onChange={e => setEditCatName(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && editCatName.trim()) { const n = editCatName.trim(); const updated = [...categories]; const oldName = updated[idx]; updated[idx] = n; onSaveCategories(updated); if (products) { const renamedProducts = products.map(p => p.category === oldName ? { ...p, category: n } : p); onSave(renamedProducts); } /* migrate meta key */ const newMeta = {...categoryMeta}; if (newMeta[oldName]) { newMeta[n] = newMeta[oldName]; delete newMeta[oldName]; onSaveCategoryMeta(newMeta); } setEditingCat(null); } if (e.key === "Escape") setEditingCat(null); }} autoFocus style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: `1px solid ${S.teal}`, background: "rgba(0,201,167,0.05)", color: S.text, fontSize: 14, fontFamily: S.font, outline: "none" }} />
                      <button onClick={() => { const n = editCatName.trim(); if (n) { const updated = [...categories]; const oldName = updated[idx]; updated[idx] = n; onSaveCategories(updated); if (products) { const renamedProducts = products.map(p => p.category === oldName ? { ...p, category: n } : p); onSave(renamedProducts); } const newMeta = {...categoryMeta}; if (newMeta[oldName]) { newMeta[n] = newMeta[oldName]; delete newMeta[oldName]; onSaveCategoryMeta(newMeta); } setEditingCat(null); } }} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: S.teal, color: "#1a1a2e", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Save</button>
                      <button onClick={() => setEditingCat(null)} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${S.border}`, background: "transparent", color: S.muted, fontSize: 12, cursor: "pointer" }}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: S.text, fontFamily: S.fontHead, minWidth: 120 }}>{cat}</span>
                      <span style={{ fontSize: 11, color: S.dimmer, fontFamily: S.fontMono }}>{count} product{count !== 1 ? "s" : ""}</span>
                      {/* Audience toggle */}
                      <button onClick={() => { const newMeta = {...categoryMeta}; newMeta[cat] = { ...meta, audience: meta.audience === "kids" ? "adult" : "kids" }; onSaveCategoryMeta(newMeta); }} style={{ padding: "4px 10px", borderRadius: 8, border: `1px solid ${meta.audience === "kids" ? "rgba(255,193,7,0.4)" : "rgba(132,94,247,0.4)"}`, background: meta.audience === "kids" ? "rgba(255,193,7,0.1)" : "rgba(132,94,247,0.1)", color: meta.audience === "kids" ? "#ffc107" : S.purple, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead }}>{meta.audience === "kids" ? "👶 Kids" : "🧑 Adult"}</button>
                      {/* Dimensions toggle */}
                      <button onClick={() => { const newMeta = {...categoryMeta}; newMeta[cat] = { ...meta, hasDimensions: !meta.hasDimensions }; onSaveCategoryMeta(newMeta); }} style={{ padding: "4px 10px", borderRadius: 8, border: `1px solid ${meta.hasDimensions ? "rgba(0,201,167,0.4)" : S.border}`, background: meta.hasDimensions ? "rgba(0,201,167,0.1)" : "rgba(255,255,255,0.02)", color: meta.hasDimensions ? S.teal : S.dimmer, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead }}>{meta.hasDimensions ? "📐 Dims ON" : "📐 Dims"}</button>
                      <button onClick={() => { setEditingCat(idx); setEditCatName(cat); }} style={{ padding: "5px 10px", borderRadius: 8, border: `1px solid ${S.border}`, background: "transparent", color: S.muted, fontSize: 11, cursor: "pointer", fontFamily: S.fontHead }}>✏️ Rename</button>
                      <button onClick={() => { if (count > 0) { if (!window.confirm(`"${cat}" has ${count} product${count !== 1 ? "s" : ""}. They'll keep their category label but it won't appear in filters. Delete anyway?`)) return; } const newMeta = {...categoryMeta}; delete newMeta[cat]; onSaveCategoryMeta(newMeta); onSaveCategories(categories.filter((_, i) => i !== idx)); }} style={{ padding: "5px 10px", borderRadius: 8, border: `1px solid rgba(255,107,107,0.3)`, background: "transparent", color: "#ff6b6b", fontSize: 11, cursor: "pointer", fontFamily: S.fontHead }}>🗑️ Delete</button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {categories.length === 0 && <p style={{ textAlign: "center", color: S.dimmer, fontSize: 13, padding: 20 }}>No categories yet. Add one above!</p>}
        </div>
      )}
       
      {adminTab === "creators" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Health summary */}
          {(() => {
            const activeProds = products.filter(p => p.available);
            const red = creators.filter(c => {
              if (c.licenceStatus === "deleted") return false;
              const hasProds = activeProds.some(p => p.creator === c.name);
              return hasProds && c.licenceStatus === "no_licence";
            }).length;
            const amber = creators.filter(c => {
              if (c.licenceStatus === "deleted") return false;
              const hasProds = activeProds.some(p => p.creator === c.name);
              return hasProds && (c.licenceStatus === "unconfirmed" || c.licenceStatus === "dm_sent");
            }).length;
            const green = creators.filter(c => {
              if (c.licenceStatus === "deleted") return false;
              const hasProds = activeProds.some(p => p.creator === c.name);
              return !hasProds || c.licenceStatus === "subscribed" || c.licenceStatus === "free";
            }).length;
            const totalCost = creators.reduce((sum, c) => sum + (parseFloat(c.monthlyCost) || 0), 0);
            return (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {[
                  { label: "🔴 Action needed", val: red, bg: "rgba(220,53,69,0.1)", border: "rgba(220,53,69,0.3)", color: "#dc3545" },
                  { label: "🟡 Unconfirmed", val: amber, bg: "rgba(245,159,0,0.1)", border: "rgba(245,159,0,0.3)", color: "#f59f00" },
                  { label: "✅ Covered", val: green, bg: "rgba(0,201,167,0.1)", border: "rgba(0,201,167,0.3)", color: S.teal },
                  { label: "💷 Monthly spend", val: "£" + totalCost.toFixed(2), bg: "rgba(255,255,255,0.03)", border: S.border, color: S.text },
                ].map(s => (
                  <div key={s.label} style={{ flex: 1, minWidth: 120, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12, padding: "12px 16px", textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: s.color, fontFamily: S.fontHead }}>{s.val}</div>
                    <div style={{ fontSize: 11, color: S.muted, marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Import buttons */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Tooltip position="bottom" text="Upload the Creator Register CSV exported from the licence audit spreadsheet. This populates the creator list with licence status, monthly cost, and subscription details.">
            <label style={{ padding: "10px 18px", borderRadius: 10, border: `1px solid ${S.border}`, background: "rgba(255,255,255,0.04)", color: S.text, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}>
              📥 Import Creator Register (CSV)
              <input type="file" accept=".csv" style={{ display: "none" }} onChange={e => {
                const file = e.target.files[0]; if (!file) return;
                const reader = new FileReader();
                reader.onload = async ev => {
                  try {
                    const lines = ev.target.result.split("\n").filter(l => l.trim());
                    const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
                    const parsed = lines.slice(1).map((line, idx) => {
                      const vals = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g) || [];
                      const clean = vals.map(v => v.trim().replace(/^"|"$/g, ""));
                      return {
                        id: Date.now() + idx,
                        name: clean[0] || "",
                        platform: clean[1] || "",
                        profileUrl: clean[2] || "",
                        licenceStatus: (clean[3] || "unconfirmed").toLowerCase().replace(/\s+/g, "_").replace("-","_"),
                        monthlyCost: parseFloat(clean[4]) || 0,
                        productsCovered: clean[5] || "",
                        actionRequired: clean[6] || "",
                        photoRights: (clean[7] || "own_needed").toLowerCase().replace(/\s+/g, "_"),
                      };
                    }).filter(c => c.name);
                    setCreators(parsed);
                    try {
                      await saveCreators(parsed);
                      setCreatorsDebug("✅ Imported and saved " + parsed.length + " creators to Firebase");
                      alert("✅ Imported " + parsed.length + " creators and saved to Firebase");
                    } catch(saveErr) {
                      alert("⚠️ Imported " + parsed.length + " creators but Firebase save failed: " + saveErr.message + "\n\nCheck your Firestore security rules allow writes to the 'shop' collection.");
                    }
                  } catch(err) { alert("Import failed: " + err.message); }
                };
                reader.readAsText(file);
                e.target.value = "";
              }} />
            </label>
            </Tooltip>
            <Tooltip position="bottom" text="Upload the Product-Creator Mapping CSV to link each product to its creator. This drives the licence risk indicators on the product list and the creator dashboard.">
            <label style={{ padding: "10px 18px", borderRadius: 10, border: `1px solid ${S.border}`, background: "rgba(255,255,255,0.04)", color: S.text, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}>
              🔗 Import Product-Creator Mapping (CSV)
              <input type="file" accept=".csv" style={{ display: "none" }} onChange={e => {
                const file = e.target.files[0]; if (!file) return;
                const reader = new FileReader();
                reader.onload = async ev => {
                  try {
                    const lines = ev.target.result.split("\n").filter(l => l.trim());
                    const rows = lines.slice(1).map(line => {
                      const parts = line.split(",");
                      return { id: parseInt(parts[0]), creator: (parts[2] || "").trim().replace(/^"|"$/g, "") };
                    }).filter(r => r.id && r.creator);
                    const updated = products.map(p => {
                      const match = rows.find(r => r.id === p.id);
                      return match ? { ...p, creator: match.creator } : p;
                    });
                    await onSave(updated);
                    alert("Updated creators for " + rows.length + " products");
                  } catch(err) { alert("Import failed: " + err.message); }
                };
                reader.readAsText(file);
                e.target.value = "";
              }} />
            </label>
            </Tooltip>
            <Tooltip position="bottom" text="Manually add a new creator entry. Fill in their name, platform, Patreon URL, licence status, and monthly cost. Use the CSV import above if you're adding many at once.">
            <button onClick={async () => {
              const newC = { id: Date.now(), name: "", platform: "MakerWorld", profileUrl: "", licenceStatus: "unconfirmed", monthlyCost: 0, productsCovered: "", actionRequired: "", photoRights: "own_needed" };
              const updated = [...creators, newC];
              setCreators(updated);
              await saveCreators(updated);
            }} style={{ padding: "10px 18px", borderRadius: 10, border: `1px solid ${S.teal}`, background: "rgba(0,201,167,0.08)", color: S.teal, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}>+ Add Creator</button>
            </Tooltip>
          </div>

          {/* Creators table */}
          <div style={{ background: S.card, borderRadius: 16, border: `1px solid ${S.border}`, overflow: "hidden" }}>
            {creators.length === 0 && <p style={{ textAlign: "center", color: S.dimmer, fontSize: 13, padding: 32 }}>No creators yet — import the Creator Register CSV to get started.</p>}
            {creators.map((c, idx) => {
              const activeProds = products.filter(p => p.available && p.creator === c.name);
              const hasProds = activeProds.length > 0;
              const health = (() => {
                if (!hasProds) return { color: S.teal, label: "✅ No exposure", bg: "rgba(0,201,167,0.1)" };
                if (c.licenceStatus === "subscribed") return { color: S.teal, label: "✅ Subscribed", bg: "rgba(0,201,167,0.1)" };
                if (c.licenceStatus === "free") return { color: S.teal, label: "✅ Free commercial", bg: "rgba(0,201,167,0.1)" };
                if (c.licenceStatus === "deleted") return { color: S.dimmer, label: "🗑 Deleted", bg: "rgba(255,255,255,0.04)" };
                if (c.licenceStatus === "no_licence") return { color: "#dc3545", label: "🔴 No licence", bg: "rgba(220,53,69,0.1)" };
                if (c.licenceStatus === "dm_sent") return { color: "#f59f00", label: "🟡 DM sent", bg: "rgba(245,159,0,0.1)" };
                return { color: "#f59f00", label: "🟡 Unconfirmed", bg: "rgba(245,159,0,0.1)" };
              })();
              const isEditing = editing === "creator_" + c.id;
              return (
                <div key={c.id} style={{ padding: "14px 16px", borderBottom: `1px solid ${S.border}`, background: health.bg }}>
                  {isEditing ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input value={c.name} onChange={e => { const u=[...creators]; u[idx]={...u[idx],name:e.target.value}; setCreators(u); }} placeholder="Creator name" style={{ flex: 2, minWidth: 120, padding: "8px 12px", borderRadius: 8, border: `1px solid ${S.border}`, background: "rgba(255,255,255,0.06)", color: S.text, fontSize: 13, fontFamily: S.fontHead }} />
                        <input value={c.platform} onChange={e => { const u=[...creators]; u[idx]={...u[idx],platform:e.target.value}; setCreators(u); }} placeholder="Platform" style={{ flex: 1, minWidth: 100, padding: "8px 12px", borderRadius: 8, border: `1px solid ${S.border}`, background: "rgba(255,255,255,0.06)", color: S.text, fontSize: 13, fontFamily: S.fontHead }} />
                        <select value={c.licenceStatus} onChange={e => { const u=[...creators]; u[idx]={...u[idx],licenceStatus:e.target.value}; setCreators(u); }} style={{ flex: 1, minWidth: 130, padding: "8px 12px", borderRadius: 8, border: `1px solid ${S.border}`, background: "#1a1a2e", color: S.text, fontSize: 13, fontFamily: S.fontHead }}>
                          <option value="unconfirmed">Unconfirmed</option>
                          <option value="subscribed">Subscribed</option>
                          <option value="free">Free commercial</option>
                          <option value="dm_sent">DM sent</option>
                          <option value="no_licence">No licence</option>
                          <option value="deleted">Deleted</option>
                        </select>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input value={c.profileUrl} onChange={e => { const u=[...creators]; u[idx]={...u[idx],profileUrl:e.target.value}; setCreators(u); }} placeholder="Profile URL" style={{ flex: 3, minWidth: 160, padding: "8px 12px", borderRadius: 8, border: `1px solid ${S.border}`, background: "rgba(255,255,255,0.06)", color: S.text, fontSize: 13, fontFamily: S.fontHead }} />
                        <input value={c.monthlyCost} onChange={e => { const u=[...creators]; u[idx]={...u[idx],monthlyCost:parseFloat(e.target.value)||0}; setCreators(u); }} placeholder="£/mo" type="number" step="0.01" style={{ flex: 1, minWidth: 70, padding: "8px 12px", borderRadius: 8, border: `1px solid ${S.border}`, background: "rgba(255,255,255,0.06)", color: S.text, fontSize: 13, fontFamily: S.fontHead }} />
                        <Tooltip position="top" text="Does this creator's subscription include rights to use their <strong>official product photos</strong> on the ET Print World website?<br/><br/>If yes, you can use MakerWorld/Patreon images. If no, Elijah must photograph every product himself before it goes live.">
                        <button onClick={() => { const u=[...creators]; u[idx]={...u[idx], photoRights: c.photoRights === "included" ? "own_needed" : "included"}; setCreators(u); }} style={{ minWidth: 140, padding: "8px 12px", borderRadius: 8, border: `1px solid ${c.photoRights === "included" ? S.teal : "rgba(245,159,0,0.4)"}`, background: c.photoRights === "included" ? "rgba(0,201,167,0.12)" : "rgba(245,159,0,0.08)", color: c.photoRights === "included" ? S.teal : "#f59f00", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}>{c.photoRights === "included" ? "📷 Photos included" : "📷 Own photos needed"}</button>
                        </Tooltip>
                      </div>
                      <input value={c.actionRequired} onChange={e => { const u=[...creators]; u[idx]={...u[idx],actionRequired:e.target.value}; setCreators(u); }} placeholder="Action required" style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${S.border}`, background: "rgba(255,255,255,0.06)", color: S.text, fontSize: 13, fontFamily: S.fontHead }} />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={async () => { setEditing(null); await saveCreators(creators); }} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: S.teal, color: "#1a1a2e", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead }}>Save</button>
                        <button onClick={() => setEditing(null)} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${S.border}`, background: "transparent", color: S.muted, fontSize: 13, cursor: "pointer", fontFamily: S.fontHead }}>Cancel</button>
                        <button onClick={async () => { if (!window.confirm("Delete " + c.name + "?")) return; const u=creators.filter((_,i)=>i!==idx); setCreators(u); await saveCreators(u); setEditing(null); }} style={{ marginLeft: "auto", padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(220,53,69,0.3)", background: "rgba(220,53,69,0.08)", color: "#dc3545", fontSize: 13, cursor: "pointer", fontFamily: S.fontHead }}>Delete</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 120 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: S.text, fontFamily: S.fontHead }}>{c.name || <em style={{color:S.dimmer}}>Unnamed</em>}</div>
                        <div style={{ fontSize: 11, color: S.muted }}>{c.platform}{c.profileUrl ? <> · <a href={c.profileUrl} target="_blank" rel="noopener noreferrer" style={{ color: S.teal }}>Profile ↗</a></> : ""}</div>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: health.color, background: health.bg, padding: "3px 10px", borderRadius: 20, fontFamily: S.fontHead }}>{health.label}</span>
                      {c.monthlyCost > 0 && <span style={{ fontSize: 12, color: S.muted, fontFamily: S.fontMono }}>£{c.monthlyCost.toFixed(2)}/mo</span>}
                      <span style={{ fontSize: 11, fontWeight: 600, color: c.photoRights === "included" ? S.teal : "#f59f00", background: c.photoRights === "included" ? "rgba(0,201,167,0.1)" : "rgba(245,159,0,0.08)", padding: "3px 8px", borderRadius: 12, fontFamily: S.fontHead }}>{c.photoRights === "included" ? "📷 Photos OK" : "📷 Own photos"}</span>
                      <span style={{ fontSize: 11, color: S.dimmer }}>{activeProds.length} active product{activeProds.length !== 1 ? "s" : ""}</span>
                      <button onClick={() => setEditing("creator_" + c.id)} style={{ padding: "5px 12px", borderRadius: 8, border: `1px solid ${S.border}`, background: "transparent", color: S.muted, fontSize: 12, cursor: "pointer", fontFamily: S.fontHead }}>Edit</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {importingJSON && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div onClick={() => setImportingJSON(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }} />
          <div style={{ position: "relative", width: "min(540px, 100%)", background: "#151530", border: `1px solid ${S.border}`, borderRadius: 20, padding: 32 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ fontSize: 20, fontWeight: 800, fontFamily: S.fontHead, color: S.text, margin: 0 }}>📋 Import Product from JSON</h3>
              <button onClick={() => setImportingJSON(false)} style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${S.border}`, color: "#aaa", width: 36, height: 36, borderRadius: "50%", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: S.muted, lineHeight: 1.6, marginBottom: 16 }}>Paste the JSON block from Claude to instantly create a new product, or paste a JSON array to import many at once. You'll still need to upload photos afterwards.</p>
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder='Paste JSON here...'
              style={{ width: "100%", height: 200, padding: 14, borderRadius: 12, border: `1px solid ${S.border}`, background: "rgba(255,255,255,0.04)", color: S.teal, fontSize: 13, fontFamily: S.fontMono, resize: "vertical", outline: "none", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setImportingJSON(false)} style={{ padding: "10px 24px", borderRadius: 10, border: `1px solid ${S.border}`, background: "transparent", color: S.muted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}>Cancel</button>
              <button onClick={async () => {
                try {
                  const raw = importText.trim().replace(/^```json?\s*/i, "").replace(/```\s*$/, "");
                  const parsed = JSON.parse(raw);
                  const items = Array.isArray(parsed) ? parsed : [parsed];
                  if (items.length === 0) { alert("Empty array"); return; }
                  const invalid = items.filter((d, i) => !d.name);
                  if (invalid.length > 0) { alert("All items must include a 'name' field"); return; }
                  const badCats = items.filter(d => d.category && !categories.includes(d.category));
                  if (badCats.length > 0) { alert("Category mismatch: " + badCats.map(d => '"' + d.category + '"').join(", ") + ". Expected: " + categories.join(", ")); return; }
                  setSaving(true);
                  const freshProducts = await loadProducts() || products;
                  let maxId = freshProducts.reduce((m, p) => Math.max(m, p.id), 0);
                  const newProducts = items.map(data => ({
                    id: ++maxId,
                    name: data.name || "",
                    price: parseFloat(data.price) || 0,
                    category: data.category || categories[0] || "Planters",
                    description: data.description || "",
                    colors: Array.isArray(data.colors) ? (data.colors.includes("all") ? [...ALL_COLORS] : data.colors.filter(c => ALL_COLORS.includes(c))) : ["Matte Charcoal"],
                    maxColors: parseInt(data.maxColors) || 1,
                    printTime: data.printTime || "",
                    grams: parseInt(data.grams) || 0,
                    available: data.available === true || data.status === "live",
                    status: data.status || "draft",
                    badge: null,
                    emoji: data.emoji || "",
                    img: "",
                    sourceRef: data.sourceRef || "",
                    sourceUrl: data.sourceUrl || "",
                    creator: data.creator || "",
                    photoSource: data.photoSource || "own",
                    addedDate: new Date().toISOString(),
                  }));
                  await onSave([...freshProducts, ...newProducts]);
                  setSaving(false);
                  setImportingJSON(false);
                  setImportText("");
                  setSavedMsg("Imported " + newProducts.length + " product" + (newProducts.length !== 1 ? "s" : "") + "!"); setTimeout(() => setSavedMsg(""), 3000);
                } catch (err) {
                  alert("Invalid JSON: " + err.message);
                }
              }} style={{ padding: "10px 28px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${S.teal}, #00a88a)`, color: "#1a1a2e", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: S.fontHead, boxShadow: "0 4px 16px rgba(0,201,167,0.25)" }}>Import Product(s)</button>
            </div>
          </div>
        </div>
      )}

      {((editing && typeof editing === "object") || addingNew) && (
        <ProductEditor
          product={addingNew ? newProduct : { ...editing, _autoBadge: autoBadges[editing?.id] || null }}
          isNew={addingNew}
          onSave={handleSaveProduct}
          onDelete={handleDelete}
          onCancel={() => { setEditing(null); setAddingNew(false); }}
          creators={creators}
          categoryMeta={categoryMeta}
        />
      )}
    </div>
  );
}

function AdminLogin({ onLogin }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const attempt = async () => {
    setError("");
    if (USE_FIREBASE) {
      if (!email.trim() || !pw.trim()) { setError("Enter email and password"); return; }
      setLoading(true);
      try {
        await firebaseSignIn(email.trim(), pw);
        onLogin();
      } catch (e) {
        const msg = e.code === "auth/invalid-credential" ? "Wrong email or password"
          : e.code === "auth/too-many-requests" ? "Too many attempts — try again later"
          : e.code === "auth/user-not-found" ? "No account with that email"
          : "Login failed — check your details";
        setError(msg);
      }
      setLoading(false);
    } else {
      if (pw === FALLBACK_ADMIN_PASSWORD) onLogin();
      else { setError("Wrong password"); setTimeout(() => setError(""), 2000); }
    }
  };

  return (
    <div style={{ maxWidth: 380, margin: "120px auto", padding: "0 24px", textAlign: "center" }}>
      <div style={{ width: 64, height: 64, borderRadius: 16, background: `linear-gradient(135deg, ${S.purple}, ${S.teal})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 24px" }}>🔒</div>
      <h2 style={{ fontSize: 22, fontWeight: 800, fontFamily: S.fontHead, color: S.text, marginBottom: 8 }}>Admin Login</h2>
      <p style={{ fontSize: 13, color: S.muted, marginBottom: 24 }}>{USE_FIREBASE ? "Sign in with your admin account" : "Enter the password to manage products"}</p>
      {USE_FIREBASE && (
        <input value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && attempt()} type="email" placeholder="Email address" autoComplete="email" style={{
          width: "100%", padding: "14px 16px", borderRadius: 12, fontSize: 16, textAlign: "center", marginBottom: 10,
          border: `1px solid ${S.border}`, background: "rgba(255,255,255,0.04)",
          color: S.text, fontFamily: S.font, outline: "none", boxSizing: "border-box",
        }} />
      )}
      <input value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && attempt()} type="password" placeholder="Password" autoComplete="current-password" style={{
        width: "100%", padding: "14px 16px", borderRadius: 12, fontSize: 16, textAlign: "center",
        border: error ? "1.5px solid #ff6b6b" : `1px solid ${S.border}`, background: "rgba(255,255,255,0.04)",
        color: S.text, fontFamily: S.fontMono, outline: "none", boxSizing: "border-box",
      }} />
      {error && <p style={{ fontSize: 12, color: "#ff6b6b", marginTop: 8 }}>{error}</p>}
      <button onClick={attempt} disabled={loading} style={{ marginTop: 16, width: "100%", padding: "14px 0", borderRadius: 12, border: "none", background: loading ? "rgba(132,94,247,0.3)" : `linear-gradient(135deg, ${S.purple}, #6c3ce0)`, color: "#fff", fontSize: 15, fontWeight: 800, cursor: loading ? "default" : "pointer", fontFamily: S.fontHead }}>{loading ? "Signing in..." : "Log In"}</button>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   CHECKOUT + CART (simplified)
   ═══════════════════════════════════════════════ */
function CheckoutPage({ cart, shipping, setShipping, onBack, onOrderPlaced, onAddTip, onRemoveTip }) {
  const [form, setForm] = useState({ email: "", name: "", address1: "", address2: "", city: "", county: "", postcode: "", phone: "" });
  const [step, setStep] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [errors, setErrors] = useState({});
  const [lastOrderId, setLastOrderId] = useState("");
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const productSubtotal = cart.filter(i => !i.isTip).reduce((s, i) => s + i.price * i.qty, 0);
  const qualifiesFree = productSubtotal >= FREE_SHIPPING_THRESHOLD;
  const currentTip = cart.find(i => i.isTip);
  const shippingCost = shipping?.id === "collection" ? 0 : (qualifiesFree ? 0 : (shipping?.price || 0));
  const stripeFee = getStripeFee(subtotal + shippingCost);
  const total = subtotal + shippingCost + stripeFee;
  const validate = (s) => {
    const e = {};
    if (s >= 1 && !shipping) e.shipping = "Required";
    if (s >= 2) { if (!form.name.trim()) e.name = "Required"; if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) e.email = "Valid email required"; if (shipping?.id !== "collection") { if (!form.address1.trim()) e.address1 = "Required"; if (!form.city.trim()) e.city = "Required"; if (!form.postcode.trim()) e.postcode = "Required"; } }
    setErrors(e); return Object.keys(e).length === 0;
  };
  const nextStep = () => { if (validate(step)) setStep(step + 1); };
  const handlePayment = async () => {
    if (!validate(3)) return;
    setProcessing(true);
    
    if (USE_STRIPE) {
      // Save pending order to localStorage so we can complete it after Stripe redirect
      const pendingOrder = {
        customer: { ...form },
        shipping: { id: shipping.id, name: shipping.name },
        items: cart.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty, selectedColors: i.selectedColors, ...(i.isTip ? { isTip: true } : {}) })),
        subtotal, shippingCost, stripeFee, total,
      };
      localStorage.setItem("ep_pending_order", JSON.stringify(pendingOrder));
      
      try {
        const resp = await fetch("/api/create-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: pendingOrder.items,
            shipping: { id: shipping.id, name: shipping.name, price: shippingCost },
            customerEmail: form.email,
            customerName: form.name,
            stripeFee,
          }),
        });
        const data = await resp.json();
        if (data.url) {
          window.location.href = data.url;
          return;
        } else {
          alert("Payment error: " + (data.error || "Could not connect to Stripe. Please try again."));
        }
      } catch (e) {
        console.error("Stripe redirect failed:", e);
        alert("Could not connect to payment service. Please try again.");
      }
      setProcessing(false);
      return;
    }
    
    // Demo mode fallback (when Stripe not configured)
    await new Promise(r => setTimeout(r, 2000));
    // Create order
    const order = {
      id: "EP-" + Date.now().toString(36).toUpperCase(),
      date: new Date().toISOString(),
      customer: { ...form },
      shipping: { id: shipping.id, name: shipping.name },
      items: cart.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty, selectedColors: i.selectedColors, ...(i.isTip ? { isTip: true } : {}) })),
      subtotal, shippingCost, stripeFee, total,
      status: { paid: true, produced: false, despatched: false },
    };
    // Save and notify
    try {
      await addOrder(order);
      sendOrderEmail(order); // fire-and-forget
    } catch (e) { console.error("Order save failed:", e); }
    if (onOrderPlaced) onOrderPlaced(order);
    setLastOrderId(order.id);
    setProcessing(false);
    setStep(4);
  };
  const inpS = (f) => ({ width: "100%", padding: "12px 14px", borderRadius: 10, fontSize: 14, border: errors[f] ? "1.5px solid #ff6b6b" : `1px solid ${S.border}`, background: "rgba(255,255,255,0.04)", color: S.text, fontFamily: S.font, outline: "none", boxSizing: "border-box" });
  const labS = { fontSize: 12, fontWeight: 600, color: S.muted, fontFamily: S.fontHead, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6, display: "block" };
  const secBox = { background: "rgba(255,255,255,0.02)", border: `1px solid rgba(255,255,255,0.06)`, borderRadius: 16, padding: 24, marginBottom: 20 };

  if (step === 4) return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "60px 24px", textAlign: "center" }}>
      <div style={{ width: 80, height: 80, borderRadius: "50%", background: `linear-gradient(135deg, ${S.teal}, #00a88a)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 24px" }}>✓</div>
      <h2 style={{ fontSize: 28, fontWeight: 800, fontFamily: S.fontHead, marginBottom: 12, color: S.text }}>Order Confirmed!</h2>
      {lastOrderId && <p style={{ fontSize: 13, fontFamily: S.fontMono, color: S.teal, fontWeight: 700, marginBottom: 8 }}>Ref: {lastOrderId}</p>}
      <p style={{ color: S.muted, fontSize: 15, marginBottom: 32 }}>{shipping?.id === "collection" ? `Thanks ${form.name.split(" ")[0]}! Elijah will bring it to school.` : `Thanks ${form.name.split(" ")[0]}! Elijah will print and ship it.`}</p>
      <button onClick={onBack} style={{ padding: "13px 32px", borderRadius: 12, border: "none", background: "rgba(255,255,255,0.05)", color: S.text, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}>Back to Shop</button>
    </div>
  );
  return (
    <div className="ep-checkout-page" style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px 80px" }}>
      <button onClick={step === 1 ? onBack : () => setStep(step - 1)} style={{ background: "none", border: "none", color: S.teal, cursor: "pointer", fontSize: 14, fontFamily: S.fontHead, fontWeight: 600, marginBottom: 24 }}>← {step === 1 ? "Back to Shop" : "Back"}</button>
      <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 40 }}>
        {["Shipping", shipping?.id === "collection" ? "Details" : "Address", "Payment"].map((label, i) => (
          <div key={i} style={{ flex: 1, display: "flex", alignItems: "center" }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, fontFamily: S.fontHead, background: step > i + 1 ? S.teal : step === i + 1 ? "rgba(0,201,167,0.15)" : "rgba(255,255,255,0.05)", color: step > i + 1 ? "#1a1a2e" : step === i + 1 ? S.teal : S.dimmer, border: step === i + 1 ? `1.5px solid ${S.teal}` : `1px solid ${S.border}`, flexShrink: 0 }}>{step > i + 1 ? "✓" : i + 1}</div>
            <span className="ep-step-label" style={{ fontSize: 12, fontWeight: 600, color: step >= i + 1 ? S.text : S.dimmer, fontFamily: S.fontHead, marginLeft: 8, whiteSpace: "nowrap" }}>{label}</span>
            {i < 2 && <div style={{ flex: 1, height: 1, marginLeft: 12, background: step > i + 1 ? S.teal : S.border }} />}
          </div>
        ))}
      </div>
      <div className="ep-checkout-grid" style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 32, alignItems: "start" }}>
        <div>
          {step === 1 && (<div style={secBox}>
            <h3 style={{ fontSize: 18, fontWeight: 700, fontFamily: S.fontHead, color: S.text, marginBottom: 16 }}>How do you want your prints?</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {SHIPPING_OPTIONS.map(opt => { const isFree = opt.id === "collection" || (qualifiesFree && opt.id !== "collection"); const sel = shipping?.id === opt.id; return (
                <button key={opt.id} onClick={() => setShipping(opt)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderRadius: 12, cursor: "pointer", textAlign: "left", border: sel ? `1.5px solid ${S.teal}` : `1px solid ${S.border}`, background: sel ? "rgba(0,201,167,0.06)" : S.card }}>
                  <span style={{ fontSize: 22 }}>{opt.icon}</span>
                  <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700, color: sel ? S.teal : S.text, fontFamily: S.fontHead }}>{opt.name}</div><div style={{ fontSize: 12, color: S.muted, marginTop: 2 }}>{opt.description}</div></div>
                  <span style={{ fontSize: 14, fontWeight: 800, color: isFree ? S.teal : S.text, fontFamily: S.fontMono }}>{isFree ? "FREE" : `£${opt.price.toFixed(2)}`}</span>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", border: sel ? `6px solid ${S.teal}` : "2px solid rgba(255,255,255,0.15)", flexShrink: 0 }} />
                </button>
              ); })}
            </div>
            <button onClick={nextStep} style={{ marginTop: 20, width: "100%", padding: "14px 0", borderRadius: 12, border: "none", background: `linear-gradient(135deg, ${S.teal}, #00a88a)`, color: "#1a1a2e", fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: S.fontHead, textTransform: "uppercase" }}>Continue →</button>
          </div>)}
          {step === 2 && (<div style={secBox}>
            <h3 style={{ fontSize: 18, fontWeight: 700, fontFamily: S.fontHead, color: S.text, marginBottom: 20 }}>{shipping?.id === "collection" ? "Your Details" : "Delivery Address"}</h3>
            <div style={{ display: "grid", gap: 16 }}>
              <div className="ep-form-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={labS}>Full Name *</label><input style={inpS("name")} value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
                <div><label style={labS}>Email *</label><input style={inpS("email")} type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} /></div>
              </div>
              {shipping?.id === "collection" ? (
                <div><label style={labS}>Phone / Instagram</label><input style={inpS("phone")} value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="07700 900000 or @username" /></div>
              ) : (<>
<div><label style={labS}>Address Line 1 *</label><input style={inpS("address1")} value={form.address1} onChange={e => setForm({...form, address1: e.target.value})} placeholder="House number and street" /></div>
                <div><label style={labS}>Address Line 2</label><input style={inpS("address2")} value={form.address2} onChange={e => setForm({...form, address2: e.target.value})} placeholder="Flat, building, floor (optional)" /></div>
                <div className="ep-form-3col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <div><label style={labS}>City / Town *</label><input style={inpS("city")} value={form.city} onChange={e => setForm({...form, city: e.target.value})} /></div>
                  <div><label style={labS}>County</label><input style={inpS("county")} value={form.county} onChange={e => setForm({...form, county: e.target.value})} /></div>
                  <div><label style={labS}>Postcode *</label><input style={inpS("postcode")} value={form.postcode} onChange={e => setForm({...form, postcode: e.target.value})} /></div>
                </div>
                <div><label style={labS}>Phone</label><input style={inpS("phone")} value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="In case Royal Mail needs to contact you" /></div>
              </>)}
            </div>
            <button onClick={nextStep} style={{ marginTop: 20, width: "100%", padding: "14px 0", borderRadius: 12, border: "none", background: `linear-gradient(135deg, ${S.teal}, #00a88a)`, color: "#1a1a2e", fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: S.fontHead, textTransform: "uppercase" }}>Continue to Payment →</button>
          </div>)}
          {step === 3 && (<div style={secBox}>
            <h3 style={{ fontSize: 18, fontWeight: 700, fontFamily: S.fontHead, color: S.text, marginBottom: 16 }}>Review & Pay</h3>
            {/* Tip selector at checkout */}
            {!currentTip && (
              <div style={{ background: "rgba(255,165,0,0.04)", border: "1px solid rgba(255,165,0,0.12)", borderRadius: 14, padding: "18px 20px", marginBottom: 16, textAlign: "center" }}>
                <p style={{ fontSize: 14, fontWeight: 700, fontFamily: S.fontHead, color: S.text, marginBottom: 4 }}>🧡 Support Elijah</p>
                <p style={{ fontSize: 12, color: S.muted, marginBottom: 12, lineHeight: 1.5 }}>Buy him a roll of filament to keep the printer running!</p>
                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                  {TIP_OPTIONS.map(t => (
                    <button key={t.amount} onClick={() => onAddTip(t.amount)} style={{ padding: "8px 18px", borderRadius: 10, border: `1px solid rgba(0,201,167,0.2)`, background: "rgba(0,201,167,0.06)", color: S.teal, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: S.fontMono, transition: "all 0.2s" }}>{t.emoji} {t.label}</button>
                  ))}
                </div>
              </div>
            )}
            {currentTip && (
              <div style={{ background: "rgba(0,201,167,0.04)", border: `1px solid rgba(0,201,167,0.15)`, borderRadius: 14, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: S.teal, fontFamily: S.fontHead }}>🧡 £{currentTip.price.toFixed(2)} tip added — thank you!</span>
                </div>
                <button onClick={onRemoveTip} style={{ background: "none", border: "none", color: S.dimmer, cursor: "pointer", fontSize: 12, fontFamily: S.fontHead, textDecoration: "underline" }}>Remove</button>
              </div>
            )}
            <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${S.border}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
              <p style={{ fontSize: 11, color: S.dimmer, textAlign: "center" }}>{USE_STRIPE ? "🔒 Secure payment via Stripe" : "Demo mode — connect Stripe for real payments"}</p>
            </div>
            <button onClick={handlePayment} disabled={processing} style={{ width: "100%", padding: "16px 0", borderRadius: 12, border: "none", background: processing ? "rgba(0,201,167,0.3)" : `linear-gradient(135deg, ${S.teal}, #00a88a)`, color: "#1a1a2e", fontSize: 16, fontWeight: 800, cursor: processing ? "wait" : "pointer", fontFamily: S.fontHead, textTransform: "uppercase" }}>{processing ? "Redirecting to payment..." : `🔒 Pay £${total.toFixed(2)}`}</button>
          </div>)}
        </div>
        <div className="ep-checkout-summary" style={{ background: "rgba(255,255,255,0.02)", border: `1px solid rgba(255,255,255,0.06)`, borderRadius: 16, padding: 20, position: "sticky", top: 84 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, fontFamily: S.fontHead, color: S.text, marginBottom: 12, textTransform: "uppercase" }}>Order</h4>
          {cart.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: 6, overflow: "hidden", flexShrink: 0, background: item.isTip ? "rgba(0,201,167,0.1)" : "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {item.isTip ? <span style={{ fontSize: 16 }}>🧡</span> : item.img ? <img src={item.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 14, opacity: 0.4 }}>📷</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12, fontWeight: 600, color: item.isTip ? S.teal : S.text, fontFamily: S.fontHead, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>{!item.isTip && <div style={{ fontSize: 10, color: S.dimmer }}>{item.selectedColors.join(" + ")} × {item.qty}</div>}</div>
              <span style={{ fontSize: 12, fontWeight: 700, color: item.isTip ? S.teal : S.text, fontFamily: S.fontMono }}>£{(item.price * item.qty).toFixed(2)}</span>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 10, marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}><span style={{ color: S.muted }}>Subtotal</span><span style={{ fontFamily: S.fontMono }}>£{subtotal.toFixed(2)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}><span style={{ color: S.muted }}>Shipping</span><span style={{ color: shippingCost === 0 ? S.teal : S.text, fontFamily: S.fontMono }}>{shippingCost === 0 ? "FREE" : `£${shippingCost.toFixed(2)}`}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}><span style={{ color: S.muted }}>Card fee</span><span style={{ fontFamily: S.fontMono }}>£{stripeFee.toFixed(2)}</span></div>
            <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 8, marginTop: 4, display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 700 }}>Total</span><span style={{ color: S.teal, fontFamily: S.fontMono, fontWeight: 800, fontSize: 20 }}>£{total.toFixed(2)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   CART DRAWER
   ═══════════════════════════════════════════════ */
function CartDrawer({ cart, onClose, onRemove, onUpdateQty, onCheckout }) {
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "relative", width: "min(420px, 90vw)", height: "100%", background: "#12122a", borderLeft: `1px solid ${S.border}`, display: "flex", flexDirection: "column", animation: "slideIn 0.3s cubic-bezier(0.16,1,0.3,1)" }}>
        <div style={{ padding: "24px 24px 16px", borderBottom: `1px solid rgba(255,255,255,0.06)`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, fontFamily: S.fontHead }}>Your Cart</h2>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${S.border}`, color: "#aaa", width: 36, height: 36, borderRadius: "50%", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          {cart.length === 0 ? <div style={{ textAlign: "center", padding: "60px 0", color: S.dimmer }}><div style={{ fontSize: 48, marginBottom: 16 }}>🛒</div><p>Empty</p></div>
          : cart.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: 12, background: item.isTip ? "rgba(0,201,167,0.04)" : S.card, borderRadius: 12, border: `1px solid ${item.isTip ? "rgba(0,201,167,0.15)" : S.border}`, marginBottom: 12 }}>
              <div style={{ width: 48, height: 48, borderRadius: 10, overflow: "hidden", flexShrink: 0, alignSelf: "center", background: item.isTip ? "rgba(0,201,167,0.1)" : "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {item.isTip ? <span style={{ fontSize: 24 }}>🧡</span> : item.img ? <img src={item.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 22, opacity: 0.4 }}>📷</span>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: S.fontHead, color: item.isTip ? S.teal : S.text }}>{item.name}</span>
                  <button onClick={() => onRemove(i)} style={{ background: "none", border: "none", color: S.dimmer, cursor: "pointer", fontSize: 14 }}>✕</button>
                </div>
                {!item.isTip && (
                  <div style={{ fontSize: 11, color: S.dimmer, marginTop: 2, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {item.selectedColors.map((c, ci) => <span key={ci} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>{ci > 0 && "+"}<span style={{ width: 8, height: 8, borderRadius: "50%", background: FILAMENTS[c]?.hex || "#666" }} />{c}</span>)}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                  {!item.isTip ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button onClick={() => onUpdateQty(i, Math.max(1, item.qty - 1))} style={{ width: 26, height: 26, borderRadius: 6, border: `1px solid ${S.border}`, background: S.card, color: "#aaa", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                      <span style={{ fontWeight: 600, fontFamily: S.fontMono }}>{item.qty}</span>
                      <button onClick={() => onUpdateQty(i, item.qty + 1)} style={{ width: 26, height: 26, borderRadius: 6, border: `1px solid ${S.border}`, background: S.card, color: "#aaa", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                    </div>
                  ) : (
                    <span style={{ fontSize: 11, color: S.muted, fontFamily: S.fontHead }}>Filament fund</span>
                  )}
                  <span style={{ fontSize: 14, fontWeight: 700, color: S.teal, fontFamily: S.fontMono }}>£{(item.price * item.qty).toFixed(2)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        {cart.length > 0 && (
          <div style={{ padding: 24, borderTop: `1px solid rgba(255,255,255,0.06)`, background: "rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}><span style={{ color: S.muted }}>Subtotal</span><span style={{ fontSize: 24, fontWeight: 800, color: S.teal, fontFamily: S.fontMono }}>£{total.toFixed(2)}</span></div>
            <button onClick={onCheckout} style={{ width: "100%", padding: "14px 0", borderRadius: 12, border: "none", background: `linear-gradient(135deg, ${S.teal}, #00a88a)`, color: "#1a1a2e", fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: S.fontHead, textTransform: "uppercase" }}>Checkout →</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   SPECIAL REQUEST PAGE
   ═══════════════════════════════════════════════ */
function SpecialRequestPage({ onBack }) {
  const [step, setStep] = useState(1);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [reqId, setReqId] = useState("");
  const [form, setForm] = useState({ type: "", description: "", modelLink: "", size: "", colours: "", budget: "", notes: "", name: "", email: "" });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const TYPES = [
    { label: "🔑 Keyring / Bag Charm", value: "Keyring" },
    { label: "🎮 Fidget / Toy", value: "Fidget / Toy" },
    { label: "🌿 Planter / Vase", value: "Planter" },
    { label: "🏠 Household Item", value: "Household" },
    { label: "🐉 Figure / Ornament", value: "Figure / Ornament" },
    { label: "🎁 Gift / Novelty", value: "Gift / Novelty" },
    { label: "🔧 Practical / Tool", value: "Practical / Tool" },
    { label: "✨ Something Else", value: "Other" },
  ];
  const SIZES = ["Tiny (coin-sized)", "Small (palm-sized)", "Medium (mug-sized)", "Large (shoe box-sized)", "Not sure — you decide!"];
  const BUDGETS = ["Under £2", "£2 – £5", "£5 – £10", "£10 – £20", "Flexible — just quote me"];

  const canNext = step === 1 ? form.type : step === 2 ? form.description.length >= 10 : step === 3 ? form.size && form.budget : step === 4 ? form.name && form.email.includes("@") : true;

  const handleSubmit = async () => {
    setSending(true);
    const id = "REQ-" + Date.now().toString(36).toUpperCase().slice(-6);
    setReqId(id);
    await sendRequestEmail({ ...form, id });
    setSending(false);
    setSent(true);
  };

  const inputStyle = { width: "100%", padding: "14px 16px", borderRadius: 12, border: `1px solid ${S.border}`, background: "rgba(255,255,255,0.04)", color: S.text, fontSize: 15, fontFamily: S.font, boxSizing: "border-box" };
  const chipStyle = (active) => ({ display: "inline-flex", alignItems: "center", gap: 6, padding: "12px 20px", borderRadius: 14, border: `2px solid ${active ? S.teal : S.border}`, background: active ? "rgba(0,201,167,0.12)" : "rgba(255,255,255,0.03)", color: active ? S.teal : S.muted, cursor: "pointer", fontSize: 14, fontWeight: active ? 700 : 500, fontFamily: S.font, transition: "all 0.2s" });
  const labelStyle = { fontSize: 13, color: S.muted, marginBottom: 6, display: "block", fontWeight: 600 };

  if (sent) {
    return (
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "60px 24px", textAlign: "center" }}>
        <div style={{ width: 80, height: 80, borderRadius: "50%", background: "rgba(0,201,167,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 24px" }}>✉️</div>
        <h2 style={{ fontSize: 28, fontWeight: 800, fontFamily: S.fontHead, marginBottom: 8 }}>Request Sent!</h2>
        <p style={{ color: S.muted, fontSize: 15, lineHeight: 1.7, marginBottom: 8 }}>Your reference is <span style={{ color: S.teal, fontFamily: S.fontMono, fontWeight: 700 }}>{reqId}</span></p>
        <p style={{ color: S.dimmer, fontSize: 14, lineHeight: 1.7, marginBottom: 32 }}>Elijah will review your request and get back to you at <strong style={{ color: S.text }}>{form.email}</strong> with a quote and timeframe. Most requests get a reply within a day or two.</p>
        <button onClick={onBack} style={{ padding: "14px 32px", borderRadius: 14, border: "none", background: `linear-gradient(135deg, ${S.teal}, #00a88a)`, color: "#1a1a2e", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead }}>Back to Shop</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 620, margin: "0 auto", padding: "40px 24px 60px" }}>
      <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: S.muted, cursor: "pointer", fontSize: 14, marginBottom: 24, padding: 0 }}>← Back to shop</button>

      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, fontFamily: S.fontHead, marginBottom: 6 }}>Special Request ✨</h1>
        <p style={{ color: S.muted, fontSize: 14, lineHeight: 1.6 }}>Describe what you'd like and we'll see if we can make it!</p>
      </div>

      {/* Progress */}
      <div style={{ display: "flex", gap: 6, marginBottom: 36 }}>
        {[1,2,3,4].map(s => (
          <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: s <= step ? S.teal : "rgba(255,255,255,0.08)", transition: "background 0.3s" }} />
        ))}
      </div>

      {/* Step 1: Type */}
      {step === 1 && (
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, fontFamily: S.fontHead, marginBottom: 6 }}>What kind of item?</h2>
          <p style={{ color: S.dimmer, fontSize: 13, marginBottom: 20 }}>Pick the closest match — don't worry if it's not exact.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {TYPES.map(t => (
              <div key={t.value} onClick={() => set("type", t.value)} style={chipStyle(form.type === t.value)}>{t.label}</div>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Describe */}
      {step === 2 && (
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, fontFamily: S.fontHead, marginBottom: 6 }}>Describe what you'd like</h2>
          <p style={{ color: S.dimmer, fontSize: 13, marginBottom: 20 }}>The more detail the better — what does it look like? What's it for? Is it a specific character, animal, shape?</p>
          <label style={labelStyle}>Description *</label>
          <textarea value={form.description} onChange={e => set("description", e.target.value)} placeholder="E.g. A small articulated dragon that I can fidget with, about the size of my hand. Preferably with spiky wings..." rows={5} style={{ ...inputStyle, resize: "vertical", minHeight: 120, lineHeight: 1.6 }} />
          <div style={{ textAlign: "right", fontSize: 12, color: form.description.length >= 10 ? S.dimmer : S.teal, marginTop: 4 }}>{form.description.length < 10 ? `${10 - form.description.length} more characters needed` : "✓ Good"}</div>

          <div style={{ marginTop: 20 }}>
            <label style={labelStyle}>Link to a model (optional)</label>
            <input value={form.modelLink} onChange={e => set("modelLink", e.target.value)} placeholder="Paste a link from MakerWorld, Thingiverse, Printables..." style={inputStyle} />
            <p style={{ color: S.dimmer, fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>Found something on MakerWorld or Thingiverse? Paste the link here and we'll check if we can print it.</p>
          </div>
        </div>
      )}

      {/* Step 3: Preferences */}
      {step === 3 && (
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, fontFamily: S.fontHead, marginBottom: 6 }}>Size, colour & budget</h2>
          <p style={{ color: S.dimmer, fontSize: 13, marginBottom: 20 }}>These help us give you an accurate quote.</p>

          <label style={labelStyle}>How big should it be? *</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
            {SIZES.map(s => (
              <div key={s} onClick={() => set("size", s)} style={chipStyle(form.size === s)}>{s}</div>
            ))}
          </div>

          <label style={labelStyle}>Colour preference</label>
          <input value={form.colours} onChange={e => set("colours", e.target.value)} placeholder="E.g. blue and green, or rainbow, or surprise me!" style={{ ...inputStyle, marginBottom: 24 }} />

          <label style={labelStyle}>Budget *</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {BUDGETS.map(b => (
              <div key={b} onClick={() => set("budget", b)} style={chipStyle(form.budget === b)}>{b}</div>
            ))}
          </div>
        </div>
      )}

      {/* Step 4: Details & Review */}
      {step === 4 && (
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, fontFamily: S.fontHead, marginBottom: 6 }}>Your details & review</h2>
          <p style={{ color: S.dimmer, fontSize: 13, marginBottom: 20 }}>So we can get back to you with a quote.</p>

          <label style={labelStyle}>Your name *</label>
          <input value={form.name} onChange={e => set("name", e.target.value)} placeholder="First name is fine" style={{ ...inputStyle, marginBottom: 16 }} />

          <label style={labelStyle}>Your email *</label>
          <input value={form.email} onChange={e => set("email", e.target.value)} type="email" placeholder="you@example.com" style={{ ...inputStyle, marginBottom: 24 }} />

          <label style={labelStyle}>Anything else? (optional)</label>
          <textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Deadline, quantity, questions..." rows={3} style={{ ...inputStyle, resize: "vertical", marginBottom: 28 }} />

          {/* Summary */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${S.border}`, borderRadius: 16, padding: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, fontFamily: S.fontHead, marginBottom: 12, color: S.teal }}>Request Summary</h3>
            {[
              ["Type", form.type],
              ["Description", form.description.length > 80 ? form.description.slice(0, 80) + "…" : form.description],
              ["Model link", form.modelLink || "—"],
              ["Size", form.size],
              ["Colour", form.colours || "No preference"],
              ["Budget", form.budget],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", gap: 12, marginBottom: 8, fontSize: 13 }}>
                <span style={{ color: S.dimmer, minWidth: 80, flexShrink: 0 }}>{k}</span>
                <span style={{ color: S.text }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 32, gap: 12 }}>
        {step > 1 ? (
          <button onClick={() => setStep(s => s - 1)} style={{ padding: "14px 24px", borderRadius: 14, border: `1px solid ${S.border}`, background: "transparent", color: S.text, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}>Back</button>
        ) : <div />}
        {step < 4 ? (
          <button onClick={() => setStep(s => s + 1)} disabled={!canNext} style={{ padding: "14px 32px", borderRadius: 14, border: "none", background: canNext ? `linear-gradient(135deg, ${S.teal}, #00a88a)` : "rgba(255,255,255,0.08)", color: canNext ? "#1a1a2e" : S.dimmer, fontSize: 14, fontWeight: 700, cursor: canNext ? "pointer" : "not-allowed", fontFamily: S.fontHead, marginLeft: "auto" }}>Next →</button>
        ) : (
          <button onClick={handleSubmit} disabled={!canNext || sending} style={{ padding: "14px 32px", borderRadius: 14, border: "none", background: canNext ? `linear-gradient(135deg, ${S.purple}, ${S.teal})` : "rgba(255,255,255,0.08)", color: canNext ? "#fff" : S.dimmer, fontSize: 14, fontWeight: 700, cursor: canNext ? "pointer" : "not-allowed", fontFamily: S.fontHead, marginLeft: "auto" }}>{sending ? "Sending…" : "Send Request ✨"}</button>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════
   ERROR BOUNDARY — prevents full white-screen crashes
   ═══════════════════════════════════════════════ */
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err, info) { console.error("Elijah's Prints caught an error:", err, info); }
  render() {
    if (this.state.hasError) return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0e0e1f", color: "#e8e8e8", fontFamily: "'DM Sans', sans-serif", padding: 32, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔧</div>
        <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", marginBottom: 8 }}>Something went wrong</h2>
        <p style={{ color: "rgba(255,255,255,0.5)", marginBottom: 24 }}>Don't worry — try refreshing the page.</p>
        <button onClick={() => { this.setState({ hasError: false }); window.location.reload(); }} style={{ padding: "12px 28px", borderRadius: 12, border: "none", background: "#00c9a7", color: "#1a1a2e", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif" }}>Refresh</button>
      </div>
    );
    return this.props.children;
  }
}

function ElijahsPrintsInner() {
  const [products, setProducts] = useState(null);
  const [activeCat, setActiveCat] = useState("All");
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartAnim, setCartAnim] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState("shop");
  const [shipping, setShipping] = useState(SHIPPING_OPTIONS[0]);
  const [search, setSearch] = useState("");
  const [adminLoggedIn, setAdminLoggedIn] = useState(false);
  const [orders, setOrders] = useState([]);
  const [filamentVer, setFilamentVer] = useState(0);
  const [catVer, setCatVer] = useState(0);
  const [categoryMeta, setCategoryMeta] = useState({...DEFAULT_CATEGORY_META});
  const [authChecked, setAuthChecked] = useState(!USE_FIREBASE); // skip auth check if no Firebase
  const [stripeSuccess, setStripeSuccess] = useState(null); // holds completed order after Stripe redirect

  // Scroll to top when navigating between pages
  useEffect(() => { window.scrollTo(0, 0); }, [page]);

  // Auto-redirect: if on login page but already authenticated, go straight to admin
  useEffect(() => {
    if (page === "admin-login" && adminLoggedIn) {
      setPage("admin");
      loadOrders().then(o => setOrders(o || []));
    }
  }, [page, adminLoggedIn]);

  useEffect(() => {
    setLoaded(true);
    // Ensure viewport meta tag exists for mobile rendering
    if (!document.querySelector('meta[name="viewport"]')) {
      const meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
      document.head.appendChild(meta);
    }
    loadProducts().then(p => {
      if (!p) { setProducts([...SEED_PRODUCTS]); saveProducts([...SEED_PRODUCTS]); return; }
      // Ensure all products have addedDate (set today for existing products without one)
      const today = new Date().toISOString();
      let needsSave = false;
      const enriched = p.map(prod => {
        if (!prod.addedDate) { needsSave = true; return { ...prod, addedDate: today }; }
        return prod;
      });
      setProducts(enriched);
      if (needsSave) saveProducts(enriched);
    });
    loadOrders().then(o => setOrders(o || []));
    loadFilaments().then(f => {
      if (f) { FILAMENTS = f; ALL_COLORS = Object.keys(f); setFilamentVer(v => v + 1); }
    });
    loadCategories().then(cats => {
      if (cats) { categories = cats; setCatVer(v => v + 1); }
    });
    loadCategoryMeta().then(meta => {
      if (meta) setCategoryMeta(meta);
      else saveCategoryMeta({...DEFAULT_CATEGORY_META}); // seed defaults on first run
    });
    // Firebase auth state: auto-login if session persists (e.g. browser refresh)
    if (USE_FIREBASE) {
      firebaseOnAuth(user => {
        if (user) { setAdminLoggedIn(true); if (page === "admin-login") setPage("admin"); loadOrders().then(o => setOrders(o || [])); }
        else setAdminLoggedIn(false);
        setAuthChecked(true);
      });
    }
  }, []);

  // Handle return from Stripe Checkout
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    if (payment === "success") {
      const pending = localStorage.getItem("ep_pending_order");
      if (pending) {
        try {
          const orderData = JSON.parse(pending);
          // Validate order has real items (prevents bot/blank orders)
          const realItems = (orderData.items || []).filter(i => !i.isTip && i.name && i.id);
          if (realItems.length === 0 && !(orderData.items || []).some(i => i.isTip)) {
            console.warn("⚠️ Blank order blocked — no items or payment data");
            localStorage.removeItem("ep_pending_order");
            window.history.replaceState({}, "", window.location.pathname);
            return;
          }
          const isTipOnly = orderData.items && orderData.items.length > 0 && orderData.items.every(i => i.isTip);
          const order = {
            id: "EP-" + Date.now().toString(36).toUpperCase(),
            date: new Date().toISOString(),
            ...orderData,
            status: isTipOnly
              ? { paid: true, produced: true, labelPrinted: true, despatched: true }
              : { paid: true, produced: false, labelPrinted: false, despatched: false },
          };
          addOrder(order).catch(e => console.error("Order save failed:", e));
          sendOrderEmail(order);
          setOrders(prev => [...prev, order]);
          setStripeSuccess(order);
          localStorage.removeItem("ep_pending_order");
        } catch (e) { console.error("Failed to process Stripe return:", e); }
      }
      window.history.replaceState({}, "", window.location.pathname);
    } else if (payment === "cancelled") {
      localStorage.removeItem("ep_pending_order");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const shopProducts = useMemo(() => {
    if (!products) return [];
    let p = products.filter(x => x.available !== false);
    if (activeCat !== "All") p = p.filter(x => x.category === activeCat);
    if (search.trim()) { const q = search.toLowerCase(); p = p.filter(x => x.name.toLowerCase().includes(q) || x.description.toLowerCase().includes(q)); }
    return p;
  }, [activeCat, search, products]);

  const addToCart = (product, selectedColors) => {
    const adjustedPrice = getPremiumPrice(product.price, selectedColors);
    const key = product.id + "-" + selectedColors.join(",");
    const i = cart.findIndex(c => (c.id + "-" + c.selectedColors.join(",")) === key);
    if (i >= 0) { const u = [...cart]; u[i].qty += 1; setCart(u); }
    else setCart([...cart, { ...product, price: adjustedPrice, selectedColors, qty: 1 }]);
    setCartAnim(product.id); setTimeout(() => setCartAnim(null), 1200);
  };

  const removeFromCart = i => setCart(cart.filter((_, idx) => idx !== i));
  const updateQty = (i, q) => { const u = [...cart]; u[i].qty = q; setCart(u); };
  const totalItems = cart.reduce((s, i) => s + i.qty, 0);
  const addTip = (amount) => {
    const withoutTip = cart.filter(i => !i.isTip);
    setCart([...withoutTip, { id: "tip", name: "Support Elijah 🧡", price: amount, qty: 1, selectedColors: [], isTip: true, img: "" }]);
  };
  const removeTip = () => setCart(cart.filter(i => !i.isTip));
  const currentTip = cart.find(i => i.isTip);
  const handleSaveProducts = async (p) => { setProducts(p); await saveProducts(p); };

  // Auto-compute badges based on sales data and product attributes
  const autoBadges = useMemo(() => computeAutoBadges(products || [], orders), [products, orders]);
  const handleUpdateOrderStatus = async (orderId, newStatus) => {
    const order = orders.find(o => o.id === orderId);
    const wasDespatched = order?.status?.despatched;
    const wasProduced = order?.status?.produced;
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
    await updateOrderStatus(orderId, newStatus);
    if (newStatus.despatched && !wasDespatched && order) {
      sendShippedEmail(order);
    } else if (newStatus.produced && !wasProduced && !newStatus.despatched && order) {
      sendMadeEmail(order);
    }
  };
  const handleOrderPlaced = (order) => { setOrders(prev => [...prev, order]); };
  const handleSaveFilaments = async (f) => { FILAMENTS = f; ALL_COLORS = Object.keys(f); setFilamentVer(v => v + 1); await saveFilaments(f); };
const handleSaveCategories = async (cats) => { categories = cats; setCatVer(v => v + 1); await saveCategories(cats); };
const handleSaveCategoryMeta = async (meta) => { setCategoryMeta(meta); await saveCategoryMeta(meta); };

   
 const displayCategories = useMemo(() => ["All", ...categories], [catVer]);

  const catCounts = useMemo(() => {
    if (!products) return {};
    const avail = products.filter(x => x.available !== false);
    const c = { All: avail.length };
    categories.forEach(cat => { c[cat] = avail.filter(p => p.category === cat).length; });
    return c;
  }, [products, catVer]);
  if (!products) return <div style={{ minHeight: "100vh", background: S.dark, display: "flex", alignItems: "center", justifyContent: "center", color: S.teal, fontFamily: S.fontHead, fontSize: 18 }}>Loading...</div>;

  return (
    <div style={{ minHeight: "100vh", background: S.dark, color: S.text, fontFamily: S.font }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes slideIn { from { transform: translateX(100%) } to { transform: translateX(0) } }
        @keyframes heroGlow { 0%,100% { opacity: 0.5 } 50% { opacity: 0.8 } }
        @keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }
        ::-webkit-scrollbar { width: 6px } ::-webkit-scrollbar-track { background: transparent } ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px }
        input:focus, textarea:focus, select:focus { border-color: ${S.teal} !important; box-shadow: 0 0 0 3px rgba(0,201,167,0.1); outline: none }
        input, textarea, select { font-size: 16px !important; }
        @media (max-width: 768px) {
          .ep-checkout-grid { grid-template-columns: 1fr !important; }
          .ep-checkout-summary { position: static !important; order: -1; margin-bottom: 20px; }
          .ep-form-2col { grid-template-columns: 1fr !important; }
          .ep-form-3col { grid-template-columns: 1fr !important; }
          .ep-checkout-steps span.ep-step-label { display: none !important; }
          .ep-order-header { display: none !important; }
          .ep-order-row { grid-template-columns: 1fr !important; }
          .ep-order-check { justify-content: flex-start !important; }
          .ep-check-label { display: inline !important; }
          .ep-stats-grid { grid-template-columns: repeat(3, 1fr) !important; }
          .ep-editor-2col { grid-template-columns: 1fr !important; }
          .ep-hero { padding: 40px 16px 28px !important; }
          .ep-product-grid { padding: 0 12px 40px !important; gap: 12px !important; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)) !important; }
          .ep-cat-bar { padding: 0 12px 20px !important; }
          .ep-nav-request { display: none !important; }
          .ep-nav { padding: 0 12px !important; }
          .ep-section-pad { padding-left: 12px !important; padding-right: 12px !important; }
          .ep-cta-box { padding: 28px 20px !important; }
          .ep-checkout-page { padding: 24px 12px 60px !important; }
          .ep-admin-colours-grid { grid-template-columns: 1fr !important; }
          .ep-colour-form-grid { grid-template-columns: 1fr !important; }
          button:not(.ep-swatch), [role="button"] { min-height: 44px; }
          .ep-checkout-page input, .ep-checkout-page select, .ep-checkout-page textarea { min-height: 48px; font-size: 16px !important; }
        }
        @media (max-width: 380px) {
          .ep-product-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <nav className="ep-nav" style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(14,14,31,0.85)", backdropFilter: "blur(20px)", borderBottom: `1px solid rgba(255,255,255,0.05)`, padding: "0 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div onClick={async () => { setPage("shop"); if (USE_FIREBASE && adminLoggedIn) await firebaseSignOut(); setAdminLoggedIn(false); }} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${S.teal}, ${S.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⬡</div>
            <span style={{ fontSize: 20, fontWeight: 800, fontFamily: S.fontHead }}><span style={{ color: S.teal }}>Elijah's</span> 3D Print World</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {page !== "admin" && (<>
              <button className="ep-nav-request" onClick={() => setPage("request")} style={{ background: "none", border: `1px solid rgba(132,94,247,0.3)`, color: S.purple, padding: "8px 14px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontFamily: S.fontHead, fontWeight: 600 }}>✨ Request</button>
              <button onClick={() => { if (adminLoggedIn) { setPage("admin"); loadOrders().then(o => setOrders(o || [])); } else { setPage("admin-login"); } }} style={{ background: "none", border: "none", color: S.dimmer, cursor: "pointer", fontSize: 16, padding: 8 }} title="Admin">🔧</button>
              <button onClick={() => setCartOpen(true)} style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${S.border}`, color: S.text, padding: "8px 16px", borderRadius: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontFamily: S.fontHead, fontWeight: 600, position: "relative" }}>
                🛒{totalItems > 0 && <span style={{ background: S.teal, color: "#1a1a2e", width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, position: "absolute", top: -6, right: -6 }}>{totalItems}</span>}<span style={{ fontSize: 13 }}>Cart</span>
              </button>
            </>)}
          </div>
        </div>
      </nav>

      {page === "admin-login" && !adminLoggedIn && <AdminLogin onLogin={() => { setAdminLoggedIn(true); setPage("admin"); }} />}
      {page === "admin" && adminLoggedIn && <AdminPanel products={products} onSave={handleSaveProducts} onLogout={async () => { if (USE_FIREBASE) await firebaseSignOut(); setAdminLoggedIn(false); setPage("shop"); }} orders={orders} onUpdateOrders={handleUpdateOrderStatus} onSaveFilaments={handleSaveFilaments} onSaveCategories={handleSaveCategories} categoryMeta={categoryMeta} onSaveCategoryMeta={handleSaveCategoryMeta} autoBadges={autoBadges} />}
      {page === "checkout" && <CheckoutPage cart={cart} shipping={shipping} setShipping={setShipping} onBack={() => { setPage("shop"); setShipping(SHIPPING_OPTIONS[0]); setCart([]); }} onOrderPlaced={handleOrderPlaced} onAddTip={addTip} onRemoveTip={removeTip} />}
      {page === "request" && <SpecialRequestPage onBack={() => setPage("shop")} />}

      {/* Stripe payment success — shown after redirect back from Stripe */}
      {stripeSuccess && (
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "60px 24px", textAlign: "center" }}>
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: `linear-gradient(135deg, ${S.teal}, #00a88a)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 24px" }}>✓</div>
          <h2 style={{ fontSize: 28, fontWeight: 800, fontFamily: S.fontHead, marginBottom: 12, color: S.text }}>Payment Successful!</h2>
          {stripeSuccess.id && <p style={{ fontSize: 13, fontFamily: S.fontMono, color: S.teal, fontWeight: 700, marginBottom: 8 }}>Ref: {stripeSuccess.id}</p>}
          <p style={{ color: S.muted, fontSize: 15, marginBottom: 32 }}>
            {stripeSuccess.items?.every(i => i.isTip)
              ? `Thanks ${stripeSuccess.customer?.name?.split(" ")[0] || ""}! 🧡 Your support means the world to Elijah!`
              : stripeSuccess.shipping?.id === "collection"
              ? `Thanks ${stripeSuccess.customer?.name?.split(" ")[0] || ""}! Elijah will bring it to school.`
              : `Thanks ${stripeSuccess.customer?.name?.split(" ")[0] || ""}! Elijah will print and ship it.`}
          </p>
          <button onClick={() => { setStripeSuccess(null); setCart([]); setPage("shop"); }} style={{ padding: "13px 32px", borderRadius: 12, border: "none", background: "rgba(255,255,255,0.05)", color: S.text, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}>Back to Shop</button>
        </div>
      )}

      {page === "shop" && (<>
        <header className="ep-hero" style={{ position: "relative", padding: "60px 24px 40px", textAlign: "center", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,201,167,0.12), transparent 70%)", animation: "heroGlow 4s ease-in-out infinite", pointerEvents: "none" }} />
          <div style={{ position: "relative", opacity: loaded ? 1 : 0, transform: loaded ? "translateY(0)" : "translateY(30px)", transition: "all 0.8s cubic-bezier(0.16,1,0.3,1)" }}>
            <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 800, fontFamily: S.fontHead, lineHeight: 1.1, letterSpacing: "-2px", marginBottom: 12, background: "linear-gradient(135deg, #fff, #a0a0a0)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Elijah's 3D<br /><span style={{ background: `linear-gradient(135deg, ${S.teal}, ${S.purple})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Print World</span>
            </h1>
            <div style={{ display: "inline-block", background: "rgba(0,201,167,0.08)", border: "1px solid rgba(0,201,167,0.15)", padding: "10px 24px", borderRadius: 20, fontSize: "clamp(11px, 2.5vw, 13px)", color: S.muted, fontFamily: S.font, fontWeight: 600, marginBottom: 20, fontStyle: "italic", lineHeight: 1.8, textAlign: "center", maxWidth: 460 }}>
              I got <span style={{ color: S.teal, fontWeight: 800, fontStyle: "normal", fontFamily: S.fontHead, textTransform: "uppercase", letterSpacing: "1px" }}>BANNED</span> from selling 3D prints at school…<br /><span style={{ color: S.teal, fontWeight: 700, fontStyle: "normal" }}>so I built this website instead!!</span>
            </div>
            <p style={{ fontSize: "clamp(13px, 2.5vw, 16px)", color: S.muted, maxWidth: 520, margin: "0 auto 20px", lineHeight: 1.7, fontStyle: "italic" }}>Bambu Lab P1S Combo · Ships from Wales 🏴󠁧󠁢󠁷󠁬󠁳󠁿</p>
            <p style={{ fontSize: 15, color: S.muted, maxWidth: 480, margin: "0 auto 20px", lineHeight: 1.6 }}>{catCounts.All || 0} products · {ALL_COLORS.length} colours · Free school drop-off or UK-wide shipping</p>
            <div style={{ display: "flex", gap: 5, justifyContent: "center", flexWrap: "wrap", maxWidth: 340, margin: "0 auto" }}>
              {ALL_COLORS.map(name => <div key={name} title={name} style={{ width: 20, height: 20, borderRadius: "50%", background: FILAMENTS[name].hex, border: "2px solid rgba(255,255,255,0.15)", boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }} />)}
            </div>
          </div>
        </header>

        <div className="ep-section-pad" style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px 12px" }}>
          <div style={{ maxWidth: 400, margin: "0 auto 16px" }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products..." style={{ width: "100%", padding: "10px 16px", borderRadius: 12, border: `1px solid ${S.border}`, background: S.card, color: S.text, fontSize: 14, fontFamily: S.font, outline: "none", textAlign: "center" }} />
          </div>
        </div>
        <div className="ep-cat-bar" style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px 28px", display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {displayCategories.map(cat => (
            <button key={cat} onClick={() => setActiveCat(cat)} style={{ padding: "8px 16px", borderRadius: 20, border: activeCat === cat ? `1.5px solid ${S.teal}` : `1px solid ${S.border}`, background: activeCat === cat ? "rgba(0,201,167,0.1)" : "rgba(255,255,255,0.02)", color: activeCat === cat ? S.teal : S.muted, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead, display: "flex", alignItems: "center", gap: 6 }}>
              {cat}<span style={{ fontSize: 11, color: activeCat === cat ? "rgba(0,201,167,0.6)" : S.dimmer, fontFamily: S.fontMono }}>{catCounts[cat] || 0}</span>
            </button>
          ))}
        </div>

        <div className="ep-product-grid" style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px 60px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 18 }}>
          {shopProducts.length === 0 ? <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px 0", color: S.dimmer }}>{search ? `Nothing found for "${search}"` : "No products available"}</div>
          : shopProducts.map((product, i) => (
            <div key={product.id} style={{ opacity: loaded ? 1 : 0, transform: loaded ? "translateY(0)" : "translateY(20px)", transition: `all 0.5s cubic-bezier(0.16,1,0.3,1) ${Math.min(i * 0.05, 0.4)}s` }}>
              <ProductCard product={{ ...product, badge: autoBadges[product.id] || null }} onAddToCart={addToCart} cartAnimation={cartAnim} />
            </div>
          ))}
        </div>

        <div style={{ maxWidth: 800, margin: "0 auto 60px", padding: "0 24px" }}>
          <div className="ep-cta-box" style={{ background: `linear-gradient(135deg, rgba(0,201,167,0.08), rgba(132,94,247,0.08))`, border: "1px solid rgba(0,201,167,0.12)", borderRadius: 20, padding: "36px 28px", textAlign: "center" }}>
            <h2 style={{ fontSize: 24, fontWeight: 800, fontFamily: S.fontHead, marginBottom: 8 }}>Got a Custom Idea? 💡</h2>
            <p style={{ color: S.muted, fontSize: 14, marginBottom: 18, lineHeight: 1.6 }}>Can't find what you're looking for? Describe it and we'll see if we can print it for you!</p>
            <button onClick={() => setPage("request")} style={{ padding: "12px 28px", borderRadius: 12, border: "none", background: `linear-gradient(135deg, ${S.teal}, #00a88a)`, color: "#1a1a2e", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead, textTransform: "uppercase" }}>Request Custom Print</button>
          </div>
        </div>

        {/* Tip Jar Section */}
        <div style={{ maxWidth: 600, margin: "0 auto 60px", padding: "0 24px" }}>
          <div style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${S.border}`, borderRadius: 20, padding: "32px 28px", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🧡</div>
            <h2 style={{ fontSize: 22, fontWeight: 800, fontFamily: S.fontHead, marginBottom: 6, color: S.text }}>Buy Elijah a Roll of Filament</h2>
            <p style={{ color: S.muted, fontSize: 13, marginBottom: 20, lineHeight: 1.6, maxWidth: 400, margin: "0 auto 20px" }}>Every print uses filament — your tip helps keep the printer running and the ideas flowing!</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginBottom: 12 }}>
              {TIP_OPTIONS.map(t => {
                const isActive = currentTip?.price === t.amount;
                return (
                  <button key={t.amount} onClick={() => isActive ? removeTip() : addTip(t.amount)} style={{
                    padding: "12px 24px", borderRadius: 12, cursor: "pointer", fontSize: 16, fontWeight: 800, fontFamily: S.fontMono, transition: "all 0.2s",
                    border: isActive ? `2px solid ${S.teal}` : `1px solid ${S.border}`,
                    background: isActive ? "rgba(0,201,167,0.12)" : "rgba(255,255,255,0.03)",
                    color: isActive ? S.teal : S.text,
                    transform: isActive ? "scale(1.05)" : "scale(1)",
                  }}>{t.emoji} {t.label}</button>
                );
              })}
            </div>
            {currentTip && <p style={{ fontSize: 12, color: S.teal, fontFamily: S.fontHead, fontWeight: 600 }}>✓ £{currentTip.price.toFixed(2)} added to your cart</p>}
          </div>
        </div>

        <footer style={{ borderTop: `1px solid rgba(255,255,255,0.05)`, padding: "28px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: S.dimmer }}><span style={{ color: S.teal, fontWeight: 700, fontFamily: S.fontHead }}>Elijah's 3D Print World</span> · Bambu Lab P1S Combo · Flintshire, Wales<br /><span style={{ fontSize: 11, marginTop: 8, display: "inline-block" }}>© 2026</span></div>
        </footer>
      </>)}

      {cartOpen && <CartDrawer cart={cart} onClose={() => setCartOpen(false)} onRemove={removeFromCart} onUpdateQty={updateQty} onCheckout={() => { setCartOpen(false); setPage("checkout"); }} />}
    </div>
  );
}

export default function ElijahsPrints() {
  return <ErrorBoundary><ElijahsPrintsInner /></ErrorBoundary>;
}

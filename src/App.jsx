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
  const app = initializeApp(FIREBASE_CONFIG);
  const db = getFirestore(app);
  const auth = getAuth(app);
  _fb = { db, doc, getDoc, setDoc, collection, getDocs, updateDoc, auth, signInWithEmailAndPassword, signOut, onAuthStateChanged };
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
    try {
      const { db, doc, getDoc } = await getFirebase();
      const snap = await getDoc(doc(db, "shop", key));
      return snap.exists() ? snap.data().value : null;
    } catch (e) { console.error("Firebase get failed:", e); return null; }
  }
  try {
    const r = await window.storage.get(key);
    return r ? r.value : null;
  } catch { return null; }
}

async function storageSet(key, value) {
  if (USE_FIREBASE) {
    try {
      const { db, doc, setDoc } = await getFirebase();
      await setDoc(doc(db, "shop", key), { value, updatedAt: new Date().toISOString() });
    } catch (e) { console.error("Firebase set failed:", e); }
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
  serviceId: "service_yfqmmph",
  templateId: "template_ses8533",
  requestTemplateId: "template_ses8533", // this is the confirmation to Elijah
  shippedTemplateId: "template_qouy2wj", // this is the confirmation to customer when sent 
  publicKey: "7wzdRK1WVUcOewtz3",
  recipientEmail: "johnianthompson@outlook.com, etprintworld@outlook.com",
  enabled: true,
};

let emailjsLoaded = false;
function loadEmailJS() {
  if (emailjsLoaded) return Promise.resolve();
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
    script.onload = () => { emailjsLoaded = true; resolve(); };
    script.onerror = () => resolve(); // fail silently
    document.head.appendChild(script);
  });
}

async function sendOrderEmail(order) {
  if (!EMAILJS_CONFIG.enabled) {
    console.log("📧 Email notification (demo mode — configure EmailJS to enable):", order);
    return;
  }
  try {
    await loadEmailJS();
    if (!window.emailjs) return;
    window.emailjs.init(EMAILJS_CONFIG.publicKey);
    const itemsList = order.items.map(i =>
      `${i.qty}× ${i.name} (${i.selectedColors.join(" + ")})`
    ).join("\n");
    const address = order.shipping.id === "collection"
      ? "🎒 School collection"
      : [order.customer.address1, order.customer.address2, order.customer.city, order.customer.county, order.customer.postcode].filter(Boolean).join(", ");
    await window.emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
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
    });
    console.log("📧 Order email sent successfully");
  } catch (e) {
    console.error("📧 Email send failed:", e);
  }
}
async function sendShippedEmail(order) {
  if (!EMAILJS_CONFIG.enabled || !EMAILJS_CONFIG.shippedTemplateId) return;
  try {
    await loadEmailJS();
    if (!window.emailjs) return;
    window.emailjs.init(EMAILJS_CONFIG.publicKey);
    const itemsList = order.items.map(i =>
      `${i.qty}× ${i.name} (${i.selectedColors.join(" + ")})`
    ).join("\n");
    const isCollection = order.shipping?.id === "collection";
    await window.emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.shippedTemplateId, {
      to_email: order.customer.email,
      order_id: order.id,
      customer_name: order.customer.name.split(" ")[0],
      order_items: itemsList,
      delivery_method: isCollection ? "handed over at school" : "shipped",
      delivery_message: isCollection
        ? "Elijah will bring it to school — keep an eye out!"
        : "Your order is on its way via Royal Mail Tracked 48. It should arrive within 2-3 working days.",
    });
    console.log("📧 Shipped email sent to", order.customer.email);
  } catch (e) {
    console.error("📧 Shipped email failed:", e);
  }
}

async function sendRequestEmail(request) {
  if (!EMAILJS_CONFIG.enabled) {
    console.log("📧 Special request email (demo mode):", request);
    return;
  }
  try {
    await loadEmailJS();
    if (!window.emailjs) return;
    window.emailjs.init(EMAILJS_CONFIG.publicKey);
    await window.emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.requestTemplateId, {
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
    <button onClick={disabled ? undefined : onClick} title={`${name} (${fil.type})`} disabled={disabled} style={{
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

function ProductImage({ product, hovered }) {
  const [err, setErr] = useState(false);
  const hasImg = product.img && !err;
  return (
    <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, rgba(0,201,167,0.05), rgba(132,94,247,0.05))", position: "relative", overflow: "hidden" }}>
      {hasImg ? <img src={product.img} alt={product.name} onError={() => setErr(true)} style={{ width: "100%", height: "100%", objectFit: "cover", transition: "transform 0.4s", transform: hovered ? "scale(1.08)" : "scale(1)" }} />
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
  const toggleColor = (color) => {
    if (maxC === 1) { setSelectedColors([color]); return; }
    if (selectedColors.includes(color)) { if (selectedColors.length > 1) setSelectedColors(selectedColors.filter(c => c !== color)); }
    else { if (selectedColors.length < maxC) setSelectedColors([...selectedColors, color]); else setSelectedColors([...selectedColors.slice(1), color]); }
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
        <p style={{ margin: "0 0 10px", fontSize: 12, lineHeight: 1.5, color: S.muted }}>{product.description}</p>
        {maxC > 1 && <div style={{ fontSize: 11, color: S.purple, fontFamily: S.fontMono, fontWeight: 600, marginBottom: 6, background: "rgba(132,94,247,0.08)", padding: "4px 8px", borderRadius: 6, display: "inline-block", border: "1px solid rgba(132,94,247,0.15)" }}>Pick {maxC} colours</div>}
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 4 }}>
          {product.colors.map((c, i) => <ColorSwatch key={i} name={c} selected={selectedColors.includes(c)} onClick={() => toggleColor(c)} size={20} />)}
        </div>
        <div style={{ fontSize: 10, color: S.dimmer, marginTop: 4, marginBottom: 4 }}>
          {selectedColors.map((c, i) => <span key={i}>{i > 0 && " + "}<span style={{ fontWeight: 600, color: S.muted }}>{c}</span></span>)}
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
function ProductEditor({ product, onSave, onDelete, onCancel, isNew }) {
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
                  set("img", compressed);
                } catch(err) { console.error("Image compression failed:", err); }
                e.target.value = "";
              }} />
            </label>
            <div style={{ flex: 1 }}>
              {p.img && (
                <button onClick={() => set("img", "")} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(255,107,107,0.3)", background: "rgba(255,107,107,0.08)", color: "#ff6b6b", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead, marginBottom: 8 }}>✕ Remove photo</button>
              )}
              <p style={{ fontSize: 11, color: S.dimmer, lineHeight: 1.5, margin: 0 }}>
                {p.img ? "Photo uploaded and compressed. Click the image to replace it." : "Upload a photo of the printed product. JPG or PNG, any size — it'll be compressed automatically."}
              </p>
            </div>
          </div>
        </div>

        {/* Row: name + category */}
        <div style={{ ...sectionStyle, display: "grid", gridTemplateColumns: "1fr 180px", gap: 12 }}>
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

        {/* Row: price, grams, print time, badge */}
        <div style={{ ...sectionStyle, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
          <div><label style={labelStyle}>Price (£) *</label><input style={inputStyle} type="number" step="0.05" min="0" value={p.price} onChange={e => set("price", parseFloat(e.target.value) || 0)} /></div>
          <div><label style={labelStyle}>Weight (g)</label><input style={inputStyle} type="number" min="0" value={p.grams} onChange={e => set("grams", parseInt(e.target.value) || 0)} /></div>
          <div><label style={labelStyle}>Print Time</label><input style={inputStyle} value={p.printTime} onChange={e => set("printTime", e.target.value)} placeholder="e.g. 2 hrs" /></div>
          <div>
            <label style={labelStyle}>Badge</label>
            <select value={p.badge || ""} onChange={e => set("badge", e.target.value || null)} style={{ ...inputStyle, cursor: "pointer" }}>
              <option value="">None</option>
              {BADGE_OPTIONS.filter(Boolean).map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>

        {/* Available Colours */}
        <div style={sectionStyle}>
          <label style={labelStyle}>Available Colours ({(p.colors || []).length} selected)</label>
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

        {/* Available toggle */}
        <div style={{ ...sectionStyle, display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => set("available", !p.available)} style={{
            width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative", transition: "background 0.2s",
            background: p.available ? S.teal : "rgba(255,255,255,0.1)",
          }}>
            <div style={{ width: 22, height: 22, borderRadius: 11, background: "#fff", position: "absolute", top: 3, left: p.available ? 23 : 3, transition: "left 0.2s", boxShadow: "0 2px 4px rgba(0,0,0,0.3)" }} />
          </button>
          <span style={{ fontSize: 14, fontWeight: 600, color: p.available ? S.teal : "#ff6b6b", fontFamily: S.fontHead }}>{p.available ? "Available in shop" : "Hidden from shop"}</span>
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
function OrderBook({ orders, onUpdateOrder }) {
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
    toDispatch: orders.filter(o => o.status.produced && !o.status.despatched).length,
    done: orders.filter(o => o.status.despatched).length,
    revenue: orders.reduce((s, o) => s + o.total, 0),
  }), [orders]);

  const toggleStatus = async (orderId, field) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const newStatus = { ...order.status, [field]: !order.status[field] };
    // Auto-logic: if despatching, also mark produced
    if (field === "despatched" && !order.status.despatched) newStatus.produced = true;
    // If un-producing, also un-despatch
    if (field === "produced" && order.status.produced) newStatus.despatched = false;
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "To Make", value: stats.toProduce, color: "#ff6b35", icon: "🔨" },
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

      {/* Column headers */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 70px 70px 70px", gap: 8, padding: "0 16px 8px", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: S.dimmer, fontFamily: S.fontHead, textTransform: "uppercase", letterSpacing: "0.5px" }}>Order</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: S.dimmer, fontFamily: S.fontHead, textTransform: "uppercase", letterSpacing: "0.5px", textAlign: "center" }}>Paid</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: S.dimmer, fontFamily: S.fontHead, textTransform: "uppercase", letterSpacing: "0.5px", textAlign: "center" }}>Made</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: S.dimmer, fontFamily: S.fontHead, textTransform: "uppercase", letterSpacing: "0.5px", textAlign: "center" }}>Sent</span>
      </div>

      {/* Order rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sorted.map(order => {
          const allDone = order.status.despatched;
          return (
            <div key={order.id} style={{
              background: S.card, border: `1px solid ${S.border}`, borderRadius: 14, padding: "14px 16px",
              opacity: allDone ? 0.45 : 1, transition: "opacity 0.3s",
              display: "grid", gridTemplateColumns: "1fr 70px 70px 70px", gap: 8, alignItems: "center",
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
                      <span style={{ fontWeight: 600, color: S.text }}>{item.qty}×</span>
                      <span>{item.name}</span>
                      <span style={{ fontSize: 10, color: S.dimmer }}>({item.selectedColors.join(" + ")})</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: S.teal, fontFamily: S.fontMono, marginTop: 6 }}>£{order.total.toFixed(2)}</div>
              </div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <Checkbox checked={order.status.paid} onChange={() => toggleStatus(order.id, "paid")} color={S.teal} />
              </div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <Checkbox checked={order.status.produced} onChange={() => toggleStatus(order.id, "produced")} color="#ff6b35" />
              </div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <Checkbox checked={order.status.despatched} onChange={() => toggleStatus(order.id, "despatched")} color={S.purple} />
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
function AdminPanel({ products, onSave, onLogout, orders, onUpdateOrders, onSaveFilaments, onSaveCategories }) {
  const [filter, setFilter] = useState("All");
  const [editing, setEditing] = useState(null);
  const [addingNew, setAddingNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [adminTab, setAdminTab] = useState("orders");
  const [newColourName, setNewColourName] = useState("");
  const [newColourHex, setNewColourHex] = useState("#888888");
  const [newColourType, setNewColourType] = useState("PLA Basic");
  const [newColourPremium, setNewColourPremium] = useState(false);
 const [editingColour, setEditingColour] = useState(null);
  const [newCatName, setNewCatName] = useState("");
  const [editingCat, setEditingCat] = useState(null);
  const [editCatName, setEditCatName] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerLoading, setScannerLoading] = useState(false);
  const [scannerResult, setScannerResult] = useState(null);
  const [scannerImage, setScannerImage] = useState(null);

  /* ── Filament Scanner ── */
  const analyseFilament = async (base64Data, mediaType) => {
    setScannerLoading(true);
    setScannerResult(null);
    const existingColours = Object.entries(FILAMENTS).map(([name, f]) => ({
      name, hex: f.hex, type: f.type, premium: !!f.premium,
    }));
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
              { type: "text", text: `You are a filament colour identification assistant for a 3D printing shop called ET Print World.

EXISTING COLOUR LIBRARY:
${JSON.stringify(existingColours, null, 2)}

Analyse this image. Determine if it shows:
A) A filament SPOOL (visible filament, possibly with a label) — MATCH mode
B) Filament PACKAGING/BOX (retail box with printed details) — SCAN mode

Respond with ONLY valid JSON (no markdown, no backticks, no preamble):

For MATCH mode (spool photo):
{
  "mode": "match",
  "matches": [
    { "name": "Existing Colour Name", "confidence": "high|medium|low", "reason": "why this matches" }
  ],
  "visibleInfo": "any text/labels visible on the spool",
  "estimatedColour": "your best guess at the colour name if no match"
}

For SCAN mode (box/packaging):
{
  "mode": "scan",
  "brand": "brand name from packaging",
  "colourName": "colour name from packaging",
  "material": "PLA/PETG/TPU etc",
  "finish": "Basic/Matte/Silk/Gradient etc",
  "hexEstimate": "#hexcode best estimate from the packaging",
  "existingMatch": "name of existing colour if it matches one, or null",
  "suggestedName": "suggested ET Print World colour name",
  "suggestedType": "suggested filament type string e.g. PLA Matte",
  "premium": false,
  "allDetailsRead": "summary of everything readable on the packaging"
}

Important:
- For suggestedType, use one of: PLA Basic, PLA Matte, PLA Silk+, PLA Gradient, ELEGOO Silk, Reprapper PLA, PETG, TPU
- For premium, set true for Silk, Gradient, or special finishes
- Match confidence: "high" = very likely the same, "medium" = close but not certain, "low" = possible but unlikely
- Return up to 3 matches, ordered by confidence` }
            ],
          }],
        }),
      });
      const data = await response.json();
      const text = data.content.map(i => i.text || "").join("\n");
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setScannerResult(parsed);
    } catch (err) {
      console.error("Filament scan error:", err);
      setScannerResult({ error: "Analysis failed. Please try again with a clearer photo." });
    }
    setScannerLoading(false);
  };

  const handleScanUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const full = reader.result;
      const base64 = full.split(",")[1];
      const mediaType = file.type || "image/jpeg";
      setScannerImage(full);
      analyseFilament(base64, mediaType);
    };
    reader.readAsDataURL(file);
  };

  const newProduct = { id: 0, name: "", price: 0, category: categories[0] || "Key Rings", description: "", colors: ["Matte Charcoal"], emoji: "", img: "", badge: null, printTime: "1 hr", grams: 10, available: true, maxColors: 1 };

  const pendingOrders = orders.filter(o => !o.status.despatched).length;

  const displayCategories = ["All", ...categories];
   const filtered = filter === "All" ? products : products.filter(p => p.category === filter);

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
          <p style={{ fontSize: 13, color: S.muted, margin: "4px 0 0" }}>{products.filter(p => p.available).length} products live · {orders.length} orders</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {savedMsg && <span style={{ color: S.teal, fontWeight: 700, fontFamily: S.fontHead, fontSize: 14 }}>✓ {savedMsg}</span>}
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
        <OrderBook orders={orders} onUpdateOrder={onUpdateOrders} />
      )}

      {/* Products tab */}
      {adminTab === "products" && (<>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
          <button onClick={() => setAddingNew(true)} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${S.purple}, #6c3ce0)`, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead, boxShadow: "0 4px 16px rgba(132,94,247,0.3)" }}>+ Add Product</button>
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
                {product.badge && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "rgba(0,201,167,0.1)", color: S.teal, fontWeight: 600, fontFamily: S.fontHead }}>{product.badge}</span>}
                {!product.available && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "rgba(255,107,107,0.1)", color: "#ff6b6b", fontWeight: 600 }}>Hidden</span>}
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

          {/* Scan Filament button */}
          <button onClick={() => { setScannerOpen(true); setScannerResult(null); setScannerImage(null); }} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 12, border: `1px solid rgba(132,94,247,0.3)`, background: "rgba(132,94,247,0.08)", color: S.purple, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead, marginBottom: 20 }}>📷 Scan Filament</button>

          {/* Scanner Modal */}
          {scannerOpen && (
            <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={(e) => { if (e.target === e.currentTarget) { setScannerOpen(false); setScannerResult(null); setScannerImage(null); } }}>
              <div style={{ background: S.dark, border: `1px solid ${S.border}`, borderRadius: 20, padding: 28, maxWidth: 520, width: "100%", maxHeight: "90vh", overflowY: "auto", position: "relative" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: S.fontHead, color: S.text, margin: 0 }}>📷 Filament Scanner</h3>
                  <button onClick={() => { setScannerOpen(false); setScannerResult(null); setScannerImage(null); }} style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: "rgba(255,255,255,0.05)", color: S.muted, fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                </div>
                <p style={{ fontSize: 13, color: S.muted, marginBottom: 16, lineHeight: 1.6 }}>
                  Upload a photo of a <strong style={{ color: S.teal }}>filament spool</strong> to match it to your library, or a <strong style={{ color: S.purple }}>filament box</strong> to scan its details. I'll figure out which one it is.
                </p>

                {/* Upload area */}
                {!scannerImage && !scannerLoading && (
                  <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "40px 20px", borderRadius: 16, border: `2px dashed ${S.border}`, background: "rgba(255,255,255,0.02)", cursor: "pointer", transition: "all 0.2s" }}>
                    <div style={{ fontSize: 40, opacity: 0.6 }}>📸</div>
                    <div style={{ fontSize: 14, color: S.muted, fontFamily: S.fontHead, fontWeight: 600 }}>Tap to upload photo</div>
                    <div style={{ fontSize: 11, color: S.dimmer }}>Spool or box — I'll work it out</div>
                    <input type="file" accept="image/*" capture="environment" onChange={handleScanUpload} style={{ display: "none" }} />
                  </label>
                )}

                {/* Loading state */}
                {scannerLoading && (
                  <div style={{ textAlign: "center", padding: "32px 0" }}>
                    {scannerImage && <img src={scannerImage} alt="Uploaded" style={{ width: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 12, marginBottom: 16, opacity: 0.6 }} />}
                    <div style={{ display: "inline-block", width: 28, height: 28, border: `3px solid ${S.border}`, borderTopColor: S.teal, borderRadius: "50%", animation: "spin 0.8s linear infinite", marginBottom: 12 }} />
                    <p style={{ fontSize: 14, color: S.teal, fontFamily: S.fontHead, fontWeight: 600 }}>Analysing filament...</p>
                    <p style={{ fontSize: 12, color: S.dimmer }}>Reading colours, labels, and packaging</p>
                  </div>
                )}

                {/* Error result */}
                {scannerResult?.error && (
                  <div>
                    {scannerImage && <img src={scannerImage} alt="Uploaded" style={{ width: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 12, marginBottom: 16 }} />}
                    <div style={{ background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.2)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
                      <p style={{ fontSize: 14, color: "#ff6b6b", fontWeight: 600 }}>{scannerResult.error}</p>
                    </div>
                    <button onClick={() => { setScannerResult(null); setScannerImage(null); }} style={{ width: "100%", padding: "12px 20px", borderRadius: 12, border: `1px solid ${S.border}`, background: S.card, color: S.text, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}>Try Again</button>
                  </div>
                )}

                {/* MATCH result (spool identified) */}
                {scannerResult?.mode === "match" && (
                  <div>
                    {scannerImage && <img src={scannerImage} alt="Uploaded" style={{ width: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 12, marginBottom: 16 }} />}
                    {scannerResult.visibleInfo && (
                      <div style={{ fontSize: 12, color: S.dimmer, fontFamily: S.fontMono, marginBottom: 12, padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
                        📝 Visible on spool: {scannerResult.visibleInfo}
                      </div>
                    )}
                    <h4 style={{ fontSize: 15, fontWeight: 700, fontFamily: S.fontHead, color: S.teal, marginBottom: 12 }}>
                      {scannerResult.matches?.length > 0 ? "🎯 Matches Found" : "❌ No Match Found"}
                    </h4>
                    {scannerResult.matches?.map((m, i) => {
                      const fil = FILAMENTS[m.name];
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, background: i === 0 ? "rgba(0,201,167,0.06)" : S.card, border: `1px solid ${i === 0 ? "rgba(0,201,167,0.2)" : S.border}`, marginBottom: 8 }}>
                          {fil && <div style={{ width: 36, height: 36, borderRadius: 10, background: fil.hex, border: "2px solid rgba(255,255,255,0.12)", flexShrink: 0 }} />}
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: S.text, fontFamily: S.fontHead }}>{m.name}</div>
                            <div style={{ fontSize: 11, color: S.dimmer, fontFamily: S.fontMono }}>{fil?.type || "Unknown"}{fil?.premium ? " ✦" : ""}</div>
                            <div style={{ fontSize: 11, color: S.muted, marginTop: 2 }}>{m.reason}</div>
                          </div>
                          <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 8, fontWeight: 700, fontFamily: S.fontMono, textTransform: "uppercase",
                            background: m.confidence === "high" ? "rgba(0,201,167,0.12)" : m.confidence === "medium" ? "rgba(249,202,36,0.12)" : "rgba(255,107,107,0.08)",
                            color: m.confidence === "high" ? S.teal : m.confidence === "medium" ? "#f9ca24" : "#ff6b6b",
                          }}>{m.confidence}</span>
                        </div>
                      );
                    })}
                    {(!scannerResult.matches || scannerResult.matches.length === 0) && scannerResult.estimatedColour && (
                      <p style={{ fontSize: 13, color: S.muted, marginTop: 8 }}>Best guess: <strong style={{ color: S.text }}>{scannerResult.estimatedColour}</strong> — not currently in your library.</p>
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                      <button onClick={() => { setScannerResult(null); setScannerImage(null); }} style={{ flex: 1, padding: "12px 20px", borderRadius: 12, border: `1px solid ${S.border}`, background: S.card, color: S.text, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}>Scan Another</button>
                      <button onClick={() => { setScannerOpen(false); setScannerResult(null); setScannerImage(null); }} style={{ flex: 1, padding: "12px 20px", borderRadius: 12, border: "none", background: `linear-gradient(135deg, ${S.teal}, #00a88a)`, color: "#1a1a2e", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead }}>Done</button>
                    </div>
                  </div>
                )}

                {/* SCAN result (box/packaging identified) */}
                {scannerResult?.mode === "scan" && (
                  <div>
                    {scannerImage && <img src={scannerImage} alt="Uploaded" style={{ width: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 12, marginBottom: 16 }} />}

                    {/* Details read from packaging */}
                    <div style={{ fontSize: 12, color: S.dimmer, fontFamily: S.fontMono, marginBottom: 16, padding: "10px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 10, lineHeight: 1.6 }}>
                      📦 <strong style={{ color: S.muted }}>Scanned:</strong> {scannerResult.allDetailsRead || `${scannerResult.brand} — ${scannerResult.colourName} (${scannerResult.material} ${scannerResult.finish})`}
                    </div>

                    {/* Existing match found */}
                    {scannerResult.existingMatch && FILAMENTS[scannerResult.existingMatch] && (
                      <div style={{ background: "rgba(0,201,167,0.06)", border: "1px solid rgba(0,201,167,0.2)", borderRadius: 14, padding: 16, marginBottom: 16, textAlign: "center" }}>
                        <div style={{ fontSize: 24, marginBottom: 8 }}>✅</div>
                        <div style={{ fontSize: 15, fontWeight: 700, fontFamily: S.fontHead, color: S.teal, marginBottom: 4 }}>Already in your library!</div>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "8px 16px", borderRadius: 10, background: S.card, border: `1px solid ${S.border}`, marginTop: 8 }}>
                          <div style={{ width: 28, height: 28, borderRadius: 8, background: FILAMENTS[scannerResult.existingMatch].hex, border: "2px solid rgba(255,255,255,0.12)" }} />
                          <div style={{ textAlign: "left" }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: S.text, fontFamily: S.fontHead }}>{scannerResult.existingMatch}</div>
                            <div style={{ fontSize: 11, color: S.dimmer, fontFamily: S.fontMono }}>{FILAMENTS[scannerResult.existingMatch].type}</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* New colour — prefill form */}
                    {!scannerResult.existingMatch && (
                      <div style={{ background: "rgba(132,94,247,0.06)", border: "1px solid rgba(132,94,247,0.2)", borderRadius: 14, padding: 16, marginBottom: 16 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, fontFamily: S.fontHead, color: S.purple, marginBottom: 12 }}>🆕 New colour detected!</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13 }}>
                          <div><span style={{ color: S.dimmer, fontFamily: S.fontMono, fontSize: 11 }}>SUGGESTED NAME</span><br /><strong style={{ color: S.text }}>{scannerResult.suggestedName}</strong></div>
                          <div><span style={{ color: S.dimmer, fontFamily: S.fontMono, fontSize: 11 }}>TYPE</span><br /><strong style={{ color: S.text }}>{scannerResult.suggestedType}</strong></div>
                          <div><span style={{ color: S.dimmer, fontFamily: S.fontMono, fontSize: 11 }}>HEX ESTIMATE</span><br /><div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 20, height: 20, borderRadius: 6, background: scannerResult.hexEstimate, border: "1px solid rgba(255,255,255,0.15)" }} /><strong style={{ color: S.text, fontFamily: S.fontMono }}>{scannerResult.hexEstimate}</strong></div></div>
                          <div><span style={{ color: S.dimmer, fontFamily: S.fontMono, fontSize: 11 }}>PREMIUM</span><br /><strong style={{ color: S.text }}>{scannerResult.premium ? "Yes ✦" : "No"}</strong></div>
                        </div>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                      <button onClick={() => { setScannerResult(null); setScannerImage(null); }} style={{ flex: 1, padding: "12px 20px", borderRadius: 12, border: `1px solid ${S.border}`, background: S.card, color: S.text, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}>Scan Another</button>
                      {!scannerResult.existingMatch ? (
                        <button onClick={() => {
                          setNewColourName(scannerResult.suggestedName || "");
                          setNewColourHex(scannerResult.hexEstimate || "#888888");
                          setNewColourType(scannerResult.suggestedType || "PLA Basic");
                          setNewColourPremium(!!scannerResult.premium);
                          setEditingColour(null);
                          setScannerOpen(false); setScannerResult(null); setScannerImage(null);
                        }} style={{ flex: 1, padding: "12px 20px", borderRadius: 12, border: "none", background: `linear-gradient(135deg, ${S.purple}, #6c5ce7)`, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead }}>Add to Library →</button>
                      ) : (
                        <button onClick={() => { setScannerOpen(false); setScannerResult(null); setScannerImage(null); }} style={{ flex: 1, padding: "12px 20px", borderRadius: 12, border: "none", background: `linear-gradient(135deg, ${S.teal}, #00a88a)`, color: "#1a1a2e", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead }}>Done</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Add / Edit colour form */}
          <div style={{ background: S.card, border: `1px solid ${editingColour ? S.teal : S.border}`, borderRadius: 16, padding: 20, marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, fontFamily: S.fontHead, color: editingColour ? S.teal : S.text, margin: "0 0 16px" }}>
              {editingColour ? `✏️ Editing: ${editingColour}` : "+ Add New Colour"}
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
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
            Manage your product categories. Add new ones, rename existing ones, or remove categories you no longer need.
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
              return (
                <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: `1px solid ${S.border}` }}>
                  {isEditing ? (
                    <>
                      <input value={editCatName} onChange={e => setEditCatName(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && editCatName.trim()) { const n = editCatName.trim(); const updated = [...categories]; const oldName = updated[idx]; updated[idx] = n; onSaveCategories(updated); if (products) { const renamedProducts = products.map(p => p.category === oldName ? { ...p, category: n } : p); onSave(renamedProducts); } setEditingCat(null); } if (e.key === "Escape") setEditingCat(null); }} autoFocus style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: `1px solid ${S.teal}`, background: "rgba(0,201,167,0.05)", color: S.text, fontSize: 14, fontFamily: S.font, outline: "none" }} />
                      <button onClick={() => { const n = editCatName.trim(); if (n) { const updated = [...categories]; const oldName = updated[idx]; updated[idx] = n; onSaveCategories(updated); if (products) { const renamedProducts = products.map(p => p.category === oldName ? { ...p, category: n } : p); onSave(renamedProducts); } setEditingCat(null); } }} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: S.teal, color: "#1a1a2e", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Save</button>
                      <button onClick={() => setEditingCat(null)} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${S.border}`, background: "transparent", color: S.muted, fontSize: 12, cursor: "pointer" }}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: S.text, fontFamily: S.fontHead }}>{cat}</span>
                      <span style={{ fontSize: 11, color: S.dimmer, fontFamily: S.fontMono }}>{count} product{count !== 1 ? "s" : ""}</span>
                      <button onClick={() => { setEditingCat(idx); setEditCatName(cat); }} style={{ padding: "5px 10px", borderRadius: 8, border: `1px solid ${S.border}`, background: "transparent", color: S.muted, fontSize: 11, cursor: "pointer", fontFamily: S.fontHead }}>✏️ Rename</button>
                      <button onClick={() => { if (count > 0) { if (!window.confirm(`"${cat}" has ${count} product${count !== 1 ? "s" : ""}. They'll keep their category label but it won't appear in filters. Delete anyway?`)) return; } onSaveCategories(categories.filter((_, i) => i !== idx)); }} style={{ padding: "5px 10px", borderRadius: 8, border: `1px solid rgba(255,107,107,0.3)`, background: "transparent", color: "#ff6b6b", fontSize: 11, cursor: "pointer", fontFamily: S.fontHead }}>🗑️ Delete</button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {categories.length === 0 && <p style={{ textAlign: "center", color: S.dimmer, fontSize: 13, padding: 20 }}>No categories yet. Add one above!</p>}
        </div>
      )}
       
      {(editing || addingNew) && (
        <ProductEditor
          product={addingNew ? newProduct : editing}
          isNew={addingNew}
          onSave={handleSaveProduct}
          onDelete={handleDelete}
          onCancel={() => { setEditing(null); setAddingNew(false); }}
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
function CheckoutPage({ cart, shipping, setShipping, onBack, onOrderPlaced }) {
  const [form, setForm] = useState({ email: "", name: "", address1: "", address2: "", city: "", county: "", postcode: "", phone: "" });
  const [step, setStep] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [errors, setErrors] = useState({});
  const [lastOrderId, setLastOrderId] = useState("");
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const qualifiesFree = subtotal >= FREE_SHIPPING_THRESHOLD;
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
        items: cart.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty, selectedColors: i.selectedColors })),
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
      items: cart.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty, selectedColors: i.selectedColors })),
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
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px 80px" }}>
      <button onClick={step === 1 ? onBack : () => setStep(step - 1)} style={{ background: "none", border: "none", color: S.teal, cursor: "pointer", fontSize: 14, fontFamily: S.fontHead, fontWeight: 600, marginBottom: 24 }}>← {step === 1 ? "Back to Shop" : "Back"}</button>
      <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 40 }}>
        {["Shipping", shipping?.id === "collection" ? "Details" : "Address", "Payment"].map((label, i) => (
          <div key={i} style={{ flex: 1, display: "flex", alignItems: "center" }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, fontFamily: S.fontHead, background: step > i + 1 ? S.teal : step === i + 1 ? "rgba(0,201,167,0.15)" : "rgba(255,255,255,0.05)", color: step > i + 1 ? "#1a1a2e" : step === i + 1 ? S.teal : S.dimmer, border: step === i + 1 ? `1.5px solid ${S.teal}` : `1px solid ${S.border}`, flexShrink: 0 }}>{step > i + 1 ? "✓" : i + 1}</div>
            <span style={{ fontSize: 12, fontWeight: 600, color: step >= i + 1 ? S.text : S.dimmer, fontFamily: S.fontHead, marginLeft: 8, whiteSpace: "nowrap" }}>{label}</span>
            {i < 2 && <div style={{ flex: 1, height: 1, marginLeft: 12, background: step > i + 1 ? S.teal : S.border }} />}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 32, alignItems: "start" }}>
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={labS}>Full Name *</label><input style={inpS("name")} value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
                <div><label style={labS}>Email *</label><input style={inpS("email")} type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} /></div>
              </div>
              {shipping?.id === "collection" ? (
                <div><label style={labS}>Phone / Instagram</label><input style={inpS("phone")} value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="07700 900000 or @username" /></div>
              ) : (<>
<div><label style={labS}>Address Line 1 *</label><input style={inpS("address1")} value={form.address1} onChange={e => setForm({...form, address1: e.target.value})} placeholder="House number and street" /></div>
                <div><label style={labS}>Address Line 2</label><input style={inpS("address2")} value={form.address2} onChange={e => setForm({...form, address2: e.target.value})} placeholder="Flat, building, floor (optional)" /></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
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
            <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${S.border}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
              <p style={{ fontSize: 11, color: S.dimmer, textAlign: "center" }}>{USE_STRIPE ? "🔒 Secure payment via Stripe" : "Demo mode — connect Stripe for real payments"}</p>
            </div>
            <button onClick={handlePayment} disabled={processing} style={{ width: "100%", padding: "16px 0", borderRadius: 12, border: "none", background: processing ? "rgba(0,201,167,0.3)" : `linear-gradient(135deg, ${S.teal}, #00a88a)`, color: "#1a1a2e", fontSize: 16, fontWeight: 800, cursor: processing ? "wait" : "pointer", fontFamily: S.fontHead, textTransform: "uppercase" }}>{processing ? "Redirecting to payment..." : `🔒 Pay £${total.toFixed(2)}`}</button>
          </div>)}
        </div>
        <div style={{ background: "rgba(255,255,255,0.02)", border: `1px solid rgba(255,255,255,0.06)`, borderRadius: 16, padding: 20, position: "sticky", top: 84 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, fontFamily: S.fontHead, color: S.text, marginBottom: 12, textTransform: "uppercase" }}>Order</h4>
          {cart.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: 6, overflow: "hidden", flexShrink: 0, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {item.img ? <img src={item.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 14, opacity: 0.4 }}>📷</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12, fontWeight: 600, color: S.text, fontFamily: S.fontHead, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div><div style={{ fontSize: 10, color: S.dimmer }}>{item.selectedColors.join(" + ")} × {item.qty}</div></div>
              <span style={{ fontSize: 12, fontWeight: 700, color: S.text, fontFamily: S.fontMono }}>£{(item.price * item.qty).toFixed(2)}</span>
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
            <div key={i} style={{ display: "flex", gap: 12, padding: 12, background: S.card, borderRadius: 12, border: `1px solid ${S.border}`, marginBottom: 12 }}>
              <div style={{ width: 48, height: 48, borderRadius: 10, overflow: "hidden", flexShrink: 0, alignSelf: "center", background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {item.img ? <img src={item.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 22, opacity: 0.4 }}>📷</span>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: S.fontHead }}>{item.name}</span>
                  <button onClick={() => onRemove(i)} style={{ background: "none", border: "none", color: S.dimmer, cursor: "pointer", fontSize: 14 }}>✕</button>
                </div>
                <div style={{ fontSize: 11, color: S.dimmer, marginTop: 2, display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {item.selectedColors.map((c, ci) => <span key={ci} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>{ci > 0 && "+"}<span style={{ width: 8, height: 8, borderRadius: "50%", background: FILAMENTS[c]?.hex || "#666" }} />{c}</span>)}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button onClick={() => onUpdateQty(i, Math.max(1, item.qty - 1))} style={{ width: 26, height: 26, borderRadius: 6, border: `1px solid ${S.border}`, background: S.card, color: "#aaa", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                    <span style={{ fontWeight: 600, fontFamily: S.fontMono }}>{item.qty}</span>
                    <button onClick={() => onUpdateQty(i, item.qty + 1)} style={{ width: 26, height: 26, borderRadius: 6, border: `1px solid ${S.border}`, background: S.card, color: "#aaa", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                  </div>
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
  const [authChecked, setAuthChecked] = useState(!USE_FIREBASE); // skip auth check if no Firebase
  const [stripeSuccess, setStripeSuccess] = useState(null); // holds completed order after Stripe redirect

  useEffect(() => {
    setLoaded(true);
    loadProducts().then(p => {
      if (!p) { setProducts([...SEED_PRODUCTS]); saveProducts([...SEED_PRODUCTS]); return; }
      setProducts(p);
    });
    loadOrders().then(o => setOrders(o || []));
    loadFilaments().then(f => {
      if (f) { FILAMENTS = f; ALL_COLORS = Object.keys(f); setFilamentVer(v => v + 1); }
    });
    loadCategories().then(cats => {
      if (cats) { categories = cats; setCatVer(v => v + 1); }
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
          const order = {
            id: "EP-" + Date.now().toString(36).toUpperCase(),
            date: new Date().toISOString(),
            ...orderData,
            status: { paid: true, produced: false, despatched: false },
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
  const handleSaveProducts = async (p) => { setProducts(p); await saveProducts(p); };
  const handleUpdateOrderStatus = async (orderId, newStatus) => {
    const order = orders.find(o => o.id === orderId);
    const wasDespatched = order?.status?.despatched;
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
    await updateOrderStatus(orderId, newStatus);
    if (newStatus.despatched && !wasDespatched && order) {
      sendShippedEmail(order);
    }
  };
  const handleOrderPlaced = (order) => { setOrders(prev => [...prev, order]); };
  const handleSaveFilaments = async (f) => { FILAMENTS = f; ALL_COLORS = Object.keys(f); setFilamentVer(v => v + 1); await saveFilaments(f); };
const handleSaveCategories = async (cats) => { categories = cats; setCatVer(v => v + 1); await saveCategories(cats); };

   
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
      `}</style>

      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(14,14,31,0.85)", backdropFilter: "blur(20px)", borderBottom: `1px solid rgba(255,255,255,0.05)`, padding: "0 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div onClick={async () => { setPage("shop"); if (USE_FIREBASE && adminLoggedIn) await firebaseSignOut(); setAdminLoggedIn(false); }} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${S.teal}, ${S.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⬡</div>
            <span style={{ fontSize: 20, fontWeight: 800, fontFamily: S.fontHead }}><span style={{ color: S.teal }}>E</span>lijah's Prints</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {page !== "admin" && (<>
              <button onClick={() => setPage("request")} style={{ background: "none", border: `1px solid rgba(132,94,247,0.3)`, color: S.purple, padding: "8px 14px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontFamily: S.fontHead, fontWeight: 600 }}>✨ Request</button>
              <button onClick={() => setPage("admin-login")} style={{ background: "none", border: "none", color: S.dimmer, cursor: "pointer", fontSize: 16, padding: 8 }} title="Admin">🔧</button>
              <button onClick={() => setCartOpen(true)} style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${S.border}`, color: S.text, padding: "8px 16px", borderRadius: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontFamily: S.fontHead, fontWeight: 600, position: "relative" }}>
                🛒{totalItems > 0 && <span style={{ background: S.teal, color: "#1a1a2e", width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, position: "absolute", top: -6, right: -6 }}>{totalItems}</span>}<span style={{ fontSize: 13 }}>Cart</span>
              </button>
            </>)}
          </div>
        </div>
      </nav>

      {page === "admin-login" && !adminLoggedIn && <AdminLogin onLogin={() => { setAdminLoggedIn(true); setPage("admin"); }} />}
      {page === "admin" && adminLoggedIn && <AdminPanel products={products} onSave={handleSaveProducts} onLogout={async () => { if (USE_FIREBASE) await firebaseSignOut(); setAdminLoggedIn(false); setPage("shop"); }} orders={orders} onUpdateOrders={handleUpdateOrderStatus} onSaveFilaments={handleSaveFilaments} onSaveCategories={handleSaveCategories} />}
      {page === "checkout" && <CheckoutPage cart={cart} shipping={shipping} setShipping={setShipping} onBack={() => { setPage("shop"); setShipping(SHIPPING_OPTIONS[0]); setCart([]); }} onOrderPlaced={handleOrderPlaced} />}
      {page === "request" && <SpecialRequestPage onBack={() => setPage("shop")} />}

      {/* Stripe payment success — shown after redirect back from Stripe */}
      {stripeSuccess && (
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "60px 24px", textAlign: "center" }}>
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: `linear-gradient(135deg, ${S.teal}, #00a88a)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 24px" }}>✓</div>
          <h2 style={{ fontSize: 28, fontWeight: 800, fontFamily: S.fontHead, marginBottom: 12, color: S.text }}>Payment Successful!</h2>
          {stripeSuccess.id && <p style={{ fontSize: 13, fontFamily: S.fontMono, color: S.teal, fontWeight: 700, marginBottom: 8 }}>Ref: {stripeSuccess.id}</p>}
          <p style={{ color: S.muted, fontSize: 15, marginBottom: 32 }}>
            {stripeSuccess.shipping?.id === "collection"
              ? `Thanks ${stripeSuccess.customer?.name?.split(" ")[0] || ""}! Elijah will bring it to school.`
              : `Thanks ${stripeSuccess.customer?.name?.split(" ")[0] || ""}! Elijah will print and ship it.`}
          </p>
          <button onClick={() => { setStripeSuccess(null); setCart([]); setPage("shop"); }} style={{ padding: "13px 32px", borderRadius: 12, border: "none", background: "rgba(255,255,255,0.05)", color: S.text, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead }}>Back to Shop</button>
        </div>
      )}

      {page === "shop" && (<>
        <header style={{ position: "relative", padding: "60px 24px 40px", textAlign: "center", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,201,167,0.12), transparent 70%)", animation: "heroGlow 4s ease-in-out infinite", pointerEvents: "none" }} />
          <div style={{ position: "relative", opacity: loaded ? 1 : 0, transform: loaded ? "translateY(0)" : "translateY(30px)", transition: "all 0.8s cubic-bezier(0.16,1,0.3,1)" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(0,201,167,0.08)", border: "1px solid rgba(0,201,167,0.15)", padding: "6px 16px", borderRadius: 20, fontSize: 12, color: S.teal, fontFamily: S.fontMono, fontWeight: 600, textTransform: "uppercase", marginBottom: 20 }}>
              <span style={{ display: "inline-block", animation: "spin 4s linear infinite" }}>⬡</span>Bambu Lab P1S Combo · Ships from Wales 🏴󠁧󠁢󠁷󠁬󠁳󠁿
            </div>
            <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 800, fontFamily: S.fontHead, lineHeight: 1.1, letterSpacing: "-2px", marginBottom: 12, background: "linear-gradient(135deg, #fff, #a0a0a0)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Custom 3D Prints<br /><span style={{ background: `linear-gradient(135deg, ${S.teal}, ${S.purple})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Made to Order</span>
            </h1>
            <p style={{ fontSize: 15, color: S.muted, maxWidth: 480, margin: "0 auto 20px", lineHeight: 1.6 }}>{catCounts.All || 0} products · {ALL_COLORS.length} colours · Free school drop-off or UK-wide shipping</p>
            <div style={{ display: "flex", gap: 5, justifyContent: "center", flexWrap: "wrap", maxWidth: 340, margin: "0 auto" }}>
              {ALL_COLORS.map(name => <div key={name} title={name} style={{ width: 20, height: 20, borderRadius: "50%", background: FILAMENTS[name].hex, border: "2px solid rgba(255,255,255,0.15)", boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }} />)}
            </div>
          </div>
        </header>

        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px 12px" }}>
          <div style={{ maxWidth: 400, margin: "0 auto 16px" }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products..." style={{ width: "100%", padding: "10px 16px", borderRadius: 12, border: `1px solid ${S.border}`, background: S.card, color: S.text, fontSize: 14, fontFamily: S.font, outline: "none", textAlign: "center" }} />
          </div>
        </div>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px 28px", display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {displayCategories.map(cat => (
            <button key={cat} onClick={() => setActiveCat(cat)} style={{ padding: "8px 16px", borderRadius: 20, border: activeCat === cat ? `1.5px solid ${S.teal}` : `1px solid ${S.border}`, background: activeCat === cat ? "rgba(0,201,167,0.1)" : "rgba(255,255,255,0.02)", color: activeCat === cat ? S.teal : S.muted, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: S.fontHead, display: "flex", alignItems: "center", gap: 6 }}>
              {cat}<span style={{ fontSize: 11, color: activeCat === cat ? "rgba(0,201,167,0.6)" : S.dimmer, fontFamily: S.fontMono }}>{catCounts[cat] || 0}</span>
            </button>
          ))}
        </div>

        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px 60px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 18 }}>
          {shopProducts.length === 0 ? <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px 0", color: S.dimmer }}>{search ? `Nothing found for "${search}"` : "No products available"}</div>
          : shopProducts.map((product, i) => (
            <div key={product.id} style={{ opacity: loaded ? 1 : 0, transform: loaded ? "translateY(0)" : "translateY(20px)", transition: `all 0.5s cubic-bezier(0.16,1,0.3,1) ${Math.min(i * 0.05, 0.4)}s` }}>
              <ProductCard product={product} onAddToCart={addToCart} cartAnimation={cartAnim} />
            </div>
          ))}
        </div>

        <div style={{ maxWidth: 800, margin: "0 auto 60px", padding: "0 24px" }}>
          <div style={{ background: `linear-gradient(135deg, rgba(0,201,167,0.08), rgba(132,94,247,0.08))`, border: "1px solid rgba(0,201,167,0.12)", borderRadius: 20, padding: "36px 28px", textAlign: "center" }}>
            <h2 style={{ fontSize: 24, fontWeight: 800, fontFamily: S.fontHead, marginBottom: 8 }}>Got a Custom Idea? 💡</h2>
            <p style={{ color: S.muted, fontSize: 14, marginBottom: 18, lineHeight: 1.6 }}>Can't find what you're looking for? Describe it and we'll see if we can print it for you!</p>
            <button onClick={() => setPage("request")} style={{ padding: "12px 28px", borderRadius: 12, border: "none", background: `linear-gradient(135deg, ${S.teal}, #00a88a)`, color: "#1a1a2e", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: S.fontHead, textTransform: "uppercase" }}>Request Custom Print</button>
          </div>
        </div>

        <footer style={{ borderTop: `1px solid rgba(255,255,255,0.05)`, padding: "28px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: S.dimmer }}><span style={{ color: S.teal, fontWeight: 700, fontFamily: S.fontHead }}>Elijah's Prints</span> · Bambu Lab P1S Combo · Flintshire, Wales<br /><span style={{ fontSize: 11, marginTop: 8, display: "inline-block" }}>© 2026</span></div>
        </footer>
      </>)}

      {cartOpen && <CartDrawer cart={cart} onClose={() => setCartOpen(false)} onRemove={removeFromCart} onUpdateQty={updateQty} onCheckout={() => { setCartOpen(false); setPage("checkout"); }} />}
    </div>
  );
}

export default function ElijahsPrints() {
  return <ErrorBoundary><ElijahsPrintsInner /></ErrorBoundary>;
}

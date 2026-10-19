// Site email: templates (in git, not in a dashboard) + the Resend transport.
//
// Why this exists (2026-10-19): every site email used to go
//   /api/send-email → EmailJS → Elijah's personal Outlook (OAuth)
// That mailbox was suspended by Microsoft on 2026-09-19 (15 h outage, a paid order
// unseen) and flagged again on 2026-10-19 (WASCL OverMaxRcpt, then silent drops). The
// templates lived in the EmailJS dashboard where nothing could check them: there were
// only 3 templates for 4 email types, so special requests rendered through the order
// layout (the "ghost order" emails). Templates now live here, under review, and mail
// goes out from the shop's own domain (etprintworld.com, DKIM-aligned via Resend).
//
// Wording is copied from the EmailJS templates captured verbatim on 2026-10-19, with
// the four fixes John approved: the old "Elijah's Prints" name → "Elijah's 3D Print
// World"; the always-blank "Card fee" line now filled (or omitted when unknown); the
// broken "[Website Link]" anchor wrapping the whole order alert removed; and special
// requests get their own layout. Customer emails no longer set a free-mail Reply-To
// (mail-tester scored that −2.5); replies to elijah@etprintworld.com are forwarded to
// Elijah's Outlook by Squarespace.

export const FROM_ORDERS = "ET Print World Orders <orders@etprintworld.com>";
export const FROM_ELIJAH = "Elijah's 3D Print World <elijah@etprintworld.com>";

// Who gets told about new orders / requests / stock orders. SINGLE SOURCE OF TRUTH —
// server-side only. Client-supplied recipients are never used for these types (the
// client token is public, so trusting its to_email would let anyone mail anyone as us).
// Overridable at runtime via ORDER_NOTIFY_TO (comma-separated).
export function orderNotifyRecipients() {
  const raw = process.env.ORDER_NOTIFY_TO || "johnianthompson78@outlook.com,etprintworld@outlook.com";
  return [...new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
// Multi-line values (item lists) keep their line breaks in HTML.
const escLines = (v) => esc(v).replace(/\r?\n/g, "<br>");
const money = (n) => `£${Number(n || 0).toFixed(2)}`;

// Customer emails drop the "[emoji tile: …]" production label (it names the physical
// tile for Elijah; customers saw it as jargon until 2026-10-19).
function personalisedSuffix(i) {
  if (!i.personalizedName && !i.personalizedEmoji) return "";
  const e = i.personalizedEmoji || "";
  const before = e && i.personalizedEmojiPos === "before";
  const txt = `${before ? e + " " : ""}${i.personalizedName || ""}${!before && e ? " " + e : ""}`.trim();
  return ` "${txt}"`;
}

// Same item line the client and webhook build — used when the server renders a
// customer email from the STORED order rather than from client-sent text.
export function itemsListFromOrder(order) {
  return (order.items || [])
    .map((i) =>
      i.isTip
        ? `🧡 Tip: ${money(i.price)}`
        : `${i.qty}× ${i.name}${personalisedSuffix(i)} (${(i.selectedColors || []).join(" + ")})${i.hasKeyring ? " + Keyring" : ""}`
    )
    .join("\n");
}

// "collection-local" (free local delivery) used to fall into the school wording and
// tell customers "Elijah will bring it to school" — fixed 2026-10-19.
export function deliveryWording(shipping) {
  const id = shipping?.id || "";
  if (id === "collection-local")
    return { how: "dropped off", msg: "Elijah will drop it round to you — keep an eye out!" };
  if (id.startsWith("collection"))
    return { how: "handed over at school", msg: "Elijah will bring it to school — keep an eye out!" };
  return { how: "shipped", msg: "Your order is on its way via Royal Mail Tracked 48. It should arrive within 2-3 working days." };
}

// Plain, light layout shared by all site emails. Kept deliberately simple: no anchors
// wrapping blocks (CLAUDE.md HTML-email rule 1), inline styles only.
function wrap(inner) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;">
<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#333;padding:14px 8px;background:#f5f5f5;">
<div style="max-width:600px;margin:auto;background:#fff;border-top:6px solid #458500;padding:18px 20px;">
${inner}
</div></div></body></html>`;
}
const para = (html) => `<p style="margin:0 0 12px 0;">${html}</p>`;

// ---- Templates. Each returns { subject, html, text }. ----

// New-order alert to John + Elijah. `p` is the existing templateParams shape.
function tplOrder(p) {
  const fee = p.card_fee ? String(p.card_fee) : null;
  const discount = p.discount ? String(p.discount) : null;
  const rows = [
    ["Order", p.order_id],
    ["Customer", p.customer_name],
    ["Email", p.customer_email],
    ["Phone", p.customer_phone],
    ["Shipping", p.shipping_method],
    ["Address", p.address],
  ];
  const money_rows = [
    ["Subtotal", p.subtotal],
    ...(discount ? [["Discount", discount]] : []),
    ["Shipping", p.shipping_cost],
    ...(fee ? [["Card fee", fee]] : []),
    ["TOTAL", p.total],
  ];
  const warn = p.unverified
    ? "⚠️ UNVERIFIED — this order is NOT in the order book. Check Stripe for a real payment before making anything."
    : null;
  const html = wrap(
    (warn ? para(`<strong style="color:#b00020;">${esc(warn)}</strong>`) : "") +
    para("<strong>New order from Elijah's 3D Print World!</strong>") +
      para(rows.map(([k, v]) => `${k}: ${esc(v)}`).join("<br>")) +
      para(`<strong>ITEMS TO MAKE:</strong><br>${escLines(p.items_list)}`) +
      para(money_rows.map(([k, v]) => (k === "TOTAL" ? `<strong>${k}: ${esc(v)}</strong>` : `${k}: ${esc(v)}`)).join("<br>"))
  );
  const text = [
    ...(warn ? [warn, ""] : []),
    "New order from Elijah's 3D Print World!",
    "",
    ...rows.map(([k, v]) => `${k}: ${v ?? ""}`),
    "",
    "ITEMS TO MAKE:",
    String(p.items_list || ""),
    "",
    ...money_rows.map(([k, v]) => `${k}: ${v ?? ""}`),
  ].join("\n");
  return { subject: `${warn ? "⚠️ UNVERIFIED " : ""}New Order: ${p.order_id}`, html, text };
}

// Stock/production order (SO- ids). The client sends these through type "order" with
// re-purposed fields; give them their own honest layout instead of a fake customer.
function tplStock(p) {
  const html = wrap(
    para("<strong>🏭 Production order — not a customer</strong>") +
      para(`Order: ${esc(p.order_id)}<br>${esc(p.customer_phone)}<br>${esc(p.subtotal)}<br>${esc(p.total)}`) +
      para(`<strong>ITEMS TO PRINT:</strong><br>${escLines(p.items_list)}`) +
      para("📦 Goes to stock, not to a customer. Check the Order Book for the tick-off list.")
  );
  const text = [
    "🏭 Production order — not a customer",
    "",
    `Order: ${p.order_id}`,
    String(p.customer_phone || ""),
    String(p.subtotal || ""),
    String(p.total || ""),
    "",
    "ITEMS TO PRINT:",
    String(p.items_list || ""),
    "",
    "Goes to stock, not to a customer. Check the Order Book for the tick-off list.",
  ].join("\n");
  return { subject: `Production order: ${p.order_id}`, html, text };
}

// Special request alert to John + Elijah — its own layout (there was never an EmailJS
// request template, which is what made requests arrive as "ghost orders").
function tplRequest(p) {
  const rows = [
    ["Request", p.request_id],
    ["Name", p.customer_name],
    ["Email", p.customer_email],
    ["Type", p.item_type],
    ["Size", p.size_pref],
    ["Colours", p.colour_pref],
    ["Budget", p.budget],
    ["Model link", p.model_link],
    ["Notes", p.extra_notes],
  ];
  const html = wrap(
    para("<strong>New special request!</strong>") +
      para(`<strong>What they want:</strong><br>${escLines(p.description)}`) +
      para(rows.map(([k, v]) => `${k}: ${esc(v)}`).join("<br>"))
  );
  const text = [
    "New special request!",
    "",
    "What they want:",
    String(p.description || ""),
    "",
    ...rows.map(([k, v]) => `${k}: ${v ?? ""}`),
  ].join("\n");
  return { subject: `New Special Request: ${p.request_id || p.customer_name || ""}`.trim(), html, text };
}

// "Your order is made" → customer. Rendered from the STORED order only.
function tplMade(order) {
  const first = String(order.customer?.name || "").split(" ")[0] || "there";
  const items = itemsListFromOrder(order);
  const html = wrap(
    para(`Hi ${esc(first)},`) +
      para(`Great news! Elijah has made your order (ref: ${esc(order.id)}).`) +
      para(`Your items:<br>${escLines(items)}`) +
      para("We'll let you know again when it's on its way!") +
      para("Thanks for supporting Elijah's 3D Print World 🖨️<br>etprintworld.com")
  );
  const text = [
    `Hi ${first},`,
    "",
    `Great news! Elijah has made your order (ref: ${order.id}).`,
    "",
    "Your items:",
    items,
    "",
    "We'll let you know again when it's on its way!",
    "",
    "Thanks for supporting Elijah's 3D Print World 🖨️",
    "etprintworld.com",
  ].join("\n");
  return { subject: "Great news! Elijah has made your order 🎉", html, text };
}

// "Your order is on its way" → customer. Rendered from the STORED order only.
function tplShipped(order) {
  const first = String(order.customer?.name || "").split(" ")[0] || "there";
  const items = itemsListFromOrder(order);
  const { how, msg } = deliveryWording(order.shipping);
  const html = wrap(
    para(`Hi ${esc(first)},`) +
      para(`Great news — your order from Elijah's 3D Print World has been ${esc(how)}!`) +
      para(`Order ref: ${esc(order.id)}`) +
      para(`Items:<br>${escLines(items)}`) +
      para(esc(msg)) +
      para("Thanks for ordering from Elijah's 3D Print World!<br>etprintworld.com")
  );
  const text = [
    `Hi ${first},`,
    "",
    `Great news — your order from Elijah's 3D Print World has been ${how}!`,
    "",
    `Order ref: ${order.id}`,
    "",
    "Items:",
    items,
    "",
    msg,
    "",
    "Thanks for ordering from Elijah's 3D Print World!",
    "etprintworld.com",
  ].join("\n");
  return { subject: `Your order ${order.id} is on its way! 📦`, html, text };
}

// type → { from, render } . `source` is templateParams for internal types and the
// stored Firestore order for customer types.
export function renderEmail(type, source) {
  switch (type) {
    case "order":
      return { from: FROM_ORDERS, ...(String(source.order_id || "").startsWith("SO-") ? tplStock(source) : tplOrder(source)) };
    case "request":
      return { from: FROM_ORDERS, ...tplRequest(source) };
    case "made":
      return { from: FROM_ELIJAH, ...tplMade(source) };
    case "shipped":
      return { from: FROM_ELIJAH, ...tplShipped(source) };
    default:
      return null;
  }
}

// One message to ONE recipient through Resend. Never throws; always reports what
// actually happened (Resend returns { id } on success — anything else is a failure).
export async function sendViaResend({ from, to, subject, html, text, headers }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { to, ok: false, detail: "RESEND_API_KEY not configured" };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000); // sends run in parallel; webhook allows 8s total
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: ac.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html, text, ...(headers ? { headers } : {}) }),
    });
    const body = await res.text();
    let id = null;
    try { id = JSON.parse(body).id || null; } catch { id = null; }
    if (!res.ok || !id) return { to, ok: false, resendStatus: res.status, detail: body.slice(0, 200) };
    return { to, ok: true, id };
  } catch (e) {
    return { to, ok: false, detail: String((e && e.message) || e).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

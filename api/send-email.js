// /api/send-email.js — Vercel serverless function
// Proxies EmailJS calls server-side so credentials stay hidden

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { type, templateParams, _tok } = req.body;

  // Reject requests without valid auth token
  const EXPECTED_TOKEN = process.env.EMAIL_API_TOKEN;
  if (!EXPECTED_TOKEN || _tok !== EXPECTED_TOKEN) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!type || !templateParams) {
    return res.status(400).json({ error: "Missing type or templateParams" });
  }

  // Internal notifications (e.g. scheduled-task summaries) bypass the order-format
  // check that protects the public order path. Added 2026-05-07 session 11 to fix
  // et-friday-briefing email delivery — server-side scheduled tasks were failing
  // the order-format validation because their payload isn't a customer order.
  // Internal notifications use the request template (already configured) and only
  // require a non-empty description.
  if (type === "internal") {
    const description = (templateParams.description || "").trim();
    if (description.length < 10) {
      console.warn("[send-email] BLOCKED internal email — empty description");
      return res.status(400).json({ error: "Internal notification description too short" });
    }
    // No order-format check; description is the only required field
  }

  // Validate order emails have required fields (prevents blank spam + bot abuse)
  // Background: the client-side _tok is bundled into App.jsx so anyone viewing the
  // deployed JS can extract it. The auth token alone isn't enough — we also need
  // strict format checks on the payload to block scraper/bot submissions that pass
  // whitespace or token strings to satisfy truthy checks.
  if (type === "order") {
    const p = templateParams;
    const order_id = (p.order_id || "").trim();
    const items_list = (p.items_list || "").trim();
    const customer_name = (p.customer_name || "").trim();
    const customer_email = (p.customer_email || "").trim();
    const total = (p.total || "").trim();

    // Order IDs must come from our generators: "EP-" (customer) or "SO-" (stock)
    const validIdPrefix = order_id.startsWith("EP-") || order_id.startsWith("SO-");
    if (!validIdPrefix) {
      console.warn("[send-email] BLOCKED order email — bad order_id:", JSON.stringify(p).slice(0, 300));
      return res.status(400).json({ error: "Invalid order_id format" });
    }

    // Real items list always contains at least "1× X" (5+ chars). Whitespace fails.
    if (items_list.length < 5) {
      console.warn("[send-email] BLOCKED order email — empty items_list:", JSON.stringify(p).slice(0, 300));
      return res.status(400).json({ error: "Order email items_list too short" });
    }

    // Customer details must be present (real or stock-placeholder)
    if (!customer_name || !customer_email || !total) {
      console.warn("[send-email] BLOCKED order email — missing customer/total:", JSON.stringify(p).slice(0, 300));
      return res.status(400).json({ error: "Order email missing customer or total" });
    }
  }

  const SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
  const PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;
  const PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;

  const TEMPLATES = {
    order: process.env.EMAILJS_ORDER_TEMPLATE_ID,
    shipped: process.env.EMAILJS_SHIPPED_TEMPLATE_ID,
    request: process.env.EMAILJS_REQUEST_TEMPLATE_ID,
    made: process.env.EMAILJS_MADE_TEMPLATE_ID,
    // Internal notifications reuse the request template (no new EmailJS config needed).
    // Renders description as the email body via the existing request template fields.
    internal: process.env.EMAILJS_REQUEST_TEMPLATE_ID,
  };

  const templateId = TEMPLATES[type];
  if (!templateId) {
    return res.status(400).json({ error: "Invalid email type: " + type });
  }

  // Fan out to one message PER recipient, rather than one message addressed to many.
  //
  // Why (2026-09-21): every internal notification passed a hardcoded two-address
  // string ("johnianthompson78@…, etprintworld@…") straight into to_email, so EmailJS
  // produced a SINGLE message with two recipients. Three problems with that:
  //   1. One bad/blocked address could take the whole notification down for everyone.
  //   2. Nothing recorded which mailbox was actually reached, so "I got two copies of
  //      EP-MU9MV9IW" could not be answered from the data at all.
  //   3. Two addresses that resolve to the same mailbox silently double-deliver.
  // Splitting here — rather than at each of the six call sites — means every caller
  // (webhook, client order, special request, stock order) gets the fix at once, and
  // there is exactly ONE place that decides what a recipient list means.
  //
  // Normalised and de-duplicated, so the same mailbox can never be addressed twice.
  const rawTo = String(templateParams.to_email || "");
  const recipients = [
    ...new Set(
      rawTo
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.toLowerCase())
    ),
  ];

  if (recipients.length === 0) {
    return res.status(400).json({ error: "No recipient in to_email" });
  }

  const results = [];
  for (const to of recipients) {
    try {
      const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: SERVICE_ID,
          template_id: templateId,
          user_id: PUBLIC_KEY,
          template_params: { ...templateParams, to_email: to },
          accessToken: PRIVATE_KEY,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("EmailJS error for", to, "—", response.status, text);
        results.push({
          to,
          ok: false,
          emailjsStatus: response.status,
          detail: String(text || "").slice(0, 200),
        });
      } else {
        console.log("[send-email] sent", type, "to", to);
        results.push({ to, ok: true });
      }
    } catch (e) {
      console.error("Email send error for", to, e);
      results.push({ to, ok: false, detail: String((e && e.message) || e).slice(0, 200) });
    }
  }

  const failed = results.filter((r) => !r.ok);

  // Non-2xx only when NOTHING got through. A partial failure still returns 200 —
  // the caller's primary job (an order is paid and saved) succeeded and must not be
  // treated as failed — but `recipients` carries the per-address truth so the caller
  // can stamp it, alarm on it, and never again assert a send it did not verify.
  if (failed.length === results.length) {
    return res.status(500).json({
      error: "EmailJS send failed",
      emailjsStatus: failed[0].emailjsStatus,
      detail: failed[0].detail,
      recipients: results,
    });
  }

  return res.status(200).json({
    success: true,
    partial: failed.length > 0,
    recipients: results,
  });
}

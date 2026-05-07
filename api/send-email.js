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

  try {
    const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: SERVICE_ID,
        template_id: templateId,
        user_id: PUBLIC_KEY,
        template_params: templateParams,
        accessToken: PRIVATE_KEY,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("EmailJS error:", response.status, text);
      return res.status(500).json({ error: "EmailJS send failed" });
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("Email send error:", e);
    return res.status(500).json({ error: "Email send failed" });
  }
}

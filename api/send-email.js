// /api/send-email.js — Vercel serverless function
// Proxies EmailJS calls server-side so credentials stay hidden

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { type, templateParams } = req.body;

  if (!type || !templateParams) {
    return res.status(400).json({ error: "Missing type or templateParams" });
  }

  const SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
  const PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;
  const PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;

  const TEMPLATES = {
    order: process.env.EMAILJS_ORDER_TEMPLATE_ID,
    shipped: process.env.EMAILJS_SHIPPED_TEMPLATE_ID,
    request: process.env.EMAILJS_REQUEST_TEMPLATE_ID,
    made: process.env.EMAILJS_MADE_TEMPLATE_ID,
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

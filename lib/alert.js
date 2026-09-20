// Out-of-band operational alarm — deliberately NOT email.
//
// Why this exists: on 2026-09-20 Microsoft suspended the shop's Outlook account and
// every email the site sends died at once. BOTH things that should have warned John
// were themselves emails — EmailJS's failure notice, and Microsoft's "verify your
// account" message, which was sent TO the very mailbox it had just suspended. Neither
// arrived until the next morning, and he only noticed by luck. An alarm that travels
// the same road as the fault it reports is not an alarm.
//
// So this uses a completely different transport: an HTTPS push to ntfy.sh, which lands
// on John's phone as a notification. No account, no credentials, no shared failure mode
// with EmailJS, Outlook, Microsoft or Firebase.
//
// NTFY_TOPIC is an env var, NOT a constant, because this repo is PUBLIC — anyone who
// could read the topic name could both read the alerts and push fake ones.
//
// Swapping to a paid//more reliable push service later (Pushover, Telegram) means
// changing only this file; no caller needs to know.

export async function alertOps(title, message, priority = "high") {
  const topic = process.env.NTFY_TOPIC;

  // No topic configured is itself worth shouting about in the logs — but it must never
  // throw, because every caller is on a path where the primary job already succeeded.
  if (!topic) {
    console.error("🔔 ALERT NOT SENT (NTFY_TOPIC env var is not set):", title, "|", message);
    return { ok: false, error: "NTFY_TOPIC not configured" };
  }

  // ntfy reads Title/Priority from HTTP headers, which are latin-1 — strip anything
  // outside ASCII so an emoji in a product name can't corrupt the header and fail the
  // push. The body is UTF-8 and can carry the full text.
  const safeTitle = String(title).replace(/[^\x20-\x7E]/g, "").slice(0, 120) || "ET Print World alert";

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 6000);
  try {
    const resp = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      signal: ac.signal,
      method: "POST",
      headers: {
        Title: safeTitle,
        Priority: priority,
        Tags: "rotating_light",
      },
      body: String(message),
    });
    clearTimeout(timer);

    // Check the response. The entire reason this file exists is that somebody didn't.
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error("🔔 alert push REJECTED — HTTP", resp.status, body.slice(0, 200));
      return { ok: false, error: `HTTP ${resp.status}` };
    }
    console.log("🔔 alert pushed:", safeTitle);
    return { ok: true };
  } catch (e) {
    console.error("🔔 alert push failed:", e);
    return { ok: false, error: String((e && e.message) || e).slice(0, 160) };
  }
}

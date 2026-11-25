// "We've got your idea": the automatic email a customer gets after sending a custom request.
//
// This is the one site email sent to an address typed into a public form, so it is
// deliberately narrow:
//   - fixed wording; the only customer text used is a single letters-only first name
//   - one strict email address, never a list
//   - at most 1 per address and 10 in total in any 24 hours (ledger claimed in a transaction)
//   - called only by api/save-request.js, only for a request that was newly saved
//   - never throws: a failed email must not fail or undo a saved request
//
// SWITCH: ACK_ENABLED (on since 2026-11-25). false = nothing is read, written or sent.
import { createHash } from "crypto";
import { FROM_ELIJAH, sendViaResend } from "./email.js";

export const ACK_ENABLED = true;
export const PER_ADDRESS_PER_DAY = 1;
export const TOTAL_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const LINK = "https://www.etprintworld.com/?utm_source=email&utm_medium=email&utm_campaign=request_ack";

export function ackRecipient(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  return /^[a-z0-9._%+'-]{1,64}@(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}$/.test(s) ? s : null;
}

export function firstName(raw) {
  const word = String(raw ?? "").trim().split(/\s+/)[0] || "";
  if (!/^\p{L}[\p{L}'’-]{0,14}$/u.test(word)) return null;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// "a+anything@x" counts as "a@x" for the limit. Only the hash is stored.
const limitKey = (addr) => createHash("sha256").update(addr.replace(/\+[^@]*@/, "@")).digest("hex");

export function renderAck(rawName) {
  const name = firstName(rawName);
  const hello = `Hi ${name || "there"},`;
  const lines = [
    "Thanks for sending us your idea. It has arrived safely with Elijah and his dad.",
    "We'll have a look and email you back at this address. If you don't see our reply, please check your junk folder.",
    "In the meantime, you're welcome to see what's on the website.",
  ];
  const footer = "You're getting this because this email address was used to send us a custom print request. If that wasn't you, you can ignore this email.";
  const safe = (v) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const p = (t) => `<p style="margin:0 0 12px 0;">${safe(t)}</p>`;
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>We've got your idea</title></head>
<body style="margin:0;padding:0;background:#0e0e1f;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#0e0e1f" style="background:#0e0e1f;"><tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="#0a1230" style="width:100%;max-width:600px;background:#0a1230;border:1px solid #2a3566;border-radius:18px;font-family:'DM Sans',Arial,Helvetica,sans-serif;">
<tr><td align="center" bgcolor="#152252" style="background:#152252;padding:22px 16px;font-size:22px;font-weight:bold;border-radius:18px 18px 0 0;"><span style="color:#00c9a7;">Elijah's</span> <span style="color:#ffffff;">3D Print World</span><div style="font-size:15px;font-weight:normal;color:#ffd43b;margin-top:6px;">&#128161; We've got your idea</div></td></tr>
<tr><td style="padding:22px 24px 6px 24px;font-size:16px;line-height:1.6;color:#ffffff;">${p(hello)}${lines.map(p).join("")}</td></tr>
<tr><td align="center" style="padding:6px 24px 8px 24px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#00c9a7" style="background:#00c9a7;border-radius:12px;"><a href="${LINK.replace(/&/g, "&amp;")}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:bold;color:#0a1230;text-decoration:none;">See the website</a></td></tr></table></td></tr>
<tr><td style="padding:16px 24px 24px 24px;font-size:16px;line-height:1.6;color:#ffffff;">Thanks,<br>Elijah (and Elijah's Dad)<br><a href="${LINK.replace(/&/g, "&amp;")}" style="color:#00c9a7;text-decoration:none;">etprintworld.com</a></td></tr>
<tr><td align="center" bgcolor="#0e0e1f" style="background:#0e0e1f;padding:14px 24px;font-size:12px;line-height:1.5;color:#8b8ba3;border-radius:0 0 18px 18px;">Elijah's 3D Print World &middot; Flintshire, Wales<br>${safe(footer)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [hello, "", ...lines.flatMap((l) => [l, ""]), LINK, "", "Thanks,", "Elijah (and Elijah's Dad)", "etprintworld.com", "", footer].join("\n");
  return { subject: "We've got your idea 💡", html, text };
}

export async function sendRequestAck({ db, request, enabled = ACK_ENABLED, send = sendViaResend, now = Date.now() }) {
  try {
    if (!enabled) return { sent: false, reason: "off" };
    const to = ackRecipient(request.email);
    if (!to) return { sent: false, reason: "bad-address" };

    const ledger = db.collection("system").doc("request-ack-ledger");
    const key = limitKey(to);
    const recent = (snap) => ((snap.exists && snap.data().sent) || []).filter((e) => e.at > now - DAY_MS);
    const verdict = await db.runTransaction(async (tx) => {
      const list = recent(await tx.get(ledger));
      if (list.filter((e) => e.k === key).length >= PER_ADDRESS_PER_DAY) return "address-limit";
      if (list.length >= TOTAL_PER_DAY) return "daily-limit";
      tx.set(ledger, { sent: [...list, { k: key, at: now, id: request.id }] });
      return "claimed";
    });
    if (verdict !== "claimed") {
      console.warn("[request-ack] not sent:", request.id, verdict);
      return { sent: false, reason: verdict };
    }

    let result;
    try {
      result = await send({ from: FROM_ELIJAH, to, ...renderAck(request.name) });
    } catch (e) {
      result = { ok: false, detail: String((e && e.message) || e).slice(0, 200) };
    }
    if (!result.ok) {
      console.error("[request-ack] send FAILED:", request.id, result.resendStatus || "", result.detail || "");
      // Nothing went out, so give the slot back.
      await db.runTransaction(async (tx) => {
        const list = recent(await tx.get(ledger));
        tx.set(ledger, { sent: list.filter((e) => !(e.id === request.id && e.at === now)) });
      });
    }
    // Record the outcome on the request, so a customer who was never told is visible in the data.
    await db.collection("requests").doc(request.id).update({
      _ackSent: !!result.ok,
      _ackAt: new Date(now).toISOString(),
      ...(result.ok ? {} : { _ackError: String(result.detail || result.resendStatus || "unknown").slice(0, 200) }),
    });
    return { sent: !!result.ok, reason: result.ok ? "sent" : "send-failed" };
  } catch (e) {
    console.error("[request-ack] error:", request && request.id, e && e.message);
    return { sent: false, reason: "error" };
  }
}

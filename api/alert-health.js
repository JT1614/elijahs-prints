// Verifies the out-of-band alarm channel actually works FROM PRODUCTION.
//
// Why this exists as a permanent endpoint rather than a throwaway test: the whole
// point of the 2026-09-20 alerting work is that a silent failure must become a loud
// one. An alarm nobody has ever proven can fire is exactly the "green build, collects
// nothing" trap this project has now hit three times (Vercel Analytics 2026-09-06, the
// unchecked email fetch, the Friday briefing's first scheduled run). So there has to
// be a way to ASK production whether the alarm is armed, without waiting for a real
// order to fail.
//
// It also answers the one thing no local test can: whether NTFY_TOPIC is actually set
// in Vercel's environment on the live deployment. A missing env var makes alertOps a
// no-op that only logs — the alarm would look fine and simply never fire.
//
// Auth: the existing HAL_EXPORT_TOKEN. No new secret, and it must be token-gated or
// anyone could spam John's phone (this repo is public).
//
// Usage:
//   GET /api/alert-health              -> checks config AND sends a real test push
//   GET /api/alert-health?dry=1        -> checks config only, sends nothing
//
// NEVER returns the topic value itself — only whether it is configured.

import { alertOps } from "../lib/alert.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = req.headers.authorization;
  if (!process.env.HAL_EXPORT_TOKEN || auth !== `Bearer ${process.env.HAL_EXPORT_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const topic = process.env.NTFY_TOPIC || "";
  const configured = topic.length > 0;

  // Report enough to diagnose a typo without ever disclosing the topic itself.
  const config = {
    ntfyTopicConfigured: configured,
    ntfyTopicLength: topic.length,
    ntfyTopicFingerprint: configured ? `${topic.slice(0, 4)}…${topic.slice(-4)}` : null,
    deployment: process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null,
  };

  if (!configured) {
    return res.status(503).json({
      ok: false,
      ...config,
      error: "NTFY_TOPIC is not set on this deployment — the alarm would never fire. Set it in Vercel and REDEPLOY (env vars only reach a function on a fresh build).",
    });
  }

  const dry = req.query?.dry === "1" || req.query?.dry === "true";
  if (dry) {
    return res.status(200).json({ ok: true, ...config, sent: false, note: "dry run — alarm is armed, nothing sent" });
  }

  const result = await alertOps(
    "ET Print World: alarm test",
    "This is a TEST of the order-email-failure alarm, sent from the live site.\n\n" +
      "If you can read this, the alarm is armed: a real order whose notification email " +
      "fails will reach you here within seconds, even when email itself is down.\n\n" +
      "No action needed.",
    "default"
  );

  return res.status(result.ok ? 200 : 502).json({ ok: result.ok, ...config, sent: result.ok, error: result.error || null });
}

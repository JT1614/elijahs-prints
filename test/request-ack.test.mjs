// Run: node --test test/
// Fake store and fake sender: nothing here touches Firestore or the mail service.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACK_ENABLED, TOTAL_PER_DAY, ackRecipient, firstName, renderAck, sendRequestAck,
} from "../lib/request-ack.js";

function fakeDb({ failTransaction = false } = {}) {
  const docs = new Map();
  const writes = [];
  const ref = (path) => ({
    path,
    update: async (patch) => { writes.push(["update", path, patch]); docs.set(path, { ...docs.get(path), ...patch }); },
  });
  return {
    docs, writes,
    collection: (c) => ({ doc: (d) => ref(`${c}/${d}`) }),
    runTransaction: async (fn) => {
      if (failTransaction) throw new Error("store down");
      return fn({
        get: async (r) => ({ exists: docs.has(r.path), data: () => docs.get(r.path) }),
        set: (r, v) => { writes.push(["set", r.path, v]); docs.set(r.path, v); },
      });
    },
  };
}
const outbox = (ok = true) => {
  const sent = [];
  return { sent, send: async (m) => { sent.push(m); return ok ? { ok: true, id: "x" } : { ok: false, resendStatus: 500, detail: "boom" }; } };
};
const request = (n = 1, extra = {}) => ({ id: `REQ-T${n}`, name: "Sam", email: `sam${n}@example.com`, ...extra });
const NOW = Date.UTC(2026, 10, 25, 12);
const run = (db, o, req, now = NOW) => sendRequestAck({ db, request: req, send: o.send, enabled: true, now });

test("is switched on, and switching it off means no reads, writes or sends", async () => {
  assert.equal(ACK_ENABLED, true);
  const db = fakeDb(), o = outbox();
  const r = await sendRequestAck({ db, request: request(), send: o.send, enabled: false });
  assert.deepEqual([r.reason, o.sent.length, db.writes.length], ["off", 0, 0]);
});

test("a new request gets one email, recorded on the request", async () => {
  const db = fakeDb(), o = outbox();
  assert.equal((await run(db, o, request())).sent, true);
  assert.equal(o.sent.length, 1);
  assert.equal(o.sent[0].to, "sam1@example.com");
  assert.equal(db.docs.get("requests/REQ-T1")._ackSent, true);
  assert.ok(!JSON.stringify(db.docs.get("system/request-ack-ledger")).includes("example.com"), "ledger holds no addresses");
});

test("one per address per day, including +tags and capitals; allowed again next day", async () => {
  const db = fakeDb(), o = outbox();
  await run(db, o, request(1, { email: "sam@example.com" }));
  assert.equal((await run(db, o, request(2, { email: "SAM+again@Example.com" }), NOW + 1000)).reason, "address-limit");
  assert.equal(o.sent.length, 1);
  assert.equal((await run(db, o, request(3, { email: "sam@example.com" }), NOW + 25 * 3600e3)).sent, true);
});

test("daily total is capped however many addresses are tried", async () => {
  const db = fakeDb(), o = outbox();
  for (let i = 0; i < TOTAL_PER_DAY + 5; i++) await run(db, o, request(i), NOW + i);
  assert.equal(o.sent.length, TOTAL_PER_DAY);
});

test("lists, headers and junk addresses are refused", async () => {
  for (const bad of ["a@x.com, b@y.com", "a@x.com;b@y.com", "A <a@x.com>", "a@x.com\nbcc:b@y.com", "nope", "a@b", ""]) {
    assert.equal(ackRecipient(bad), null, bad);
    const db = fakeDb(), o = outbox();
    await run(db, o, request(1, { email: bad }));
    assert.equal(o.sent.length, 0, bad);
  }
});

test("customer text cannot get into the email beyond one plain first name", () => {
  assert.equal(firstName("lucas the grinch god"), "Lucas");
  for (const bad of ["http://evil.example", "<b>x</b>", "win£500", "a".repeat(16), "123"]) assert.equal(firstName(bad), null, bad);
  const m = renderAck("Visit www.evil.example now");
  assert.ok(m.html.includes("Hi Visit,") && !m.html.includes("evil") && !m.text.includes("evil"));
  assert.ok(renderAck("<script>").text.startsWith("Hi there,"));
});

test("a failed send is recorded and gives the slot back", async () => {
  const db = fakeDb(), bad = outbox(false), good = outbox();
  assert.equal((await run(db, bad, request(1, { email: "s@example.com" }))).reason, "send-failed");
  assert.equal(db.docs.get("requests/REQ-T1")._ackSent, false);
  assert.match(db.docs.get("requests/REQ-T1")._ackError, /boom/);
  assert.equal((await run(db, good, request(2, { email: "s@example.com" }), NOW + 5)).sent, true);
});

test("never throws, and never sends if the limit cannot be checked", async () => {
  const o = outbox();
  const r = await run(fakeDb({ failTransaction: true }), o, request());
  assert.deepEqual([r.reason, o.sent.length], ["error", 0]);
  const thrower = { send: async () => { throw new Error("network"); } };
  assert.equal((await run(fakeDb(), thrower, request())).reason, "send-failed");
});

test("save-request calls it only after a new request is stored", () => {
  const src = readFileSync(new URL("../api/save-request.js", import.meta.url), "utf8");
  const saved = src.indexOf("await ref.set(doc)"), ack = src.indexOf("await sendRequestAck(");
  assert.ok(src.indexOf("alreadyExists: true") < saved && saved < ack);
});

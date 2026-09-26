// SAP EWM task → robot mission → Joule vision decision → simulated confirmation.
import assert from "node:assert/strict";
import { createOrderBook, publicOrder, missionFor, decide, closeOrder, stage, jouleVerifyBin } from "../src/sap-orders.mjs";

const places = [
  { id: "start", name: "Start", kind: "start", x: 0, y: 0 },
  { id: "rack-1", name: "Rack 1", kind: "rack", x: 9, y: 0 }, { id: "rack-2", name: "Rack 2", kind: "rack", x: 2, y: 1 },
  { id: "rack-3", name: "Rack 3", kind: "rack", x: 4, y: 0 }, { id: "rack-4", name: "Rack 4", kind: "rack", x: 6, y: 0 },
  { id: "forklift-1", name: "Forklift 1", kind: "forklift", x: 1, y: 1 }
];
const book = createOrderBook();

// without a map: generic bins; once Isaac maps the warehouse they move to its racks, nearest first
assert.deepEqual(book.list("t1", []).map((o) => o.placeId), [null, null, null]);
const seeded = book.list("t1", places);
assert.deepEqual(seeded.map((o) => o.storageBin), ["Rack 2", "Rack 3", "Rack 4"]);
assert.ok(seeded.every((o) => /^WT-41000\d{5}$/.test(o.id) && o.status === "open" && o.simulated));
assert.equal(book.list("t2", places).length, 3, "one book per tenant");

const order = seeded[0];
assert.deepEqual(missionFor(order).map((s) => s.type + ":" + (s.place || s.view)), ["go_to:rack-2", "view:inspect", "view:chase", "go_to:start"]);

// decisions: only a confident answer posts to SAP
assert.equal(decide({ rackState: "stocked", confidence: 0.9 }).decision, "confirm");
assert.equal(decide({ rackState: "stocked", confidence: 0.4 }).decision, "review");
assert.deepEqual([decide({ rackState: "empty", confidence: 0.8 }).code, decide({ rackState: "blocked", confidence: 0.8 }).code], ["DIFF", "BLCK"]);
assert.equal(decide({ rackState: "unclear", confidence: 0.99 }).decision, "review");

// the photo never travels in the public shape; events keep a copy, not a live reference
order.evidence = { image: "data:image/jpeg;base64,AAAA", caption: "inspect view", capturedAt: "now", pose: { x: 1, y: 2 } };
const snapshot = publicOrder(order);
assert.equal(snapshot.evidence.image, undefined);
stage(order, "verified", "stocked · 90%");
assert.notEqual(snapshot.timeline.length, order.timeline.length);

const conf = closeOrder(order, { ...decide({ rackState: "stocked", confidence: 0.9 }), by: "Joule + robot evidence" });
assert.match(conf.document, /^EWM-CONF-\d{8}$/);
assert.equal(order.status, "confirmed"); assert.equal(conf.simulated, true);
const exc = closeOrder(seeded[1], { ...decide({ rackState: "blocked", confidence: 0.9 }), by: "Joule + robot evidence" });
assert.match(exc.document, /^EWM-EXC-\d{8}$/); assert.equal(seeded[1].status, "exception");

// reset: fresh open tasks
assert.ok(book.reset("t1", places).every((o) => o.status === "open"));

// Joule offline: no call, a person reviews
const offline = await jouleVerifyBin({ orchestrator: { enabled: false } }, { image: "data:image/jpeg;base64,AAAA", order, principal: { tenantId: "t", userId: "u" }, cache: new Map() });
assert.equal(decide(offline).decision, "review");
console.log("sap-orders: ok");

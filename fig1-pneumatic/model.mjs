// The numbers behind Figure 1. Everything the readout, the motion and the caption say comes from here.

// Measured average ICMP round trips between backbone points of presence (hatsnet.io, 13 Oct 2026, 50 samples each).
// They move by a millisecond or two from round to round, and a real browser adds its access network on top.
export const LINES = [
  { id: "near", label: "New York ↔ Ashburn", short: "NY–Ashburn", km: 330, rtt: 6.1 },
  { id: "coast", label: "New York ↔ Los Angeles", short: "NY–LA", km: 3940, rtt: 57.9 },
  { id: "ocean", label: "New York ↔ London", short: "NY–London", km: 5570, rtt: 64.5 },
];

// Representative, not measured: an app server's own work for a small JSON endpoint, and one indexed
// query against a database in the same region (a same-region hop is well under a millisecond).
export const SERVER_MS = 2.0;
export const QUERY_MS = 0.8;

export const METHODS = {
  GET: { path: "/api/notes/42", sql: "SELECT … WHERE id = $1", ok: 200, body: false },
  POST: { path: "/api/notes", sql: "INSERT INTO notes …", ok: 201, body: true },
};

export const FAULTS = ["none", "missing", "broken"];

export const REASON = { 200: "OK", 201: "Created", 404: "Not Found", 500: "Internal Server Error" };

// Network time on screen runs this many times slower than real time. Handling at each station
// (lifting the canister, pulling the drawer) runs at a fixed pace that is not to scale.
export const SLOW = 50;

// Fixed handling times on screen, in seconds.
export const HANDLE = { click: 0.7, lift: 0.7, open: 0.5, drawer: 0.55, think: 0.35, drop: 0.7, settle: 0.4 };

export function outcome(method, fault) {
  const m = METHODS[method];
  if (fault === "broken") return { status: 500, query: false, row: false };
  if (fault === "missing") return { status: 404, query: true, row: false };
  return { status: m.ok, query: true, row: true };
}

// TCP (1 round trip) and TLS 1.3 (1 round trip) before the request on a new connection; a kept-alive
// connection sends the request straight away.
export function roundTrips(cold) {
  return cold ? 3 : 1;
}

export function totalMs(method, fault, line, cold) {
  const o = outcome(method, fault);
  return roundTrips(cold) * line.rtt + SERVER_MS + (o.query ? QUERY_MS : 0);
}

// The request's timeline on screen: a list of steps, each with a kind, a start and a duration in seconds.
export function timeline(method, fault, line, cold) {
  const o = outcome(method, fault);
  const leg = (line.rtt / 2 / 1000) * SLOW;
  const steps = [];
  let t = 0;
  const add = (kind, seconds, extra = {}) => {
    steps.push({ kind, t0: t, t1: t + seconds, ...extra });
    t += seconds;
  };
  add("click", HANDLE.click);
  if (cold) {
    add("syn", leg, { dir: 1, hand: 0 });
    add("synack", leg, { dir: -1, hand: 0 });
    add("hello", leg, { dir: 1, hand: 1 });
    add("helloback", leg, { dir: -1, hand: 1 });
  }
  add("lift", HANDLE.lift);
  add("out", leg, { dir: 1 });
  add("open", HANDLE.open);
  if (o.query) {
    add("query", HANDLE.drawer);
    add("rows", HANDLE.drawer);
  } else {
    add("think", HANDLE.think);
  }
  add("pack", HANDLE.open);
  add("back", leg, { dir: -1 });
  add("drop", HANDLE.drop);
  add("done", HANDLE.settle);
  return { steps, total: t, outcome: o, ms: totalMs(method, fault, line, cold) };
}

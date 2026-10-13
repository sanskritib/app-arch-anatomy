import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../kit/tube.mjs";
import * as A from "../kit/audit.mjs";
import { glCamera } from "../kit/gl.mjs";
import { kitScript, glScript } from "../scripts/inline-kit.mjs";
import { makeParts } from "./parts.mjs";
import { LINES, METHODS, SERVER_MS, QUERY_MS, SLOW } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = process.argv.includes("--light") ? "light" : "dark";

const W = 640;
const H = 440;
const AZIMUTH = 58;

// World layout, in units of about one viewBox px.
const PLATE = { x: -176, y: -56, w: 352, d: 266, r: 8 };
const PLATE_H = 10;
const FOOT_H = 5;
const CY = -8;
const DZ = 55;
const BODY = { z0: 3, z1: 52 };
const STATIONS = {
  browser: { plan: { x: -162, y: -36, w: 64, d: 58, r: 3 }, cx: -130 },
  server: { plan: { x: 28, y: -36, w: 64, d: 58, r: 3 }, cx: 60 },
};
const FRONT = 22;
const CAN = { r: 4.0, cap: 4.4, h: 20, base: DZ + 1.2 };
const RECV = { z0: 79, h: 24, r: 7.2 };
const RECV_TOP = RECV.z0 + RECV.h;
const TUBE = { r: 4.2, z: 128, bend: 16 };
const POSTS = [-48, 0];
const VALVE_X = -96;
const COUPLINGS = [-22, 24];
const SPEAK = { r: 1.6, y: 32, z: 9, top: 60, xs: [-104, 36] };
const CAB = { plan: { x: 112, y: -40, w: 52, d: 44, r: 2 }, z1: 78 };
const CAB_FACE = CAB.plan.y + CAB.plan.d;
const DRAWERS = [[6, 28], [30, 52], [54, 76]];
const QUERY_DRAWER = 1;
const SQL = { r: 1.8, x0: 84, x1: 138, y: -18, z: 96 };
const KNOB = { c: [-138, 38], r: 5.4, h: 4, dial: 8.6 };

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [STATIONS.browser.cx, CY, TUBE.z + TUBE.r + 2], [STATIONS.server.cx, CY, TUBE.z + TUBE.r + 2]],
  W,
  H,
  { pad: 16, azimuth: AZIMUTH },
);
const V = G.viewOf(P);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
const f2 = (v) => Math.round(v * 100) / 100;
const UP = [0, 0, 1];

const R = A.recorder(P);
const record = R.solid;
// Which part of the story each item belongs to, so the walkthrough can quiet the rest.
const zoneOf = (name) =>
  /^post\.tag/.test(name) ? "wire" :
  /^(monitor|display)/.test(name) ? "view" : /^(browser|method|knob)/.test(name) ? "client" : /^(main|valve|post)/.test(name) ? "wire" : /^(server|fault)/.test(name) ? "server" : /^(sql|cab)/.test(name) ? "db" : /^speak/.test(name) ? "socket" : "base";
function put(name, ref, svg, shapes = [], { bias = 0, attrs = "", ...rest } = {}) {
  return R.put({ name, at: ref, bias, svg, shapes, piece: "rig", attrs: ` data-zone="${zoneOf(name)}"${attrs}`, ...rest });
}
function box(name, [x0, y0, z0], [x1, y1, z1], style = {}, { r = 0.4, steps = 2, bevel = 0, extra = "", inner = "", bias = 0, attrs = "" } = {}) {
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r };
  const shape = record(A.slab(plan, z0, z1 - z0, { name }, steps));
  put(name, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
  return shape;
}
function turned(name, F, profile, style = {}, { extra = "", inner = "", bias = 0, smooth, steps, bevel = 0, owner, attrs = "", rims } = {}) {
  const opts = { bevel, ...(smooth !== undefined ? { smooth } : {}), ...(steps ? { steps } : {}), ...(rims ? { rims } : {}) };
  const paths = G.solidOf(profile, F, P, opts);
  const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
  const shape = record(A.solid(F, profile, { name, owner }));
  put(name, G.add3(F.o, G.mul3(F.a, mid)), S(paths, { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
  return shape;
}
const disc = (name, F, s0, s1, r, style = {}, options = {}) =>
  turned(name, F, [[s0, r], [s1, r]], style, options);
function ringAt(name, F, s0, s1, rIn, rOut, style = {}, { owner, bias = 0 } = {}) {
  const shape = record(A.ring(F, s0, s1, rIn, rOut, { name, owner }));
  put(name, G.add3(F.o, G.mul3(F.a, (s0 + s1) / 2)), S(G.ringBand(s0, s1, rIn, rOut, F, P), { tone: "mid", ...style }), [shape], { bias });
  return shape;
}
const vert = (x, y, z = 0) => G.frameOf([x, y, z], UP, [1, 0, 0], [0, 1, 0]);
function planeMatrix(o, ex, ey) {
  const p0 = at(o);
  const px = at(G.add3(o, ex));
  const py = at(G.add3(o, ey));
  const v = (x) => x.toFixed(4);
  return `matrix(${v(px[0] - p0[0])} ${v(px[1] - p0[1])} ${v(py[0] - p0[0])} ${v(py[1] - p0[1])} ${p0[0].toFixed(2)} ${p0[1].toFixed(2)})`;
}

// Pipes: filleted route, flanges whose back faces sit on the ports, collars that gap the pipe, and
// a dense resampling of the centreline for the glow that runs along it.
const ROUTES = {};
function pipe(name, control, r, { tone = "hi", bend = 3, flangeR = r * 1.45, collars = [], maxLength = 18, glow = true } = {}) {
  const route = G.fillet(control, Math.max(bend, r * 2.6), 14, { P, tube: r });
  const total = G.pathLength(route);
  const thick = Math.max(1.2, r * 0.38);
  const gaps = [[0, thick], [total - thick, total]];
  for (const c of collars) gaps.push([c.at - c.w / 2, c.at + c.w / 2]);
  R.route(name, route, r, { gaps, rims: [flangeR, flangeR] });
  tubePieces(route, r, P, { maxLength, spacing: Math.max(0.8, Math.min(2, r * 0.3)), gaps }).forEach((piece, index) =>
    put(`${name}:${index}`, piece.mid, tubeSvg(piece, { tone }), [A.tube(piece.points, piece.radii)], { attrs: ` data-route="${name}" data-chunk="${index}" data-s="${f2((piece.from + piece.to) / 2)}"` }),
  );
  [[0, 1], [total, -1]].forEach(([along, sign], index) => {
    const tangent = G.tangentAlong(route, along);
    const centre = G.add3(G.pointAlong(route, along), G.mul3(tangent, (sign * thick) / 2));
    const F = G.frameAlong(centre, tangent);
    const facing = Math.abs(G.dot3(F.a, V)) > 0.12;
    const face = G.dot3(F.a, V) > 0 ? thick / 2 : -thick / 2;
    const bolts = facing && r > 3 ? Dots(G.dotsOf(F, face, flangeR * 0.78, 6, P, { all: true }), { size: 0.42, tone: "mid" }) : "";
    const shape = record(A.disc(F, -thick / 2, thick / 2, flangeR, { name: `${name}.flange${index}`, owner: name }));
    put(`${name}.flange${index}`, centre, S(G.disc(-thick / 2, thick / 2, flangeR, F, P), { tone }) + bolts, [shape]);
  });
  if (glow) {
    const samples = G.resample(route, 1.5);
    let s = 0;
    const pts = samples.map((p, i) => {
      if (i) s += G.len3(G.sub3(p, samples[i - 1]));
      const q = at(p);
      return [f2(q[0]), f2(q[1]), f2(s)];
    });
    ROUTES[name] = { pts, total: f2(s), r: f2(r * KS), gaps: gaps.map(([a, b]) => [f2(a), f2(b)]) };
  }
  return { route, total };
}

function cable(name, control, r, { tone = "mid", bend = 4 } = {}) {
  const route = G.fillet(control, Math.max(bend, r * 2.6), 10, { P, tube: r });
  R.route(name, route, r, { limp: true });
  tubePieces(route, r, P, { maxLength: 16, spacing: 0.8 }).forEach((piece, i) => put(`${name}:${i}`, piece.mid, tubeSvg(piece, { tone }), [A.tube(piece.points, piece.radii)]));
  const size = Math.max(0.5, r * KS * 0.9);
  for (const end of [route[0], route[route.length - 1]]) put(`${name}.end`, end, Dots([at(end)], { size, tone: "hi" }), [A.ball(end, size / KS, { name: `${name}.end`, owner: name })], { bias: 0.15 });
}

// The monitor's picture: a tiny notes app in the plane of the screen. Every view is drawn once; the
// page shows one at a time.
function screenSvg() {
  const m = planeMatrix(SCREEN.o, [SCREEN.scale, 0, 0], [0, 0, -SCREEN.scale]);
  const t = (x, y, size, text, cls = "f1-st") => `<text class="${cls}" x="${x}" y="${y}" font-size="${size}">${text}</text>`;
  const rect = (x, y, w, h, cls, rx = 0.8) => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;
  const rows = (from, list) => list.map(([w, cls], i) => rect(3, from + i * 6, 56, 4.4, cls) + rect(5, from + i * 6 + 1.7, w, 1, "f1-si")).join("");
  const heading = (text) => t(3, 11.4, 3.6, text, "f1-sh");
  const views = {
    list: heading("My notes") + `<g class="f1-snew">${rect(47, 7.8, 12, 4.6, "f1-sbtn", 1)}${t(48.6, 11.1, 2.4, "+ New", "f1-sbt")}</g>` + `<g class="f1-srow">${rect(3, 14, 56, 4.4, "f1-sr0")}${rect(5, 15.7, 22, 1, "f1-si")}</g>` + rows(20, [[18, "f1-sr0"], [28, "f1-sr0"]]),
    loading: `<g class="f1-sdim">${heading("My notes")}${rows(14, [[22, "f1-sr0"], [18, "f1-sr0"], [28, "f1-sr0"]])}</g><g class="f1-spin" data-part="spinner"><path class="f1-sarc" d="M31 22.6a3 3 0 1 1 -3 -3"/></g>`,
    note: heading("Note 42") + rect(3, 14, 56, 20, "f1-sr0") + [44, 36, 40, 22].map((w, i) => rect(5.4, 17.5 + i * 4, w, 1, "f1-si")).join(""),
    saved: heading("My notes") + `<g class="f1-sok">${rect(3, 14, 56, 4.4, "f1-snew-row")}${rect(5, 15.7, 20, 1, "f1-si")}${rect(46, 14.7, 11.4, 3, "f1-schip", 1.5)}${t(47.6, 16.95, 2.1, "Saved", "f1-schipt")}</g>` + rows(20, [[22, "f1-sr0"], [18, "f1-sr0"], [28, "f1-sr0"]].slice(0, 2)),
    missing: t(3, 21, 9, "404", "f1-swarn") + t(3, 27.6, 3.2, "Note not found") + t(3, 31.8, 2.4, "It may have been deleted.", "f1-smut"),
    error: rect(3, 8, 56, 8.4, "f1-serr", 1) + t(5.4, 13.2, 3.1, "Something went wrong", "f1-serrt") + rect(3, 20, 18, 6, "f1-sbtn", 1) + t(5.2, 23.9, 2.6, "Try again", "f1-sbt"),
  };
  const bar = rect(0, 0, SCREEN.u, 5.4, "f1-sbar", 0) + [2.6, 4.8, 7].map((x) => `<circle class="f1-sdot" cx="${x}" cy="2.7" r=".75"/>`).join("") + rect(10, 1.2, 34, 3, "f1-surl", 1.5) + `<g class="f1-surls">${t(11.6, 3.45, 2.3, "notes.app", "f1-surlt")}</g>`;
  const body = Object.entries(views).map(([id, svg]) => `<g class="f1-sview" data-v="${id}">${svg}</g>`).join("");
  return `<g class="f1-screen" data-part="screen" data-view="list" transform="${m}"><clipPath id="f1-scr"><rect x="0" y="0" width="${SCREEN.u}" height="${SCREEN.v}" rx="1.2"/></clipPath><rect class="f1-sbg" x="0" y="0" width="${SCREEN.u}" height="${SCREEN.v}" rx="1.2"/><g clip-path="url(#f1-scr)">${bar}${body}</g><rect class="f1-sframe" x="0" y="0" width="${SCREEN.u}" height="${SCREEN.v}" rx="1.2"/></g>`;
}

// Engraved text in the plane through o spanned by ex (along the text) and ey (down the letters).
const engrave = (o, ex, ey, text, size, anchor = "middle") => k.faceTextSvg(planeMatrix(o, ex, ey), text, { size, tone: "hi", anchor });
const back = [];
back.push(`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
  back.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
  back.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
}
back.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid", inner: Ln(k.sideSeam(PLATE, -4, P, 8), { tone: "faint" }) }));
back.push(Ln(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
const plateScrews = k.corners(PLATE, 10);
back.push(Ln(plateScrews.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
back.push(Dots(plateScrews.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
record(A.slab(PLATE, -PLATE_H, PLATE_H, { name: "stand.plate", ground: true }, 8));

// The fibre ruler along the front edge, under the speaking tube.
const STRIP = { x: -150, y: 44, w: 300, d: 6, r: 1 };
back.push(S(k.slabOf(STRIP, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
{
  const t = k.topTicks(STRIP.x + 4, STRIP.x + STRIP.w - 4, 4, 5, STRIP.y, 0.6, [1.8, 3.4], P);
  back.push(Ln(t.minor, { tone: "lo" }), Ln(t.major, { tone: "mid" }));
  back.push(Dots([at([STRIP.x + 2, STRIP.y + 3, 0.6]), at([STRIP.x + STRIP.w - 2, STRIP.y + 3, 0.6])], { size: 0.45 }));
}
// Label plate on the base.
{
  const LABEL = { x: 104, y: 22, w: 32, d: 13, r: 1.2 };
  back.push(S(k.slabOf(LABEL, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  back.push(Ln(k.planOutline(k.insetPlan(LABEL, 1.4), 0.8, P, 3), { tone: "faint" }));
  back.push(Ln([20, 14, 17].map((w, i) => k.lineOnTop([LABEL.x + 4, LABEL.y + 3.4 + i * 3], [LABEL.x + 4 + w, LABEL.y + 3.4 + i * 3], 0.8, P)).join(""), { tone: "lo", free: true }));
  back.push(Dots([at([LABEL.x + LABEL.w - 2.6, LABEL.y + 2.4, 0.8]), at([LABEL.x + LABEL.w - 2.6, LABEL.y + LABEL.d - 2.4, 0.8])], { size: 0.45 }));
}

// The display: a desktop monitor at the front of the bench, wired to the browser station. It shows what
// the person using the app sees.
const MON = { x0: 0, x1: 100, y0: 166, y1: 169, z0: 14, z1: 78 };
const SCREEN = { u: 62, v: 38, scale: 1.516, o: [3, MON.y1 + 0.02, 75.6] };
box("monitor.foot", [32, 156, 0], [68, 174, 2], { tone: "lo" }, { r: 5, steps: 6, bevel: 0.5, extra: Dots([at([36, 171, 2]), at([64, 171, 2])], { size: 0.45 }) });
box("monitor.neck", [46, 162, 2], [54, 166, 40], { tone: "mid" }, { r: 1, steps: 3, inner: Ln(k.sideSeam({ x: 46, y: 162, w: 8, d: 4, r: 1 }, 10, P, 3), { tone: "faint" }) });
box("monitor.bezel", [MON.x0, MON.y0, MON.z0], [MON.x1, MON.y1, MON.z1], { tone: "mid" }, {
  r: 1.6,
  steps: 4,
  bevel: 0.5,
  extra: screenSvg() + Dots([at([94, MON.y1, 15.9])], { size: 0.8, tone: "hi" }) + Dots([86, 88.4, 90.8].map((x) => at([x, MON.y1, 15.9])), { size: 0.4, tone: "lo" }),
});
// Keyboard and mouse in front of the monitor: where the person's click starts.
{
  const KB = { x: 14, y: 184, w: 72, d: 24, r: 2.5 };
  const keys = [];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 13; col++) keys.push(k.planOutline({ x: KB.x + 3 + col * 5.1, y: KB.y + 3 + row * 4.4, w: 4.3, d: 3.6, r: 0.6 }, 2.6, P, 2));
  keys.push(k.planOutline({ x: KB.x + 16, y: KB.y + 3 + 4 * 4.4, w: 40, d: 3, r: 0.6 }, 2.6, P, 2));
  box("monitor.keyboard", [KB.x, KB.y, 0], [KB.x + KB.w, KB.y + KB.d, 2.6], { tone: "mid" }, { r: KB.r, steps: 5, bevel: 0.4, extra: Ln(keys.join(""), { tone: "lo" }) });
  const MS = { x: 96, y: 186, w: 10, d: 15, r: 4.6 };
  const btn = [[MS.x + 0.9, MS.y + 1.2], [MS.x + 4.8, MS.y + 1.2], [MS.x + 4.8, MS.y + 6], [MS.x + 0.9, MS.y + 6]];
  box("monitor.mouse", [MS.x, MS.y, 0], [MS.x + MS.w, MS.y + MS.d, 3.2], { tone: "mid" }, {
    r: MS.r,
    steps: 8,
    bevel: 0.4,
    extra: `<path class="f1-mbtn" d="${k.onTop(btn, 3.2, P, true)}"/>` + Ln(k.planOutline({ x: MS.x + 0.9, y: MS.y + 1.2, w: 3.9, d: 4.8, r: 0.8 }, 3.2, P, 3) + k.planOutline({ x: MS.x + 5.2, y: MS.y + 1.2, w: 3.9, d: 4.8, r: 0.8 }, 3.2, P, 3), { tone: "lo" }),
  });
}
cable("display.cable", [[-118, FRONT, 6], [-118, 27, 6], [-118, 27, 1.6], [-118, 152, 1.6], [50, 152, 1.6], [50, 152, 8], [50, 162, 8]], 0.7, { bend: 4 });

// Stations: plinth, cabinet body with a seam, deck, front panel, the cradle and the receiver on its arm.
const LAMP_X = [-150, -142, -134];
const LAMP_Z = 42;
for (const [id, st] of Object.entries(STATIONS)) {
  const plan = st.plan;
  box(`${id}.plinth`, [plan.x + 2, plan.y + 2, 0], [plan.x + plan.w - 2, plan.y + plan.d - 2, BODY.z0], { tone: "lo" }, { r: 2, steps: 4 });
  const body = record(A.slab(plan, BODY.z0, BODY.z1 - BODY.z0, { name: `${id}.body` }, 6));
  const slots = [];
  const x0 = plan.x + plan.w - (id === "browser" ? 30 : 58);
  for (let i = 0; i < 6; i++) {
    const x = x0 + i * 4.4;
    slots.push(path3([[x, FRONT, 8], [x + 1.6, FRONT, 8], [x + 1.6, FRONT, 20], [x, FRONT, 20]], true));
  }
  const screws = [[plan.x + 3, 6], [plan.x + plan.w - 3, 6], [plan.x + 3, 48], [plan.x + plan.w - 3, 48]].map(([x, z]) => at([x, FRONT, z]));
  const xs = plan.x + plan.w;
  for (let i = 0; i < 7; i++) {
    const y = plan.y + 10 + i * 5.2;
    slots.push(path3([[xs, y, 34], [xs, y + 2, 34], [xs, y + 2, 46], [xs, y, 46]], true));
  }
  screws.push(...[[plan.y + 3, 6], [plan.y + plan.d - 3, 6], [plan.y + 3, 48], [plan.y + plan.d - 3, 48]].map(([y, z]) => at([xs, y, z])));
  if (id === "server") {
    const door = [[plan.x + 4, FRONT, 24], [plan.x + 40, FRONT, 24], [plan.x + 40, FRONT, 48], [plan.x + 4, FRONT, 48]];
    slots.push(path3(door, true));
    screws.push(...[[plan.x + 6, 26], [plan.x + 38, 26], [plan.x + 6, 46], [plan.x + 38, 46]].map(([x, z]) => at([x, FRONT, z])));
  }
  put(`${id}.body`, [plan.x + plan.w / 2, plan.y + plan.d / 2, (BODY.z0 + BODY.z1) / 2], S(k.slabOf(plan, BODY.z0, BODY.z1 - BODY.z0, P, 6, 0.8), { tone: "mid", inner: Ln(k.sideSeam(plan, 26, P, 6), { tone: "faint" }) }) + Ln(slots.join(""), { tone: "faint" }) + Dots(screws, { size: 0.45 }), [body]);
  const deck = k.insetPlan(plan, -1.5);
  box(`${id}.deck`, [deck.x, deck.y, BODY.z1], [deck.x + deck.w, deck.y + deck.d, DZ], { tone: "mid" }, { r: 4, steps: 6, bevel: 0.6, extra: Ln(k.planOutline(k.insetPlan(plan, 4), DZ, P, 6), { tone: "faint" }) });
  const cx = st.cx;
  disc(`${id}.cradle`, vert(cx, CY), DZ, DZ + 1.2, 6.2, { tone: "lo" }, { extra: Ln(G.circleOf(vert(cx, CY), DZ + 1.2, 4.6, P, 40), { tone: "faint" }) });
  const postY = CY - 17;
  disc(`${id}.post.collar`, vert(cx, postY), DZ, DZ + 2, 3.8, { tone: "lo" });
  disc(`${id}.post`, vert(cx, postY), DZ + 2, 99, 2.4, { tone: "mid" }, { inner: Ln(G.arcOf(vert(cx, postY), 70, 2.4, P), { tone: "faint" }) });
  disc(`${id}.post.cap`, vert(cx, postY), 99, 100.4, 3, { tone: "mid" });
  box(`${id}.arm`, [cx - 1.4, postY + 2, 92], [cx + 1.4, CY - 6.9, 96], { tone: "mid" }, { extra: Dots([at([cx, postY + 4, 96]), at([cx, CY - 9.6, 96])], { size: 0.4 }) });
  const RF = vert(cx, CY, RECV.z0);
  turned(`${id}.receiver`, RF, [[0, 6.4], [1.4, 6.4], [1.4, RECV.r], [RECV.h - 1.6, RECV.r], [RECV.h - 1.6, 6.8], [RECV.h, 6.8]], { tone: "mid" }, {
    inner: Ln(G.arcOf(RF, 8, RECV.r, P) + G.arcOf(RF, 15, RECV.r, P), { tone: "faint" }),
    extra: Dots(G.dotsOf(RF, 11.5, RECV.r, 10, P, { fade: [0.04, 0.42] }), { size: 0.42, tone: "mid" }),
  });
}

// Browser front panel: three status lamps and a label plate; send button and method lever on the deck.
{
  const panel = { x: -158, y: FRONT, w: 30, d: 1, r: 0.6 };
  box("browser.panel", [panel.x, FRONT, 32], [panel.x + panel.w, FRONT + 1, 50], { tone: "mid" }, {
    extra:
      engrave([panel.x + panel.w / 2, FRONT + 1.02, 36.2], [1, 0, 0], [0, 0, -1], "BROWSER", 4.4) +
      Dots([[panel.x + 1.6, 48.4], [panel.x + panel.w - 1.6, 48.4], [panel.x + 1.6, 33.6], [panel.x + panel.w - 1.6, 33.6]].map(([x, z]) => at([x, FRONT + 1, z])), { size: 0.42 }),
  });
  ["ok", "warn", "fail"].forEach((kind, i) => {
    const F = G.frameAlong([LAMP_X[i], FRONT + 1, LAMP_Z + 2], [0, 1, 0]);
    disc(`browser.lamp.${kind}`, F, 0, 1.4, 2.6, { tone: "hi" }, { attrs: ` data-lamp="${kind}"`, extra: Ln(G.circleOf(F, 1.4, 1.5, P, 24), { tone: "faint" }) });
  });
}
const SEND = [-110, 10];
disc("browser.send.housing", vert(...SEND), DZ, DZ + 1.6, 4.4, { tone: "lo" });
const BUTTON_TOP = DZ + 3.2;
const LEVERS = {
  method: { base: [-150, 7, DZ], plate: { x: -161, y: 2, w: 22, d: 13, r: 1 }, marks: [["GET", -6.2], ["POST", 6.2]] },
  fault: { base: [45, 7, DZ], plate: { x: 32, y: 2, w: 26, d: 13, r: 1 }, marks: [["OK", -7.4], ["404", 0], ["500", 7.4]] },
};
for (const [id, lv] of Object.entries(LEVERS)) {
  box(`${id}.plate`, [lv.plate.x, lv.plate.y, DZ], [lv.plate.x + lv.plate.w, lv.plate.y + lv.plate.d, DZ + 1.2], { tone: "lo" }, {
    r: 1,
    steps: 3,
    extra:
      Ln(k.planOutline({ x: lv.plate.x + 2.4, y: lv.base[1] - 0.8, w: lv.plate.w - 4.8, d: 1.6, r: 0.8 }, DZ + 1.2, P, 3), { tone: "lo" }) +
      Dots([at([lv.plate.x + 1.2, lv.plate.y + 1.2, DZ + 1.2]), at([lv.plate.x + lv.plate.w - 1.2, lv.plate.y + lv.plate.d - 1.2, DZ + 1.2])], { size: 0.4 }) +
      lv.marks.map(([text, dx]) => engrave([lv.base[0] + dx, 13.4, DZ + 1.22], [1, 0, 0], [0, 1, 0], text, 2.9)).join(""),
  });
}

{
  const x0 = STATIONS.server.plan.x;
  box("server.handle", [x0 + 33, FRONT, 33], [x0 + 35, FRONT + 1.4, 40], { tone: "hi" }, { r: 0.6 });
  for (let i = 0; i < 3; i++) {
    const z0 = 28 + i * 6.4;
    box(`server.bay${i}`, [x0 + 12, FRONT, z0], [x0 + 30, FRONT + 0.8, z0 + 4.6], { tone: "mid" }, { r: 0.4, extra: Dots([at([x0 + 28, FRONT + 0.8, z0 + 2.3])], { size: 0.55, tone: "hi" }) + Ln(path3([[x0 + 14, FRONT + 0.8, z0 + 2.3], [x0 + 23, FRONT + 0.8, z0 + 2.3]]), { tone: "lo", free: true }) });
  }
}

box("server.nameplate", [68, FRONT, 36], [91, FRONT + 0.6, 44], { tone: "lo" }, { r: 0.4, extra: engrave([79.5, FRONT + 0.62, 41.6], [1, 0, 0], [0, 0, -1], "SERVER", 4.4) + Dots([at([69.3, FRONT + 0.6, 40]), at([89.7, FRONT + 0.6, 40])], { size: 0.4 }) });
for (const [id, st] of Object.entries(STATIONS)) {
  const y = CY + RECV.r;
  box(`${id}.receiver.plate`, [st.cx - 5, y, 83.6], [st.cx + 5, y + 0.5, 89.8], { tone: "lo" }, { r: 0.3, extra: engrave([st.cx, y + 0.52, 88.1], [1, 0, 0], [0, 0, -1], "PORT", 3.4) });
}
{
  const x = POSTS[0];
  box("post.tag", [x - 10.5, CY + 2, 107], [x + 10.5, CY + 2.6, 115], { tone: "lo" }, { r: 0.4, extra: engrave([x, CY + 2.62, 112.4], [1, 0, 0], [0, 0, -1], "INTERNET", 3.4) + Dots([at([x - 9.4, CY + 2.6, 111]), at([x + 9.4, CY + 2.6, 111])], { size: 0.4 }) });
}

// The database: a filing cabinet with three drawers; the middle one is the query.
{
  const plan = CAB.plan;
  box("cab.plinth", [plan.x + 2, plan.y + 2, 0], [plan.x + plan.w - 2, plan.y + plan.d - 2, 2], { tone: "lo" }, { r: 1.5, steps: 3 });
  const openings = DRAWERS.map(([z0, z1]) => path3([[plan.x + 2, CAB_FACE, z0], [plan.x + plan.w - 2, CAB_FACE, z0], [plan.x + plan.w - 2, CAB_FACE, z1], [plan.x + 2, CAB_FACE, z1]], true));
  const xs = plan.x + plan.w;
  const side = [[xs, -35, 57], [xs, -7, 57], [xs, -7, 69], [xs, -35, 69]];
  const sideScrews = [[-38, 6], [-38, 74], [2, 6], [2, 74]].map(([y, z]) => at([xs, y, z]));
  box("cab.body", [plan.x, plan.y, 2], [plan.x + plan.w, plan.y + plan.d, CAB.z1], { tone: "mid" }, { r: 2, steps: 4, bevel: 0.6, inner: Ln(k.sideSeam(plan, 29, P, 4) + k.sideSeam(plan, 53, P, 4), { tone: "faint" }), extra: `<path class="f1-void" d="${openings[QUERY_DRAWER]}"/>` + Ln(openings.join(""), { tone: "lo" }) + Ln(path3(side, true), { tone: "lo" }) + engrave([xs + 0.02, -21, 64.8], [0, -1, 0], [0, 0, -1], "DATABASE", 4.4) + Dots(sideScrews, { size: 0.45 }) });
  const top = k.insetPlan(plan, -1);
  box("cab.top", [top.x, top.y, CAB.z1], [top.x + top.w, top.y + top.d, CAB.z1 + 2], { tone: "mid" }, { r: 2.5, steps: 4, bevel: 0.5 });
}
const DRAWER_D = { face: CAB_FACE, x0: CAB.plan.x + 2, x1: CAB.plan.x + CAB.plan.w - 2, z0: DRAWERS[QUERY_DRAWER][0], z1: DRAWERS[QUERY_DRAWER][1], wall: 12, cards: 8, card: [124, 146] };
const PARTS = makeParts(k, P, { drawer: DRAWER_D });
DRAWERS.forEach(([z0, z1], i) => {
  if (i === QUERY_DRAWER) return;
  const d = { ...DRAWER_D, z0, z1 };
  const parts = makeParts(k, P, { drawer: d });
  put(`cab.drawer${i}`, [(d.x0 + d.x1) / 2, CAB_FACE + 0.9, (z0 + z1) / 2], parts.drawer(0, 0), [record(A.slab({ x: d.x0, y: CAB_FACE, w: d.x1 - d.x0, d: 1.8, r: 0.6 }, z0, z1 - z0, { name: `cab.drawer${i}` }, 2))]);
});

// Main tube: up out of the browser's receiver, across, down into the server's receiver. The valve on
// the browser side stands for opening a new connection; two posts carry the run on clamps.
const B = STATIONS.browser.cx;
const SX = STATIONS.server.cx;
const mainControl = [[B, CY, RECV_TOP], [B, CY, TUBE.z], [SX, CY, TUBE.z], [SX, CY, RECV_TOP]];
const mainRoute = G.fillet(mainControl, TUBE.bend, 14, { P, tube: TUBE.r });
const arcAtX = (x) => {
  const pts = G.resample(mainRoute, 0.25);
  let s = 0;
  let best = 0;
  let bd = Infinity;
  pts.forEach((p, i) => {
    if (i) s += G.len3(G.sub3(p, pts[i - 1]));
    const d = Math.abs(p[0] - x) + Math.abs(p[2] - TUBE.z) * 4;
    if (d < bd) {
      bd = d;
      best = s;
    }
  });
  return best;
};
const VALVE_HALF = TUBE.r * 2.4;
const CLAMP_W = 3;
const CLAMP_R = 7;
const main = pipe("main", mainControl, TUBE.r, {
  tone: "hi",
  bend: TUBE.bend,
  flangeR: 6.1,
  collars: [{ at: arcAtX(VALVE_X), w: VALVE_HALF * 2 }, ...POSTS.map((x) => ({ at: arcAtX(x), w: CLAMP_W })), ...COUPLINGS.map((x) => ({ at: arcAtX(x), w: 2.4 }))],
});
for (const x of POSTS) {
  const F = G.frameAlong([x, CY, TUBE.z], [1, 0, 0]);
  ringAt(`post${x}.clamp`, F, -CLAMP_W / 2, CLAMP_W / 2, TUBE.r, CLAMP_R, { tone: "mid" }, { owner: "main" });
  const PF = vert(x, CY);
  disc(`post${x}.foot`, PF, 0, 1.2, 6, { tone: "lo" }, { extra: Dots(G.dotsOf(PF, 1.2, 4.6, 4, P, { all: true, phase: Math.PI / 4 }), { size: 0.42 }) });
  disc(`post${x}.collar`, PF, 1.2, 4, 3.6, { tone: "mid" });
  const top = TUBE.z - Math.sqrt(CLAMP_R ** 2 - 2 ** 2);
  disc(`post${x}`, PF, 4, top, 2, { tone: "mid" }, { inner: Ln(G.arcOf(PF, 40, 2, P) + G.arcOf(PF, 80, 2, P), { tone: "faint" }) });
}
// Valve: a ball body on the straight with a collar each side, a neck and an actuator with the handle on top.
const BALL_R = 7.4;
const VALVE_TOP = TUBE.z + BALL_R + 4.6;
{
  const centre = [VALVE_X, CY, TUBE.z];
  put("valve", centre, S(G.sphereOf(centre, BALL_R, P, { steps: 48 }), { tone: "hi" }), [record(A.ball(centre, BALL_R, { name: "valve", owner: "main" }))]);
  const F = G.frameAlong(centre, [1, 0, 0]);
  const meet = Math.sqrt(BALL_R ** 2 - 5.8 ** 2);
  for (const sign of [-1, 1]) {
    const [s0, s1] = sign < 0 ? [-VALVE_HALF, -meet] : [meet, VALVE_HALF];
    const face = sign < 0 ? s0 : s1;
    disc(`valve.collar${sign}`, F, s0, s1, 5.8, { tone: "hi" }, { owner: "main", extra: Dots(G.dotsOf(F, face, 4.9, 6, P, { all: true }), { size: 0.4, tone: "mid" }) });
  }
  const NF = vert(VALVE_X, CY, TUBE.z);
  const neck0 = Math.sqrt(BALL_R ** 2 - 2.2 ** 2);
  disc("valve.neck", NF, neck0, BALL_R + 1.6, 2.2, { tone: "hi" }, { owner: "main", bias: 0.2 });
  disc("valve.actuator", NF, BALL_R + 1.6, VALVE_TOP - TUBE.z, 3.8, { tone: "mid" }, { owner: "main", bias: 0.3, bevel: 0.4, extra: Dots(G.dotsOf(NF, VALVE_TOP - TUBE.z, 3, 4, P, { all: true, phase: Math.PI / 4 }), { size: 0.4 }) });
}
for (const x of COUPLINGS) ringAt(`main.coupling${x}`, G.frameAlong([x, CY, TUBE.z], [1, 0, 0]), -1.2, 1.2, TUBE.r, 5.2, { tone: "hi" }, { owner: "main" });

// The speaking tube: always open, low along the front, from a mouthpiece by each station.
const speakControl = [[SPEAK.xs[0], SPEAK.y, SPEAK.top], [SPEAK.xs[0], SPEAK.y, SPEAK.z], [SPEAK.xs[1], SPEAK.y, SPEAK.z], [SPEAK.xs[1], SPEAK.y, SPEAK.top]];
const speakRoute = G.fillet(speakControl, 6, 14, { P, tube: SPEAK.r });
const speakArcAt = (x) => {
  const pts = G.resample(speakRoute, 0.25);
  let s = 0;
  let best = 0;
  let bd = Infinity;
  pts.forEach((p, i) => {
    if (i) s += G.len3(G.sub3(p, pts[i - 1]));
    const d = Math.abs(p[0] - x) + Math.abs(p[2] - SPEAK.z) * 4;
    if (d < bd) {
      bd = d;
      best = s;
    }
  });
  return best;
};
const SPEAK_FEET = [-62, -12];
const SPEAK_BRACKET_Z = 36;
const speakTotal = G.pathLength(speakRoute);
pipe("speak", speakControl, SPEAK.r, {
  tone: "mid",
  bend: 6,
  flangeR: 2.4,
  collars: [...SPEAK_FEET.map((x) => ({ at: speakArcAt(x), w: 2 })), { at: SPEAK.top - SPEAK_BRACKET_Z, w: 2 }, { at: speakTotal - (SPEAK.top - SPEAK_BRACKET_Z), w: 2 }],
});
for (const x of SPEAK_FEET) {
  const F = G.frameAlong([x, SPEAK.y, SPEAK.z], [1, 0, 0]);
  ringAt(`speak.clip${x}`, F, -1, 1, SPEAK.r, 2.6, { tone: "mid" }, { owner: "speak" });
  box(`speak.foot${x}`, [x - 1.4, SPEAK.y - 2, 0], [x + 1.4, SPEAK.y + 2, SPEAK.z - 2.5], { tone: "lo" });
}
SPEAK.xs.forEach((x, i) => {
  const MF = vert(x, SPEAK.y, SPEAK.top);
  const bell = (s) => 2.6 + 2.6 * (s / 8.6) ** 2;
  const bellSlope = (s) => (5.2 * s) / 8.6 ** 2;
  const profile = [...Array.from({ length: 13 }, (_, j) => {
    const s = (8.6 * j) / 12;
    return [s, bell(s), j && j < 12 ? 1 : 0];
  }), [9.6, bell(8.6)]];
  const top = SPEAK.top + 9.6;
  turned(`speak.mouth${i}`, MF, profile, { tone: "hi" }, { smooth: { slope: (s) => (s > 8.6 ? 0 : bellSlope(s)), rows: 3 }, extra: `<path class="f1-void" d="${G.circleOf(MF, 9.6, bell(8.6) - 0.7, P, 40)}"/>` });
  const F = vert(x, SPEAK.y, SPEAK_BRACKET_Z);
  ringAt(`speak.collar${i}`, F, -1, 1, SPEAK.r, 2.6, { tone: "mid" }, { owner: "speak" });
  box(`speak.bracket${i}`, [x - 1, FRONT, SPEAK_BRACKET_Z - 1], [x + 1, SPEAK.y - 2.45, SPEAK_BRACKET_Z + 1], { tone: "lo" });
});

// The SQL line from the server's deck to the top of the cabinet.
disc("sql.boss.server", vert(SQL.x0, SQL.y), DZ, DZ + 2, 3.4, { tone: "mid" });
disc("sql.boss.cab", vert(SQL.x1, SQL.y), CAB.z1 + 2, CAB.z1 + 3.6, 3.4, { tone: "mid" });
pipe("sql", [[SQL.x0, SQL.y, DZ + 2], [SQL.x0, SQL.y, SQL.z], [SQL.x1, SQL.y, SQL.z], [SQL.x1, SQL.y, CAB.z1 + 3.6]], SQL.r, { tone: "mid", bend: 7, flangeR: 2.8 });

// The line selector knob on the base.
{
  const [x, y] = KNOB.c;
  const marks = [-0.9, 0, 0.9].map((a) => k.lineOnTop([x + Math.sin(a) * (KNOB.r + 0.9), y - Math.cos(a) * (KNOB.r + 0.9)], [x + Math.sin(a) * KNOB.dial, y - Math.cos(a) * KNOB.dial], 0.8, P)).join("");
  disc("knob.dial", vert(x, y), 0, 0.8, KNOB.dial, { tone: "lo" }, { extra: Ln(marks, { tone: "mid" }) });
  disc("knob", vert(x, y), 0.8, 0.8 + KNOB.h, KNOB.r, { tone: "mid" }, { extra: Ln(k.knurl(x, y, KNOB.r, 0.8, 0.8 + KNOB.h, 40, P), { tone: "lo" }), bias: 0.2 });
}

A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);

// Reserved slots for live parts, placed in the settled order.
const indexOf = (name) => R.items.findIndex((item) => item.name === name);
const slots = new Map();
const addSlot = (index, svg) => slots.set(index, (slots.get(index) ?? "") + svg);
const can = canisterSvg();
addSlot(indexOf("browser.receiver") - 1, `<g data-part="can-browser" class="f1-can">${can}</g>`);
addSlot(indexOf("server.receiver") - 1, `<g data-part="can-server" class="f1-can">${can}</g>`);
addSlot(Math.max(indexOf("cab.body"), indexOf("cab.drawer0"), indexOf("cab.drawer2")), `<g data-part="drawer">${PARTS.drawer(0, 0)}</g>`);
addSlot(indexOf("method.plate"), `<g data-part="lever-method">${PARTS.lever(LEVERS.method.base.map((v, i) => (i === 2 ? DZ + 1.2 : v)), -1)}</g>`);
addSlot(indexOf("fault.plate"), `<g data-part="lever-fault">${PARTS.lever(LEVERS.fault.base.map((v, i) => (i === 2 ? DZ + 1.2 : v)), -1)}</g>`);
addSlot(indexOf("browser.send.housing"), `<g data-part="send">${S(k.cylinder(SEND[0], SEND[1], 3.2, DZ + 1.6, BUTTON_TOP - DZ - 1.6, P, 32, 0.3), { tone: "hi" })}</g>`);
addSlot(indexOf("valve.actuator"), `<g data-part="handle">${PARTS.handle([VALVE_X, CY, VALVE_TOP], Math.PI / 2)}</g>`);
addSlot(indexOf("knob"), `<g data-part="pointer">${PARTS.pointer(KNOB.c, 0.8 + KNOB.h, 0, KNOB.r - 0.8)}</g>`);
const groups = R.items.map((item, index) => `<g class="it" data-name="${item.name}"${item.attrs ?? ""}>${item.svg}</g>${slots.get(index) ?? ""}`);

// The canister: shell, felt-banded caps, a status band, and a tag plate facing the viewer that carries
// the method and, through its window, the JSON payload.
function canisterSvg() {
  const cx = STATIONS.browser.cx;
  const F = vert(cx, CY, CAN.base);
  const shell = S(G.solidOf([[0, 3.6], [0.6, CAN.cap], [2.2, CAN.cap], [2.2, CAN.r], [CAN.h - 2.2, CAN.r], [CAN.h - 2.2, CAN.cap], [CAN.h - 0.6, CAN.cap], [CAN.h, 3.6]], F, P), { tone: "hi", lit: true, inner: Ln(G.arcOf(F, 1.4, CAN.cap, P) + G.arcOf(F, CAN.h - 1.4, CAN.cap, P), { tone: "faint" }) });
  const band = `<g class="f1-band">${S(G.disc(5.2, 6.6, CAN.r + 0.25, F, P), { tone: "hi" })}</g>`;
  const ty = CY + CAN.r + 0.15;
  const tag = { x: cx - 3.4, y: ty, w: 6.8, d: 0.5, r: 0.3 };
  const plate = S(k.slabOf(tag, CAN.base + 8, 9.4, P, 1, 0.2), { tone: "hi" });
  const m = planeMatrix([cx, ty + 0.52, CAN.base + 15], [1, 0, 0], [0, 0, -1]);
  const text = ["GET", "POST"].map((t) => `<g class="f1-method" data-for="${t}" transform="${m}"><text class="f1-tag" x="0" y="1.15" text-anchor="middle" font-size="3.2">${t}</text></g>`).join("");
  const win = [[cx - 2.6, ty + 0.52, CAN.base + 12.4], [cx + 2.6, ty + 0.52, CAN.base + 12.4], [cx + 2.6, ty + 0.52, CAN.base + 8.8], [cx - 2.6, ty + 0.52, CAN.base + 8.8]];
  const json = `<g class="f1-json">${Ln([4.2, 3, 3.6].map((w, i) => path3([[cx - 2, ty + 0.53, CAN.base + 11.6 - i * 1.05], [cx - 2 + w, ty + 0.53, CAN.base + 11.6 - i * 1.05]])).join(""), { tone: "hi", free: true })}</g>`;
  return shell + band + plate + `<path class="f1-window" d="${path3(win, true)}"/>` + json + text;
}

const svg = k.figureSvg({
  width: W,
  height: H,
  label:
    "A pneumatic tube system on a bench. On the left, the browser station packs a canister and sends it up through an overhead tube to the server station on the right, which can pull a drawer from a filing cabinet beside it through a thin SQL line. The canister comes back with a coloured status band. A thin speaking tube along the front stays open between the two stations for live messages.",
  body: [...back, `<g class="f1-rig">${groups.join("")}</g>`],
});

// Data for the page.
const DATA = {
  P,
  W,
  H,
  camera: glCamera(P),
  routes: ROUTES,
  stations: { browser: STATIONS.browser.cx, server: STATIONS.server.cx },
  rise: RECV.z0 - CAN.base + 0.6,
  lamp: { cy: CY, z: CAN.base + 5.9, r: CAN.r + 0.25, scale: KS, rise: RECV.z0 - CAN.base + 0.6 },
  levers: Object.fromEntries(Object.entries(LEVERS).map(([id, lv]) => [id, [lv.base[0], lv.base[1], DZ + 1.2]])),
  send: { at: SEND, top: BUTTON_TOP, z: DZ + 1.6 },
  valve: [VALVE_X, CY, VALVE_TOP],
  knob: { c: KNOB.c, z: 0.8 + KNOB.h, r: KNOB.r - 0.8 },
  drawer: DRAWER_D,
  lines: LINES,
  methods: METHODS,
  serverMs: SERVER_MS,
  queryMs: QUERY_MS,
  slow: SLOW,
};

const CSS = readFileSync(join(HERE, "fig1.css"), "utf8");
const strip = (file) => readFileSync(join(HERE, file), "utf8").replace(/^import .*$/gm, "").replace(/^export /gm, "");
const LIVE = strip("model.mjs") + strip("parts.mjs") + readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA));

const stage = `<div class="iso-stage f1-stage" tabindex="0" role="group" aria-label="Pneumatic tube system. Space or Enter sends a request. G or P picks GET or POST. F cycles the server fault: none, not found, server error. L cycles the line: New York to Ashburn, Los Angeles or London. C closes the connection so the next request opens a new one. Escape stops.">${svg}<canvas class="f1-gl" aria-hidden="true"></canvas><span class="f1-sr" role="status" aria-live="polite" data-status></span><div class="f1-tip" role="tooltip" hidden><strong></strong><span></span></div></div>`;
const body =
  `<style>${CSS}</style>` +
  k.plateHtml({
    fig: "Fig 1",
    title: "Frontend ↔ backend",
    readout: "ready · GET /api/notes/42",
    body: stage + `<div class="f1-steps"><button type="button" data-go="-1" aria-label="Previous step" disabled>←</button><button type="button" data-go="1" aria-label="Next step">→</button><span data-step-label>Step through</span></div>`,
  });

const page = k.pageHtml({ title: "Frontend and backend", theme: THEME, body, script: kitScript() + glScript() + LIVE, width: 700 });
const name = THEME === "light" ? "fig1-light.html" : "fig1.html";
writeFileSync(join(HERE, name), page);
console.log("wrote", name, `${(page.length / 1024).toFixed(0)} KB`, `${R.items.length} items`, `scale ${KS.toFixed(3)}`);

A.auditOrExit(R, P, { allow: [["valve.collar*", "valve"]] });

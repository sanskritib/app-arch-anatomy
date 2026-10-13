import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../kit/tube.mjs";
import * as A from "../kit/audit.mjs";
import { kitScript } from "../scripts/inline-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = process.argv.includes("--light") ? "light" : "dark";

const W = 640;
const H = 460;
const AZIMUTH = 40;

// The monitor from Figure 1, taken apart on a jig. Four layers ride two guide rods; at rest they stack
// into one monitor at the back of the bench, apart they stand 100 units from each other.
const Z0 = 16;
const PH = 60;
const TOP = Z0 + PH;
const XW = 100;
const SPREAD = 82;
const LAYERS = {
  glass: { y: [10.5, 13.5], name: "SCREEN", move: [0, SPREAD * 3, 0] },
  shell: { y: [7, 9.5], name: "APP SHELL", move: [0, SPREAD * 2, 0] },
  tray: { y: [1, 3], name: "COMPONENTS", move: [0, SPREAD, 0] },
  state: { y: [-12, 0], name: "STATE + DATA", move: [0, 0, 0] },
};
const STAGGER = ["glass", "shell", "tray", "state", "jig"];
const SPRING = { stagger: 0.07, stiffness: 46, damping: 12.4, substeps: 4 };
const ROD = { r: 1.8, z: 10, xs: [10, 90], y0: -18, y1: 13.5 + SPREAD * 3 + 8.5 };
const BENCH = { x: -26, y: -42, w: 156, d: ROD.y1 + 54, r: 8 };
const BENCH_H = 8;
const FOOT_H = 5;

const P = k.fitProjection([...k.boxCorners(BENCH, -BENCH_H - FOOT_H, 0), [0, -12, TOP + 8], [XW, -12, TOP + 8], [0, 13.5 + SPREAD * 3, TOP + 8]], W, H, { pad: 18, azimuth: AZIMUTH });
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
const f2 = (v) => Math.round(v * 100) / 100;
function planeMatrix(o, ex, ey) {
  const p0 = at(o);
  const px = at(G.add3(o, ex));
  const py = at(G.add3(o, ey));
  const v = (x) => x.toFixed(4);
  return `matrix(${v(px[0] - p0[0])} ${v(px[1] - p0[1])} ${v(py[0] - p0[0])} ${v(py[1] - p0[1])} ${p0[0].toFixed(2)} ${p0[1].toFixed(2)})`;
}
// A group of markup laid in the vertical plane y (local x along world x, local y downward from z = top).
const face = (y, top = TOP) => planeMatrix([0, y + 0.02, top], [1, 0, 0], [0, 0, -1]);
const engrave = (o, text, size, anchor = "middle", tone = "hi") => k.faceTextSvg(planeMatrix(o, [1, 0, 0], [0, 0, -1]), text, { size, tone, anchor });

const R = A.recorder(P, { order: STAGGER, spring: SPRING });
const record = R.solid;
function put(piece, name, ref, svg, shapes = [], { bias = 0, attrs = "" } = {}) {
  return R.put({ piece, ride: piece, name, at: ref, bias, svg, shapes, move: LAYERS[piece]?.move ?? [0, 0, 0], attrs });
}
function box(piece, name, [x0, y0, z0], [x1, y1, z1], style = {}, { r = 0.5, steps = 2, bevel = 0, extra = "", inner = "", bias = 0, attrs = "" } = {}) {
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r };
  const shape = record(A.slab(plan, z0, z1 - z0, { name }, steps));
  put(piece, name, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
  return shape;
}
function disc(piece, name, F, s0, s1, r, style = {}, { extra = "", bias = 0, attrs = "", owner } = {}) {
  const shape = record(A.disc(F, s0, s1, r, { name, owner }));
  put(piece, name, G.add3(F.o, G.mul3(F.a, (s0 + s1) / 2)), S(G.disc(s0, s1, r, F, P), { tone: "mid", ...style }) + extra, [shape], { bias, attrs });
  return shape;
}
const ROUTES = {};
function tube(piece, name, control, r, { tone = "mid", bend = 4, maxLength = 8, touch = [], limp = false, ends = true } = {}) {
  const route = control.length > 2 ? G.fillet(control, Math.max(bend, r * 2.6), 10, { P, tube: r }) : control;
  R.route(name, route, r, { touch, limp, piece });
  tubePieces(route, r, P, { maxLength, spacing: 0.9 }).forEach((p, i) => put(piece, `${name}:${i}`, p.mid, tubeSvg(p, { tone }), [A.tube(p.points, p.radii)], { attrs: ` data-route="${name}" data-s="${f2((p.from + p.to) / 2)}"` }));
  if (ends) {
    const size = Math.max(0.5, r * KS * 0.9);
    for (const end of [route[0], route[route.length - 1]]) put(piece, `${name}.end`, end, Dots([at(end)], { size, tone: "hi" }), [A.ball(end, size / KS, { name: `${name}.end`, owner: name })], { bias: 0.15 });
  }
  ROUTES[name] = { total: f2(G.pathLength(route)) };
  return route;
}

// ——— the bench and the jig ————————————————————————————————————————————————————————
const back = [];
back.push(`<path class="iso-halo" d="${k.haloOf(BENCH, -BENCH_H - FOOT_H, BENCH_H, P)}"/>`);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
for (const [x, y] of byDepth(k.corners(BENCH, 22))) {
  back.push(S(k.cylinder(x, y, 7, -BENCH_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
  back.push(S(k.cylinder(x, y, 5.4, -BENCH_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
}
back.push(S(k.slabOf(BENCH, -BENCH_H, BENCH_H, P, 8, 1.6), { tone: "mid", inner: Ln(k.sideSeam(BENCH, -3, P, 8), { tone: "faint" }) }));
back.push(Ln(k.planOutline(k.insetPlan(BENCH, 5), 0, P), { tone: "lo" }));
const benchScrews = k.corners(BENCH, 10);
back.push(Ln(benchScrews.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
back.push(Dots(benchScrews.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
record(A.slab(BENCH, -BENCH_H, BENCH_H, { name: "stand.plate", ground: true }, 8));
// A ruler along the rods, with a stop mark where each layer parks.
{
  const strip = { x: 34, y: ROD.y0, w: 6, d: ROD.y1 - ROD.y0, r: 1 };
  back.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const t = k.topTicks(strip.y + 4, strip.y + strip.d - 4, 5, 5, strip.x, 0.6, [1.6, 3.2], P, "y");
  back.push(Ln(t.minor, { tone: "lo" }), Ln(t.major, { tone: "mid" }));
}

for (const [x, y] of [[ROD.xs[0], ROD.y0 - 6], [ROD.xs[1], ROD.y0 - 6], [ROD.xs[0], ROD.y1], [ROD.xs[1], ROD.y1]]) {
  box("jig", `stand.post${x}.${y}`, [x - 6, y, 0], [x + 6, y + 6, ROD.z + 5], { tone: "mid" }, { r: 1, steps: 3, bevel: 0.4, extra: Dots([at([x - 4, y + 6, ROD.z + 2.6]), at([x + 4, y + 6, ROD.z + 2.6])], { size: 0.42 }) });
}
for (const x of ROD.xs) tube("jig", `rod${x}`, [[x, ROD.y0, ROD.z], [x, ROD.y1, ROD.z]], ROD.r, { tone: "hi", maxLength: 8, touch: ["saddle"], ends: false });

// Each layer rides the rods on two saddles and carries a name tab on its top edge.
function saddles(piece) {
  const [y0, y1] = LAYERS[piece].y;
  const bottom = piece === "glass" ? Z0 - 3 : Z0;
  for (const x of ROD.xs) box(piece, `saddle.${piece}.${x}`, [x - 4, Math.max(y0, y0), ROD.z + ROD.r], [x + 4, y1, bottom], { tone: "lo" }, { r: 0.6 });
}
function tab(piece, top = TOP) {
  const [, y1] = LAYERS[piece].y;
  box(piece, `${piece}.tab`, [0, y1 - 1.5, top], [38, y1, top + 7], { tone: "lo" }, { r: 0.5, extra: engrave([19, y1 + 0.02, top + 5], LAYERS[piece].name, 3.4) });
}

// ——— layer 4 (back): state + data ————————————————————————————————————————————————
saddles("state");
{
  const [y0, y1] = LAYERS.state.y;
  const plan = { x: 0, y: y0, w: XW, d: y1 - y0, r: 2 };
  const divider = path3([[50, y1, Z0], [50, y1, TOP]]);
  const extra = [
    Ln(divider, { tone: "faint" }),
    engrave([6, y1 + 0.02, TOP - 5], "selected", 2.8, "start", "mid"),
    `<path class="f2-window" d="${path3([[6, y1 + 0.02, TOP - 8], [44, y1 + 0.02, TOP - 8], [44, y1 + 0.02, TOP - 19], [6, y1 + 0.02, TOP - 19]], true)}"/>`,
    `<g transform="${face(y1, TOP - 8)}"><text class="f2-digits" data-part="reg-selected" x="9.5" y="8.6" font-size="7.4">—</text></g>`,
    engrave([18, y1 + 0.02, Z0 + 27], "loading", 2.8, "start", "mid"),
    engrave([56, y1 + 0.02, TOP - 5], "cache", 2.8, "start", "mid"),
    engrave([56, y1 + 0.02, Z0 + 4], "fetch", 2.8, "start", "mid"),
    Dots([[3, Z0 + 3], [XW - 3, Z0 + 3], [3, TOP - 3], [XW - 3, TOP - 3]].map(([x, z]) => at([x, y1, z])), { size: 0.45 }),
    `<g data-part="cache"></g>`,
  ].join("");
  box("state", "state.housing", [0, y0, Z0], [XW, y1, TOP], { tone: "mid" }, { r: 2, steps: 4, bevel: 0.6, inner: Ln(k.sideSeam(plan, Z0 + 30, P, 4), { tone: "faint" }), extra });
  tab("state");
  disc("state", "state.lamp", G.frameAlong([12, y1, Z0 + 28], [0, 1, 0]), 0, 1.4, 3, { tone: "hi" }, { attrs: ' data-part="lamp-loading"' });
  disc("state", "state.port", G.frameAlong([XW, -6, Z0 + 14], [1, 0, 0]), 0, 2, 3.2, { tone: "mid" });
  // Fetch valve: a hand wheel on the face that turns while a request is out.
  const VF = G.frameAlong([76, y1, Z0 + 15], [0, 1, 0]);
  disc("state", "state.valve", VF, 0, 0.5, 8, { tone: "mid" }, { extra: `<g transform="${planeMatrix([76, y1 + 0.52, Z0 + 15], [1, 0, 0], [0, 0, -1])}"><g data-part="wheel">${[0, 1, 2, 3, 4, 5].map((i) => `<path class="iso-line" data-tone="hi" d="M0 0L${f2(6.4 * Math.cos((i * Math.PI) / 3))} ${f2(6.4 * Math.sin((i * Math.PI) / 3))}"/>`).join("")}<circle class="f2-hub" r="1.4"/><circle class="f2-rim" r="6.4"/></g></g>` });
}
// The cable from the fetch port to the wall: this is Figure 1's tube.
box("jig", "plug", [104, -36, 0], [124, -30, 9], { tone: "mid" }, { r: 1, steps: 3, bevel: 0.4, extra: engrave([114, -29.98, 5.6], "TO SERVER", 2.5) + Dots([at([106, -30, 1.6]), at([122, -30, 1.6])], { size: 0.42 }) });
tube("jig", "cable", [[XW + 2, -6, Z0 + 14], [114, -6, Z0 + 14], [114, -6, 0.9], [114, -30, 0.9]], 0.9, { tone: "mid", bend: 4, maxLength: 10, touch: ["stand.plate", "plug"], limp: true });

// ——— layer 3: components on a board, set into the outlet the shell leaves open ————————————————
saddles("tray");
const CARDS = [[Z0 + 27, Z0 + 35], [Z0 + 17, Z0 + 25], [Z0 + 7, Z0 + 15]];
{
  const [y0, y1] = LAYERS.tray.y;
  const outlet = path3([[23, y1, Z0 + 3], [97, y1, Z0 + 3], [97, y1, TOP - 13], [23, y1, TOP - 13]], true);
  box("tray", "tray.board", [0, y0, Z0], [XW, y1, TOP], { tone: "mid" }, { r: 0.8, steps: 3, bevel: 0.4, extra: Ln(outlet, { tone: "lo" }) + engrave([95, y1 + 0.02, TOP - 9.5], "outlet", 2.4, "end", "lo") + Dots([[3, Z0 + 3], [XW - 3, Z0 + 3], [3, TOP - 3], [XW - 3, TOP - 3]].map(([x, z]) => at([x, y1, z])), { size: 0.42 }) });
  tab("tray");
  const yb = y1;
  const list = [
    engrave([25, yb + 0.02, Z0 + 42], "My notes", 3.6, "start"),
    S(k.slabOf({ x: 25, y: yb, w: 70, d: 1.4, r: 0.6 }, Z0 + 5, 32, P, 2, 0.3), { tone: "mid" }),
    ...CARDS.map(([z0, z1], i) => `<g class="f2-card" data-card="${42 + i}">${S(k.slabOf({ x: 28, y: yb + 1.4, w: 64, d: 1.6, r: 0.5 }, z0, z1 - z0, P, 2, 0.3), { tone: "hi" })}${Ln(path3([[31, yb + 3.02, z1 - 2.6], [31 + [24, 18, 28][i], yb + 3.02, z1 - 2.6]]) + path3([[31, yb + 3.02, z1 - 5.2], [31 + [40, 34, 30][i], yb + 3.02, z1 - 5.2]]), { tone: "lo", free: true })}</g>`),
    `<g class="f2-btn">${S(k.slabOf({ x: 80, y: yb, w: 15, d: 2, r: 0.6 }, Z0 + 39, 6, P, 2, 0.3), { tone: "hi" })}${engrave([87.5, yb + 2.02, Z0 + 40.9], "+ New", 2.6)}</g>`,
  ].join("");
  const note = [
    engrave([25, yb + 0.02, Z0 + 42], "Note 42", 3.6, "start"),
    S(k.slabOf({ x: 25, y: yb, w: 70, d: 1.4, r: 0.6 }, Z0 + 5, 32, P, 2, 0.3), { tone: "mid" }),
    S(k.slabOf({ x: 28, y: yb + 1.4, w: 64, d: 1.6, r: 0.5 }, Z0 + 28, 7, P, 2, 0.3), { tone: "hi" }),
    Ln([38, 52, 46, 30].map((w, i) => path3([[29, yb + 1.42, Z0 + 23 - i * 4.4], [29 + w, yb + 1.42, Z0 + 23 - i * 4.4]])).join(""), { tone: "lo", free: true }),
    engrave([30, yb + 3.02, Z0 + 30.2], "Groceries", 3, "start"),
    `<g class="f2-btn f2-back">${S(k.slabOf({ x: 25, y: yb, w: 17, d: 2, r: 0.6 }, Z0 + 39, 6, P, 2, 0.3), { tone: "hi" })}${engrave([33.5, yb + 2.02, Z0 + 40.9], "← Back", 2.6)}</g>`,
  ].join("");
  put("tray", "tray.components", [60, yb + 2, Z0 + 25], `<g data-part="views"><g class="f2-view" data-v="list">${list}</g><g class="f2-view" data-v="note" style="opacity:0">${note}</g></g>`, [record(A.slab({ x: 25, y: yb, w: 70, d: 3, r: 0.5 }, Z0 + 5, 40, { name: "tray.components" }, 2))], { bias: 0.4 });
}

// ——— layer 2: the app shell, a frame that stays put ———————————————————————————————————
saddles("shell");
{
  const [y0, y1] = LAYERS.shell.y;
  const nav = ["Home", "Notes", "Settings"];
  const navSvg = nav.map((t, i) => {
    const z = TOP - 16 - i * 7;
    return `<path class="f2-pill${t === "Notes" ? " f2-on" : ""}" d="${path3([[3, y1 + 0.02, z], [19, y1 + 0.02, z], [19, y1 + 0.02, z - 5], [3, y1 + 0.02, z - 5]], true)}"/>` + engrave([5, y1 + 0.03, z - 1.6], t, 2.6, "start");
  }).join("");
  box("shell", "shell.nav", [0, y0, Z0], [22, y1, TOP], { tone: "mid" }, { r: 0.6, steps: 3, bevel: 0.4, extra: navSvg + Dots([at([3, y1, Z0 + 3]), at([19, y1, Z0 + 3])], { size: 0.42 }) });
  box("shell", "shell.header", [22, y0, TOP - 10], [XW, y1, TOP], { tone: "mid" }, { r: 0.6, steps: 3, bevel: 0.4, extra: engrave([26, y1 + 0.02, TOP - 3.6], "Notes", 4.2, "start") + `<g transform="${face(y1, TOP - 5)}"><circle class="f2-avatar" cx="92" cy="0" r="2.6"/></g>` });
  box("shell", "shell.side", [XW - 3, y0, Z0], [XW, y1, TOP - 10], { tone: "mid" }, { r: 0.4 });
  box("shell", "shell.foot", [22, y0, Z0], [XW - 3, y1, Z0 + 3], { tone: "mid" }, { r: 0.4 });
  tab("shell");
}

// ——— layer 1 (front): the screen, where every layer behind it ends up as pixels ———————————————
saddles("glass");
{
  const [y0, y1] = LAYERS.glass.y;
  box("glass", "glass.bezel.left", [-3, y0, Z0 - 3], [2, y1, TOP], { tone: "mid" }, { r: 1, steps: 3 });
  box("glass", "glass.bezel.right", [XW - 2, y0, Z0 - 3], [XW + 3, y1, TOP], { tone: "mid" }, { r: 1, steps: 3 });
  box("glass", "glass.bezel.top", [2, y0, TOP - 3], [XW - 2, y1, TOP], { tone: "mid" }, { r: 0.4 });
  box("glass", "glass.bezel.bottom", [2, y0, Z0 - 3], [XW - 2, y1, Z0], { tone: "mid" }, { r: 0.4, extra: Dots([at([XW - 6, y1, Z0 - 1.5])], { size: 0.8, tone: "hi" }) });
  const yp = y0 + 1;
  put("glass", "glass.pane", [50, yp, Z0 + 28], S(k.slabOf({ x: 2, y: y0, w: XW - 4, d: 1, r: 0 }, Z0, PH - 3, P, 1), { tone: "lo", crease: "none" }) + screenSvg(yp), [record(A.slab({ x: 2, y: y0, w: XW - 4, d: 1, r: 0 }, Z0, PH - 3, { name: "glass.pane" }, 1))], { bias: 0.3 });
  tab("glass");
}

// The picture on the glass: every layer behind it, composited.
function screenSvg(y) {
  const t = (x, yy, size, text, cls = "f2-st") => `<text class="${cls}" x="${x}" y="${yy}" font-size="${size}">${text}</text>`;
  const rect = (x, yy, w, h, cls, rx = 0.8) => `<rect class="${cls}" x="${x}" y="${yy}" width="${w}" height="${h}" rx="${rx}"/>`;
  const Wd = XW - 4;
  const Hd = PH - 5;
  const chrome = rect(0, 0, Wd, 4.6, "f2-sbar", 0) + [2.4, 4.4, 6.4].map((x) => `<circle class="f2-sdot" cx="${x}" cy="2.3" r=".7"/>`).join("") + rect(10, 1, 36, 2.8, "f2-surl", 1.4) + t(11.6, 3.15, 2.2, "notes.app", "f2-smut");
  const header = rect(0, 4.6, Wd, 7, "f2-shead", 0) + t(22, 9.6, 4, "Notes", "f2-sh") + `<circle class="f2-avatar" cx="${Wd - 6}" cy="8.1" r="2.4"/>`;
  const nav = rect(0, 11.6, 20, Hd - 11.6, "f2-snav", 0) + ["Home", "Notes", "Settings"].map((n, i) => (n === "Notes" ? rect(2, 15 + i * 7 - 3.4, 16, 5, "f2-sact", 1) : "") + t(3.4, 15 + i * 7, 2.6, n)).join("");
  const list = t(23, 19, 3.6, "My notes", "f2-sh") + rect(80, 14.8, 13, 5, "f2-sbtn", 1) + t(81.6, 18.2, 2.4, "+ New") + [0, 1, 2].map((i) => `<g class="f2-scard" data-card="${42 + i}">${rect(23, 23 + i * 10.5, 70, 8.6, "f2-srow")}${rect(25.4, 25.4 + i * 10.5, [24, 18, 28][i], 1.2, "f2-sink")}${rect(25.4, 28.4 + i * 10.5, [40, 34, 30][i], 1, "f2-sink2")}</g>`).join("");
  const note = `<g class="f2-sback">${rect(23, 14.8, 16, 5, "f2-sbtn", 1)}${t(24.6, 18.2, 2.4, "← Back")}</g>` + t(23, 27, 4, "Groceries", "f2-sh") + [38, 52, 46, 30].map((w, i) => rect(23, 31 + i * 4.6, w, 1.2, "f2-sink")).join("");
  return `<g class="f2-screen" data-part="screen" data-view="list" transform="${planeMatrix([2, y + 0.02, TOP - 5], [1, 0, 0], [0, 0, -1])}"><clipPath id="f2-scr"><rect width="${Wd}" height="${Hd}"/></clipPath><rect class="f2-sbg" width="${Wd}" height="${Hd}"/><g clip-path="url(#f2-scr)">${chrome}${header}${nav}<g class="f2-sview" data-v="list">${list}</g><g class="f2-sview" data-v="note">${note}</g></g></g>`;
}

A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);
const V = G.viewOf(P);
const groups = R.items.map((item) => {
  const [mx, my, mz] = item.move;
  return `<g class="it" data-piece="${item.piece}" data-name="${item.name}" data-k="${item.key.toFixed(3)}" data-m="${mx},${my},${mz}" data-l="${(G.dot3(item.move, V)).toFixed(3)}"${item.attrs ?? ""}>${item.svg}</g>`;
});

const svg = k.figureSvg({
  width: W,
  height: H,
  label: "The monitor from Figure 1, taken apart on a jig with two guide rods. Front to back: the screen, the app shell (header and navigation), a board of components set into the shell's outlet, and the state and data layer with a selected-note register, a loading lamp, a cache drawer and a fetch valve whose cable runs to the server.",
  body: [...back, `<g class="f2-rig">${groups.join("")}</g>`],
});

const EX = at([1, 0, 0]).map((v, i) => v - at([0, 0, 0])[i]);
const EY = at([0, 1, 0]).map((v, i) => v - at([0, 0, 0])[i]);
const EZ = at([0, 0, 1]).map((v, i) => v - at([0, 0, 0])[i]);
const DATA = { P, EX, EY, EZ, stagger: STAGGER, spring: SPRING, routes: ROUTES, rod: ROD, layers: LAYERS, cache: { x0: 56, x1: 94, z0: Z0 + 32, z1: Z0 + 47, face: 0 } };

const CSS = readFileSync(join(HERE, "fig2.css"), "utf8");
const LIVE = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA));
const home = THEME === "light" ? "../fig1-pneumatic/fig1-light.html" : "../fig1-pneumatic/fig1.html";
const stage = `<div class="iso-stage f2-stage" tabindex="0" role="group" aria-label="The monitor taken apart. Space takes it apart or puts it together. Enter opens note 42; Escape goes back to the list. Click a note on the screen or on the components board to open it.">${svg}<span class="f2-sr" role="status" aria-live="polite" data-status></span><div class="f2-tip" role="tooltip" hidden><strong></strong><span></span></div></div>`;
const body =
  `<style>${CSS}</style>` +
  `<nav class="f2-crumbs"><a href="${home}">← The whole system (Fig 1)</a></nav>` +
  k.plateHtml({
    fig: "Fig 2",
    title: "Inside the screen",
    hint: "Click a note · Space apart/together",
    readout: "list · <NoteList>",
    keys: [
      { mark: "lit", label: "Screen: what you see, every layer behind it painted into pixels" },
      { mark: "raised", label: "App shell (layout component): header and navigation, built once and never swapped" },
      { mark: "flat", label: "Components (React): reusable pieces like NoteList, NoteCard and Button, set into the shell’s outlet. These swap when you change page" },
      { mark: "dashed", label: "State + data: what the app remembers (useState or a store), and the data layer that fetches from the server and keeps a cache" },
    ],
    caption: `A click travels backwards: the screen reports it to the component, the component updates state, and state asks the data layer for the note. If the note isn’t cached, the data layer sends a request down the cable to the server (that trip is <a href="${home}">Figure 1</a>, about 61 ms to Los Angeles). The answer comes forward: state changes, the components re-render, and the screen repaints. The shell never moves. Based on a common React + TypeScript stack; the layer names are general.`,
    body: stage,
  });

const page = k.pageHtml({ title: "Inside the screen", theme: THEME, body, script: kitScript() + LIVE, width: 720 });
const name = THEME === "light" ? "fig2-light.html" : "fig2.html";
writeFileSync(join(HERE, name), page);
console.log("wrote", name, `${(page.length / 1024).toFixed(0)} KB`, `${R.items.length} items`, `scale ${KS.toFixed(3)}`);

A.auditOrExit(R, P, {});

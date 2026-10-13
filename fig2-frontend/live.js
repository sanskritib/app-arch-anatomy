
const D = __DATA__;
const P = D.P;
const stage = document.querySelector(".f2-stage");
const svg = stage.querySelector("svg");
const rig = svg.querySelector(".f2-rig");
const $ = (sel) => svg.querySelector(sel);
const readout = document.querySelector("[data-readout]");
const status = document.querySelector("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const smooth = (a, b, x) => ease((x - a) / (b - a));

// ——— taking it apart: one spring per layer, staggered front to back ——————————————————————
const STAGGER = D.stagger;
const SPRING = D.spring;
const piece = Object.fromEntries(STAGGER.map((id) => [id, { x: 0, v: 0, target: 0, pending: null }]));
const nodes = [...rig.children].map((el) => ({ el, piece: el.dataset.piece, key: +el.dataset.k, lift: +el.dataset.l, m: el.dataset.m.split(",").map(Number), shown: "" }));
let order = nodes.map((_, i) => i);
let apart = false;
let clock = 0;
function setApart(on) {
  if (apart === on) return;
  apart = on;
  const goal = on ? 1 : 0;
  let index = 0;
  for (const id of on ? STAGGER : [...STAGGER].reverse()) {
    if (piece[id].target === goal) piece[id].pending = null;
    else piece[id].pending = { value: goal, at: clock + (still.matches ? 0 : index++ * SPRING.stagger) };
  }
  announce(on ? "taken apart into four layers" : "put back together");
  run();
}
function steer(state, dt, calm) {
  if (state.pending && clock >= state.pending.at) {
    state.target = state.pending.value;
    state.pending = null;
  }
  if (calm) {
    state.x = state.target;
    state.v = 0;
    return false;
  }
  for (let i = 0; i < SPRING.substeps; i++) {
    const h = dt / SPRING.substeps;
    state.v += ((state.target - state.x) * SPRING.stiffness - state.v * SPRING.damping) * h;
    state.x += state.v * h;
  }
  if (Math.abs(state.target - state.x) < 2e-4 && Math.abs(state.v) < 2e-4) {
    state.x = state.target;
    state.v = 0;
    return state.pending !== null;
  }
  return true;
}
function place() {
  for (const node of nodes) {
    const share = piece[node.piece].x;
    const tx = (D.EX[0] * node.m[0] + D.EY[0] * node.m[1] + D.EZ[0] * node.m[2]) * share;
    const ty = (D.EX[1] * node.m[0] + D.EY[1] * node.m[1] + D.EZ[1] * node.m[2]) * share;
    const text = share === 0 ? "" : `translate(${tx.toFixed(2)} ${ty.toFixed(2)})`;
    if (text !== node.shown) {
      node.shown = text;
      if (text) node.el.setAttribute("transform", text);
      else node.el.removeAttribute("transform");
    }
  }
  const next = nodes.map((_, i) => i).sort((a, b) => nodes[a].key + nodes[a].lift * piece[nodes[a].piece].x - (nodes[b].key + nodes[b].lift * piece[nodes[b].piece].x));
  if (next.some((index, at) => index !== order[at])) {
    const fragment = document.createDocumentFragment();
    for (const index of next) fragment.appendChild(nodes[index].el);
    rig.appendChild(fragment);
    order = next;
  }
}
// Where each layer's front face is now, along the rods.
const frontY = (id) => D.layers[id].y[1] + D.layers[id].move[1] * piece[id].x;

// ——— a click on a note, and what it sets off ———————————————————————————————————
const LEG = (57.9 / 2 / 1000) * 50;
const cache = new Set(["list"]);
const nav = { view: "list", run: null };
const el = {
  screen: $('[data-part="screen"]'),
  views: $('[data-part="views"]'),
  reg: $('[data-part="reg-selected"]'),
  lamp: svg.querySelector('[data-part="lamp-loading"]'),
  wheel: $('[data-part="wheel"]'),
  cache: $('[data-part="cache"]'),
};
const viewEls = Object.fromEntries([...el.views.querySelectorAll("[data-v]")].map((g) => [g.dataset.v, g]));
const chunks = {};
for (const g of rig.querySelectorAll(".it[data-route]")) (chunks[g.dataset.route] ??= []).push({ g, s: +g.dataset.s });

function plan(to) {
  const miss = !cache.has(to);
  const steps = [];
  let t = 0;
  const add = (kind, seconds) => {
    steps.push({ kind, t0: t, t1: t + seconds });
    t += seconds;
  };
  add("click", 0.45);
  add("event", 1.0);
  add("state", 0.45);
  if (miss) {
    add("out", LEG);
    add("server", 0.3);
    add("in", LEG);
    add("store", 0.6);
  } else add("hit", 0.6);
  add("ready", 0.8);
  add("render", 0.7);
  add("paint", 0.6);
  add("done", 0.3);
  return { steps, total: t, to, miss };
}
function go(to) {
  if (nav.run || nav.view === to) return;
  nav.run = { ...plan(to), t: 0 };
  announce(to === "note" ? "opening note 42" : "going back to the list");
  run();
}
const stepAt = (p, t) => p.steps.find((s) => t < s.t1) ?? p.steps[p.steps.length - 1];
const uOf = (s, t) => clamp((t - s.t0) / (s.t1 - s.t0), 0, 1);

const GLOW = {};
function glow(route, s, kind, strength = 1) {
  GLOW[route] = { s, kind, strength };
}
const rodS = (y) => y - D.rod.y0;
function drawNav(dt, calm) {
  const r = nav.run;
  for (const key of Object.keys(GLOW)) delete GLOW[key];
  if (!r) return false;
  r.t += calm ? r.total : dt;
  const step = stepAt(r, r.t);
  const u = uOf(step, r.t);
  const to = r.to;
  const open = to === "note";
  const env = smooth(0, 0.15, u) * smooth(0, 0.15, 1 - u);
  const gy = frontY("glass");
  const ty = frontY("tray");
  let word = "";
  let drawer = 0;
  let card = 0;
  let spin = 0;
  let swap = 0;
  switch (step.kind) {
    case "click":
      word = open ? "click · <NoteCard id={42}>" : "click · <BackButton>";
      break;
    case "event":
      glow("rod90", rodS(gy + (0 - gy) * u), "req", env);
      word = open ? "event · onClick → setSelected(42)" : "event · onClick → setSelected(null)";
      break;
    case "state":
      word = open ? "state · selected = 42" : "state · selected = none";
      break;
    case "out":
      glow("cable", u * D.routes.cable.total, "req", env);
      spin = u;
      word = "data · not cached · GET /api/notes/42";
      break;
    case "server":
      spin = 1;
      word = "server · see Fig 1";
      break;
    case "in":
      glow("cable", (1 - u) * D.routes.cable.total, "ok", env);
      spin = 1 + u;
      word = `data · 200 OK · ${(57.9 + 2.8).toFixed(1)} ms`;
      break;
    case "store":
      drawer = Math.sin(u * Math.PI);
      card = u;
      word = "cache · keeps note 42";
      break;
    case "hit":
      drawer = Math.sin(u * Math.PI);
      word = `cache · ${open ? "note 42" : "list"} already here · no request`;
      break;
    case "ready":
      glow("rod90", rodS(0 + (ty - 0) * u), "ok", env);
      word = open ? "state · note 42 ready" : "state · list ready";
      break;
    case "render":
      swap = ease(u);
      word = open ? "render · <NoteView> replaces <NoteList>" : "render · <NoteList> replaces <NoteView>";
      break;
    case "paint":
      swap = 1;
      glow("rod90", rodS(ty + (gy - ty) * u), "ok", env);
      word = "paint · screen updated · shell unchanged";
      break;
    case "done":
      swap = 1;
      word = open ? "note · <NoteView>" : "list · <NoteList>";
      break;
  }
  const idx = r.steps.indexOf(step);
  const after = (kind) => idx > r.steps.findIndex((s) => s.kind === kind);
  el.reg.textContent = (open ? after("event") : !after("event")) ? "42" : "—";
  el.lamp.toggleAttribute("data-on", step.kind === "out" || step.kind === "server" || step.kind === "in");
  el.wheel.setAttribute("transform", `rotate(${(spin * 180).toFixed(1)})`);
  drawCache(apart ? drawer : 0, card);
  // The components swap: the old view lifts out toward the screen and fades, the new one settles in.
  const from = open ? "list" : "note";
  const into = open ? "note" : "list";
  setView(viewEls[from], 1 - swap, swap);
  setView(viewEls[into], swap, 1 - swap);
  // The screen repaints once the paint step reaches it.
  const shown = after("paint") || (step.kind === "paint" && u > 0.85) ? into : from;
  if (el.screen.getAttribute("data-view") !== shown) el.screen.setAttribute("data-view", shown);
  el.screen.toggleAttribute("data-press", step.kind === "click");
  stage.setAttribute("data-step", step.kind);
  say(word);
  if (r.t >= r.total) {
    if (r.miss) cache.add(to);
    nav.view = to;
    nav.run = null;
    announce(open ? "note 42 is showing" : "the list is showing");
  }
  return true;
}
function setView(g, alpha, out) {
  g.style.opacity = alpha.toFixed(3);
  const d = 7 * out;
  g.setAttribute("transform", d ? translateAlong(P, [0, d, 0]) : "");
  g.style.pointerEvents = alpha > 0.5 ? "" : "none";
}
// The cache drawer, rebuilt as it slides out; its cards are the cached answers.
function drawCache(open, card) {
  const c = D.cache;
  const o = open * 10;
  const key = `${o.toFixed(2)} ${card.toFixed(2)} ${cache.size}`;
  if (el.cache.dataset.key === key) return;
  el.cache.dataset.key = key;
  const out = [];
  if (o > 0.4) {
    out.push(solidSvg(slabOf({ x: c.x0 + 1.5, y: 0, w: c.x1 - c.x0 - 3, d: o, r: 0 }, c.z0 + 1, 0.8, P, 1), { tone: "lo", crease: "none" }));
    out.push(solidSvg(slabOf({ x: c.x0 + 1.5, y: 0, w: 0.8, d: o, r: 0 }, c.z0 + 1.8, 7, P, 1), { tone: "mid", crease: "none" }));
    const n = cache.size + (card > 0 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const lift = i === n - 1 && card > 0 ? (1 - card) * 8 : 0;
      const x = c.x0 + 5 + i * 7;
      out.push(solidSvg(slabOf({ x, y: Math.max(0.5, o - 7), w: 5.4, d: 0.6, r: 0 }, c.z0 + 1.8 + lift, 8, P, 1), { tone: "hi" }));
    }
    out.push(solidSvg(slabOf({ x: c.x1 - 2.3, y: 0, w: 0.8, d: o, r: 0 }, c.z0 + 1.8, 7, P, 1), { tone: "mid", crease: "none" }));
  }
  out.push(solidSvg(slabOf({ x: c.x0, y: -1.5 + o, w: c.x1 - c.x0, d: 1.5, r: 0.5 }, c.z0, c.z1 - c.z0, P, 2, 0.3), { tone: "mid" }));
  out.push(solidSvg(slabOf({ x: (c.x0 + c.x1) / 2 - 5, y: o, w: 10, d: 1.2, r: 0.5 }, c.z0 + 3, 2, P, 2), { tone: "hi" }));
  el.cache.innerHTML = out.join("");
}

// The signal on the rods and the cable: each chunk takes the colour by how close the message is.
const SIGMA = { rod10: 14, rod90: 14, cable: 8 };
const tabs = Object.fromEntries(Object.keys(D.layers).map((id) => [id, rig.querySelector(`.it[data-name="${id}.tab"]`)]));
function drawGlow() {
  // The layer the message is passing lights its name tab.
  const rg = GLOW.rod90;
  for (const [id, t] of Object.entries(tabs)) {
    const v = rg ? rg.strength * Math.exp(-(((rg.s - rodS(frontY(id))) / 10) ** 2)) : 0;
    if (v > 0.05) {
      t.setAttribute("data-hot", rg.kind);
      t.style.setProperty("--g", v.toFixed(3));
    } else if (t.hasAttribute("data-hot")) {
      t.removeAttribute("data-hot");
      t.style.removeProperty("--g");
    }
  }
  for (const [route, list] of Object.entries(chunks)) {
    const g = GLOW[route];
    for (const c of list) {
      const v = g ? g.strength * Math.exp(-(((c.s - g.s) / SIGMA[route]) ** 2)) : 0;
      if (v > 0.02) {
        c.g.style.setProperty("--g", v.toFixed(3));
        c.g.setAttribute("data-hot", g.kind);
      } else if (c.g.hasAttribute("data-hot")) {
        c.g.removeAttribute("data-hot");
        c.g.style.removeProperty("--g");
      }
    }
  }
}

// ——— words ————————————————————————————————————————————————————————————————————
function say(text) {
  if (readout.textContent !== text) readout.textContent = text;
}
let announceTimer = 0;
function announce(text) {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => (status.textContent = text), 120);
}

// ——— labels on hover or tap ———————————————————————————————————————————————————
const INFO = [
  [/^(f2-scard|f2-card)/, "NoteCard · a component", "One reusable piece, drawn once for each note. Click it to open the note."],
  [/^glass/, "Screen · the rendered page", "What you see: the browser paints every layer behind it into pixels."],
  [/^shell/, "App shell · layout component", "The frame that stays put: header and navigation. Built once, it doesn’t change when you move between pages."],
  [/^tray\.components/, "Components · React", "Reusable pieces (NoteList, NoteCard, Button) set into the shell’s outlet. This is the part that swaps when you change page."],
  [/^tray/, "Outlet", "The opening the shell leaves for the current page’s components."],
  [/^state\.lamp/, "Loading flag · state", "On while the app waits for the server, so the page can show a spinner."],
  [/^state\.valve|^state\.port/, "Data layer · fetch", "Asks the server for data through the cable, the tube from Fig 1."],
  [/^state/, "State + data · useState and a query cache", "What the app remembers right now (which note is selected), and answers it has already fetched (the cache drawer)."],
  [/^(cable|plug)/, "To the server", "The tube from Fig 1. Click to go back to the whole system."],
  [/^(rod|saddle)/, "Guide rods", "Hold the layers in line. Here they also carry the signal: clicks travel backwards, data forwards."],
];
const tip = stage.querySelector(".f2-tip");
function infoAt(target) {
  const card = target.closest(".f2-card, .f2-scard");
  if (card) return INFO[0];
  const g = target.closest(".it[data-name]");
  if (!g) return null;
  return INFO.find(([re]) => re.test(g.dataset.name)) ?? null;
}
function showTip(event) {
  const info = infoAt(event.target);
  if (!info) {
    tip.hidden = true;
    return;
  }
  tip.querySelector("strong").textContent = info[1];
  tip.querySelector("span").textContent = info[2];
  tip.hidden = false;
  const box = stage.getBoundingClientRect();
  const x = event.clientX - box.left;
  const y = event.clientY - box.top;
  tip.style.left = `${clamp(x - tip.offsetWidth / 2, 4, box.width - tip.offsetWidth - 4)}px`;
  tip.style.top = `${y - tip.offsetHeight - 14 < 4 ? y + 18 : y - tip.offsetHeight - 14}px`;
}
stage.addEventListener("pointermove", (event) => event.pointerType === "mouse" && showTip(event));
stage.addEventListener("pointerleave", () => (tip.hidden = true));

// ——— input ————————————————————————————————————————————————————————————————————
const HOME = document.querySelector(".f2-crumbs a").getAttribute("href");
svg.addEventListener("click", (event) => {
  takeOver();
  if (event.target.closest(".f2-card, .f2-scard")) go("note");
  else if (event.target.closest(".f2-back, .f2-sback")) go("list");
  else if (event.target.closest('.it[data-name^="cable"], .it[data-name="plug"]')) location.href = HOME;
  else if (event.pointerType !== "mouse") showTip(event);
});
stage.addEventListener("keydown", (event) => {
  const key = event.key;
  let handled = true;
  if (key === " ") setApart(!apart);
  else if (key === "Enter") go(nav.view === "list" ? "note" : "list");
  else if (key === "Escape" || key === "Backspace") go("list");
  else if (key === "r" || key === "R") {
    cache.clear();
    cache.add(nav.view);
    announce("cache cleared");
  } else handled = false;
  if (!handled) return;
  event.preventDefault();
  takeOver();
  run();
});

// ——— the idle tour: take it apart, open a note, go back, open it again from the cache ——————————
const TOUR = [() => go("note"), () => go("list"), () => go("note"), () => go("list")];
let touring = !still.matches;
let tourWait = 1.2;
let tourIndex = 0;
let idleTimer = 0;
function tourTick(dt) {
  if (!touring || nav.run) return;
  tourWait -= dt;
  if (tourWait <= 0) {
    TOUR[tourIndex++ % TOUR.length]();
    tourWait = 2.4;
  }
}
function takeOver() {
  touring = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    touring = !still.matches;
    tourWait = 1.4;
    run();
  }, 3600);
}

let frame = 0;
let last = 0;
let visible = false;
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  const calm = still.matches;
  let moving = false;
  for (const id of STAGGER) moving = steer(piece[id], dt, calm) || moving;
  place();
  tourTick(dt);
  const busy = drawNav(dt, calm);
  drawGlow();
  if (!nav.run) say(nav.view === "note" ? "note · <NoteView>" : "list · <NoteList>");
  frame = visible && (moving || busy || (touring && !calm)) ? requestAnimationFrame(tick) : 0;
}
function run() {
  if (!frame && visible) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
}
new IntersectionObserver((entries) => {
  visible = entries[entries.length - 1].isIntersecting;
  if (visible) run();
}, { rootMargin: "120px 0px" }).observe(stage);
drawCache(0, 0);
setView(viewEls.list, 1, 0);
setView(viewEls.note, 0, 0);
place();
// Arriving from Figure 1, the monitor comes apart.
setTimeout(() => setApart(true), still.matches ? 0 : 700);
// For tools: read-only view of the figure's state.
window.__f2 = { get touring() { return touring; }, get view() { return nav.view; }, get running() { return !!nav.run; } };

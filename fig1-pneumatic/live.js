
const D = __DATA__;
const P = D.P;
const K = { iso, pathOf, solidSvg, lineSvg, dotsSvg, slabOf, lineOnTop };
const PT = makeParts(K, P, { drawer: D.drawer });
const stage = document.querySelector(".f1-stage");
const svg = stage.querySelector("svg");
const $ = (sel) => svg.querySelector(sel);
const readout = document.querySelector("[data-readout]");
const status = document.querySelector("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const LIGHT = (stage.closest("[data-theme]")?.getAttribute("data-theme") ?? "dark") === "light" ? 1 : 0;

const el = {
  canB: $('[data-part="can-browser"]'),
  canS: $('[data-part="can-server"]'),
  drawer: $('[data-part="drawer"]'),
  method: $('[data-part="lever-method"]'),
  fault: $('[data-part="lever-fault"]'),
  send: $('[data-part="send"]'),
  handle: $('[data-part="handle"]'),
  pointer: $('[data-part="pointer"]'),
  screen: $('[data-part="screen"]'),
  spinner: $('[data-part="spinner"]'),
  lamps: Object.fromEntries(["ok", "warn", "fail"].map((kind) => [kind, svg.querySelector(`.it[data-lamp="${kind}"]`)])),
};
const chunks = {};
for (const g of svg.querySelectorAll(".it[data-route]")) (chunks[g.dataset.route] ??= []).push({ g, s: +g.dataset.s });

const DX = D.stations.server - D.stations.browser;
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const follow = (x, target, dt, tau, calm) => (calm ? target : Math.abs(target - x) < 1e-4 ? target : x + (target - x) * (1 - Math.exp(-dt / tau)));
const statusKind = (code) => (code < 300 ? "ok" : code === 404 ? "warn" : "fail");
const fmt = (ms) => (ms < 10 ? ms.toFixed(1) : ms.toFixed(1));

const state = {
  method: "GET",
  fault: 0,
  line: 1,
  cold: true,
  run: null,
  shown: { method: -1, fault: -1, line: 0, valve: 0, press: 0 },
  last: null,
  ws: { open: false, t: 0, next: 0.8, glow: null, dir: 1, count: 0 },
};

// ——— the request ————————————————————————————————————————————————————————————————————
const RESULT_VIEW = (method, code) => (code === 500 ? "error" : code === 404 ? "missing" : method === "POST" ? "saved" : "note");
function newRun(cold = state.cold) {
  const line = LINES[state.line];
  const plan = timeline(state.method, FAULTS[state.fault], line, cold);
  return { plan, t: 0, method: state.method, fault: FAULTS[state.fault], line, cold, path: METHODS[state.method].path };
}
function send() {
  walkOff();
  if (state.run) return;
  state.run = newRun();
  state.last = null;
  state.shown.press = 1;
  announce(`sending ${state.method} ${METHODS[state.method].path}${state.cold ? " on a new connection" : ""}`);
  run();
}

function stepAt(plan, t) {
  for (const s of plan.steps) if (t < s.t1) return { step: s, u: clamp((t - s.t0) / (s.t1 - s.t0), 0, 1) };
  const s = plan.steps[plan.steps.length - 1];
  return { step: s, u: 1 };
}
const stepOf = (plan, kind) => plan.steps.find((s) => s.kind === kind);

// Real milliseconds elapsed by screen time t: legs carry half a round trip each, the server's own work
// is spread over its handling steps, the query over the drawer.
function realMs(r, t) {
  const leg = r.line.rtt / 2;
  const serverSteps = r.plan.steps.filter((s) => ["open", "think", "pack"].includes(s.kind));
  const serverShare = SERVER_MS / serverSteps.length;
  const querySteps = r.plan.steps.filter((s) => s.kind === "query" || s.kind === "rows");
  let ms = 0;
  for (const s of r.plan.steps) {
    const u = clamp((t - s.t0) / (s.t1 - s.t0), 0, 1);
    if (s.dir) ms += leg * u;
    else if (serverSteps.includes(s)) ms += serverShare * u;
    else if (querySteps.includes(s)) ms += (QUERY_MS / querySteps.length) * u;
  }
  return ms;
}

const GLOW = { main: null, speak: null, sql: null };
const LAMP = { x: 0, v: 0, target: 0, vis: 1, kind: "ok", at: null };
function glowOn(route, s, colour, strength) {
  GLOW[route] = { s, colour, strength };
}

// Draw the whole machine for run r at its time r.t. Nothing here depends on earlier frames.
function render(r, clock) {
  const { step, u } = stepAt(r.plan, r.t);
  const o = r.plan.outcome;
  const code = o.status;
  const kind = statusKind(code);
  const main = D.routes.main.total;
  const sql = D.routes.sql.total;
  const post = r.method === "POST";
  GLOW.main = null;
  GLOW.sql = null;
  let canAt = "browser";
  let rise = 0;
  let open = 0;
  let lift = 0;
  let word = "";
  const envelope = (x) => smooth(0, 0.12, x) * smooth(0, 0.12, 1 - x);
  switch (step.kind) {
    case "click":
      word = post ? "you click · + New" : "you click · Note 42";
      break;
    case "syn":
    case "synack":
    case "hello":
    case "helloback": {
      const s = step.dir > 0 ? u * main : (1 - u) * main;
      glowOn("main", s, "req", 0.7 * envelope(u));
      word = step.hand ? "opening · TLS 1.3 handshake" : "opening · TCP handshake";
      break;
    }
    case "lift":
      rise = ease(u);
      word = `sending · ${r.method} ${r.path}`;
      break;
    case "out":
      canAt = "tube";
      glowOn("main", u * main, "req", envelope(u));
      word = `request in the tube · ${fmt(realMs(r, r.t))} ms`;
      break;
    case "open":
      canAt = "server";
      rise = 1 - ease(u);
      word = "server · reads the JSON";
      break;
    case "query":
      canAt = "server";
      glowOn("sql", u * sql, "req", envelope(u));
      open = ease(clamp((u - 0.45) / 0.55, 0, 1));
      lift = post && o.row ? open : 0;
      word = `SQL · ${METHODS[r.method].sql}`;
      break;
    case "rows":
      canAt = "server";
      glowOn("sql", (1 - u) * sql, o.row ? "ok" : "warn", envelope(u));
      if (post) lift = o.row ? 1 - ease(clamp(u / 0.45, 0, 1)) : 0;
      else lift = o.row ? ease(clamp(u / 0.35, 0, 1)) * (1 - ease(clamp((u - 0.6) / 0.4, 0, 1))) : 0;
      open = 1 - ease(clamp((u - 0.55) / 0.45, 0, 1));
      word = post ? (o.row ? "SQL · 1 row saved" : "SQL · nothing saved") : o.row ? "SQL · 1 row" : "SQL · 0 rows";
      break;
    case "think":
      canAt = "server";
      word = "server · throws an error";
      break;
    case "pack":
      canAt = "server";
      rise = ease(clamp((u - 0.35) / 0.65, 0, 1));
      word = `server · JSON · ${code} ${REASON[code]}`;
      break;
    case "back":
      canAt = "tube";
      glowOn("main", (1 - u) * main, kind, envelope(u));
      word = `response in the tube · ${fmt(realMs(r, r.t))} ms`;
      break;
    case "drop":
      canAt = "browser";
      rise = 1 - ease(u);
      word = "browser · reads the JSON";
      break;
    case "done":
      canAt = "browser";
      word = `${r.method} ${r.path} · ${code} · ${fmt(r.plan.ms)} ms`;
      break;
  }
  const at = r.plan.steps.indexOf(step);
  // The canister's lamp: lit once the server has stamped the status, dimmed before the band enters a port.
  const stampedNow = at >= r.plan.steps.indexOf(stepOf(r.plan, "pack"));
  LAMP.target = stampedNow ? 1 : 0;
  LAMP.vis = canAt === "tube" ? 0 : 1 - smooth(0.1, 0.32, rise);
  LAMP.kind = kind;
  LAMP.at = [D.stations.browser + (canAt === "server" ? DX : 0), D.lamp.cy, D.lamp.z + rise * D.lamp.rise];
  const stamped = at >= r.plan.steps.indexOf(stepOf(r.plan, "pack"));
  for (const can of [el.canB, el.canS]) {
    can.setAttribute("data-method", r.method);
    if (stamped) can.setAttribute("data-status", kind);
    else can.removeAttribute("data-status");
    can.toggleAttribute("data-json", stamped || METHODS[r.method].body);
  }
  el.canB.toggleAttribute("data-hidden", canAt !== "browser");
  el.canS.toggleAttribute("data-hidden", canAt !== "server");
  const can = canAt === "server" ? el.canS : el.canB;
  can.setAttribute("transform", translateAlong(P, [canAt === "server" ? DX : 0, 0, rise * D.rise]));
  const drawerKey = `${open.toFixed(3)} ${lift.toFixed(3)}`;
  if (el.drawer.dataset.key !== drawerKey) {
    el.drawer.innerHTML = PT.drawer(open * 18, lift * 16);
    el.drawer.dataset.key = drawerKey;
  }
  for (const k of Object.keys(el.lamps)) el.lamps[k].toggleAttribute("data-on", k === kind && step.kind === "done");
  // The valve turns half open with each handshake.
  if (r.cold) {
    let v = 0;
    for (const s of r.plan.steps) if (s.kind === "synack" || s.kind === "helloback") v += 0.5 * ease(clamp((r.t - s.t0) / (s.t1 - s.t0), 0, 1));
    state.valve = v;
  } else state.valve = 1;
  // The monitor: the click, then waiting, then the page redrawn from the answer.
  const drop = stepOf(r.plan, "drop");
  const view = step.kind === "click" ? "list" : r.t < drop.t1 ? "loading" : RESULT_VIEW(r.method, code);
  setScreen(view, step.kind === "click" && u > 0.15 && u < 0.85 ? (post ? "new" : "row") : null, clock);
  say(word);
  return { step, word };
}

function setScreen(view, press, clock) {
  if (el.screen.getAttribute("data-view") !== view) el.screen.setAttribute("data-view", view);
  if (press) el.screen.setAttribute("data-press", press);
  else el.screen.removeAttribute("data-press");
  stage.toggleAttribute("data-click", !!press);
  if (view === "loading") el.spinner.setAttribute("transform", `rotate(${((clock * 300) % 360).toFixed(1)} 28 22.6)`);
}

function drawRun(dt, calm, clock) {
  const r = state.run;
  if (!r) return;
  r.t += calm ? r.plan.total : dt;
  render(r, clock);
  if (r.t >= r.plan.total) {
    state.cold = false;
    state.last = { code: r.plan.outcome.status, ms: r.plan.ms, method: r.method, path: r.path, view: RESULT_VIEW(r.method, r.plan.outcome.status) };
    announce(`${r.method} ${r.path} answered ${r.plan.outcome.status} ${REASON[r.plan.outcome.status]} in ${fmt(r.plan.ms)} milliseconds`);
    state.run = null;
    el.drawer.innerHTML = PT.drawer(0, 0);
    el.drawer.dataset.key = "";
  }
}

// ——— the speaking tube (WebSocket) ————————————————————————————————————————————————————
function drawSocket(dt, calm) {
  const w = state.ws;
  GLOW.speak = null;
  if (calm) return false;
  w.t += dt;
  const leg = (LINES[state.line].rtt / 2 / 1000) * SLOW;
  const total = D.routes.speak.total;
  if (!w.glow && w.t >= w.next) {
    // First the upgrade request and its 101 answer, then small frames both ways.
    w.dir = !w.open ? (w.count % 2 === 0 ? 1 : -1) : w.count % 3 === 2 ? 1 : -1;
    w.glow = { t: 0, dir: w.dir, colour: !w.open && w.dir < 0 ? "ok" : "req" };
  }
  if (w.glow) {
    w.glow.t += dt / Math.max(leg, 0.25);
    const u = w.glow.t;
    const s = w.glow.dir > 0 ? u * total : (1 - u) * total;
    glowOn("speak", s, w.glow.colour, smooth(0, 0.12, u) * smooth(0, 0.12, 1 - u) * 0.85);
    if (u >= 1) {
      w.glow = null;
      w.count += 1;
      if (!w.open && w.count >= 2) w.open = true;
      w.t = 0;
      w.next = w.open ? 2.6 + (w.count % 2) * 1.1 : 0.15;
    }
  }
  return true;
}

// ——— levers, knob, valve, button ————————————————————————————————————————————————
function drawControls(dt, calm) {
  const sh = state.shown;
  let moving = false;
  const mt = state.method === "GET" ? -1 : 1;
  const ft = state.fault - 1;
  const lt = state.line - 1;
  const vt = state.run ? state.valve : state.cold ? 0 : 1;
  const next = {
    method: follow(sh.method, mt, dt, 0.12, calm),
    fault: follow(sh.fault, ft, dt, 0.12, calm),
    line: follow(sh.line, lt, dt, 0.16, calm),
    valve: state.run ? vt : follow(sh.valve, vt, dt, 0.25, calm),
    press: follow(sh.press, 0, dt, 0.09, calm),
  };
  if (next.method !== sh.method) el.method.innerHTML = PT.lever(D.levers.method, next.method);
  if (next.fault !== sh.fault) el.fault.innerHTML = PT.lever(D.levers.fault, next.fault);
  if (next.line !== sh.line) el.pointer.innerHTML = PT.pointer(D.knob.c, D.knob.z, next.line * 0.9, D.knob.r);
  if (next.valve !== sh.valve) el.handle.innerHTML = PT.handle(D.valve, (1 - next.valve) * (Math.PI / 2));
  if (next.press !== sh.press) el.send.setAttribute("transform", translateAlong(P, [0, 0, -1.1 * next.press]));
  for (const key of Object.keys(next)) if (Math.abs(next[key] - (key === "valve" ? vt : key === "press" ? 0 : { method: mt, fault: ft, line: lt }[key])) > 1e-4) moving = true;
  Object.assign(sh, next);
  return moving;
}

// ——— glow: WebGL inside the tube, or the chunk it is in ——————————————————————————————————
const COLOURS = {
  req: LIGHT ? [0.18, 0.43, 0.87] : [0.42, 0.66, 1.0],
  ok: LIGHT ? [0.12, 0.62, 0.33] : [0.31, 0.86, 0.55],
  warn: LIGHT ? [0.79, 0.52, 0.0] : [1.0, 0.76, 0.24],
  fail: LIGHT ? [0.83, 0.23, 0.17] : [1.0, 0.42, 0.36],
};
const NPTS = 24;
const FRAGMENT = `
uniform vec4 uG[3];
uniform vec3 uCol[3];
uniform vec3 uPts[${NPTS * 3}];
uniform vec4 uGap[6];
uniform vec2 uEnd[3];
uniform vec4 uN;
uniform float uLight;
uniform vec4 uLamp;
uniform vec3 uLampCol;
vec4 inkFor(vec3 seen,float cover){vec3 absorbed=1.-seen;float a=max(max(absorbed.r,max(absorbed.g,absorbed.b)),cover);return vec4(vec3(a)-absorbed,a);}
vec4 over(vec4 top,vec4 under){return top+under*(1.-top.a);}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  float px=uView.x/uCanvas.x;
  vec4 ink=vec4(0.);
  for(int g=0;g<3;g++){
    vec4 G4=uG[g];
    if(G4.z<.002)continue;
    vec2 E=uEnd[g];float n=uN[g];vec4 g0=uGap[g*2];vec4 g1=uGap[g*2+1];
    float best=1e9;float sb=0.;
    for(int i=0;i<${NPTS - 1};i++){
      if(float(i)>=n-1.)break;
      vec3 a=uPts[g*${NPTS}+i];vec3 b=uPts[g*${NPTS}+i+1];
      vec2 ab=b.xy-a.xy;float t=clamp(dot(vb-a.xy,ab)/max(dot(ab,ab),1e-6),0.,1.);
      float d=length(vb-a.xy-ab*t);
      if(d<best){best=d;sb=mix(a.z,b.z,t);}
    }
    float rs=G4.w;
    float inside=1.-smoothstep(rs-.3-.6*px,rs-.3+.2*px,best);
    float cross=.55+.45*clamp(1.-pow(best/rs,2.),0.,1.);
    float along=exp(-pow((sb-G4.x)/G4.y,2.));
    float gap=(1.-window(sb,g0.x,g0.y,.5))*(1.-window(sb,g0.z,g0.w,.5))*(1.-window(sb,g1.x,g1.y,.5))*(1.-window(sb,g1.z,g1.w,.5));
    float e=G4.z*inside*cross*along*gap*window(sb,E.x,E.y,.6);
    if(e<.001)continue;
    vec3 c=g==0?uCol[0]:g==1?uCol[1]:uCol[2];
    vec4 layer;
    if(uLight>.5){
      vec3 seen=mix(vec3(1.),c,min(1.,1.1*e));
      layer=inkFor(seen,0.)*smoothstep(0.,.06,e);
    }else{
      vec3 col=1.-exp(-c*e*1.7);
      float a=max(col.r,max(col.g,col.b));
      layer=vec4(col,a);
    }
    ink=over(layer,ink);
  }
  if(uLamp.w>.002){
    vec2 q=vb-uLamp.xy;q.y/=uCam.z;
    float d=length(q)/uLamp.z;
    float ring=exp(-pow((d-1.)/.22,2.));
    float halo=exp(-d*d/mix(2.4,1.1,uLight));
    float e=uLamp.w*mix(.75*ring+.6*halo,.85*ring+.3*halo*(1.-smoothstep(1.,1.5,d)),uLight);
    vec4 layer;
    if(uLight>.5){vec3 seen=mix(vec3(1.),uLampCol,min(1.,e));layer=inkFor(seen,0.)*smoothstep(0.,.05,e);}
    else{vec3 col=1.-exp(-uLampCol*e*1.6);layer=vec4(col,max(col.r,max(col.g,col.b)));}
    ink=over(layer,ink);
  }
  float n=(hash12(gl_FragCoord.xy+fract(uTime*.61)*91.)+hash12(gl_FragCoord.yx*1.37+fract(uTime*.37)*57.)-1.)/255.;
  ink=max(ink+n*smoothstep(0.,1.5/255.,ink.a),0.);
  ink.rgb=min(ink.rgb,vec3(ink.a));
  gl_FragColor=ink;
}`;
const canvas = stage.querySelector(".f1-gl");
const layer = glLayer({ canvas, fragment: FRAGMENT, view: [D.W, D.H], camera: D.camera, uniforms: ["uG", "uCol", "uPts", "uGap", "uEnd", "uN", "uLamp", "uLampCol"], fixed: { uLight: LIGHT } });
if (layer) stage.setAttribute("data-gl", "");
const ROUTE_ORDER = ["main", "speak", "sql"];
const SIGMA = { main: 12, speak: 8, sql: 6 };
let glDrawn = false;
function drawGlow(clock) {
  const G4 = new Float32Array(12);
  const COL = new Float32Array(9);
  const PTS = new Float32Array(NPTS * 9);
  const GAP = new Float32Array(24).fill(-1000);
  const END = new Float32Array(6);
  const N = new Float32Array(4);
  let any = false;
  ROUTE_ORDER.forEach((name, g) => {
    const glow = GLOW[name];
    const route = D.routes[name];
    // SVG: the chunks under the glow take its colour (shown only without WebGL).
    for (const c of chunks[name] ?? []) {
      const hot = glow && glow.strength > 0.15 && Math.abs(c.s - glow.s) < 10;
      if (hot) c.g.setAttribute("data-hot", glow.colour);
      else c.g.removeAttribute("data-hot");
    }
    if (!glow || glow.strength < 0.002) return;
    any = true;
    const sigma = SIGMA[name];
    const near = route.pts.filter((p) => Math.abs(p[2] - glow.s) < sigma * 2.6);
    const step = Math.max(1, Math.ceil(near.length / NPTS));
    const pick = near.filter((_, i) => i % step === 0).slice(0, NPTS);
    pick.forEach((p, i) => PTS.set(p, (g * NPTS + i) * 3));
    N[g] = pick.length;
    G4.set([glow.s, sigma, glow.strength, route.r], g * 4);
    COL.set(COLOURS[glow.colour], g * 3);
    const gaps = route.gaps.filter(([a, b]) => b - a < route.total * 0.5 && a > 0.01 && b < route.total - 0.01).slice(0, 4);
    gaps.forEach(([a, b], i) => GAP.set([a, b], g * 8 + i * 2));
    const flange0 = route.gaps[0][1];
    const flange1 = route.gaps[1][0];
    END.set([flange0 + 0.6, flange1 - 0.6], g * 2);
  });
  const level = LAMP.x * LAMP.vis;
  const lamp = LAMP.at && level > 0.002 ? [...iso(LAMP.at, P), D.lamp.r * D.lamp.scale, level] : [0, 0, 1, 0];
  if (lamp[3] > 0) any = true;
  if (!layer) return any;
  if (any) {
    layer.draw({ uG: G4, uCol: COL, uPts: PTS, uGap: GAP, uEnd: END, uN: N, uLamp: lamp, uLampCol: COLOURS[LAMP.kind] }, still.matches ? 0.8 : clock);
    glDrawn = true;
  } else if (glDrawn) {
    layer.clear();
    glDrawn = false;
  }
  return any;
}

// ——— step through: arrows replay one part of a request at a time ————————————————————————
const STEPS = [
  { label: "You click", focus: "0", span: (p) => [0, stepOf(p, "click").t1], hold: 1.0 },
  { label: "Request travels", focus: "1", span: (p) => [stepOf(p, "lift").t0, stepOf(p, "out").t1], hold: 1.0 },
  { label: "Server reads it", focus: "2", span: (p) => [stepOf(p, "open").t0, stepOf(p, "open").t1], hold: 1.2 },
  { label: "Database answers", focus: "3", span: (p) => [(stepOf(p, "query") ?? stepOf(p, "think")).t0, (stepOf(p, "rows") ?? stepOf(p, "think")).t1], hold: 1.2 },
  { label: "Answer travels back", focus: "4", span: (p) => [stepOf(p, "pack").t0, stepOf(p, "back").t1], hold: 1.0 },
  { label: "Screen updates", focus: "5", span: (p) => [stepOf(p, "drop").t0, p.total], hold: 1.8 },
];
const stepsEl = document.querySelector(".f1-steps");
const walk = { on: false, at: 0, run: null, hold: 0 };
function walkTo(index) {
  walk.on = true;
  walk.at = clamp(index, 0, STEPS.length - 1);
  walk.run = newRun(false);
  walk.run.t = STEPS[walk.at].span(walk.run.plan)[0];
  walk.hold = 0;
  state.run = null;
  touring = false;
  clearTimeout(idleTimer);
  stage.setAttribute("data-focus", STEPS[walk.at].focus);
  stepsEl.querySelector("[data-step-label]").textContent = `${walk.at + 1}/${STEPS.length} · ${STEPS[walk.at].label}`;
  stepsEl.querySelector('[data-go="-1"]').disabled = walk.at === 0;
  stepsEl.querySelector('[data-go="1"]').disabled = walk.at === STEPS.length - 1;
  announce(`Step ${walk.at + 1} of ${STEPS.length}: ${STEPS[walk.at].label}`);
  run();
}
function walkOff() {
  if (!walk.on) return;
  walk.on = false;
  walk.run = null;
  stage.removeAttribute("data-focus");
  stepsEl.querySelector("[data-step-label]").textContent = "Step through";
  stepsEl.querySelector('[data-go="-1"]').disabled = true;
  stepsEl.querySelector('[data-go="1"]').disabled = false;
}
function walkTick(dt, calm, clock) {
  const r = walk.run;
  const [t0, end] = STEPS[walk.at].span(r.plan);
  const t1 = end - 1e-3;
  if (calm) r.t = t1;
  else if (r.t < t1) r.t = Math.min(t1, r.t + dt);
  else if ((walk.hold += dt) > STEPS[walk.at].hold) {
    r.t = t0;
    walk.hold = 0;
  }
  render(r, clock);
}
stepsEl.addEventListener("click", (event) => {
  const b = event.target.closest("button[data-go]");
  if (!b) return;
  walkTo(walk.on ? walk.at + +b.dataset.go : 0);
});

// ——— readout, status, tour, loop ——————————————————————————————————————————————————
function idleWord() {
  if (state.last) return `${state.last.method} ${state.last.path} · ${state.last.code} · ${fmt(state.last.ms)} ms`;
  return `ready · ${state.method} ${METHODS[state.method].path}`;
}
function say(text) {
  if (readout.textContent !== text) readout.textContent = text;
}
let announceTimer = 0;
function announce(text) {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    status.textContent = text;
  }, 120);
}
function describe() {
  const line = LINES[state.line];
  stage.setAttribute("aria-description", `${state.method} ${METHODS[state.method].path}, server fault: ${["none", "not found", "server error"][state.fault]}, line ${line.label} (${line.rtt} ms round trip), ${state.cold ? "new connection" : "connection kept alive"}.`);
}

const TOUR = [
  { method: "GET", fault: 0, line: 1, cold: true },
  { method: "POST", fault: 0, line: 1 },
  { method: "GET", fault: 1, line: 1 },
  { method: "GET", fault: 0, line: 0 },
  { method: "POST", fault: 2, line: 2 },
  { method: "GET", fault: 0, line: 2 },
];
let touring = !still.matches;
let tourIndex = 0;
let tourWait = 1.4;
let idleTimer = 0;
function tourTick(dt) {
  if (!touring || state.run) return;
  tourWait -= dt;
  if (tourWait > 0.9 && tourWait - dt <= 0.9) {
    const step = TOUR[tourIndex % TOUR.length];
    state.method = step.method;
    state.fault = step.fault;
    state.line = step.line;
    if (step.cold && tourIndex > 0) state.cold = true;
    describe();
  }
  if (tourWait <= 0) {
    const step = TOUR[tourIndex % TOUR.length];
    state.method = step.method;
    state.fault = step.fault;
    state.line = step.line;
    if (step.cold) state.cold = true;
    send();
    tourIndex += 1;
    tourWait = 2.2;
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
let clock = 0;
let visible = false;
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  const calm = still.matches;
  if (walk.on) walkTick(dt, calm, clock);
  else {
    tourTick(dt);
    drawRun(dt, calm, clock);
  }
  if (walk.on) GLOW.speak = null;
  const socket = walk.on ? false : drawSocket(dt, calm);
  const moving = drawControls(dt, calm);
  const lampMoving = settle(LAMP, LAMP.target, dt, 0.18, calm);
  drawGlow(clock);
  if (!state.run && !walk.on) say(idleWord());
  const busy = walk.on ? !calm : state.run || moving || lampMoving || (touring && !calm) || (socket && !calm);
  frame = visible && busy ? requestAnimationFrame(tick) : 0;
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

stage.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === "arrowright" || key === "arrowleft") {
    event.preventDefault();
    walkTo(walk.on ? walk.at + (key === "arrowright" ? 1 : -1) : 0);
    return;
  }
  if (walk.on && key !== "escape") walkOff();
  if (walk.on && key === "escape") {
    walkOff();
    event.preventDefault();
    return;
  }
  let handled = true;
  if (key === " " || key === "enter") send();
  else if (key === "g") state.method = "GET";
  else if (key === "p") state.method = "POST";
  else if (key === "f") state.fault = (state.fault + 1) % 3;
  else if (key === "l") state.line = (state.line + 1) % LINES.length;
  else if (key === "c") {
    if (!state.run) state.cold = true;
  } else if (key === "escape") {
    touring = false;
    clearTimeout(idleTimer);
  } else handled = false;
  if (!handled) return;
  event.preventDefault();
  if (key !== "escape") takeOver();
  describe();
  run();
});
// Pointer: each physical control is a target.
const hits = [
  ["send", () => send()],
  ["lever-method", () => (state.method = state.method === "GET" ? "POST" : "GET")],
  ["lever-fault", () => (state.fault = (state.fault + 1) % 3)],
  ["pointer", () => (state.line = (state.line + 1) % LINES.length)],
  ["handle", () => !state.run && (state.cold = true)],
];
for (const [part, act] of hits) {
  const g = $(`[data-part="${part}"]`);
  g.style.cursor = "pointer";
  g.addEventListener("click", (event) => {
    event.stopPropagation();
    act();
    takeOver();
    describe();
    run();
  });
}
for (const name of ["browser.send.housing", "method.plate", "fault.plate", "knob", "knob.dial", "valve.actuator", "browser.deck"]) {
  const g = svg.querySelector(`.it[data-name="${name}"]`);
  if (!g) continue;
  g.style.cursor = "pointer";
  g.addEventListener("click", () => {
    if (name === "browser.send.housing" || name === "browser.deck") send();
    if (name === "method.plate") state.method = state.method === "GET" ? "POST" : "GET";
    if (name === "fault.plate") state.fault = (state.fault + 1) % 3;
    if (name.startsWith("knob")) state.line = (state.line + 1) % LINES.length;
    if (name === "valve.actuator" && !state.run) state.cold = true;
    takeOver();
    describe();
    run();
  });
}

// ——— labels: point at (or tap) any part to see what it is and what it does ——————————————
const PARTS_INFO = [
  [/^can-/, "Canister · one message", "Its tag says GET (read) or POST (save); its window shows the data as JSON. It comes back with a coloured band: the status."],
  [/^(browser|can)\.receiver|\.receiver/, "Port", "Where the canister goes into the tube and comes out again: where a request is sent and an answer received."],
  [/^browser\.lamp/, "Status lamps", "Light up when the answer arrives: green means it worked, amber not found, red the server broke."],
  [/^(send|browser\.send)/, "Send button", "Sends the request. Press Space to do the same."],
  [/^(method|lever-method)/, "Method lever", "GET asks to read something; POST asks to save something."],
  [/^browser/, "Browser station", "Your browser: it turns your click into a request and turns the answer back into the page you see."],
  [/^(valve|handle)/, "Connection valve", "The first time the browser talks to a server it opens a connection in two steps (TCP, then TLS). After that it stays open."],
  [/^(main|post)/, "The internet", "The tube that carries requests and answers between your browser and the server. Farther away means a longer ride."],
  [/^(fault|lever-fault)/, "Outcome switch", "For trying things out: the request works (OK), the note is missing (404), or the server breaks (500)."],
  [/^server/, "Server station", "A computer in a data centre running the app’s code. It reads the request, asks the database and writes the answer."],
  [/^sql/, "Database line", "The server talks to the database through this line, in the database’s own language, SQL."],
  [/^(cab|drawer)/, "Database", "Where the app’s data is kept, like a filing cabinet. The server reads and saves notes here."],
  [/^speak/, "Speaking tube · WebSocket", "A line that stays open for live updates, like new chat messages, without sending a new request each time."],
  [/^(knob|pointer)/, "Distance knob", "How far away the server is: nearby, across the US or across the ocean. Farther means slower."],
  [/^(monitor|display)/, "Your screen · click to open it up", "What you see and click. Click it to take it apart and see the layers inside: app shell, components, state and data."],
];
const tip = stage.querySelector(".f1-tip");
function infoAt(target) {
  const g = target.closest("[data-part], .it[data-name]");
  if (!g || !svg.contains(g)) return null;
  const key = g.dataset.part ?? g.dataset.name;
  return PARTS_INFO.find(([re]) => re.test(key)) ?? null;
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
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  tip.style.left = `${clamp(x - w / 2, 4, box.width - w - 4)}px`;
  tip.style.top = `${y - h - 14 < 4 ? y + 18 : y - h - 14}px`;
}
stage.addEventListener("pointermove", (event) => event.pointerType === "mouse" && showTip(event));
stage.addEventListener("pointerdown", (event) => event.pointerType !== "mouse" && showTip(event));
stage.addEventListener("pointerleave", () => (tip.hidden = true));
// The monitor opens Figure 2: the same screen, taken apart into its layers.
const FIG2 = LIGHT ? "../fig2-frontend/fig2-light.html" : "../fig2-frontend/fig2.html";
for (const g of svg.querySelectorAll('.it[data-name^="monitor"]')) {
  g.style.cursor = "pointer";
  g.addEventListener("click", () => (location.href = FIG2));
}
stage.addEventListener("focus", () => {
  status.textContent = idleWord();
});
if (still.matches) touring = false;
for (const can of [el.canB, el.canS]) can.setAttribute("data-method", state.method);
el.canS.setAttribute("data-hidden", "");
el.canS.setAttribute("transform", translateAlong(P, [DX, 0, 0]));
describe();
drawControls(1, true);
drawGlow(0);
say(idleWord());

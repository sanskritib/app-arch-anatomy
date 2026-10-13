# Context: Explaining app architecture with the Anatomy skill

## Who I am and what I want

I'm a creative technologist (design + code). I want to *understand*, visually, how the pieces of a modern web app talk to each other. The goal is a set of interactive isometric figures, built with the **Anatomy** skill (`/anatomy`), that I can learn from and later use in my portfolio.

Skill: https://github.com/wheresryan22/anatomy
Install: `npx skills add wheresryan22/anatomy -g -a claude-code`

## Ground rules for every figure

- **Follow the skill's core idea: the object is the explanation.** Each concept becomes a real, well-made physical machine whose working *is* the concept. No boxes, arrows or floating labels.
- **No brand names, logos or product UI** of any real company. Figure 3 is a *generic* "conversational AI app builder", not any specific product. The internals of commercial builders aren't public, so model a plausible architecture based on common public stacks, and say so in the caption.
- **Truth first.** Collect real numbers (latencies, status codes, payload sizes, build/reload times, token streaming rates) from reliable sources before building. Don't invent figures; if a number is uncertain, use a clearly labelled representative value and note it.
- **Output:** standalone HTML page per figure (framework-free build script, as in `examples/dial-indicator`). Build both light and dark themes; I'll pick. Light is the primary theme.
- **WebGL only where it earns its place:** a soft glow travelling through tubes/wires (data in motion) or a lit preview window. Machines and parts stay SVG. The figure must still read without WebGL.
- **Run the skill's full verification loop** (audit, line check, 4× close-ups in both themes, motion contact sheets).

## The plan: three figures, in order

### Figure 1 — How frontend and backend communicate
**Size:** Figure (40–80 parts). Build this first; it's the foundation for the other two.

**Machine: a pneumatic tube system** (bank drive-through style).
- **Browser station:** packs a canister = an HTTP request. The canister carries a method tag (GET/POST), an address plate (the endpoint) and a JSON payload.
- **Tube:** the network. Travel time = real round-trip latency.
- **Server station:** opens the canister, the backend does the work, and when needed pulls a drawer from a filing cabinet (the database, queried with SQL).
- **Return canister:** a status lamp (200 green / 404 amber / 500 red) plus the JSON response.
- **Optional second line:** an always-open speaking tube beside it for WebSockets (live updates such as chat or collaborative editing), contrasted with one-shot canisters.

**The idea it must land: how different languages interact.** Each station speaks its own language inside: HTML/CSS/JS in the browser, TypeScript/Python/etc. on the server, SQL at the database. What crosses between them is always the same standard canister, **JSON over HTTP**. The languages never talk directly; they agree on the container.

**Interaction ideas:** pick GET vs POST; trigger a request; toggle "server error" or "not found"; a live readout of status code and round-trip ms.

### Figure 2 — How an app shell works
**Size:** Figure.

**Machine: a slide viewer / display cabinet.**
- **Fixed frame = the shell:** header, nav, sidebar. It's built once and kept in a store (a service worker cache), so it appears instantly on repeat visits.
- **Swappable cartridge = route content:** only the middle changes when you navigate, and its data arrives through the tube from Figure 1.
- Show the difference between first load (frame built + cartridge fetched) and repeat navigation (frame already there, only the cartridge swaps).

**Readout ideas:** first load vs repeat load time; bytes fetched per navigation.

### Figure 3 — How a conversational AI app builder works
**Size:** Hero (80–150 parts, about 2–4 hours). Do **not** expand it into an Epic. If it starts growing, keep the core loop and list what a full version would add.

**Machine: a print shop / press line.**
- **Order slip** = my chat prompt.
- **Typesetter** = the AI model/agent composing and editing code files, set as type from a **type case** (the project's file tree and component library).
- **Press** = the build step (bundler/dev server, e.g. Vite) that turns source files into a running app.
- **Proof window** = the live preview (a sandboxed iframe that hot-reloads on each change).
- **Warehouse behind the shop** = backend-as-a-service: database, auth, file storage, server functions.
- **Delivery dock** = publish/deploy to hosting/CDN (optional, only if it fits).

**The idea it must land: the conversational loop.** I read the proof, mark corrections on a new order slip, and the line runs again. If the press jams (a build error), a red lamp sends the error back to the typesetter, which fixes it and reruns. That self-correction loop is the heart of these tools.

**Common public stack to base it on (verify before building):** generated React + TypeScript frontend, Tailwind CSS, a Vite build, and a hosted Postgres-based backend with auth and storage; optional sync to GitHub.

**Readout ideas:** current stage (composing → building → preview); files changed; build status; iteration count.

## How to start in Claude Code

1. Read this file, then open the closest skill example (`examples/dial-indicator` for Figures 1–2).
2. Do the research for Figure 1's real numbers.
3. Before any geometry, give me: the size tier, a one-sentence statement of what moves and what that motion means, and the parts list.
4. Build Figure 1, verify it, and send me screenshots in both themes before moving on.

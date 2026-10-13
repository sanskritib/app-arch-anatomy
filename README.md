# App architecture, anatomically

Three interactive isometric figures, built with the [Anatomy](https://github.com/wheresryan22/anatomy) skill, that explain how a modern web app works:

1. **How the frontend and backend communicate** (a pneumatic tube system): [`fig1-pneumatic/`](fig1-pneumatic/)
2. **Inside the screen: how the front end is layered** (the monitor taken apart on a jig): [`fig2-frontend/`](fig2-frontend/)
3. How a conversational AI app builder works (a print shop)

See [anatomy-app-architecture-context.md](anatomy-app-architecture-context.md) for the brief.

## Figure 1

A browser station sends a canister (one HTTP request) up an overhead tube to a server station, which pulls a drawer from a filing cabinet (the database) through a thin SQL line, then sends the canister back with a coloured status band. A valve on the tube opens in two steps when a new HTTPS connection is set up (TCP, then TLS 1.3). A thin speaking tube along the front stays open for WebSocket messages.

Open `index.html` (or `fig1-pneumatic/fig1-light.html`, light; `fig1.html`, dark): this is the home page. Hover or tap any part for what it is. Click the computer screen at the front to open Figure 2. or `fig1-pneumatic/fig1.html` (dark) in a browser. Space sends a request; G and P pick the method; F cycles the server fault (none, 404, 500); L cycles the line (New York to Ashburn, Los Angeles or London); C closes the connection so the next request opens a new one. The physical controls can also be clicked.

The numbers live in [`fig1-pneumatic/model.mjs`](fig1-pneumatic/model.mjs). Round trips are measured ping averages; server and query times are representative and labelled as such in the caption.

## Figure 2

The monitor from Figure 1, taken apart on two guide rods into four layers: the screen (what you see), the app shell (header and navigation, which never changes), the components set into the shell's outlet (NoteList, NoteCard, Button: the part that swaps when you change page), and state + data (the selected note, a loading flag, a cache drawer and the fetch valve whose cable is Figure 1's tube).

Click a note on the screen or the components board: the click travels back along the rod, state changes, the data layer fetches (or answers from its cache the second time), and the new components come forward and repaint the screen. Space takes it apart or puts it together; Enter and Escape open and close the note; R clears the cache. The cable's plug links back to Figure 1.

### Build and verify

Needs Node 18+ and Google Chrome (for the screenshot and line checks).

```sh
node fig1-pneumatic/build.mjs --light --audit   # light page + geometry audit
node fig1-pneumatic/build.mjs --audit           # dark page + geometry audit
node fig2-frontend/build.mjs --light --audit
node fig2-frontend/build.mjs --audit
node scripts/lines.mjs fig1-pneumatic/fig1-light.html
node scripts/capture.mjs fig1-pneumatic/fig1-light.html --out shots/fig1.png
```

`kit/` and `scripts/` are vendored from the Anatomy skill (MIT, see `kit/LICENSE`) so the figures build without the skill installed.

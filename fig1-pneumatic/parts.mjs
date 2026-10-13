// Parts that are rebuilt while the figure runs: levers, the valve handle, the knob pointer and the
// database drawer. The build uses them through the kit module, the page through the inlined kit.
export function makeParts(k, P, D) {
  const at = (p) => k.iso(p, P);
  const S = (paths, style) => k.solidSvg(paths, style);
  const Ln = (d, style) => k.lineSvg(d, style);

  // A toggle lever standing on a pivot block: t runs from -1 to 1 and tips it along x.
  function lever(base, t, len = 9) {
    const a = t * 0.7;
    const tip = [base[0] + Math.sin(a) * len, base[1], base[2] + Math.cos(a) * len];
    return `<path class="iso-line f1-rod" data-tone="hi" d="${k.pathOf([at(base), at(tip)])}"/>` + k.dotsSvg([at(tip)], { size: 1.7, tone: "hi" });
  }

  // The valve handle on top of the actuator: angle 0 lies along the tube (open), π/2 across it (shut).
  function handle(top, angle, len = 7) {
    const tip = [top[0] + Math.cos(angle) * len, top[1] + Math.sin(angle) * len, top[2]];
    const tail = top;
    return `<path class="iso-line f1-rod" data-tone="hi" d="${k.pathOf([at(tail), at(tip)])}"/>` + k.dotsSvg([at(tip)], { size: 1.3, tone: "hi" }) + k.dotsSvg([at(top)], { size: 1.1, tone: "mid" });
  }

  // The knob's pointer on its top face.
  function pointer(c, z, angle, r) {
    const tip = [c[0] + Math.sin(angle) * r, c[1] - Math.cos(angle) * r];
    return Ln(k.lineOnTop([c[0], c[1]], tip, z, P), { tone: "hi", free: "end" });
  }

  // The database drawer, pulled out by `open` units toward the viewer, with the found card lifted by `lift`.
  const DR = D.drawer;
  function drawer(open, lift, { card = true } = {}) {
    const out = [];
    const y0 = DR.face;
    const yF = DR.face + open;
    if (open > 0.6) {
      out.push(S(k.slabOf({ x: DR.x0 + 2, y: y0, w: DR.x1 - DR.x0 - 4, d: open, r: 0 }, DR.z0 + 1, 1, P, 1), { tone: "lo", crease: "none" }));
      out.push(S(k.slabOf({ x: DR.x0 + 2, y: y0, w: 1, d: open, r: 0 }, DR.z0 + 2, DR.wall, P, 1), { tone: "mid", crease: "none" }));
      const rows = [];
      for (let y = yF - 3; y > y0 + 0.4; y -= 2.6) rows.push(k.lineOnTop([DR.x0 + 3, y], [DR.x1 - 3, y], DR.z0 + 2 + DR.cards, P));
      if (rows.length) out.push(Ln(rows.join(""), { tone: "faint" }));
      if (card && open > 9) {
        const cy = yF - 12;
        const plan = { x: DR.card[0], y: cy, w: DR.card[1] - DR.card[0], d: 0.7, r: 0 };
        out.push(`<g class="f1-card">${S(k.slabOf(plan, DR.z0 + 2, DR.cards + lift, P, 1), { tone: "hi" })}${lift > 1.5 ? Ln([0, 1, 2].map((i) => k.pathOf([at([plan.x + 2, cy + 0.7, DR.z0 + 2 + DR.cards + lift - 2 - i * 1.6]), at([plan.x + 2 + [14, 10, 12][i], cy + 0.7, DR.z0 + 2 + DR.cards + lift - 2 - i * 1.6])])).join(""), { tone: "lo", free: true }) : ""}</g>`);
      }
      out.push(S(k.slabOf({ x: DR.x1 - 3, y: y0, w: 1, d: open, r: 0 }, DR.z0 + 2, DR.wall, P, 1), { tone: "mid", crease: "none" }));
    }
    const front = { x: DR.x0, y: yF, w: DR.x1 - DR.x0, d: 1.8, r: 0.6 };
    out.push(S(k.slabOf(front, DR.z0, DR.z1 - DR.z0, P, 2, 0.4), { tone: "mid" }));
    out.push(drawerFace(yF + 1.8));
    return out.join("");
  }

  // The label holder and pull on a drawer's front face at y.
  function drawerFace(y) {
    const cx = (DR.x0 + DR.x1) / 2;
    const zt = DR.z1 - 5;
    const holder = [[cx - 7, y, zt + 2.4], [cx + 7, y, zt + 2.4], [cx + 7, y, zt - 2.4], [cx - 7, y, zt - 2.4]];
    const card = [[cx - 5.6, y, zt + 1.2], [cx + 2, y, zt + 1.2]];
    const pull = { x: cx - 6, y, w: 12, d: 1.4, r: 0.5 };
    return (
      Ln(k.pathOf(holder.map(at), true), { tone: "lo" }) +
      Ln(k.pathOf(card.map(at)), { tone: "faint", free: true }) +
      k.dotsSvg([at([cx - 7.8, y, zt]), at([cx + 7.8, y, zt])], { size: 0.45 }) +
      S(k.slabOf(pull, DR.z0 + 6, 2.2, P, 2, 0.3), { tone: "hi" })
    );
  }

  return { lever, handle, pointer, drawer, drawerFace };
}

// Generated "studio shot" artwork for the demo seed (scripts/seed-demo.ts).
//
// Every image is a flat-ish SVG illustration of the object on a light, seamless studio backdrop with a
// soft floor (or drop) shadow, rendered to JPEG with sharp. No text anywhere in the images.
//  - Products: 4:5 portrait (1200×1500), subject centred with breathing room so a centred square crop
//    still holds the whole object. The object is measured after drawing (sharp trim), so every shape is
//    fitted the same way regardless of its own coordinates.
//  - View 0 = front, 1 = mirrored / other side, 2 = close detail, 3 = pulled back on a lighter backdrop.
//  - Deterministic: the same title + seed + view always renders the same image.
import sharp from "sharp";

export type Shape = "helmet" | "cap" | "tunic" | "coat" | "bag" | "canteen" | "optics" | "badge" | "buckle" | "patch" | "document" | "photo" | "blade";

// ─── Utilities ──────────────────────────────────────────────────────────────

type Rng = () => number;
function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
const has = (title: string, re: RegExp) => re.test(title);

function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}
const darker = (c: string, t = 0.2) => mix(c, "#000000", t);
const lighter = (c: string, t = 0.2) => mix(c, "#ffffff", t);

// ─── SVG helpers ────────────────────────────────────────────────────────────

const f = (n: number) => Math.round(n * 10) / 10;
const P = (d: string, fill: string, more = "") => `<path d="${d}" fill="${fill}"${more ? ` ${more}` : ""}/>`;
/** Filled path with soft top-left light / bottom-right shade. */
const L = (d: string, fill: string) => P(d, fill) + P(d, "url(#lit)");
/** Filled path with a metallic sheen. */
const M = (d: string, fill: string) => P(d, fill) + P(d, "url(#sheen)");
const S = (d: string, color: string, w: number, more = "") =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${more ? ` ${more}` : ""}/>`;
const C = (cx: number, cy: number, r: number, fill: string, more = "") => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${fill}"${more ? ` ${more}` : ""}/>`;
const E = (cx: number, cy: number, rx: number, ry: number, fill: string, more = "") =>
  `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill}"${more ? ` ${more}` : ""}/>`;
/** Rounded rectangle as a path `d`. */
function rr(x: number, y: number, w: number, h: number, r: number): string {
  r = Math.min(r, w / 2, h / 2);
  return `M${f(x + r)},${f(y)} H${f(x + w - r)} A${f(r)},${f(r)} 0 0 1 ${f(x + w)},${f(y + r)} V${f(y + h - r)} A${f(r)},${f(r)} 0 0 1 ${f(x + w - r)},${f(y + h)} H${f(x + r)} A${f(r)},${f(r)} 0 0 1 ${f(x)},${f(y + h - r)} V${f(y + r)} A${f(r)},${f(r)} 0 0 1 ${f(x + r)},${f(y)} Z`;
}
const ellipseD = (cx: number, cy: number, rx: number, ry: number) =>
  `M${f(cx - rx)},${f(cy)} A${f(rx)},${f(ry)} 0 1 0 ${f(cx + rx)},${f(cy)} A${f(rx)},${f(ry)} 0 1 0 ${f(cx - rx)},${f(cy)} Z`;
const g = (transform: string, body: string) => `<g transform="${transform}">${body}</g>`;
/** Stitched / embossed outline. */
const dashed = (d: string, color: string, w = 3, dash = "10 8", more = "") => S(d, color, w, `stroke-dasharray="${dash}" ${more}`);

const DEFS = `
  <linearGradient id="lit" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset=".42" stop-color="#fff" stop-opacity="0"/>
    <stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".24"/>
  </linearGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity=".1"/><stop offset=".3" stop-color="#fff" stop-opacity=".42"/>
    <stop offset=".46" stop-color="#fff" stop-opacity="0"/><stop offset=".75" stop-color="#000" stop-opacity=".08"/>
    <stop offset="1" stop-color="#000" stop-opacity=".3"/>
  </linearGradient>
  <radialGradient id="glass" cx=".38" cy=".34" r=".7">
    <stop offset="0" stop-color="#8FA0A8"/><stop offset=".35" stop-color="#3C4A52"/><stop offset="1" stop-color="#15191B"/>
  </radialGradient>
  <linearGradient id="steel" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#D9DCDA"/><stop offset=".45" stop-color="#A5AAA8"/><stop offset=".55" stop-color="#8A8F8D"/><stop offset="1" stop-color="#B9BDBB"/>
  </linearGradient>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="26"/></filter>
  <filter id="softer" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8"/></filter>
  <filter id="drop" x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="14"/><feOffset dx="10" dy="22"/>
    <feComponentTransfer><feFuncA type="linear" slope=".26"/></feComponentTransfer>
  </filter>
  <filter id="contact" x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="4"/><feOffset dx="2" dy="4"/>
    <feComponentTransfer><feFuncA type="linear" slope=".22"/></feComponentTransfer>
  </filter>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7"/>
    <feColorMatrix type="matrix" values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .05 0"/>
  </filter>`;

// ─── Colours ────────────────────────────────────────────────────────────────

const BACKDROPS = [
  { top: "#F4F1EB", bottom: "#E8E3D9" }, // warm off-white
  { top: "#EDE9E2", bottom: "#DFD9CE" }, // light stone
  { top: "#F0F0EE", bottom: "#E2E2DF" }, // pale grey
  { top: "#F3EFE7", bottom: "#E6DFD2" }, // sand
  { top: "#EEEFEC", bottom: "#E1E3DE" }, // cool grey-green
];

const COL = {
  brass: "#B39253",
  bronze: "#94704A",
  silver: "#B9BBB5",
  aluminium: "#A8AAA4",
  blackMetal: "#2F302E",
  leather: "#7A5236",
  darkLeather: "#4C3424",
  wood: "#8A5E3B",
  paper: "#ECE4D0",
  agedPaper: "#DFD1B0",
  sepia: "#9B7E5D",
  bakelite: "#3A2B22",
};

function clothTone(t: string): string {
  if (has(t, /kriegsmarine|navy/i)) return "#2F3645";
  if (has(t, /luftwaffe|flieger/i)) return "#5E6874";
  if (has(t, /horizon/i)) return "#8796A3";
  if (has(t, /jungle|knil/i)) return "#4E5943";
  if (has(t, /british|battledress|general service|37 pattern/i)) return "#86764F";
  if (has(t, /\bus\b|m1943|m41/i)) return "#6B684A";
  if (has(t, /shinel/i)) return "#6E6656";
  if (has(t, /soviet|pilotka/i)) return "#807A58";
  if (has(t, /nva|volksarmee|bundeswehr/i)) return "#787A71";
  if (has(t, /belgian|bonnet/i)) return "#8A7D59";
  if (has(t, /dutch|mobilisation|m34|m37|dt-63|m1912|irene/i)) return "#65674E";
  return "#6C705F"; // feldgrau
}

function helmetTone(t: string): string {
  if (has(t, /horizon|adrian|french/i)) return "#7A8690";
  if (has(t, /british|brodie/i)) return "#6A6546";
  if (has(t, /\bus\b/i)) return "#575840";
  if (has(t, /soviet/i)) return "#59604A";
  if (has(t, /dutch/i)) return "#5E5C48";
  if (has(t, /belgian/i)) return "#6A6448";
  if (has(t, /bundeswehr|m56/i)) return "#54574F";
  return "#5E6356";
}

const RIBBONS: string[][] = [
  ["#1E1E1E", "#EDEBE4", "#1E1E1E", "#EDEBE4", "#1E1E1E"], // black-white
  ["#3F6B45", "#9C2F2B", "#3F6B45", "#9C2F2B", "#3F6B45"], // green-red
  ["#273A66", "#9C2F2B", "#7FA4C8"], // blue-red-light blue
  ["#9C2F2B", "#EDEBE4", "#1E1E1E", "#EDEBE4", "#9C2F2B"], // red-white-black
  ["#D07A2B", "#2E5E3A", "#D07A2B"], // orange-green
  ["#2E4E8C", "#D9B54A", "#2E4E8C"], // blue-gold
];
function ribbonFor(t: string): string[] {
  if (has(t, /iron cross/i)) return RIBBONS[0];
  if (has(t, /croix de guerre|yser/i)) return RIBBONS[1];
  if (has(t, /star/i)) return RIBBONS[2];
  if (has(t, /eastern front/i)) return RIBBONS[3];
  if (has(t, /mobilisation|dutch|justice/i)) return RIBBONS[4];
  return RIBBONS[hash(t) % RIBBONS.length];
}

// ─── Shapes ─────────────────────────────────────────────────────────────────
// Each shape draws in local coordinates around (0, 0) and says whether it stands on the floor
// (floor shadow) or lies flat (drop shadow). Size does not matter: the renderer fits it.

type Art = { body: string; flat: boolean };

function helmet(t: string): Art {
  const c = helmetTone(t);
  const rim = darker(c, 0.25);
  if (has(t, /brodie|british/i)) {
    const body =
      E(0, 70, 380, 92, darker(c, 0.12)) +
      L("M-205,62 C-205,-140 205,-140 205,62 C205,92 -205,92 -205,62 Z", c) +
      S("M-196,40 C-120,58 120,58 196,40", darker(c, 0.3), 4, 'opacity=".5"') +
      P("M-380,70 A380,92 0 0 0 380,70 A380,64 0 0 1 -380,70 Z", lighter(c, 0.1)) +
      S("M-380,70 A380,92 0 0 0 380,70", rim, 7) +
      C(0, -6, 10, darker(c, 0.2));
    return { body, flat: false };
  }
  if (has(t, /adrian|french/i)) {
    const body =
      L("M-340,44 C-300,24 -240,20 -222,30 L222,30 C262,20 322,8 362,-8 C352,30 300,64 222,66 L-222,66 C-282,66 -330,58 -340,44 Z", darker(c, 0.06)) +
      L("M-222,34 C-222,-168 222,-168 222,34 Z", c) +
      L("M-178,-92 C-120,-205 120,-205 178,-92 L164,-84 C110,-182 -110,-182 -164,-84 Z", lighter(c, 0.06)) +
      M(ellipseD(-196, -24, 22, 30), COL.bronze) +
      S("M-340,46 C-300,62 -260,66 -222,66 L222,66 C300,64 352,30 362,-8", rim, 5);
    return { body, flat: false };
  }
  if (has(t, /\bus\b|m53/i)) {
    const body =
      L("M-292,60 C-292,-160 -150,-252 0,-252 C150,-252 292,-160 292,60 C200,50 100,40 0,42 C-100,40 -200,50 -292,60 Z", c) +
      P("M-300,62 C-200,50 -100,40 0,42 C100,40 200,50 300,62 L300,80 C200,68 100,60 0,60 C-100,60 -200,68 -300,80 Z", rim) +
      M(rr(-212, 30, 26, 46, 8), darker(c, 0.15)) +
      M(rr(186, 30, 26, 46, 8), darker(c, 0.15)) +
      S("M-200,74 C-170,150 170,150 200,74", darker(clothTone(t), 0.05), 18) +
      S("M-150,-200 C-60,-235 60,-235 120,-215", "#fff", 6, 'opacity=".12"');
    return { body, flat: false };
  }
  if (has(t, /dutch m27|dutch m34|m27|m34/i) && !has(t, /m53/i)) {
    const body =
      L("M-232,42 C-232,-196 232,-196 232,42 Z", c) +
      L("M-350,40 C-350,28 350,28 350,40 L350,58 C200,72 -200,72 -350,58 Z", darker(c, 0.08)) +
      S("M-350,58 C-200,72 200,72 350,58", rim, 5) +
      (has(t, /lion|m27/i) ? M(ellipseD(-170, -36, 26, 34), COL.brass) : "") +
      C(60, -20, 9, darker(c, 0.25));
    return { body, flat: false };
  }
  // Stahlhelm silhouette (German, Soviet, Belgian, Bundeswehr): visor left, flared skirt right.
  const body =
    L(
      "M-330,56 C-322,20 -300,-10 -286,-40 C-262,-192 -150,-262 10,-262 C170,-262 272,-180 290,-40 C300,10 318,62 346,110 C350,124 340,132 326,127 C250,104 150,96 40,98 C-80,100 -200,96 -262,80 C-290,74 -318,72 -330,66 Z",
      c,
    ) +
    S("M-286,-40 C-150,-18 150,-18 290,-40", darker(c, 0.35), 4, 'opacity=".45"') +
    S("M-330,62 C-300,74 -262,80 -200,94 C-80,100 40,98 150,96 C250,104 326,127 340,124", rim, 6) +
    M(ellipseD(-60, -70, 13, 13), lighter(c, 0.1)) +
    (has(t, /m56|bundeswehr/i) ? "" : M(ellipseD(196, -54, 11, 11), lighter(c, 0.1))) +
    S("M-170,-210 C-80,-248 40,-250 120,-226", "#fff", 7, 'opacity=".12"');
  return { body, flat: false };
}

function cap(t: string): Art {
  const c = clothTone(t);
  if (has(t, /schirmm|kepi/i)) {
    const crown = has(t, /kriegsmarine/i) ? "#2B3140" : c;
    const band = has(t, /kriegsmarine/i) ? "#1F1F22" : has(t, /nva/i) ? "#3E4A3C" : darker(c, 0.3);
    const tall = has(t, /kepi/i);
    const top = tall ? -250 : -120;
    const body =
      L(`M-300,${top} C-300,${top + 70} -230,-10 -205,10 L205,10 C230,-10 300,${top + 70} 300,${top} Z`, darker(crown, 0.08)) +
      L(ellipseD(0, top, 300, 92), lighter(crown, 0.08)) +
      dashed(`M-280,${top + 6} C-180,${top + 70} 180,${top + 70} 280,${top + 6}`, darker(crown, 0.3), 3, "2 10") +
      L("M-206,2 L206,2 L200,78 L-200,78 Z", band) +
      S("M-200,62 L200,62", has(t, /kriegsmarine/i) ? COL.brass : COL.silver, 6) +
      M(ellipseD(0, 36, 18, 18), has(t, /kriegsmarine/i) ? COL.brass : COL.silver) +
      M(ellipseD(0, -40, 42, 16), has(t, /kriegsmarine/i) ? COL.brass : COL.silver) +
      P("M-202,72 C-150,152 150,152 202,72 C120,98 -120,98 -202,72 Z", "#1C1C1C") +
      P("M-140,104 C-60,128 60,128 140,104 C60,118 -60,118 -140,104 Z", "#fff", 'opacity=".22"');
    return { body, flat: false };
  }
  if (has(t, /m43|general service/i)) {
    const body =
      L("M-282,52 L-262,-128 C-150,-172 150,-172 272,-120 L292,52 Z", c) +
      S("M-272,-18 L284,-18", darker(c, 0.3), 4) +
      L("M-282,40 C-332,48 -372,66 -386,86 C-336,92 -282,78 -262,62 Z", darker(c, 0.2)) +
      M(ellipseD(-232, 16, 11, 11), darker(c, 0.25)) +
      M(ellipseD(-196, 16, 11, 11), darker(c, 0.25)) +
      M(ellipseD(-170, -76, 26, 10), COL.silver);
    return { body, flat: false };
  }
  // Side cap (Feldmütze, pilotka, bonnet de police, Dutch field cap).
  const insignia = has(t, /pilotka|star|soviet/i)
    ? P("M-200,-12 L-193,8 L-172,8 L-189,20 L-182,40 L-200,28 L-218,40 L-211,20 L-228,8 L-207,8 Z", "#9C2F2B")
    : M(ellipseD(-200, 16, 16, 16), has(t, /dutch|belgian|bonnet/i) ? COL.bronze : COL.silver) + M(ellipseD(-196, -36, 34, 10), COL.silver);
  const body =
    L("M-322,62 L322,62 L302,-58 C282,-122 222,-142 170,-112 C80,-72 -80,-72 -170,-112 C-222,-142 -282,-122 -302,-58 Z", c) +
    S("M-306,-6 L306,-6", darker(c, 0.32), 4) +
    P("M-318,62 L318,62 L312,30 L-312,30 Z", darker(c, 0.1)) +
    insignia;
  return { body, flat: false };
}

function tunic(t: string): Art {
  const c = clothTone(t);
  const collar = has(t, /m36/i) ? "#3D4A3C" : darker(c, 0.12);
  const btn = has(t, /\bus\b|knil|dt-63/i) ? "#4A4436" : has(t, /waffenrock|horizon|vareuse/i) ? COL.brass : "#8B8C84";
  const noPockets = has(t, /flieger|waffenrock/i);
  const lowerPockets = !noPockets && !has(t, /battledress|p37/i);
  const waistband = has(t, /battledress|p37/i);
  const hidden = has(t, /flieger/i);
  let body =
    L("M-150,-300 L-58,-322 L0,-268 L58,-322 L150,-300 L300,-196 L372,132 L280,152 L232,-78 L232,332 L-232,332 L-232,-78 L-280,152 L-372,132 L-300,-196 Z", c) +
    S("M-232,-78 L-210,-40 M232,-78 L210,-40", darker(c, 0.25), 3, 'opacity=".6"') +
    L("M-58,-322 L0,-268 L58,-322 L82,-298 L0,-232 L-82,-298 Z", collar) +
    L("M-150,-300 L-110,-310 L-96,-268 L-140,-258 Z", darker(c, 0.1)) +
    L("M150,-300 L110,-310 L96,-268 L140,-258 Z", darker(c, 0.1)) +
    S("M4,-232 L4,332", darker(c, 0.3), 3) +
    L("M-372,132 L-280,152 L-286,118 L-366,100 Z", darker(c, 0.1)) +
    L("M372,132 L280,152 L286,118 L366,100 Z", darker(c, 0.1));
  if (!hidden) for (let i = 0; i < (has(t, /waffenrock/i) ? 8 : 5); i++) body += M(ellipseD(20, -200 + i * (has(t, /waffenrock/i) ? 62 : 86), 10, 10), btn);
  const pocket = (x: number, y: number, w: number, h: number) =>
    L(rr(x, y, w, h, 8), darker(c, 0.04)) +
    S(`M${x + w / 2},${y + 10} L${x + w / 2},${y + h - 10}`, darker(c, 0.2), 3, 'opacity=".6"') +
    L(`M${x - 6},${y - 8} L${x + w + 6},${y - 8} L${x + w + 4},${y + 30} L${x + w / 2},${y + 44} L${x - 4},${y + 30} Z`, darker(c, 0.08)) +
    M(ellipseD(x + w / 2, y + 28, 8, 8), btn);
  if (!noPockets) body += pocket(-180, -170, 124, 116) + pocket(62, -170, 124, 116);
  if (lowerPockets) body += pocket(-208, 104, 150, 170) + pocket(64, 104, 150, 170);
  if (waistband) body += L("M-232,262 L232,262 L232,332 L-232,332 Z", darker(c, 0.08)) + M(rr(150, 280, 54, 34, 6), "#5E5A48");
  if (has(t, /flieger/i)) body += S("M-150,-210 L-150,320 M150,-210 L150,320", darker(c, 0.2), 3, 'opacity=".4"');
  return { body, flat: false };
}

function coat(t: string): Art {
  const c = clothTone(t);
  if (has(t, /trousers/i)) {
    const body =
      L("M-200,-320 L200,-320 L246,340 L66,350 L10,-60 L-10,-60 L-66,350 L-246,340 Z", c) +
      L("M-204,-340 L204,-340 L200,-300 L-200,-300 Z", darker(c, 0.1)) +
      S("M-160,-300 C-130,-230 -110,-200 -96,-190 M160,-300 C130,-230 110,-200 96,-190", darker(c, 0.3), 3) +
      L(rr(-150, -40, 110, 130, 10), darker(c, 0.05)) +
      L(rr(40, -40, 110, 130, 10), darker(c, 0.05)) +
      S("M0,-300 L0,-90", darker(c, 0.3), 3) +
      [-150, -60, 60, 150].map((x) => P(rr(x - 8, -344, 16, 46, 4), darker(c, 0.18))).join("");
    return { body, flat: false };
  }
  const btn = has(t, /soviet|shinel/i) ? "#5E5848" : "#8B8C84";
  let body =
    L("M-150,-320 L-58,-342 L0,-290 L58,-342 L150,-320 L292,-216 L360,120 L272,140 L230,-60 L278,420 L-278,420 L-230,-60 L-272,140 L-360,120 L-292,-216 Z", c) +
    L("M-58,-342 L0,-290 L58,-342 L120,-300 L40,-160 L0,-210 L-40,-160 L-120,-300 Z", darker(c, 0.1)) +
    S("M0,-210 L0,420", darker(c, 0.3), 3) +
    L("M-262,-6 L262,-6 L266,48 L-266,48 Z", darker(c, 0.06)) +
    L("M-360,120 L-272,140 L-278,96 L-354,80 Z", darker(c, 0.1)) +
    L("M360,120 L272,140 L278,96 L354,80 Z", darker(c, 0.1)) +
    S("M-170,140 L-200,240 M170,140 L200,240", darker(c, 0.3), 4);
  for (let i = 0; i < 6; i++) {
    const y = -150 + i * 60 + (i >= 3 ? 70 : 0);
    body += M(ellipseD(-72, y, 11, 11), btn) + M(ellipseD(72, y, 11, 11), btn);
  }
  return { body, flat: false };
}

function fieldGear(t: string): Art {
  if (has(t, /canister|gas mask/i)) {
    const c = "#69705B";
    let body = L(rr(-118, -290, 236, 560, 40), c);
    for (let i = 0; i < 9; i++) body += S(`M-112,${-200 + i * 52} L112,${-200 + i * 52}`, i % 2 ? lighter(c, 0.15) : darker(c, 0.2), 6, 'opacity=".7"');
    body +=
      L(rr(-128, -330, 256, 92, 34), darker(c, 0.05)) +
      M(rr(-24, -262, 48, 62, 10), "#8E918A") +
      S("M-100,-300 C-180,-300 -200,-180 -150,-120", COL.darkLeather, 14) +
      M(rr(-140, -132, 30, 40, 6), "#8E918A");
    return { body, flat: false };
  }
  if (has(t, /entrenching|spaten/i)) {
    const carrier = has(t, /carrier/i);
    let body = L(rr(-24, -420, 48, 470, 20), COL.wood) + M(rr(-34, 30, 68, 50, 10), "#5F635C");
    body += carrier
      ? L("M-150,60 L150,60 L140,320 C70,390 -70,390 -140,320 Z", COL.darkLeather) +
        dashed("M-128,80 L128,80 L120,310 C60,368 -60,368 -120,310 Z", lighter(COL.darkLeather, 0.25), 3, "8 8") +
        L(rr(-150, 120, 300, 46, 6), darker(COL.darkLeather, 0.2)) +
        M(rr(-18, 116, 36, 54, 6), COL.aluminium)
      : M("M-132,62 L132,62 L122,300 C62,362 -62,362 -122,300 Z", "#6A6D66");
    return { body: g("rotate(-16)", body), flat: true };
  }
  if (has(t, /zeltbahn/i)) {
    const base = "#8C8A6A";
    const clip = `<clipPath id="zb"><path d="M-300,-120 L240,-170 L330,60 L-210,120 Z"/></clipPath>`;
    const r = rng(hash(t));
    let camo = "";
    for (let i = 0; i < 26; i++) {
      const x = -320 + r() * 640;
      const y = -180 + r() * 300;
      const col = ["#5D6247", "#7A6548", "#6E7458"][i % 3];
      camo += P(`M${f(x)},${f(y)} L${f(x + 60 + r() * 90)},${f(y - 20 + r() * 30)} L${f(x + 30 + r() * 50)},${f(y + 30 + r() * 40)} Z`, col);
    }
    const body =
      `<defs>${clip}</defs>` +
      L("M-210,120 L330,60 L330,150 L-210,212 Z", darker(base, 0.2)) +
      L("M-300,-120 L-210,120 L-210,212 L-300,-30 Z", darker(base, 0.3)) +
      S("M-210,150 L330,90 M-210,182 L330,120", darker(base, 0.4), 3, 'opacity=".5"') +
      P("M-300,-120 L240,-170 L330,60 L-210,120 Z", base) +
      `<g clip-path="url(#zb)">${camo}</g>` +
      P("M-300,-120 L240,-170 L330,60 L-210,120 Z", "url(#lit)") +
      S("M-250,-40 C-100,-80 100,-110 280,-40", "#4C4636", 6) +
      M(ellipseD(40, -26, 12, 12), "#7C7F78");
    return { body, flat: false };
  }
  if (has(t, /belt|webbing/i)) {
    const canvas = has(t, /webbing|37 pattern/i);
    const strap = canvas ? "#9C8D63" : COL.darkLeather;
    const pouch = canvas ? "#8E8058" : COL.leather;
    // Belt closed as a loop, seen from slightly above; pouches and buckle on the front.
    let body = S(ellipseD(0, 0, 360, 170), strap, 50) + S(ellipseD(0, 0, 360, 170), "#000", 50, 'opacity=".06"');
    if (canvas) body += S("M-150,-150 L-110,-420 M150,-150 L110,-420 M-110,-420 L110,-420", strap, 36);
    const pos = canvas ? [-0.62, 0.62] : [-0.82, -0.58, -0.34, 0.34, 0.58, 0.82];
    for (const u of pos) {
      const a = Math.PI / 2 - u * (Math.PI / 2);
      const x = Math.cos(a) * 360;
      const y = Math.sin(a) * 170;
      const w = canvas ? 170 : 96;
      const h = canvas ? 210 : 132;
      body += g(
        `translate(${f(x)} ${f(y)}) rotate(${f(-u * 22)})`,
        L(rr(-w / 2, -h * 0.35, w, h, 12), pouch) + L(rr(-w / 2 - 4, -h * 0.4, w + 8, h * 0.42, 12), darker(pouch, 0.14)) + M(ellipseD(0, h * 0.12, 8, 8), canvas ? "#8A8670" : COL.aluminium),
      );
    }
    body += M(rr(-64, 128, 128, 90, 12), canvas ? "#B5A57A" : COL.aluminium) + M(ellipseD(0, 173, 32, 32), canvas ? "#A3946B" : "#BDBEB8");
    return { body, flat: true };
  }
  if (has(t, /tornister|knapsack/i)) {
    const c = has(t, /dutch/i) ? "#6A6A54" : "#6F6A54";
    let body = L(rr(-240, -270, 480, 510, 40), c);
    if (has(t, /cowhide/i)) {
      const r = rng(hash(t));
      let spots = "";
      for (let i = 0; i < 7; i++) spots += E(-160 + r() * 320, -190 + r() * 250, 40 + r() * 60, 30 + r() * 40, "#E6DCC8", `transform="rotate(${f(r() * 60 - 30)})" opacity=".9"`);
      body +=
        `<clipPath id="flap"><path d="${rr(-250, -280, 500, 380, 44)}"/></clipPath>` +
        P(rr(-250, -280, 500, 380, 44), "#6A4A30") +
        `<g clip-path="url(#flap)">${spots}</g>` +
        P(rr(-250, -280, 500, 380, 44), "url(#lit)") +
        S(rr(-250, -280, 500, 380, 44), COL.darkLeather, 10);
    } else {
      body += L(rr(-250, -280, 500, 340, 44), darker(c, 0.1));
    }
    body +=
      L(rr(-170, -40, 56, 260, 10), COL.darkLeather) +
      L(rr(114, -40, 56, 260, 10), COL.darkLeather) +
      M(rr(-176, 60, 68, 48, 6), COL.aluminium) +
      M(rr(108, 60, 68, 48, 6), COL.aluminium);
    return { body, flat: false };
  }
  // Bread bag.
  const c = has(t, /m31|brotbeutel/i) ? "#6E6C55" : "#7A7258";
  const body =
    L("M-252,-150 L252,-150 C272,40 262,200 202,222 L-202,222 C-262,200 -272,40 -252,-150 Z", c) +
    L("M-258,-150 L258,-150 C260,-20 242,40 0,62 C-242,40 -260,-20 -258,-150 Z", darker(c, 0.1)) +
    L(rr(-160, -150, 46, 210, 8), COL.darkLeather) +
    L(rr(114, -150, 46, 210, 8), COL.darkLeather) +
    M(rr(-166, 6, 58, 40, 6), COL.aluminium) +
    M(rr(108, 6, 58, 40, 6), COL.aluminium) +
    L(rr(-220, -196, 70, 56, 10), COL.darkLeather) +
    L(rr(150, -196, 70, 56, 10), COL.darkLeather) +
    S("M-185,-196 C-180,-250 -150,-262 -120,-250 M185,-196 C180,-250 150,-262 120,-250", "#8C8D86", 8);
  return { body, flat: false };
}

function canteen(t: string): Art {
  if (has(t, /kochgeschirr|mess tin/i)) {
    const c = has(t, /1942/i) ? "#5E6352" : "#6A6E5E";
    const body =
      S("M-196,-160 C-196,-340 196,-340 196,-160", "#8D908A", 10) +
      L("M-222,-118 L222,-118 L222,200 C222,242 190,262 150,262 L-150,262 C-190,262 -222,242 -222,200 Z", c) +
      L(rr(-234, -176, 468, 80, 20), lighter(c, 0.06)) +
      M(rr(-270, -160, 60, 30, 8), "#8D908A") +
      S("M-200,-100 L200,-100", darker(c, 0.3), 3);
    return { body, flat: false };
  }
  const cover = has(t, /\bus\b/i) ? "#6B6A4C" : has(t, /dutch/i) ? "#5C5B52" : "#7A6B54";
  const cup = has(t, /bakelite/i) ? COL.bakelite : has(t, /\bus\b/i) ? "#8A8D88" : "#5F6354";
  const body =
    L("M-170,-150 C-202,-50 -202,180 -150,240 C-80,300 80,300 150,240 C202,180 202,-50 170,-150 C100,-212 -100,-212 -170,-150 Z", cover) +
    dashed("M-150,-136 C-180,-50 -180,170 -136,224 C-70,280 70,280 136,224 C180,170 180,-50 150,-136", lighter(cover, 0.18), 3, "6 8") +
    M(rr(-44, -260, 88, 70, 14), "#8E918A") +
    L(rr(-110, -232, 220, 100, 22), cup) +
    L(rr(-26, -210, 52, 500, 10), COL.darkLeather) +
    M(rr(-34, 120, 68, 46, 6), COL.aluminium) +
    (has(t, /\bus\b/i) ? M(ellipseD(-120, 170, 10, 10), "#8E918A") + M(ellipseD(120, 170, 10, 10), "#8E918A") : "");
  return { body, flat: false };
}

function optics(t: string): Art {
  if (has(t, /telephone|fernsprecher/i)) {
    const c = COL.bakelite;
    const body =
      L(rr(-262, -100, 524, 330, 26), c) +
      L(rr(-262, -100, 524, 70, 26), lighter(c, 0.1)) +
      L("M-230,-150 C-230,-200 -170,-210 -150,-170 L150,-170 C170,-210 230,-200 230,-150 C230,-110 180,-104 160,-130 L-160,-130 C-180,-104 -230,-110 -230,-150 Z", "#1E1A17") +
      M(ellipseD(300, 40, 30, 30), "#7C7F78") +
      S("M300,40 L360,110", "#7C7F78", 12) +
      M(ellipseD(360, 110, 16, 16), COL.wood) +
      S("M-210,-100 C-210,-260 210,-260 210,-100", COL.darkLeather, 16) +
      M(rr(-200, 40, 120, 70, 8), "#55504A") +
      M(ellipseD(160, 100, 40, 40), "#55504A");
    return { body, flat: false };
  }
  if (has(t, /compass/i)) {
    const body =
      L(ellipseD(0, -260, 220, 120), COL.blackMetal) +
      L(ellipseD(0, 40, 236, 236), COL.blackMetal) +
      P(ellipseD(0, 40, 196, 196), "#E8E2D2") +
      Array.from({ length: 36 }, (_, i) => {
        const a = (i * Math.PI) / 18;
        const r1 = i % 9 === 0 ? 150 : 170;
        return S(`M${f(Math.cos(a) * r1)},${f(40 + Math.sin(a) * r1)} L${f(Math.cos(a) * 188)},${f(40 + Math.sin(a) * 188)}`, "#3A3A36", i % 9 === 0 ? 5 : 2.5);
      }).join("") +
      P("M0,-90 L22,40 L0,170 L-22,40 Z", "#3A3A36") +
      P("M0,-90 L22,40 L-22,40 Z", "#9C2F2B") +
      C(0, 40, 12, COL.brass) +
      P(ellipseD(0, 40, 196, 196), "url(#sheen)", 'opacity=".5"') +
      M(rr(-30, -230, 60, 40, 8), COL.brass);
    return { body, flat: true };
  }
  if (has(t, /torch|lamp/i)) {
    const c = "#4A4E45";
    const body =
      L(rr(-160, -240, 320, 470, 30), c) +
      M(ellipseD(0, -70, 104, 104), "#7C7F78") +
      P(ellipseD(0, -70, 82, 82), "url(#glass)") +
      P(ellipseD(-26, -98, 22, 14), "#fff", 'opacity=".35"') +
      L(rr(-184, 40, 24, 90, 6), "#9C2F2B") +
      L(rr(160, 40, 24, 90, 6), "#3F6B45") +
      M(rr(-60, 110, 120, 60, 10), "#7C7F78") +
      M(rr(-100, -284, 200, 48, 12), "#7C7F78");
    return { body, flat: false };
  }
  // Binoculars.
  const c = has(t, /dienstglas/i) ? "#2E302C" : "#5A5E52";
  const barrel = (x: number) =>
    L(rr(x - 74, -150, 148, 330, 48), c) +
    L(rr(x - 50, -250, 100, 120, 20), darker(c, 0.15)) +
    P(rr(x - 74, -40, 148, 120, 10), "#000", 'opacity=".14"') +
    M(ellipseD(x, 186, 74, 26), "#6D706A") +
    P(ellipseD(x, 186, 60, 20), "url(#glass)");
  const body =
    barrel(-100) +
    barrel(100) +
    M(rr(-40, -200, 80, 220, 18), darker(c, 0.1)) +
    M(ellipseD(0, -170, 30, 30), "#6D706A") +
    S("M-174,-120 C-260,-60 -260,160 -180,250", COL.darkLeather, 12) +
    S("M174,-120 C260,-60 260,160 180,250", COL.darkLeather, 12);
  return { body, flat: false };
}

function badge(t: string): Art {
  const ribbonStripes = ribbonFor(t);
  const ribbon = (cy: number, w = 140, h = 230) => {
    const n = ribbonStripes.length;
    const top = cy - h;
    let s = `<clipPath id="rb"><path d="M${-w / 2},${top} L${w / 2},${top} L${w / 2},${cy} L0,${cy + 34} L${-w / 2},${cy} Z"/></clipPath><g clip-path="url(#rb)">`;
    // Stripe widths: outer bands wider, inner narrower.
    const weights = ribbonStripes.map((_, i) => (i === 0 || i === n - 1 ? 1.6 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let x = -w / 2;
    ribbonStripes.forEach((col, i) => {
      const sw = (weights[i] / total) * w;
      s += `<rect x="${f(x)}" y="${top}" width="${f(sw + 0.6)}" height="${h + 40}" fill="${col}"/>`;
      x += sw;
    });
    s += `<rect x="${-w / 2}" y="${top}" width="${w}" height="${h + 40}" fill="url(#lit)"/>`;
    s += S(`M${-w / 2},${top + h * 0.35} L${w / 2},${top + h * 0.35}`, "#000", 2, 'opacity=".12"');
    return `${s}</g>`;
  };
  if (has(t, /cross/i)) {
    const arm = "M-38,-38 L-92,-250 C-30,-238 30,-238 92,-250 L38,-38 Z";
    const cross = (fill: string, scale: number, metal: boolean) =>
      [0, 90, 180, 270].map((a) => g(`rotate(${a}) scale(${scale})`, metal ? M(arm, fill) : L(arm, fill))).join("") + (metal ? M(rr(-40 * scale, -40 * scale, 80 * scale, 80 * scale, 2), fill) : L(rr(-40 * scale, -40 * scale, 80 * scale, 80 * scale, 2), fill));
    const iron = has(t, /iron/i);
    const metal = iron ? COL.silver : COL.bronze;
    const body =
      ribbon(-240) +
      M(ellipseD(0, -262, 18, 18), "none") +
      S("M0,-280 m-16,0 a16,16 0 1 0 32,0 a16,16 0 1 0 -32,0", metal, 7) +
      g("translate(0 6)", cross(metal, 1, true) + (iron ? cross("#1F1F1E", 0.84, false) : g("scale(.62)", [0, 90, 180, 270].map((a) => g(`rotate(${a})`, S("M0,-60 L0,-200", darker(metal, 0.3), 6, 'opacity=".6"'))).join("")) + M(ellipseD(0, 6, 50, 50), lighter(metal, 0.08))));
    return { body: g("translate(0 120)", body), flat: true };
  }
  if (has(t, /star/i)) {
    const pts = Array.from({ length: 12 }, (_, i) => {
      const a = (i * Math.PI) / 6 - Math.PI / 2;
      const r = i % 2 ? 120 : 230;
      return `${f(Math.cos(a) * r)},${f(Math.sin(a) * r)}`;
    }).join(" L");
    const body = ribbon(-240) + S("M0,-258 m-14,0 a14,14 0 1 0 28,0 a14,14 0 1 0 -28,0", "#B7924E", 7) + M(`M${pts} Z`, "#B7924E") + M(ellipseD(0, 0, 70, 70), "#A5803F");
    return { body: g("translate(0 120)", body), flat: true };
  }
  if (has(t, /medal/i)) {
    const metal = has(t, /eastern front/i) ? "#7D7A72" : has(t, /yser|bronze|long service/i) ? COL.bronze : COL.silver;
    const body =
      ribbon(-200) +
      S("M0,-196 L0,-176", metal, 10) +
      M(ellipseD(0, 0, 176, 176), metal) +
      S(ellipseD(0, 0, 150, 150), darker(metal, 0.25), 4, 'opacity=".55"') +
      M(ellipseD(0, 0, 80, 80), lighter(metal, 0.05)) +
      (has(t, /eastern front/i) ? M(ellipseD(0, -170, 54, 24), metal) : "");
    return { body: g("translate(0 110)", body), flat: true };
  }
  // Oval wreath badge (assault / wound badge).
  const metal = has(t, /black/i) ? "#2E2E2B" : has(t, /gold/i) ? COL.brass : "#9EA09A";
  let leaves = "";
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const x = Math.cos(a) * 170;
    const y = Math.sin(a) * 230;
    leaves += E(x, y, 34, 16, metal, `transform="rotate(${f((a * 180) / Math.PI + 90 + (i % 2 ? 24 : -24))} ${f(x)} ${f(y)})"`);
  }
  const centre = has(t, /wound/i)
    ? M("M-110,40 C-110,-70 -40,-120 30,-110 C100,-100 120,-40 124,20 L150,60 C80,50 -40,52 -120,60 Z", lighter(metal, 0.08))
    : M("M-120,110 L100,-150 L122,-132 L-96,128 Z", lighter(metal, 0.1)) + M(rr(-80, 80, 70, 40, 8), lighter(metal, 0.1));
  const body =
    `<g>${leaves}</g>` +
    P(ellipseD(0, 0, 196, 258), "none", `stroke="${darker(metal, 0.15)}" stroke-width="10" opacity=".6"`) +
    P(ellipseD(0, 0, 196, 258), "url(#sheen)", 'opacity=".6"') +
    centre +
    (has(t, /black/i) ? P(ellipseD(0, 0, 196, 258), "url(#sheen)", 'opacity=".35"') : "");
  return { body, flat: true };
}

function buckle(t: string): Art {
  const metal = has(t, /brass|knil|kriegsmarine|dutch/i) ? COL.brass : COL.aluminium;
  const centre = has(t, /kriegsmarine/i)
    ? S("M0,-70 L0,60 M-50,-40 L50,-40 M-60,20 C-50,70 50,70 60,20", darker(metal, 0.35), 12) + S("M0,-86 m-14,0 a14,14 0 1 0 28,0 a14,14 0 1 0 -28,0", darker(metal, 0.35), 8)
    : has(t, /lion/i)
      ? M("M-46,-70 L46,-70 L46,10 C46,60 0,80 0,80 C0,80 -46,60 -46,10 Z", lighter(metal, 0.06)) + S("M-46,-70 L46,-70 L46,10 C46,60 0,80 0,80 C0,80 -46,60 -46,10 Z", darker(metal, 0.3), 4)
      : M(ellipseD(0, 0, 54, 54), lighter(metal, 0.08)) + S(ellipseD(0, 0, 54, 54), darker(metal, 0.3), 4);
  let ring = "";
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ring += E(Math.cos(a) * 92, Math.sin(a) * 92, 16, 7, darker(metal, 0.12), `transform="rotate(${f((a * 180) / Math.PI + 90)} ${f(Math.cos(a) * 92)} ${f(Math.sin(a) * 92)})"`);
  }
  const body =
    L(rr(-420, -66, 230, 132, 6), COL.darkLeather) +
    dashed("M-410,-48 L-200,-48 M-410,48 L-200,48", lighter(COL.darkLeather, 0.25), 3, "8 8") +
    M(rr(-236, -166, 472, 332, 28), metal) +
    S(rr(-206, -136, 412, 272, 18), darker(metal, 0.25), 5, 'opacity=".55"') +
    S(ellipseD(0, 0, 120, 120), darker(metal, 0.25), 6, 'opacity=".6"') +
    ring +
    centre;
  return { body, flat: true };
}

function patch(t: string): Art {
  if (has(t, /collar tab/i)) {
    const tab = (x: number) =>
      L(rr(x - 80, -170, 160, 340, 14), "#3D4A3C") +
      dashed(rr(x - 68, -158, 136, 316, 10), "#5C6B59", 3, "6 6") +
      [x - 34, x + 34].map((cx) => L(rr(cx - 22, -130, 44, 260, 18), "#9A9C93") + P(rr(cx - 5, -124, 10, 248, 4), "#E9E6DC")).join("");
    return { body: tab(-110) + g("rotate(4 110 0)", tab(110)), flat: true };
  }
  const shield = "M-200,-200 L200,-200 L200,40 C200,150 90,212 0,240 C-90,212 -200,150 -200,40 Z";
  if (has(t, /sleeve eagle/i)) {
    const c = "#4B5046";
    const w = "#9FA197";
    const wing = (sx: number) =>
      g(
        `scale(${sx} 1)`,
        M("M20,-40 C80,-120 200,-160 300,-150 C280,-110 250,-90 220,-80 C240,-70 250,-50 250,-36 C220,-40 200,-38 180,-30 C190,-18 196,-4 196,8 C150,0 100,0 40,20 Z", w) +
          S("M60,-40 C120,-90 200,-120 280,-140 M70,-20 C130,-60 190,-70 230,-74 M70,0 C110,-20 150,-26 186,-26", darker(w, 0.3), 3, 'opacity=".6"'),
      );
    const body =
      L("M-330,-150 L330,-150 L250,170 L-250,170 Z", c) +
      dashed("M-306,-134 L306,-134 L234,154 L-234,154 Z", lighter(c, 0.15), 3, "6 6") +
      wing(1) +
      wing(-1) +
      M("M-34,-70 C-30,-110 30,-110 34,-70 L40,60 C20,90 -20,90 -40,60 Z", w) +
      M("M-30,80 L30,80 L50,130 L-50,130 Z", w);
    return { body, flat: true };
  }
  const isUS = has(t, /101st|screaming/i);
  const isUK = has(t, /pegasus|airborne division/i);
  const field = isUS ? "#1C1C1C" : isUK ? "#6B2C33" : has(t, /irene/i) ? "#2E3446" : "#4B5046";
  const emblem = isUK ? "#9CB8D0" : has(t, /irene/i) ? "#D07A2B" : "#E9E6DC";
  let body = "";
  if (isUS) {
    body += L("M-200,-330 C-120,-380 120,-380 200,-330 L190,-270 C110,-310 -110,-310 -190,-270 Z", "#1C1C1C") + dashed("M-186,-322 C-110,-362 110,-362 186,-322", "#E9E6DC", 3, "6 6");
    body +=
      L(shield, field) +
      dashed("M-184,-184 L184,-184 L184,40 C184,140 84,196 0,222 C-84,196 -184,140 -184,40 Z", "#E9E6DC", 3, "6 6") +
      M("M-60,-90 C-60,-150 60,-160 80,-100 L150,-60 L80,-40 C70,40 40,110 -10,150 L-70,150 C-80,60 -80,-20 -60,-90 Z", "#EFEDE6") +
      P("M80,-100 L150,-60 L80,-40 Z", "#D9B54A") +
      C(30, -100, 10, "#1C1C1C");
  } else {
    body +=
      L(isUK ? rr(-220, -220, 440, 440, 18) : shield, field) +
      dashed(isUK ? rr(-204, -204, 408, 408, 12) : "M-184,-184 L184,-184 L184,40 C184,140 84,196 0,222 C-84,196 -184,140 -184,40 Z", lighter(field, 0.3), 3, "6 6") +
      M("M0,-40 C-40,-110 -120,-140 -170,-120 C-150,-80 -130,-60 -100,-50 C-130,-30 -140,-10 -140,10 C-90,0 -40,10 -16,40 L-16,130 L16,130 L16,40 C40,10 90,0 140,10 C140,-10 130,-30 100,-50 C130,-60 150,-80 170,-120 C120,-140 40,-110 0,-40 Z", emblem) +
      M(ellipseD(0, -70, 22, 22), emblem);
  }
  return { body, flat: true };
}

function documentArt(t: string): Art {
  const r = rng(hash(t));
  const lines = (x: number, y: number, w: number, n: number, gap: number, color: string, width = 4) =>
    Array.from({ length: n }, (_, i) => {
      const len = w * (0.55 + r() * 0.45);
      const yy = y + i * gap;
      return S(`M${f(x)},${f(yy)} C${f(x + len * 0.3)},${f(yy - 4)} ${f(x + len * 0.6)},${f(yy + 4)} ${f(x + len)},${f(yy)}`, color, width, 'opacity=".55"');
    }).join("");
  if (has(t, /kennkarte|ausweis/i)) {
    const card = "#C9C4B6";
    const body =
      g("rotate(-8) translate(-40 150)", L(rr(-230, -150, 460, 300, 8), "#D8CBA8") + lines(-190, -100, 360, 6, 40, "#6B5E48", 3)) +
      L(rr(-330, -230, 660, 420, 6), card) +
      S("M0,-230 L0,190", darker(card, 0.2), 3) +
      P(rr(-290, -170, 140, 180, 4), "#E8E2D2") +
      P(rr(-280, -160, 120, 160, 2), COL.sepia) +
      E(-220, -100, 34, 42, darker(COL.sepia, 0.3)) +
      P("M-280,0 C-270,-50 -170,-50 -160,0 Z", darker(COL.sepia, 0.3)) +
      lines(-130, -150, 110, 5, 36, "#55524A", 3) +
      lines(40, -170, 250, 8, 40, "#55524A", 3) +
      S(ellipseD(-180, 80, 56, 56), "#6E5A8A", 5, 'opacity=".5"') +
      S(ellipseD(-180, 80, 40, 40), "#6E5A8A", 3, 'opacity=".4"');
    return { body, flat: true };
  }
  if (has(t, /letter|veldpost|field post|feldpost/i) && !has(t, /postcard/i)) {
    const bundle = has(t, /bundle/i);
    const env = (dx: number, dy: number, rot: number, tone: string) =>
      g(
        `translate(${dx} ${dy}) rotate(${rot})`,
        L(rr(-300, -180, 600, 360, 6), tone) +
          lines(-120, -10, 260, 3, 44, "#3E3A55", 4) +
          P(rr(160, -150, 96, 116, 2), "#8E3A33") +
          dashed(rr(160, -150, 96, 116, 2), tone, 4, "4 6") +
          S(ellipseD(150, -70, 54, 54), "#3E3A40", 4, 'opacity=".45"') +
          S("M60,-90 C90,-100 120,-80 150,-90 C180,-100 210,-80 240,-90 M60,-60 C90,-70 120,-50 150,-60 C180,-70 210,-50 240,-60", "#3E3A40", 3, 'opacity=".45"'),
      );
    let body = bundle ? env(-20, 60, -5, "#D9CCAA") + env(10, 20, 3, "#E4DABF") + env(0, -20, -1, "#EAE1C9") : env(0, 0, -3, "#E8DEC4");
    if (!bundle) body = g("rotate(6) translate(60 -170)", L(rr(-250, -170, 500, 340, 4), COL.paper) + lines(-210, -130, 420, 7, 40, "#3E3A55", 3)) + body;
    if (bundle) body += S("M-330,24 L330,24 M0,-200 L0,240", "#9C8A63", 7);
    return { body, flat: true };
  }
  // Booklet: Soldbuch / Wehrpass / pocket book.
  const cover = has(t, /wehrpass/i) ? "#7E8790" : has(t, /pocket book|dutch/i) ? "#5E4430" : "#8A7F6A";
  const body =
    g(
      "rotate(-5)",
      L(rr(-196, -262, 400, 532, 10), "#E6DCC4") +
        S("M200,-250 L200,262", "#C9BC9C", 3) +
        S("M-180,268 L196,268", "#C9BC9C", 3) +
        L(rr(-206, -272, 396, 528, 12), cover) +
        S("M-180,-272 L-180,256", darker(cover, 0.25), 4, 'opacity=".6"') +
        S(ellipseD(10, -90, 70, 70), lighter(cover, 0.18), 5, 'opacity=".5"') +
        S("M-40,60 L60,60 M-60,90 L80,90", lighter(cover, 0.18), 6, 'opacity=".4"'),
    ) + g("rotate(9) translate(150 200)", L(rr(-110, -150, 220, 290, 3), "#EFE9DA") + P(rr(-96, -136, 192, 220, 2), COL.sepia) + P("M-96,84 L-96,40 C-40,0 20,30 96,-10 L96,84 Z", darker(COL.sepia, 0.2)));
  return { body, flat: true };
}

function photoArt(t: string): Art {
  const scene = (w: number, h: number, kind: number) => {
    const sky = lighter(COL.sepia, 0.35);
    const land = darker(COL.sepia, 0.15);
    let s = P(rr(-w / 2, -h / 2, w, h, 2), sky);
    if (kind === 0) {
      s += P(`M${-w / 2},${h * 0.1} C${-w * 0.2},${-h * 0.05} ${w * 0.1},${h * 0.15} ${w / 2},${-h * 0.02} L${w / 2},${h / 2} L${-w / 2},${h / 2} Z`, land);
      s += P(`M${-w * 0.25},${h * 0.06} L${-w * 0.25},${-h * 0.2} L${-w * 0.12},${-h * 0.3} L${w * 0.01},${-h * 0.2} L${w * 0.01},${h * 0.08} Z`, darker(COL.sepia, 0.3));
    } else if (kind === 1) {
      s += P(`M${-w / 2},${h * 0.2} L${w / 2},${h * 0.1} L${w / 2},${h / 2} L${-w / 2},${h / 2} Z`, land);
      for (let i = 0; i < 4; i++) s += E(-w * 0.3 + i * w * 0.18, h * 0.05, w * 0.035, h * 0.12, darker(COL.sepia, 0.4)) + C(-w * 0.3 + i * w * 0.18, -h * 0.12, w * 0.03, darker(COL.sepia, 0.4));
    } else {
      s += E(0, -h * 0.1, w * 0.17, h * 0.2, darker(COL.sepia, 0.35));
      s += P(`M${-w * 0.36},${h / 2} C${-w * 0.34},${h * 0.12} ${w * 0.34},${h * 0.12} ${w * 0.36},${h / 2} Z`, darker(COL.sepia, 0.3));
    }
    return s + P(rr(-w / 2, -h / 2, w, h, 2), "url(#lit)");
  };
  const card = (w: number, h: number, kind: number, border = 22) => L(rr(-w / 2, -h / 2, w, h, 4), "#EEE7D6") + g("", scene(w - border * 2, h - border * 2, kind));
  if (has(t, /portrait/i)) {
    const body = L(rr(-220, -300, 440, 600, 8), "#D9CDB2") + g("translate(0 -30)", scene(360, 460, 2)) + S(rr(-196, -276, 392, 552, 6), "#B9A57E", 3, 'opacity=".7"');
    return { body, flat: true };
  }
  if (has(t, /album/i)) {
    const c = "#2E2B28";
    const body =
      g("rotate(-14) translate(-140 210)", card(260, 180, 1, 12)) +
      g("rotate(10) translate(180 230)", card(240, 170, 0, 12)) +
      L(rr(-300, -230, 600, 440, 14), c) +
      S("M-260,-230 L-260,210", lighter(c, 0.12), 4) +
      [-160, -60, 40, 140].map((y) => C(-282, y * 0.9, 8, "#9C8A63")).join("") +
      S("M-282,-150 C-330,-120 -340,-80 -330,-40", "#9C8A63", 5) +
      g("translate(30 -10)", P(rr(-130, -96, 260, 192, 4), "#EEE7D6") + scene(226, 160, 0)) +
      S(rr(-226, -180, 512, 340, 10), lighter(c, 0.15), 3, 'opacity=".6"');
    return { body, flat: true };
  }
  if (has(t, /letter/i)) return documentArt(t);
  // Postcard set (fanned).
  const n = has(t, /set/i) ? 3 : 1;
  let body = "";
  for (let i = 0; i < n; i++) {
    const rot = n === 1 ? -4 : -14 + i * 12;
    body += g(`translate(${(i - (n - 1) / 2) * 60} ${(i - (n - 1) / 2) * 30}) rotate(${rot})`, card(520, 340, i % 2));
  }
  return { body, flat: true };
}

function blade(t: string): Art {
  const spike = has(t, /spike|no\.4/i);
  const grip = has(t, /\bus\b/i) ? "#3A3A36" : COL.wood;
  const sheath = has(t, /\bus\b/i) ? "#5A5E4E" : has(t, /lebel|french/i) ? "#3A3A38" : "#2C2B29";
  const bladeD = spike
    ? "M-420,0 L-110,-14 L150,-16 L150,16 L-110,14 Z"
    : "M-420,0 C-380,-16 -330,-28 -280,-30 L150,-30 L150,30 L-280,30 C-330,28 -380,16 -420,0 Z";
  const body =
    // Scabbard below.
    g(
      "translate(0 130)",
      L(spike ? "M-330,0 L-120,-16 L120,-22 L120,22 L-120,16 Z" : "M-380,0 C-360,-26 -320,-38 -280,-40 L120,-40 L120,40 L-280,40 C-320,38 -360,26 -380,0 Z", sheath) +
        M(rr(110, -48, 70, 96, 10), "#7C7F78") +
        M(ellipseD(30, -40, 16, 12), "#7C7F78"),
    ) +
    P(bladeD, "url(#steel)") +
    (spike ? "" : S("M-280,-4 L130,-4", "#7E8381", 5, 'opacity=".55"')) +
    M(rr(150, -76, 30, 140, 6), "#6D706A") +
    (has(t, /mannlicher|m95|lebel/i) ? S("M165,-96 m-20,0 a20,20 0 1 0 40,0 a20,20 0 1 0 -40,0", "#6D706A", 10) : "") +
    L(rr(180, -34, 170, 68, 14), grip) +
    M(ellipseD(230, 0, 9, 9), "#8D908A") +
    M(ellipseD(300, 0, 9, 9), "#8D908A") +
    M(rr(340, -40, 56, 80, 14), "#6D706A");
  return { body: g("rotate(-52)", body), flat: true };
}

function shapeArt(shape: Shape, title: string): Art {
  switch (shape) {
    case "helmet":
      return helmet(title);
    case "cap":
      return cap(title);
    case "tunic":
      return tunic(title);
    case "coat":
      return coat(title);
    case "bag":
      return fieldGear(title);
    case "canteen":
      return canteen(title);
    case "optics":
      return optics(title);
    case "badge":
      return badge(title);
    case "buckle":
      return buckle(title);
    case "patch":
      return patch(title);
    case "document":
      return documentArt(title);
    case "photo":
      return photoArt(title);
    case "blade":
      return blade(title);
  }
}

// ─── Rendering ──────────────────────────────────────────────────────────────

type Box = { x: number; y: number; w: number; h: number };
const MEASURE = 2400;

/** Bounding box of the drawn object in local coordinates (rendered once and trimmed). */
async function measure(body: string): Promise<Box> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${MEASURE}" height="${MEASURE}"><defs>${DEFS}</defs><g transform="translate(${MEASURE / 2} ${MEASURE / 2})">${body}</g></svg>`;
  const { info } = await sharp(Buffer.from(svg)).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
  const left = -(info.trimOffsetLeft ?? 0);
  const top = -(info.trimOffsetTop ?? 0);
  return { x: left - MEASURE / 2, y: top - MEASURE / 2, w: info.width, h: info.height };
}

function backdrop(w: number, h: number, bd: { top: string; bottom: string }, horizon = 0.62) {
  return (
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bd.top}"/><stop offset="${horizon}" stop-color="${mix(bd.top, bd.bottom, 0.45)}"/><stop offset="1" stop-color="${bd.bottom}"/></linearGradient>` +
    `<radialGradient id="spot" cx=".5" cy=".42" r=".62"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="vig" cx=".5" cy=".5" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".07"/></radialGradient>` +
    `</defs><rect width="${w}" height="${h}" fill="url(#bg)"/><rect width="${w}" height="${h}" fill="url(#spot)"/>`
  );
}
const finish = (w: number, h: number) => `<rect width="${w}" height="${h}" fill="url(#vig)"/><rect width="${w}" height="${h}" filter="url(#grain)"/>`;

/** Places `art` (measured as `box`) into a scene: fitted to maxW×maxH, centred on (cx, cy). */
function place(art: Art, box: Box, opts: { cx: number; cy: number; maxW: number; maxH: number; zoom?: number; mirror?: boolean; rotate?: number; focus?: [number, number] }): string {
  const s = Math.min(opts.maxW / box.w, opts.maxH / box.h) * (opts.zoom ?? 1);
  const fx = box.x + box.w * (0.5 + (opts.focus?.[0] ?? 0));
  const fy = box.y + box.h * (0.5 + (opts.focus?.[1] ?? 0));
  const sx = opts.mirror ? -s : s;
  const transform = `translate(${f(opts.cx)} ${f(opts.cy)}) rotate(${f(opts.rotate ?? 0)}) scale(${f(sx * 1000) / 1000} ${f(s * 1000) / 1000}) translate(${f(-fx)} ${f(-fy)})`;
  let out = "";
  if (art.flat) {
    out += `<g transform="${transform}" filter="url(#drop)">${art.body}</g>`;
  } else {
    // Floor shadow: wide soft ellipse plus a tight contact shadow under the object's base.
    const floorY = opts.cy + (box.y + box.h - fy) * s;
    const half = (box.w * s) / 2;
    out += E(opts.cx, floorY + 4, half * 0.92, Math.max(18, half * 0.11), "#2E2A22", 'opacity=".2" filter="url(#soft)"');
    out += E(opts.cx, floorY, half * 0.7, Math.max(8, half * 0.035), "#2E2A22", 'opacity=".32" filter="url(#softer)"');
  }
  out += `<g transform="${transform}">${art.body}</g>`;
  return out;
}

const measured = new Map<string, Promise<Box>>();
function measureCached(key: string, art: Art) {
  let p = measured.get(key);
  if (!p) measured.set(key, (p = measure(art.body)));
  return p;
}

export const PRODUCT_ART_SIZE = { width: 1200, height: 1500 };

/** SVG of one product photo. `seed` varies backdrop and tilt per product; `view` varies the shot. */
export async function productArtSvg(opts: { title: string; shape: Shape; seed: number; view: number }): Promise<string> {
  const { width: W, height: H } = PRODUCT_ART_SIZE;
  const art = shapeArt(opts.shape, opts.title);
  const box = await measureCached(`${opts.shape}|${opts.title}`, art);
  const r = rng(opts.seed * 31 + opts.view);
  const view = opts.view % 4;
  const bdIndex = (opts.seed + [0, 1, 0, 2][view]) % BACKDROPS.length;
  const bd = view === 3 ? { top: lighter(BACKDROPS[bdIndex].top, 0.3), bottom: lighter(BACKDROPS[bdIndex].bottom, 0.2) } : BACKDROPS[bdIndex];
  const tilt = art.flat ? (r() - 0.5) * 8 : 0;
  // Subject area: 72% × 52% of the frame, centred slightly above the middle (fits a centred square crop).
  const base = { cx: W / 2, cy: H * 0.5, maxW: W * 0.72, maxH: H * 0.52 };
  const scene =
    view === 0
      ? place(art, box, { ...base, rotate: tilt })
      : view === 1
        ? place(art, box, { ...base, zoom: 0.92, mirror: true, rotate: -tilt })
        : view === 2
          ? place(art, box, { ...base, zoom: 1.4, focus: [r() < 0.5 ? -0.1 : 0.1, -0.08], rotate: tilt })
          : place(art, box, { ...base, zoom: 0.8, rotate: tilt + (art.flat ? 6 : 0) });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${DEFS}${backdrop(W, H, bd)}${scene}${finish(W, H)}</svg>`;
}

export async function productArtJpeg(opts: { title: string; shape: Shape; seed: number; view: number }): Promise<Uint8Array> {
  const buf = await sharp(Buffer.from(await productArtSvg(opts))).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  return new Uint8Array(buf);
}

/** Wide hero banner (2400×1100): a helmet and canteen on the right, a cross lying in front; left kept calm for the text card. */
export async function heroArtJpeg(): Promise<Uint8Array> {
  const W = 2400;
  const H = 1100;
  const helm = helmet("Stahlhelm M35 field grey");
  const flask = canteen("Feldflasche M31 with bakelite cup");
  const cross = badge("Iron Cross 2nd class 1914");
  const book = documentArt("Soldbuch Heer");
  const [bh, bf, bc, bb] = await Promise.all([measure(helm.body), measure(flask.body), measure(cross.body), measure(book.body)]);
  const lying = (art: Art, box: Box, cx: number, cy: number, w: number, rot: number) => {
    const s = w / box.w;
    const tf = `translate(${cx} ${cy}) scale(1 .55) rotate(${rot}) scale(${f(s * 1000) / 1000}) translate(${f(-(box.x + box.w / 2))} ${f(-(box.y + box.h / 2))})`;
    return `<g transform="${tf}" filter="url(#drop)">${art.body}</g><g transform="${tf}">${art.body}</g>`;
  };
  const scene =
    place(flask, bf, { cx: 2060, cy: 590, maxW: 330, maxH: 420 }) +
    lying(book, bb, 1390, 860, 360, -24) +
    place(helm, bh, { cx: 1640, cy: 600, maxW: 720, maxH: 470 }) +
    lying(cross, bc, 1980, 900, 300, 18);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${DEFS}${backdrop(W, H, { top: "#EFEBE3", bottom: "#E2DBCF" }, 0.55)}<rect y="${H * 0.6}" width="${W}" height="${H * 0.4}" fill="#000" opacity=".025"/>${scene}${finish(W, H)}</svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).jpeg({ quality: 86, mozjpeg: true }).toBuffer());
}

/** 3:2 flat lay (1800×1200): a certificate card with seal and QR code next to a medal and a photo. */
export async function provenanceArtJpeg(): Promise<Uint8Array> {
  const W = 1800;
  const H = 1200;
  const r = rng(1944);
  // QR-like module grid (21×21) with three finder patterns.
  const N = 21;
  const cell = 9;
  let qr = "";
  const finder = (x: number, y: number) =>
    `<rect x="${x * cell}" y="${y * cell}" width="${7 * cell}" height="${7 * cell}" fill="#1E1E1C"/><rect x="${(x + 1) * cell}" y="${(y + 1) * cell}" width="${5 * cell}" height="${5 * cell}" fill="#FBF9F4"/><rect x="${(x + 2) * cell}" y="${(y + 2) * cell}" width="${3 * cell}" height="${3 * cell}" fill="#1E1E1C"/>`;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const inFinder = (x < 8 && y < 8) || (x > N - 9 && y < 8) || (x < 8 && y > N - 9);
      if (!inFinder && r() < 0.48) qr += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}" fill="#1E1E1C"/>`;
    }
  qr += finder(0, 0) + finder(N - 7, 0) + finder(0, N - 7);
  const bar = (x: number, y: number, w: number, h = 10, o = 0.5) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="#3A3833" opacity="${o}"/>`;
  const certificate =
    L(rr(-380, -500, 760, 1000, 6), "#FBF9F4") +
    S(rr(-344, -464, 688, 928, 4), "#B39253", 3, 'opacity=".7"') +
    bar(-280, -380, 380, 22, 0.75) +
    bar(-280, -330, 260, 12, 0.4) +
    P(rr(-280, -270, 250, 200, 3), COL.sepia) +
    P("M-280,-70 L-280,-130 C-220,-180 -140,-120 -30,-170 L-30,-70 Z", darker(COL.sepia, 0.2)) +
    [0, 1, 2, 3, 4].map((i) => bar(10, -260 + i * 40, 230 - (i % 2) * 70, 10, 0.4)).join("") +
    [0, 1, 2, 3, 4, 5].map((i) => bar(-280, -10 + i * 40, 560 - (i % 3) * 90, 10, 0.35)).join("") +
    `<g transform="translate(110 250)">${qr}</g>` +
    M(ellipseD(-190, 330, 74, 74), "#B39253") +
    S(ellipseD(-190, 330, 56, 56), darker("#B39253", 0.25), 4, 'opacity=".6"') +
    bar(-280, 430, 200, 6, 0.4);
  const cross = badge("Iron Cross 2nd class 1914");
  const photo = photoArt("Studio portrait");
  const [bc, bp] = await Promise.all([measure(cross.body), measure(photo.body)]);
  const scene =
    place(photo, bp, { cx: 1450, cy: 300, maxW: 260, maxH: 340, rotate: 9 }) +
    `<g transform="translate(720 610) rotate(-4) scale(.98)" filter="url(#drop)">${certificate}</g><g transform="translate(720 610) rotate(-4) scale(.98)">${certificate}</g>` +
    place(cross, bc, { cx: 1400, cy: 830, maxW: 340, maxH: 470, rotate: 14 });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${DEFS}${backdrop(W, H, { top: "#ECE8E1", bottom: "#E4DED4" }, 0.5)}${scene}${finish(W, H)}</svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).jpeg({ quality: 86, mozjpeg: true }).toBuffer());
}

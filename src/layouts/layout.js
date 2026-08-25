/**
 * Parse ZMK zmk,physical-layout keys from a .dtsi.
 * Each key is <&key_physical_attrs w h x y r rx ry> in centikey units (100 = 1u).
 */

export function parsePhysicalLayout(dtsi) {
  const keys = [];
  const re =
    /&key_physical_attrs\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/g;
  let match;
  while ((match = re.exec(dtsi))) {
    keys.push({
      w: Number(match[1]),
      h: Number(match[2]),
      x: Number(match[3]),
      y: Number(match[4]),
      r: Number(match[5]),
      rx: Number(match[6]),
      ry: Number(match[7]),
    });
  }
  return keys;
}

/** RC(row, col) cells from the longest zmk,matrix-transform map in a dtsi. */
export function parseMatrixTransform(dtsi) {
  const maps = [];
  const blockRe = /compatible\s*=\s*"zmk,matrix-transform"[\s\S]*?map\s*=\s*<([^>]+)>/gi;
  let block;
  while ((block = blockRe.exec(dtsi))) {
    const cells = [];
    const cellRe = /RC\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/g;
    let cell;
    while ((cell = cellRe.exec(block[1]))) {
      cells.push({ row: Number(cell[1]), col: Number(cell[2]) });
    }
    if (cells.length) maps.push(cells);
  }
  maps.sort((a, b) => b.length - a.length);
  return maps[0] || [];
}

export function keysFromMatrixMap(cells, gap = 160) {
  if (!cells?.length) return [];
  const cols = cells.map((c) => c.col);
  const minC = Math.min(...cols);
  const maxC = Math.max(...cols);
  const split = maxC - minC >= 4;
  const mid = (minC + maxC) / 2;
  return cells.map((c) => {
    const right = split && c.col > mid;
    const x = c.col * 110 + (right ? gap : 0);
    return {
      w: 100,
      h: 100,
      x,
      y: c.row * 110,
      r: 0,
      rx: 0,
      ry: 0,
      hand: right ? "right" : "left",
    };
  });
}

export function parseDtsiLayout(dtsi) {
  const physical = parsePhysicalLayout(dtsi);
  const transform = parseMatrixTransform(dtsi);
  const display = (String(dtsi).match(/display-name\s*=\s*"([^"]+)"/) || [])[1] || "";
  if (physical.length) {
    return { keys: physical, transform, display, source: "physical" };
  }
  if (transform.length) {
    return { keys: keysFromMatrixMap(transform), transform, display, source: "transform" };
  }
  return { keys: [], transform, display, source: null };
}

export function profileFromDtsi(dtsi, opts = {}) {
  const parsed = parseDtsiLayout(dtsi);
  if (!parsed.keys.length) {
    throw new Error("No key_physical_attrs positions or matrix-transform map in that .dtsi.");
  }
  const name = opts.name || parsed.display || "Imported layout";
  return profileFromPhysicalKeys(parsed.keys, { ...opts, name });
}

export function layoutBounds(keys, pad = 40) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const k of keys) {
    minX = Math.min(minX, k.x);
    minY = Math.min(minY, k.y);
    maxX = Math.max(maxX, k.x + k.w);
    maxY = Math.max(maxY, k.y + k.h);
  }
  return {
    minX: minX - pad,
    minY: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

/** Built-in layout profiles shipped with the editor. */
export const PROFILE_INDEX = [{ id: "totem", name: "Totem", url: "../../layouts/totem.json" }];

export function normalizeProfile(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Invalid layout profile.");
  const keys = (raw.keys || []).map((k) => ({
    w: Number(k.w),
    h: Number(k.h),
    x: Number(k.x),
    y: Number(k.y),
    r: Number(k.r || 0),
    rx: Number(k.rx || 0),
    ry: Number(k.ry || 0),
    hand: k.hand === "right" ? "right" : "left",
  }));
  const keyCount = Number(raw.keyCount || keys.length);
  if (!keyCount) throw new Error("Layout profile has no keys.");
  if (keys.length !== keyCount) {
    throw new Error(`Layout profile keyCount is ${keyCount} but keys[] has ${keys.length}.`);
  }
  const rows = Array.isArray(raw.rows) && raw.rows.length ? raw.rows.map(Number) : [keyCount];
  const rowSum = rows.reduce((a, b) => a + b, 0);
  if (rowSum !== keyCount) {
    throw new Error(`Layout rows sum to ${rowSum}, expected ${keyCount}.`);
  }
  return {
    id: String(raw.id || "keyboard"),
    name: String(raw.name || raw.id || "Keyboard"),
    keyCount,
    split: !!raw.split,
    rows,
    keys,
    homeRowBehaviors: Array.isArray(raw.homeRowBehaviors) ? raw.homeRowBehaviors.map(String) : [],
    sampleKeymap: raw.sampleKeymap || null,
  };
}

export async function loadProfile(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return normalizeProfile(await res.json());
}

export function keysFromDtsi(dtsi, hands = []) {
  return parsePhysicalLayout(dtsi).map((k, i) => ({
    ...k,
    hand: hands[i] === "right" ? "right" : "left",
  }));
}

export function inferRowCounts(keys, slop = 50) {
  if (!keys?.length) return [];
  const ordered = keys.map((k, i) => ({ k, i }));
  ordered.sort((a, b) => a.k.y - b.k.y || a.k.x - b.k.x || a.i - b.i);
  const rows = [];
  let row = [ordered[0]];
  for (let n = 1; n < ordered.length; n++) {
    if (Math.abs(ordered[n].k.y - row[0].k.y) <= slop) row.push(ordered[n]);
    else {
      rows.push(row.length);
      row = [ordered[n]];
    }
  }
  rows.push(row.length);
  return rows;
}

export function inferHands(keys) {
  if (!keys?.length) return [];
  const centers = keys.map((k) => k.x + k.w / 2);
  const min = Math.min(...centers);
  const max = Math.max(...centers);
  if (max - min < 200) return keys.map(() => "left");
  const mid = (min + max) / 2;
  const leftN = keys.filter((k) => k.x + k.w / 2 < mid).length;
  if (!leftN || leftN === keys.length) return keys.map(() => "left");
  return keys.map((k) => (k.x + k.w / 2 < mid ? "left" : "right"));
}

export function profileFromPhysicalKeys(keys, opts = {}) {
  const raw = (keys || []).map((k, i) => ({
    w: Number(k.w),
    h: Number(k.h),
    x: Number(k.x),
    y: Number(k.y),
    r: Number(k.r || 0),
    rx: Number(k.rx || 0),
    ry: Number(k.ry || 0),
    hand: k.hand || null,
  }));
  const hands = raw.some((k) => k.hand) ? raw.map((k) => k.hand) : inferHands(raw);
  const withHands = raw.map((k, i) => ({ ...k, hand: hands[i] === "right" ? "right" : "left" }));
  return normalizeProfile({
    id: opts.id || "imported",
    name: opts.name || "Imported layout",
    keyCount: withHands.length,
    split: withHands.some((k) => k.hand === "left") && withHands.some((k) => k.hand === "right"),
    rows: opts.rows || inferRowCounts(withHands),
    keys: withHands,
    homeRowBehaviors: opts.homeRowBehaviors || [],
    sampleKeymap: opts.sampleKeymap || null,
  });
}

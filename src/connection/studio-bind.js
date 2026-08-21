/**
 * Map .keymap tokens onto Studio BehaviorBinding cells.
 * HID numbers match ZMK keys.h / modifiers.h.
 */

const KEY = 0x07;
const CON = 0x0C;
const hid = (page, id) => (page << 16) | id;
const LS = (usage) => (0x02 << 24) | usage;
const MOD_WRAP = {
  LC: 0x01,
  LS: 0x02,
  LA: 0x04,
  LG: 0x08,
  RC: 0x10,
  RS: 0x20,
  RA: 0x40,
  RG: 0x80,
};

const KEY_IDS = {
  A: 0x04, B: 0x05, C: 0x06, D: 0x07, E: 0x08, F: 0x09, G: 0x0a, H: 0x0b,
  I: 0x0c, J: 0x0d, K: 0x0e, L: 0x0f, M: 0x10, N: 0x11, O: 0x12, P: 0x13,
  Q: 0x14, R: 0x15, S: 0x16, T: 0x17, U: 0x18, V: 0x19, W: 0x1a, X: 0x1b,
  Y: 0x1c, Z: 0x1d,
  N1: 0x1e, N2: 0x1f, N3: 0x20, N4: 0x21, N5: 0x22,
  N6: 0x23, N7: 0x24, N8: 0x25, N9: 0x26, N0: 0x27,
  ENTER: 0x28, ESC: 0x29, BSPC: 0x2a, TAB: 0x2b, SPACE: 0x2c,
  MINUS: 0x2d, EQUAL: 0x2e, LBKT: 0x2f, RBKT: 0x30, BSLH: 0x31,
  SEMI: 0x33, SQT: 0x34, GRAVE: 0x35, COMMA: 0x36, DOT: 0x37, FSLH: 0x38,
  CAPS: 0x39,
  F1: 0x3a, F2: 0x3b, F3: 0x3c, F4: 0x3d, F5: 0x3e, F6: 0x3f,
  F7: 0x40, F8: 0x41, F9: 0x42, F10: 0x43, F11: 0x44, F12: 0x45,
  PSCRN: 0x46, INS: 0x49, HOME: 0x4a, PG_UP: 0x4b, DEL: 0x4c,
  END: 0x4d, PG_DN: 0x4e, RIGHT: 0x4f, LEFT: 0x50, DOWN: 0x51, UP: 0x52,
  K_UNDO: 0x7a,
  LCTRL: 0xe0, LSHFT: 0xe1, LALT: 0xe2, LGUI: 0xe3,
  RCTRL: 0xe4, RSHFT: 0xe5, RALT: 0xe6, RGUI: 0xe7,
};

const NAMED = {};
for (const [name, id] of Object.entries(KEY_IDS)) NAMED[name] = hid(KEY, id);
NAMED.RETURN = NAMED.ENTER;
NAMED.ESCAPE = NAMED.ESC;
NAMED.BACKSPACE = NAMED.BSPC;
NAMED.PRINTSCREEN = NAMED.PSCRN;
NAMED.INSERT = NAMED.INS;
NAMED.PAGE_UP = NAMED.PG_UP;
NAMED.PAGE_DOWN = NAMED.PG_DN;
NAMED.DELETE = NAMED.DEL;
NAMED.LEFT_CONTROL = NAMED.LCTRL;
NAMED.LEFT_SHIFT = NAMED.LSHFT;
NAMED.LSHIFT = NAMED.LSHFT;
NAMED.LEFT_ALT = NAMED.LALT;
NAMED.LEFT_GUI = NAMED.LGUI;
NAMED.RIGHT_CONTROL = NAMED.RCTRL;
NAMED.RIGHT_SHIFT = NAMED.RSHFT;
NAMED.RSHIFT = NAMED.RSHFT;
NAMED.RIGHT_ALT = NAMED.RALT;
NAMED.RIGHT_GUI = NAMED.RGUI;
NAMED.EXCL = LS(NAMED.N1);
NAMED.AT = LS(NAMED.N2);
NAMED.HASH = LS(NAMED.N3);
NAMED.DLLR = LS(NAMED.N4);
NAMED.DOLLAR = NAMED.DLLR;
NAMED.PRCNT = LS(NAMED.N5);
NAMED.PERCENT = NAMED.PRCNT;
NAMED.CARET = LS(NAMED.N6);
NAMED.AMPS = LS(NAMED.N7);
NAMED.STAR = LS(NAMED.N8);
NAMED.ASTRK = NAMED.STAR;
NAMED.LPAR = LS(NAMED.N9);
NAMED.RPAR = LS(NAMED.N0);
NAMED.UNDER = LS(NAMED.MINUS);
NAMED.PLUS = LS(NAMED.EQUAL);
NAMED.PIPE = LS(NAMED.BSLH);
NAMED.DQT = LS(NAMED.SQT);
NAMED.TILDE = LS(NAMED.GRAVE);
NAMED.C_MUTE = hid(CON, 0xe2);
NAMED.C_VOL_UP = hid(CON, 0xe9);
NAMED.C_VOL_DN = hid(CON, 0xea);
NAMED.C_PP = hid(CON, 0xcd);
NAMED.C_NEXT = hid(CON, 0xb5);
NAMED.C_PREV = hid(CON, 0xb6);
NAMED.C_PREVIOUS = NAMED.C_PREV;
NAMED.C_BRI_UP = hid(CON, 0x6f);
NAMED.C_BRI_INC = NAMED.C_BRI_UP;
NAMED.C_BRI_DN = hid(CON, 0x70);
NAMED.C_BRI_DEC = NAMED.C_BRI_DN;

export const BT_CMD = {
  BT_CLR: 0,
  BT_NXT: 1,
  BT_PRV: 2,
  BT_SEL: 3,
  BT_CLR_ALL: 4,
  BT_DISC: 5,
};

/** ZMK pointing.h with default MOVE_VAL=600, SCRL_VAL=10 (uint32 encoded). */
const u16 = (n) => n & 0xffff;
const moveX = (hor) => (u16(hor) << 16) >>> 0;
const moveY = (vert) => u16(vert) >>> 0;
const MOVE_VAL = 600;
const SCRL_VAL = 10;

export const MOUSE_MOVE = {
  MOVE_UP: moveY(-MOVE_VAL),
  MOVE_DOWN: moveY(MOVE_VAL),
  MOVE_LEFT: moveX(-MOVE_VAL),
  MOVE_RIGHT: moveX(MOVE_VAL),
};

export const MOUSE_SCROLL = {
  SCRL_UP: moveY(SCRL_VAL),
  SCRL_DOWN: moveY(-SCRL_VAL),
  SCRL_LEFT: moveX(-SCRL_VAL),
  SCRL_RIGHT: moveX(SCRL_VAL),
};

export const MOUSE_BTN = {
  LCLK: 1,
  MB1: 1,
  RCLK: 2,
  MB2: 2,
  MCLK: 4,
  MB3: 4,
  MB4: 8,
  MB5: 16,
};

const MOUSE_CMD = { ...MOUSE_MOVE, ...MOUSE_SCROLL, ...MOUSE_BTN };

function nameFromTable(value, table, prefer = []) {
  const n = Number(value) >>> 0;
  const hits = Object.entries(table).filter(([, v]) => (v >>> 0) === n).map(([k]) => k);
  if (!hits.length) return null;
  for (const p of prefer) if (hits.includes(p)) return p;
  return hits[0];
}

const BEHAVIOR_ALIASES = {
  kp: ["key press", "kp", "key_press"],
  trans: ["transparent", "trans"],
  none: ["none"],
  mo: ["momentary layer", "mo", "momentary"],
  to: ["to layer", "to"],
  tog: ["toggle layer", "tog"],
  lt: ["layer tap", "layer-tap", "lt"],
  sl: ["sticky layer", "sticky-layer", "sl"],
  bt: ["bluetooth", "bt"],
  sk: ["sticky key", "sticky-key", "sticky", "sk", "one shot", "oneshot"],
  mt: ["mod tap", "mod-tap", "mt"],
  hml: ["hml", "homerow mods left", "homerow_mods_left"],
  hmr: ["hmr", "homerow mods right", "homerow_mods_right"],
  sys_reset: ["sys_reset", "sysreset", "system reset", "soft reset", "reset"],
  bootloader: ["bootloader", "bootload", "uf2"],
  host_log_dump: ["host_log_dump", "host log dump", "log dump"],
  mac_lock: ["mac_lock", "mac lock"],
  win_lock: ["win_lock", "win lock"],
  studio_unlock: ["studio_unlock", "studio unlock", "unlock"],
  msc: ["mouse scroll", "mouse_scroll", "mousescroll", "scroll", "msc"],
  mmv: ["move mouse", "mouse move", "mouse_move", "mousemove", "mmv"],
  mkp: ["mouse key press", "mouse button", "mouse_key_press", "mouse click", "mkp"],
  rt: ["rt", "runtime object", "runtime_object"],
};

const HID_ALIASES = {
  LSHIFT: "LSHFT",
  LSFT: "LSHFT",
  LEFTSHIFT: "LSHFT",
  RSHIFT: "RSHFT",
  RSFT: "RSHFT",
  RIGHTSHIFT: "RSHFT",
  LCTL: "LCTRL",
  LCONTROL: "LCTRL",
  RCTL: "RCTRL",
  RCONTROL: "RCTRL",
  LOPTION: "LALT",
  ROPTION: "RALT",
  LCMD: "LGUI",
  LWIN: "LGUI",
  RCMD: "RGUI",
  RWIN: "RGUI",
};

export function parseBindingText(text) {
  const src = String(text || "").trim();
  const m = src.match(/^&([A-Za-z_][A-Za-z0-9_]*)(.*)$/);
  if (!m) return null;
  const name = m[1];
  const rest = m[2].trim();
  const args = [];
  let i = 0;
  while (i < rest.length) {
    while (i < rest.length && /[ \t]/.test(rest[i])) i++;
    if (i >= rest.length) break;
    const start = i;
    if (/[A-Za-z_]/.test(rest[i])) {
      i++;
      while (i < rest.length && /[A-Za-z0-9_]/.test(rest[i])) i++;
      if (rest[i] === "(") {
        let depth = 1;
        i++;
        while (i < rest.length && depth) {
          if (rest[i] === "(") depth++;
          else if (rest[i] === ")") depth--;
          i++;
        }
      }
      args.push(rest.slice(start, i));
    } else if (/\d/.test(rest[i])) {
      while (i < rest.length && /\d/.test(rest[i])) i++;
      args.push(rest.slice(start, i));
    } else {
      i++;
    }
  }
  return { name, args };
}

export function hidUsage(token) {
  if (token == null || token === "") return null;
  let t = String(token).trim();
  const wrap = t.match(/^(LC|LS|LA|LG|RC|RS|RA|RG)\((.+)\)$/);
  if (wrap) {
    const inner = hidUsage(wrap[2]);
    if (inner == null) return null;
    return (MOD_WRAP[wrap[1]] << 24) | inner;
  }
  if (/^\d+$/.test(t)) return Number(t);
  t = HID_ALIASES[t.toUpperCase()] || t;
  const upper = t.toUpperCase();
  if (NAMED[upper] != null) return NAMED[upper];
  if (NAMED[t] != null) return NAMED[t];
  if (/^[A-Z]$/.test(upper)) return NAMED[upper];
  if (/^N[0-9]$/.test(upper) && NAMED[upper] != null) return NAMED[upper];
  if (/^F([1-9]|1[0-2])$/.test(upper)) return NAMED[upper];
  return null;
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function behaviorMatchScore(displayName, dtsName) {
  const dn = norm(displayName);
  const compact = dn.replace(/\s+/g, "");
  const want = norm(dtsName);
  const wantCompact = want.replace(/\s+/g, "");
  const aliases = (BEHAVIOR_ALIASES[dtsName] || [dtsName]).map(norm);
  if (!dn && !compact) return 0;
  if (dn === want || compact === wantCompact) return 100;
  if (aliases.includes(dn) || aliases.some((a) => a.replace(/\s+/g, "") === compact)) return 100;
  if (dtsName === "sk" && /\bsticky\b/.test(dn) && /\bkey\b/.test(dn) && !/\blayer\b/.test(dn)) return 90;
  if (dtsName === "sl" && /\bsticky\b/.test(dn) && /\blayer\b/.test(dn)) return 90;
  if (dtsName === "sys_reset" && /^(soft )?reset$/.test(dn) && !/boot/.test(dn)) return 90;
  if (dtsName === "hml" && /homerow/.test(dn) && /left/.test(dn)) return 90;
  if (dtsName === "hmr" && /homerow/.test(dn) && /right/.test(dn)) return 90;
  if (dtsName === "mmv" && /mouse/.test(dn) && /move/.test(dn) && !/scroll/.test(dn)) return 90;
  if (dtsName === "msc" && (/scroll/.test(dn) || (/mouse/.test(dn) && /wheel/.test(dn)))) return 90;
  if (dtsName === "mkp" && /mouse/.test(dn) && /press|button|click/.test(dn)) return 90;
  let best = 0;
  for (const a of aliases) {
    const words = a.split(" ").filter((w) => w.length > 1);
    if (words.length && words.every((w) => new RegExp(`(?:^| )${w}(?: |$)`).test(dn))) {
      best = Math.max(best, 40 + words.length * 10);
    }
  }
  return best;
}

const KNOWN_NON_MOUSE = new Set([
  "kp",
  "trans",
  "none",
  "mo",
  "to",
  "tog",
  "lt",
  "sl",
  "bt",
  "sk",
  "mt",
  "hml",
  "hmr",
  "sys_reset",
  "bootloader",
  "host_log_dump",
  "mac_lock",
  "win_lock",
  "studio_unlock",
  "mkp",
]);

function namedDts(behavior) {
  let best = "";
  let bestScore = 0;
  for (const dts of Object.keys(BEHAVIOR_ALIASES)) {
    const score = behaviorMatchScore(behavior.displayName, dts);
    if (score > bestScore) {
      best = dts;
      bestScore = score;
    }
  }
  if (bestScore >= 40) return best;
  const k = paramKinds(behavior.param1);
  if (["LCLK", "RCLK", "MB1", "MB4"].some((n) => k.constants.has(n))) return "mkp";
  if (["MOVE_UP", "MOVE_LEFT"].some((n) => k.constants.has(n))) return "mmv";
  if (["SCRL_UP", "SCRL_LEFT"].some((n) => k.constants.has(n))) return "msc";
  return "";
}

function isZeroCellBehavior(behavior) {
  const p1 = paramKinds(behavior.param1);
  const p2 = paramKinds(behavior.param2);
  return p1.nil && !p1.hid && !p1.layer && !p1.constants.size && !p2.hid && !p2.layer && !p2.constants.size;
}

/** Classify a Studio behavior as mmv, msc, a generic two-axis, or not a mouse axis. */
function twoAxisHint(behavior) {
  const named = namedDts(behavior);
  if (named === "mmv" || named === "msc") return named;
  if (named && KNOWN_NON_MOUSE.has(named)) return null;
  const p1 = paramKinds(behavior.param1);
  if (p1.hid || p1.layer) return null;
  if (isZeroCellBehavior(behavior)) return null;
  const dn = norm(behavior.displayName);
  if (/scroll|wheel/.test(dn) && !/move/.test(dn)) return "msc";
  if ((/mouse/.test(dn) && /move/.test(dn)) || dn === "mmv") return "mmv";
  if (/input two axis|two axis/.test(dn) || dn === "zmk behavior input two axis") return "axis";
  if (!dn) return "axis";
  if (!named) return "axis";
  return null;
}

function findBehaviorByShape(behaviors, dtsName) {
  const list = behaviors || [];
  const hasConst = (b, names) => {
    const k = paramKinds(b.param1);
    return names.some((n) => k.constants.has(n));
  };
  if (dtsName === "mkp") {
    return (
      list.find((b) => hasConst(b, ["LCLK", "RCLK", "MB1", "MB2"])) ||
      list.find((b) => /mouse/.test(norm(b.displayName)) && /press|button|click|key/.test(norm(b.displayName)))
    );
  }
  if (dtsName === "mmv") {
    return list.find((b) => hasConst(b, ["MOVE_UP", "MOVE_LEFT", "MOVE_DOWN", "MOVE_RIGHT"])) || pairTwoAxis(list).mmv;
  }
  if (dtsName === "msc") {
    return list.find((b) => hasConst(b, ["SCRL_UP", "SCRL_LEFT", "SCRL_DOWN", "SCRL_RIGHT"])) || pairTwoAxis(list).msc;
  }
  return null;
}

function pairTwoAxis(behaviors) {
  const cands = (behaviors || [])
    .map((b) => ({ b, hint: twoAxisHint(b) }))
    .filter((x) => x.hint)
    .sort((a, b) => a.b.id - b.b.id);
  const out = { mmv: null, msc: null };
  for (const { b, hint } of cands) {
    if (hint === "mmv" && !out.mmv) out.mmv = b;
    if (hint === "msc" && !out.msc) out.msc = b;
  }
  const unused = cands.filter((x) => x.b !== out.mmv && x.b !== out.msc);
  if (!out.mmv && unused[0]) out.mmv = unused.shift().b;
  if (!out.msc && unused[0]) out.msc = unused.shift().b;
  return out;
}

let inferredBehaviorIds = {};

export function setInferredBehaviorIds(map) {
  inferredBehaviorIds = { ...(map || {}) };
}

function cellStudioId(cell, behaviors) {
  // `behaviorId` is the decoded sint32 value. `rawBehaviorId` is only the
  // protobuf wire value and may coincidentally equal another behavior's local
  // ID (for example zigzag(7) === 14). Always use the logical value first.
  const logical = Number(cell?.behaviorId);
  const raw = Number(cell?.rawBehaviorId);
  const listed = (behaviors || []).map((b) => b.id);
  if (listed.includes(logical)) return logical;
  if (listed.includes(raw)) return raw;
  return Number.isFinite(logical) ? logical : raw;
}

function cellBehaviorIsNonMouse(cell, behaviors) {
  const b = findBehaviorById(behaviors, cell);
  if (!b) return false;
  const named = namedDts(b);
  if (named === "mmv" || named === "msc") return false;
  if (named && KNOWN_NON_MOUSE.has(named)) return true;
  const p1 = paramKinds(b.param1);
  return !!(p1.hid || p1.layer);
}

export function inferBehaviorIdsFromKeymap(studioLayers, behaviors = []) {
  const found = {};
  const take = (name, cell) => {
    if (found[name] != null) return;
    const id = cellStudioId(cell, behaviors);
    if (id != null && !Number.isNaN(id)) found[name] = id;
  };
  for (const layer of studioLayers || []) {
    for (const cell of layer.bindings || []) {
      if (!cell) continue;
      if (nameFromTable(cell.param1, MOUSE_MOVE)) {
        if (!cellBehaviorIsNonMouse(cell, behaviors)) take("mmv", cell);
      } else if (nameFromTable(cell.param1, MOUSE_SCROLL)) {
        if (!cellBehaviorIsNonMouse(cell, behaviors)) take("msc", cell);
      } else if (nameFromTable(cell.param1, { MB4: 8, MB5: 16 })) take("mkp", cell);
    }
  }
  return found;
}

function guessUnnamedMouseIds(behaviors) {
  const pair = pairTwoAxis(behaviors);
  const out = {};
  if (pair.mmv) out.mmv = pair.mmv.id;
  if (pair.msc) out.msc = pair.msc.id;
  return out;
}

export function rememberStudioBehaviors(behaviors, studioLayers) {
  const guessed = guessUnnamedMouseIds(behaviors);
  const inferred = inferBehaviorIdsFromKeymap(studioLayers, behaviors);
  // A live keymap is stronger evidence than ID ordering. Local IDs are
  // persisted by ZMK and are not semantic, so the two generic input-axis
  // behaviors cannot safely be assigned by sorting their IDs.
  const remembered = { ...guessed, ...inferred };
  setInferredBehaviorIds(remembered);
  return remembered;
}

function syntheticBehavior(id, dtsName) {
  return { id, displayName: dtsName, param1: [], param2: [] };
}

export function findBehavior(behaviors, dtsName) {
  let best = null;
  let bestScore = 0;
  for (const b of behaviors || []) {
    const score = behaviorMatchScore(b.displayName, dtsName);
    if (score > bestScore) {
      best = b;
      bestScore = score;
    }
  }
  if (bestScore >= 40) return best;
  let inferred = inferredBehaviorIds[dtsName];
  if (inferred != null) {
    return (behaviors || []).find((b) => b.id === inferred) || syntheticBehavior(inferred, dtsName);
  }
  const shaped = findBehaviorByShape(behaviors, dtsName);
  if (shaped) return shaped;
  if (dtsName === "mmv" || dtsName === "msc") {
    inferred = guessUnnamedMouseIds(behaviors)[dtsName];
    if (inferred != null) {
      return (behaviors || []).find((b) => b.id === inferred) || syntheticBehavior(inferred, dtsName);
    }
  }
  return null;
}

function paramKinds(descs) {
  const kinds = { hid: false, layer: false, constants: new Map(), nil: false };
  for (const d of descs || []) {
    if (d.hid) kinds.hid = true;
    if (d.layer) kinds.layer = true;
    if (d.nil) kinds.nil = true;
    if (d.constant != null && d.name) kinds.constants.set(d.name.toUpperCase(), d.constant);
  }
  return kinds;
}

function layerNameKey(raw) {
  return String(raw || "")
    .replace(/_layer$/i, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function resolveLayerId(token, layers) {
  if (token == null) return null;
  const t = String(token).trim();
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    const byId = (layers || []).find((l) => l.id === n);
    return byId ? byId.id : n;
  }
  const name = layerNameKey(t);
  for (const l of layers || []) {
    if (layerNameKey(l.name) === name || layerNameKey(l.id) === name) return l.id;
  }
  return null;
}

function encodeArg(token, kinds, layers) {
  if (token == null) return 0;
  const upper = String(token).toUpperCase();
  if (kinds.constants.has(upper)) return kinds.constants.get(upper);
  if (MOUSE_CMD[upper] != null) return MOUSE_CMD[upper] >>> 0;
  if (BT_CMD[upper] != null && !kinds.hid && !kinds.layer) return BT_CMD[upper];
  if (kinds.hid) {
    const u = hidUsage(token);
    if (u == null) throw new Error(`Unknown HID token ${token}`);
    return u;
  }
  if (kinds.layer) {
    const id = resolveLayerId(token, layers);
    if (id == null) throw new Error(`Unknown layer ${token}`);
    return id;
  }
  if (/^\d+$/.test(token)) return Number(token);
  const hid = hidUsage(token);
  if (hid != null) return hid;
  const layer = resolveLayerId(token, layers);
  if (layer != null) return layer;
  throw new Error(`Cannot encode ${token}`);
}

export function bindingToCells(text, behaviors, layers) {
  const parsed = parseBindingText(text);
  if (!parsed) return { ok: false, reason: "not a binding" };
  const behavior = findBehavior(behaviors, parsed.name);
  if (!behavior) return { ok: false, reason: `behavior &${parsed.name} is not in this firmware` };
  // ZMK's built-in input-two-axis driver has no parameter metadata. Studio
  // therefore rejects every non-zero binding for it during validation, even
  // though the behavior is listed and the numeric value is easy to encode.
  // Treat that as a flash-only binding instead of reporting a false live
  // success and leaving the user with an apparently empty key.
  if ((parsed.name === "mmv" || parsed.name === "msc") && !behavior.param1?.length && !behavior.param2?.length) {
    return { ok: false, reason: `behavior &${parsed.name} has no Studio parameter metadata; download and flash this change` };
  }
  const p1 = paramKinds(behavior.param1);
  const p2 = paramKinds(behavior.param2);
  try {
    const param1 = parsed.args[0] != null ? encodeArg(parsed.args[0], p1, layers) : 0;
    const param2 = parsed.args[1] != null ? encodeArg(parsed.args[1], p2, layers) : 0;
    return {
      ok: true,
      binding: { behaviorId: behavior.id, param1, param2 },
      name: parsed.name,
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

export function canApplyLive(text, behaviors, layers) {
  return bindingToCells(text, behaviors, layers).ok;
}

const USAGE_NAME = new Map();
for (const [name, id] of Object.entries(KEY_IDS)) USAGE_NAME.set(hid(KEY, id), name);
for (const [name, usage] of Object.entries(NAMED)) {
  if (!USAGE_NAME.has(usage)) USAGE_NAME.set(usage, name);
}

const MOD_BITS = [
  [0x80, "RG"],
  [0x40, "RA"],
  [0x20, "RS"],
  [0x10, "RC"],
  [0x08, "LG"],
  [0x04, "LA"],
  [0x02, "LS"],
  [0x01, "LC"],
];

export function hidToken(usage) {
  if (usage == null) return null;
  const n = Number(usage);
  if (!Number.isFinite(n) || n === 0) return null;
  if (USAGE_NAME.has(n)) return USAGE_NAME.get(n);
  // Bare usage ids like 0x04=A. Do not treat mouse packed values (SCRL_UP=10=G) as HID.
  if (n <= 0xffff && USAGE_NAME.has(hid(KEY, n))) {
    if (nameFromTable(n, MOUSE_SCROLL) || nameFromTable(n, MOUSE_MOVE) || nameFromTable(n, MOUSE_BTN)) return null;
    return USAGE_NAME.get(hid(KEY, n));
  }
  if (n <= 0xffff && USAGE_NAME.has(hid(CON, n))) return USAGE_NAME.get(hid(CON, n));
  const mods = (n >>> 24) & 0xff;
  const base = n & 0xffffff;
  let name = USAGE_NAME.get(base) || (base <= 0xffff ? USAGE_NAME.get(hid(KEY, base)) : null);
  if (!name) return null;
  for (const [bit, wrap] of MOD_BITS) {
    if (mods & bit) name = `${wrap}(${name})`;
  }
  return name;
}

export function isEmptyStudioCell(cell) {
  if (!cell) return true;
  return !Number(cell.behaviorId) && !Number(cell.param1) && !Number(cell.param2);
}

export function isPlaceholderBinding(text) {
  const parts = String(text || "").trim().split(/\s+/);
  if (!parts[0]) return true;
  if (parts[0] !== "&kp") return false;
  const key = parts.slice(1).find((p) => p && p !== "0") || parts[1];
  if (key == null || key === "0" || key === "N0" || key === "KP_0") return true;
  if (/^\d+$/.test(key)) return true;
  return false;
}

function dtsNameFromBehavior(behavior) {
  const named = namedDts(behavior);
  if (named) return named;
  const raw = String(behavior.displayName || "").trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) return raw;
  const compact = norm(behavior.displayName).replace(/\s+/g, "_");
  return compact || "kp";
}

function hidPage(value) {
  return (Number(value) >>> 16) & 0xff;
}

function decodeArg(value, kinds, layers) {
  if (kinds.constants.size) {
    for (const [name, constant] of kinds.constants) {
      if (constant === value) return name;
    }
  }
  if (kinds.layer) {
    const layer = (layers || []).find((l) => l.id === value);
    if (layer) {
      return String(layer.name || "")
        .replace(/_layer$/i, "")
        .toUpperCase() || String(value);
    }
    return String(value);
  }
  const hid = hidToken(value);
  if (kinds.hid) {
    if (hid) return hid;
    if (!value) return null;
  }
  if (hid && (hidPage(value) === KEY || hidPage(value) === CON)) return hid;
  if (!kinds.hid && !kinds.layer && !kinds.constants.size && hid) return hid;
  const mouse =
    nameFromTable(value, MOUSE_MOVE, ["MOVE_UP", "MOVE_DOWN", "MOVE_LEFT", "MOVE_RIGHT"]) ||
    nameFromTable(value, MOUSE_SCROLL, ["SCRL_UP", "SCRL_DOWN", "SCRL_LEFT", "SCRL_RIGHT"]) ||
    nameFromTable(value, MOUSE_BTN, ["LCLK", "RCLK", "MCLK", "MB4", "MB5"]);
  if (mouse) return mouse;
  return String(value);
}

function shouldEmitParam(value, kinds) {
  if (kinds.nil && !kinds.hid && !kinds.layer && !kinds.constants.size) return false;
  if (!value && kinds.hid && !kinds.layer && !kinds.constants.size) return false;
  return true;
}

function findBehaviorById(behaviors, cell) {
  const list = behaviors || [];
  const logical = Number(cell?.behaviorId);
  const raw = Number(cell?.rawBehaviorId);
  // The firmware's BehaviorBinding.behavior_id is sint32. The parser stores
  // its decoded value in behaviorId and retains the encoded value only for
  // diagnostics. Never let a raw zig-zag value select a different behavior.
  return list.find((b) => b.id === logical) || list.find((b) => b.id === raw) || null;
}

export function cellsToBinding(cell, behaviors, layers) {
  if (!cell || isEmptyStudioCell(cell)) return { ok: false, reason: "empty cell" };
  const page = hidPage(cell.param1);
  if (page !== KEY && page !== CON) {
    const asMove = nameFromTable(cell.param1, MOUSE_MOVE);
    if (asMove) return { ok: true, text: `&mmv ${asMove}` };
    const asScroll = nameFromTable(cell.param1, MOUSE_SCROLL);
    if (asScroll) return { ok: true, text: `&msc ${asScroll}` };
  }
  let behavior = findBehaviorById(behaviors, cell);
  if (!behavior) return { ok: false, reason: `unknown behavior id ${cell.behaviorId}/${cell.rawBehaviorId}` };
  let name = dtsNameFromBehavior(behavior);
  if (name === "rt" || name === "runtime_object") {
    return { ok: true, text: `&rt ${Number(cell.param1) || 0}` };
  }
  const asMove = nameFromTable(cell.param1, MOUSE_MOVE);
  const asScroll = nameFromTable(cell.param1, MOUSE_SCROLL);
  const asBtn = nameFromTable(cell.param1, MOUSE_BTN, ["LCLK", "RCLK", "MCLK", "MB4", "MB5"]);
  if (asMove && name !== "mmv") {
    const mmv = findBehavior(behaviors, "mmv");
    if (mmv) {
      behavior = mmv;
      name = "mmv";
    }
  } else if (asScroll && name !== "msc") {
    const msc = findBehavior(behaviors, "msc");
    if (msc) {
      behavior = msc;
      name = "msc";
    }
  } else if (asBtn && name !== "mkp" && !hidToken(cell.param1)) {
    const mkp = findBehavior(behaviors, "mkp");
    if (mkp) {
      behavior = mkp;
      name = "mkp";
    }
  }
  if ((name === "mmv" || name === "msc") && hidToken(cell.param1) && hidPage(cell.param1) === KEY) {
    const kp = (behaviors || []).find((b) => dtsNameFromBehavior(b) === "kp");
    if (kp) {
      behavior = kp;
      name = "kp";
    }
  }
  const p1 = paramKinds(behavior.param1);
  const p2 = paramKinds(behavior.param2);
  const args = [];
  if (shouldEmitParam(cell.param1, p1)) {
    const a = decodeArg(cell.param1, p1, layers);
    if (a != null && a !== "") args.push(a);
  }
  if (shouldEmitParam(cell.param2, p2)) {
    const a = decodeArg(cell.param2, p2, layers);
    if (a != null && a !== "") args.push(a);
  }
  if (name === "bt") {
    const cmd = Object.entries(BT_CMD).find(([, v]) => v === Number(cell.param1));
    if (cmd) args[0] = cmd[0];
    if (args[0] === "BT_SEL" && args[1] == null) args[1] = String(Number(cell.param2) || 0);
  }
  if (name === "mmv" || name === "msc" || name === "mkp") {
    const table = name === "mmv" ? MOUSE_MOVE : name === "msc" ? MOUSE_SCROLL : MOUSE_BTN;
    const prefer = name === "mkp" ? ["LCLK", "RCLK", "MCLK", "MB4", "MB5"] : Object.keys(table);
    const tok = nameFromTable(cell.param1, table, prefer);
    if (tok) args[0] = tok;
  }
  if (name === "kp" && args.length > 1 && args[args.length - 1] === "0") args.pop();
  const text = args.length ? `&${name} ${args.join(" ")}` : `&${name}`;
  if (isPlaceholderBinding(text)) return { ok: false, reason: "placeholder binding", text };
  return { ok: true, text };
}

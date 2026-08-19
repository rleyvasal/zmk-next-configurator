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

const BEHAVIOR_ALIASES = {
  kp: ["key press", "kp", "key_press"],
  trans: ["transparent", "trans"],
  none: ["none"],
  mo: ["momentary layer", "mo", "momentary"],
  to: ["to layer", "to"],
  tog: ["toggle layer", "tog"],
  lt: ["layer tap", "layer-tap", "lt"],
  sl: ["sticky layer", "sl"],
  bt: ["bluetooth", "bt"],
  sk: ["sticky key", "sk"],
  hml: ["hml", "homerow_mods_left"],
  hmr: ["hmr", "homerow_mods_right"],
  sys_reset: ["sys_reset", "system reset", "reset"],
  host_log_dump: ["host_log_dump", "host log dump"],
  mac_lock: ["mac_lock", "mac lock"],
  win_lock: ["win_lock", "win lock"],
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
  const t = String(token).trim();
  const wrap = t.match(/^(LC|LS|LA|LG|RC|RS|RA|RG)\((.+)\)$/);
  if (wrap) {
    const inner = hidUsage(wrap[2]);
    if (inner == null) return null;
    return (MOD_WRAP[wrap[1]] << 24) | inner;
  }
  if (/^\d+$/.test(t)) return Number(t);
  if (NAMED[t] != null) return NAMED[t];
  if (/^[A-Z]$/.test(t)) return NAMED[t];
  if (/^N[0-9]$/.test(t) && NAMED[t] != null) return NAMED[t];
  if (/^F([1-9]|1[0-2])$/.test(t)) return NAMED[t];
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

export function findBehavior(behaviors, dtsName) {
  const want = norm(dtsName);
  const aliases = (BEHAVIOR_ALIASES[dtsName] || [dtsName]).map(norm);
  const aliasCompact = new Set(aliases.map((a) => a.replace(/\s+/g, "")));
  for (const b of behaviors) {
    const dn = norm(b.displayName);
    const compact = dn.replace(/\s+/g, "");
    if (dn === want || compact === want) return b;
    if (aliases.includes(dn) || aliasCompact.has(compact)) return b;
    if (want === "hml" && /homerow/.test(dn) && /left/.test(dn)) return b;
    if (want === "hmr" && /homerow/.test(dn) && /right/.test(dn)) return b;
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

export function resolveLayerId(token, layers) {
  if (token == null) return null;
  const t = String(token).trim();
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    const byId = layers.find((l) => l.id === n);
    return byId ? byId.id : n;
  }
  const name = t.replace(/_layer$/i, "").toUpperCase();
  for (const l of layers) {
    const ln = String(l.name || "").replace(/_layer$/i, "").toUpperCase();
    if (ln === name) return l.id;
  }
  return null;
}

function encodeArg(token, kinds, layers) {
  if (token == null) return 0;
  const upper = String(token).toUpperCase();
  if (kinds.constants.has(upper)) return kinds.constants.get(upper);
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
  if (n <= 0xffff && USAGE_NAME.has(hid(KEY, n))) return USAGE_NAME.get(hid(KEY, n));
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
  const dn = norm(behavior.displayName);
  const compact = dn.replace(/\s+/g, "");
  for (const [dts, aliases] of Object.entries(BEHAVIOR_ALIASES)) {
    const aliasNorm = [dts, ...aliases].map(norm);
    const aliasCompact = aliasNorm.map((a) => a.replace(/\s+/g, ""));
    if (dn === norm(dts) || compact === dts || aliasNorm.includes(dn) || aliasCompact.includes(compact)) return dts;
    if (dts === "hml" && /homerow/.test(dn) && /left/.test(dn)) return dts;
    if (dts === "hmr" && /homerow/.test(dn) && /right/.test(dn)) return dts;
  }
  const raw = String(behavior.displayName || "").trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) return raw;
  return compact.replace(/\s+/g, "_") || "kp";
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
  return String(value);
}

function shouldEmitParam(value, kinds) {
  if (kinds.nil && !kinds.hid && !kinds.layer && !kinds.constants.size) return false;
  if (!value && kinds.hid && !kinds.layer && !kinds.constants.size) return false;
  return true;
}

function findBehaviorById(behaviors, cell) {
  const list = behaviors || [];
  const raw = cell?.rawBehaviorId;
  const zig = cell?.behaviorId;
  const byRaw = list.find((b) => b.id === raw);
  const byZig = list.find((b) => b.id === zig);
  if (byRaw && byZig && byRaw !== byZig) {
    const hid = hidToken(cell.param1);
    if (hid && hidPage(cell.param1) === KEY) {
      const hidBeh = [byRaw, byZig].find((b) => paramKinds(b.param1).hid || dtsNameFromBehavior(b) === "kp");
      if (hidBeh) return hidBeh;
    }
    return byRaw;
  }
  return byRaw || byZig || null;
}

export function cellsToBinding(cell, behaviors, layers) {
  if (!cell || isEmptyStudioCell(cell)) return { ok: false, reason: "empty cell" };
  let behavior = findBehaviorById(behaviors, cell);
  if (!behavior) return { ok: false, reason: `unknown behavior id ${cell.behaviorId}/${cell.rawBehaviorId}` };
  let name = dtsNameFromBehavior(behavior);
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
  if (name === "kp" && args.length > 1 && args[args.length - 1] === "0") args.pop();
  const text = args.length ? `&${name} ${args.join(" ")}` : `&${name}`;
  if (isPlaceholderBinding(text)) return { ok: false, reason: "placeholder binding", text };
  return { ok: true, text };
}

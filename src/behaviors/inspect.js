/**
 * Structured view of a single keymap binding for the key inspector.
 * Round-trips the tokens this keymap actually uses (&kp, &lt, &hml, chords).
 */

const CHORD_RE = /^(LC|LS|LA|LG|RC|RS|RA|RG)\((.+)\)$/;

export const INSPECT_MODS = [
  ["LC", "Ctrl"],
  ["LS", "Shift"],
  ["LA", "Alt"],
  ["LG", "GUI"],
  ["RC", "Ctrl R"],
  ["RS", "Shift R"],
  ["RA", "Alt R"],
  ["RG", "GUI R"],
];

export const BT_COMMANDS = ["BT_SEL", "BT_CLR", "BT_CLR_ALL", "BT_NXT", "BT_PRV", "BT_DISC"];

export const MOUSE_PARAMS = {
  mmv: ["MOVE_UP", "MOVE_DOWN", "MOVE_LEFT", "MOVE_RIGHT"],
  msc: ["SCRL_UP", "SCRL_DOWN", "SCRL_LEFT", "SCRL_RIGHT"],
  mkp: ["LCLK", "RCLK", "MCLK", "MB4", "MB5"],
};

const EMPTY = new Set(["trans", "none"]);
const LAYER_ONLY = new Set(["mo", "to", "tog", "sl"]);
const LAYER_HOLD = new Set(["mo", "lt", "sl", "to", "tog"]);
const MOUSE = new Set(["mmv", "msc", "mkp"]);

export function isLayerHoldBinding(model) {
  return LAYER_HOLD.has(model?.behavior);
}

export function unwrapChord(token) {
  const mods = [];
  let key = String(token || "").trim();
  while (true) {
    const m = key.match(CHORD_RE);
    if (!m) break;
    mods.push(m[1]);
    key = m[2];
  }
  return { mods, key };
}

export function wrapChord(key, mods) {
  let out = String(key || "").trim();
  if (!out) return "";
  for (const mod of [...(mods || [])].reverse()) {
    if (mod) out = `${mod}(${out})`;
  }
  return out;
}

export function parseBinding(text) {
  const raw = String(text || "").trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  const behavior = (parts[0] || "&trans").replace(/^&/, "");
  const args = parts.slice(1);
  const model = {
    raw,
    behavior,
    args,
    mods: [],
    key: "",
    layer: "",
    hold: "",
    btCmd: "",
    btProfile: "",
  };
  if (behavior === "kp" || behavior === "sk") {
    const chord = unwrapChord(args[0] || "");
    model.mods = chord.mods;
    model.key = chord.key;
  } else if (behavior === "lt") {
    model.layer = args[0] || "";
    const chord = unwrapChord(args[1] || "");
    model.mods = chord.mods;
    model.key = chord.key;
  } else if (LAYER_ONLY.has(behavior)) {
    model.layer = args[0] || "";
  } else if (behavior === "bt") {
    model.btCmd = args[0] || "BT_SEL";
    model.btProfile = args[1] || "0";
  } else if (MOUSE.has(behavior)) {
    model.key = args[0] || "";
  } else if (args.length >= 2) {
    model.hold = args[0];
    const chord = unwrapChord(args.slice(1).join(" "));
    model.mods = chord.mods;
    model.key = chord.key;
  } else if (args.length === 1) {
    const chord = unwrapChord(args[0]);
    model.mods = chord.mods;
    model.key = chord.key;
  }
  return model;
}

export function formatBinding(model) {
  const b = String(model?.behavior || "trans").replace(/^&/, "");
  if (EMPTY.has(b) || b === "sys_reset") return `&${b}`;
  if (b === "kp") {
    const key = wrapChord(model.key, model.mods);
    return key ? `&kp ${key}` : "&kp A";
  }
  if (b === "sk") {
    const key = wrapChord(model.key || "LSHFT", model.mods);
    return `&sk ${key}`;
  }
  if (b === "lt") {
    const key = wrapChord(model.key, model.mods) || "SPACE";
    return `&lt ${model.layer || "NAV"} ${key}`;
  }
  if (LAYER_ONLY.has(b)) return `&${b} ${model.layer || "NAV"}`;
  if (b === "bt") {
    const cmd = model.btCmd || "BT_SEL";
    if (cmd === "BT_SEL" || cmd === "BT_DISC") return `&bt ${cmd} ${model.btProfile || "0"}`;
    return `&bt ${cmd}`;
  }
  if (MOUSE.has(b)) {
    const fallback = MOUSE_PARAMS[b]?.[0] || "MOVE_UP";
    return `&${b} ${model.key || fallback}`;
  }
  if (model.hold && model.key) return `&${b} ${model.hold} ${wrapChord(model.key, model.mods)}`;
  if (model.key) return `&${b} ${wrapChord(model.key, model.mods)}`;
  return `&${b}`;
}

export function isHomeRowBehavior(beh, ctx = {}) {
  if (!beh || beh.deleted) return false;
  const ids = ctx.homeRowBehaviors || [];
  if (ids.includes(beh.id)) return true;
  if (/homerow/i.test(beh.name || "")) return true;
  return beh.kind === "hold-tap" && Array.isArray(beh.triggerPositions) && beh.triggerPositions.length > 0;
}

export function isHomeRowBinding(model, ctx = {}) {
  if (!model) return false;
  const ids = ctx.homeRowBehaviors || [];
  if (ids.includes(model.behavior)) return true;
  const beh = (ctx.behaviors || []).find((x) => !x.deleted && x.id === model.behavior);
  return isHomeRowBehavior(beh, ctx);
}

export function classifyBinding(model, ctx = {}) {
  const b = model.behavior;
  if (b === "kp") return "keypress";
  if (b === "sk") return "sticky";
  if (b === "lt") return "layer-tap";
  if (LAYER_ONLY.has(b)) return "layer";
  if (b === "bt") return "bt";
  if (MOUSE.has(b)) return "mouse";
  if (EMPTY.has(b)) return "empty";
  if (b === "sys_reset") return "zero";
  const macros = ctx.macros || [];
  if (macros.some((m) => !m.deleted && m.id === b)) return "macro";
  const behaviors = ctx.behaviors || [];
  const beh = behaviors.find((x) => !x.deleted && x.id === b);
  if (beh?.kind === "hold-tap" || (model.hold && model.key)) return "hold-tap";
  if (beh) return "zero";
  if (!model.args.length) return "zero";
  return "raw";
}

export function convertBinding(model, nextBehavior, ctx = {}) {
  const next = {
    ...model,
    behavior: String(nextBehavior || "kp").replace(/^&/, ""),
  };
  const b = next.behavior;
  const layer = ctx.defaultLayer || next.layer || "NAV";
  if (b === "lt") {
    next.layer = next.layer || layer;
    next.key = next.key || "SPACE";
  } else if (LAYER_ONLY.has(b)) {
    next.layer = next.layer || layer;
  } else if (b === "kp") {
    next.key = next.key || "A";
  } else if (b === "sk") {
    next.key = next.key && /CTRL|SHFT|ALT|GUI/.test(next.key) ? next.key : "LSHFT";
  } else if (b === "bt") {
    next.btCmd = next.btCmd || "BT_SEL";
    next.btProfile = next.btProfile || "0";
  } else if (MOUSE.has(b)) {
    const allowed = MOUSE_PARAMS[b] || [];
    if (!allowed.includes(next.key)) next.key = allowed[0] || "";
  } else if ((ctx.behaviors || []).some((x) => x.id === b && x.kind === "hold-tap")) {
    next.hold = next.hold || "LGUI";
    next.key = next.key || "A";
  }
  return formatBinding(next);
}

export function keycodeFromBinding(text) {
  const model = parseBinding(text);
  return model.key || "";
}

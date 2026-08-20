/**
 * Source-preserving ZMK keymap parser.
 * Finds each layer's bindings = < ... >; and records exact spans so a save
 * rewrites only the binding tokens, never comments or formatting.
 */

const BINDING_START = "bindings = <";

function skipLineComment(src, i, end) {
  if (src[i] === "/" && src[i + 1] === "/") {
    while (i < end && src[i] !== "\n") i++;
  }
  return i;
}

function readIdent(src, i, end) {
  if (i >= end || !/[A-Za-z_]/.test(src[i])) return i;
  i++;
  while (i < end && /[A-Za-z0-9_]/.test(src[i])) i++;
  return i;
}

function readNumber(src, i, end) {
  if (i >= end || !/\d/.test(src[i])) return i;
  while (i < end && /\d/.test(src[i])) i++;
  return i;
}

function readParenGroup(src, i, end) {
  if (src[i] !== "(") return i;
  let depth = 1;
  i++;
  while (i < end && depth > 0) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") depth--;
    i++;
  }
  return i;
}

function readArg(src, i, end) {
  if (/[A-Za-z_]/.test(src[i])) {
    i = readIdent(src, i, end);
    if (src[i] === "(") i = readParenGroup(src, i, end);
    return i;
  }
  if (/\d/.test(src[i])) return readNumber(src, i, end);
  return i;
}

export function parseBindingsBlock(src, start, end) {
  const bindings = [];
  let i = start;
  while (i < end) {
    i = skipLineComment(src, i, end);
    if (i >= end) break;
    if (src[i] === "&") {
      const tokenStart = i;
      i++;
      i = readIdent(src, i, end);
      while (i < end) {
        let j = i;
        while (j < end && /[ \t]/.test(src[j])) j++;
        if (j < end && src[j] === "/" && src[j + 1] === "/") break;
        if (j >= end || src[j] === "&" || src[j] === ">" || src[j] === "\n") break;
        const next = readArg(src, j, end);
        if (next === j) break;
        i = next;
      }
      bindings.push({
        start: tokenStart,
        end: i,
        text: src.slice(tokenStart, i),
      });
      continue;
    }
    i++;
  }
  return bindings;
}

function layerNameBefore(src, bindIdx) {
  const before = src.slice(Math.max(0, bindIdx - 240), bindIdx);
  const match = before.match(/([A-Za-z_][A-Za-z0-9_]*)\s*\{\s*$/s);
  return match ? match[1] : `layer_${bindIdx}`;
}

export function parseKeymap(src, expectedCount) {
  const count = Number(expectedCount);
  if (!count) throw new Error("parseKeymap requires a key count from the layout profile.");
  expectedCount = count;
  const layers = [];
  let searchFrom = 0;
  while (true) {
    const bindIdx = src.indexOf(BINDING_START, searchFrom);
    if (bindIdx < 0) break;
    const innerStart = bindIdx + BINDING_START.length;
    const close = src.indexOf(">;", innerStart);
    if (close < 0) break;
    const bindings = parseBindingsBlock(src, innerStart, close);
    if (bindings.length === expectedCount) {
      const id = layerNameBefore(src, bindIdx);
      layers.push({
        id,
        bindings,
        start: null,
        end: null,
      });
    }
    searchFrom = close + 2;
  }
  for (const layer of layers) {
    const node = findLayerNode(src, layer.bindings[0]?.start ?? 0, layer.id);
    if (node) {
      layer.start = node.start;
      layer.end = node.end;
    }
  }
  const comboBlock = parseCombos(src);
  const behaviorBlock = parseBehaviors(src);
  const macroBlock = parseMacros(src);
  return { source: src, layers, ...comboBlock, ...behaviorBlock, ...macroBlock };
}

function matchBrace(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findLayerNode(src, from, id) {
  if (!id) return null;
  let search = from;
  while (search > 0) {
    const idx = src.lastIndexOf(id, search - 1);
    if (idx < 0) return null;
    if (idx > 0 && /[A-Za-z0-9_]/.test(src[idx - 1])) {
      search = idx;
      continue;
    }
    let j = idx + id.length;
    while (j < from && /[ \t\n]/.test(src[j])) j++;
    if (src[j] === "{") {
      const close = matchBrace(src, j);
      if (close < 0) return null;
      let end = close + 1;
      while (end < src.length && /[ \t]/.test(src[end])) end++;
      if (src[end] === ";") end++;
      return { start: idx, end };
    }
    search = idx;
  }
  return null;
}

function parseAngleList(src) {
  const inner = src.match(/<([^>]*)>/);
  if (!inner) return [];
  return inner[1]
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function parseCombos(src) {
  const marker = src.indexOf('compatible = "zmk,combos"');
  if (marker < 0) return { combos: [], comboInsertAt: -1 };
  const blockOpen = src.lastIndexOf("{", marker);
  const blockClose = matchBrace(src, blockOpen);
  if (blockOpen < 0 || blockClose < 0) return { combos: [], comboInsertAt: -1 };

  const combos = [];
  let i = marker;
  let ifdef = 0;
  while (i < blockClose) {
    if (src.startsWith("#ifdef", i)) {
      ifdef++;
      i += 6;
      continue;
    }
    if (src.startsWith("#endif", i)) {
      ifdef = Math.max(0, ifdef - 1);
      i += 6;
      continue;
    }
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < blockClose && src[i] !== "\n") i++;
      continue;
    }
    if (/[A-Za-z_]/.test(src[i])) {
      const nameStart = i;
      i = readIdent(src, i, blockClose);
      const name = src.slice(nameStart, i);
      let j = i;
      while (j < blockClose && /[ \t\n]/.test(src[j])) j++;
      if (src[j] !== "{") continue;
      const close = matchBrace(src, j);
      if (close < 0) break;
      let end = close + 1;
      while (end < src.length && /[ \t]/.test(src[end])) end++;
      if (src[end] === ";") end++;
      const body = src.slice(j + 1, close);
      const posMatch = body.match(/key-positions\s*=\s*<[^>]+>/);
      const bindMatch = body.match(/bindings\s*=\s*<([^>]+)>/);
      const layerMatch = body.match(/layers\s*=\s*<([^>]+)>/);
      const timeMatch = body.match(/timeout-ms\s*=\s*<(\d+)>/);
      const positions = posMatch ? parseAngleList(posMatch[0]).map(Number) : [];
      const bindToks = bindMatch ? parseBindingsBlock(bindMatch[1], 0, bindMatch[1].length) : [];
      combos.push({
        id: name,
        positions,
        binding: bindToks[0]?.text || (bindMatch ? bindMatch[1].trim() : ""),
        layers: layerMatch ? parseAngleList(`<${layerMatch[1]}>`).map(Number) : "all",
        timeout: timeMatch ? Number(timeMatch[1]) : 50,
        slowRelease: /slow-release/.test(body),
        guarded: ifdef > 0,
        start: nameStart,
        end,
        deleted: false,
        added: false,
      });
      i = end;
      continue;
    }
    i++;
  }

  const ifdefIdx = src.slice(blockOpen, blockClose).search(/#ifdef\b/);
  const comboInsertAt = ifdefIdx >= 0 ? blockOpen + ifdefIdx : blockClose;
  return { combos, comboInsertAt };
}

export function formatComboNode(combo, mode = "insert") {
  const layers =
    combo.layers === "all" ? "" : `            layers = <${combo.layers.join(" ")}>;\n`;
  const slow = combo.slowRelease ? "            slow-release;\n" : "";
  const body =
    ` {\n` +
    `            timeout-ms = <${combo.timeout ?? 50}>;\n` +
    `            key-positions = <${combo.positions.join(" ")}>;\n` +
    `            bindings = <${combo.binding}>;\n` +
    slow +
    layers +
    `        };`;
  if (mode === "replace") return `${combo.id}${body}`;
  return `\n        ${combo.id}${body}\n`;
}

export function applyCombos(src, combos, insertAt) {
  if (insertAt < 0) return src;
  let insert = insertAt;
  let out = src;
  const ops = [];
  for (const c of combos) {
    if (c.added || c.start == null) continue;
    if (c.deleted) ops.push({ start: c.start, end: c.end, text: "" });
    else if (c.edited) ops.push({ start: c.start, end: c.end, text: formatComboNode(c, "replace") });
  }
  ops.sort((a, b) => b.start - a.start);
  for (const op of ops) {
    out = out.slice(0, op.start) + op.text + out.slice(op.end);
    if (op.start < insert) insert += op.text.length - (op.end - op.start);
  }
  const adds = combos.filter((c) => c.added && !c.deleted);
  if (adds.length) {
    out = out.slice(0, insert) + adds.map((c) => formatComboNode(c, "insert")).join("") + out.slice(insert);
  }
  return out;
}

function propNum(body, name) {
  const m = body.match(new RegExp(`${name}\\s*=\\s*<(\\d+)>`));
  return m ? Number(m[1]) : null;
}

function propStr(body, name) {
  const m = body.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : "";
}

export function parseBehaviors(src) {
  let search = 0;
  let blockOpen = -1;
  while (search < src.length) {
    const idx = src.indexOf("behaviors", search);
    if (idx < 0) break;
    const before = src.slice(Math.max(0, idx - 12), idx);
    if (/zmk,\s*$/.test(before)) {
      search = idx + 9;
      continue;
    }
    let j = idx + 9;
    while (j < src.length && /[ \t\n]/.test(src[j])) j++;
    if (src[j] === "{") {
      blockOpen = j;
      break;
    }
    search = idx + 9;
  }
  if (blockOpen < 0) return { behaviors: [], behaviorInsertAt: -1 };
  const blockClose = matchBrace(src, blockOpen);
  if (blockClose < 0) return { behaviors: [], behaviorInsertAt: -1 };

  const behaviors = [];
  let i = blockOpen + 1;
  while (i < blockClose) {
    if (src[i] === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? blockClose : end + 2;
      continue;
    }
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < blockClose && src[i] !== "\n") i++;
      continue;
    }
    if (/[A-Za-z_]/.test(src[i])) {
      const labelStart = i;
      i = readIdent(src, i, blockClose);
      const label = src.slice(labelStart, i);
      let j = i;
      while (j < blockClose && /[ \t]/.test(src[j])) j++;
      let nodeName = label;
      if (src[j] === ":") {
        j++;
        while (j < blockClose && /[ \t]/.test(src[j])) j++;
        const ns = j;
        j = readIdent(src, j, blockClose);
        nodeName = src.slice(ns, j);
      }
      while (j < blockClose && /[ \t\n]/.test(src[j])) j++;
      if (src[j] !== "{") {
        i = j;
        continue;
      }
      const close = matchBrace(src, j);
      if (close < 0) break;
      let end = close + 1;
      while (end < src.length && /[ \t]/.test(src[end])) end++;
      if (src[end] === ";") end++;
      const body = src.slice(j + 1, close);
      const compatible = propStr(body, "compatible");
      const posMatch = body.match(/hold-trigger-key-positions\s*=\s*<[^>]+>/);
      const bindMatch = body.match(/bindings\s*=\s*([^;]+);/);
      const bindRaw = bindMatch ? bindMatch[1].replace(/\s+/g, " ").trim() : "";
      const bindingList = parseBindingList(bindRaw);
      behaviors.push({
        id: label,
        name: nodeName,
        compatible,
        kind: kindFromCompatible(compatible),
        tappingTerm: propNum(body, "tapping-term-ms") ?? 280,
        quickTap: propNum(body, "quick-tap-ms"),
        priorIdle: propNum(body, "require-prior-idle-ms"),
        flavor: propStr(body, "flavor") || "balanced",
        bindings: bindRaw || "<&kp>, <&kp>",
        bindingList,
        mods: parseModFlags(body, "mods"),
        keepMods: parseModFlags(body, "keep-mods"),
        triggerPositions: posMatch ? parseAngleList(posMatch[0]).map(Number) : [],
        holdOnRelease: /hold-trigger-on-release/.test(body),
        start: labelStart,
        end,
        deleted: false,
        added: false,
        edited: false,
      });
      i = end;
      continue;
    }
    i++;
  }
  return { behaviors, behaviorInsertAt: blockClose };
}

export function kindFromCompatible(compatible) {
  const c = String(compatible || "");
  if (c.includes("hold-tap")) return "hold-tap";
  if (c.includes("mod-morph")) return "mod-morph";
  if (c.includes("tap-dance")) return "tap-dance";
  return "other";
}

export function parseBindingList(raw) {
  const parts = [];
  const re = /<([^>]+)>/g;
  let m;
  while ((m = re.exec(String(raw || "")))) parts.push(m[1].trim());
  return parts;
}

export function parseModFlags(body, prop = "mods") {
  const m = String(body || "").match(new RegExp(`${prop}\\s*=\\s*<([^>]+)>`));
  if (!m) return [];
  return [...m[1].matchAll(/MOD_([A-Z]+)/g)].map((x) => x[1]);
}

export function formatModFlags(names) {
  const flags = (names || []).filter(Boolean);
  if (!flags.length) return "";
  if (flags.length === 1) return `<MOD_${flags[0]}>`;
  return `<(${flags.map((n) => `MOD_${n}`).join("|")})>`;
}

function formatBindingList(list) {
  const items = (list || []).filter(Boolean);
  if (!items.length) return "<&none>, <&none>";
  return items.map((b) => `<${b}>`).join(", ");
}

export function formatBehaviorNode(b, mode = "insert") {
  const extra = [];
  const kind = b.kind || kindFromCompatible(b.compatible);
  if (kind === "hold-tap") {
    extra.push(`            #binding-cells = <2>;`);
    extra.push(`            tapping-term-ms = <${b.tappingTerm ?? 280}>;`);
    if (b.quickTap != null && b.quickTap !== "") extra.push(`            quick-tap-ms = <${b.quickTap}>;`);
    if (b.priorIdle != null && b.priorIdle !== "") extra.push(`            require-prior-idle-ms = <${b.priorIdle}>;`);
    extra.push(`            flavor = "${b.flavor || "balanced"}";`);
    extra.push(`            bindings = ${b.bindings || formatBindingList(b.bindingList) || "<&kp>, <&kp>"};`);
    if (b.triggerPositions?.length) {
      extra.push(`            hold-trigger-key-positions = <${b.triggerPositions.join(" ")}>;`);
    }
    if (b.holdOnRelease) extra.push(`            hold-trigger-on-release;`);
  } else if (kind === "mod-morph") {
    extra.push(`            #binding-cells = <0>;`);
    extra.push(`            bindings = ${formatBindingList(b.bindingList || ["&kp DOT", "&kp COMMA"])};`);
    const mods = formatModFlags(b.mods?.length ? b.mods : ["LSFT"]);
    if (mods) extra.push(`            mods = ${mods};`);
    if (b.keepMods?.length) extra.push(`            keep-mods = ${formatModFlags(b.keepMods)};`);
  } else if (kind === "tap-dance") {
    extra.push(`            #binding-cells = <0>;`);
    extra.push(`            tapping-term-ms = <${b.tappingTerm ?? 200}>;`);
    extra.push(`            bindings = ${formatBindingList(b.bindingList || ["&kp N1", "&kp N2"])};`);
  } else {
    extra.push(`            #binding-cells = <0>;`);
    if (b.bindings) extra.push(`            bindings = ${b.bindings};`);
  }
  const compatible =
    b.compatible ||
    (kind === "mod-morph"
      ? "zmk,behavior-mod-morph"
      : kind === "tap-dance"
        ? "zmk,behavior-tap-dance"
        : kind === "hold-tap"
          ? "zmk,behavior-hold-tap"
          : "zmk,behavior-mod-morph");
  const head = `${b.id}: ${b.name || b.id}`;
  const body = ` {\n            compatible = "${compatible}";\n${extra.join("\n")}\n        };`;
  if (mode === "replace") return `${head}${body}`;
  return `\n        ${head}${body}\n`;
}

export function parseMacroSteps(rawList) {
  return (rawList || []).map((raw) => {
    const text = String(raw).trim();
    if (text === "&macro_pause_for_release") return { kind: "pause", keys: "" };
    const tap = text.match(/^&macro_tap\s+(.+)$/);
    if (tap) return { kind: "tap", keys: tap[1].trim() };
    const press = text.match(/^&macro_press\s+(.+)$/);
    if (press) return { kind: "press", keys: press[1].trim() };
    const rel = text.match(/^&macro_release\s+(.+)$/);
    if (rel) return { kind: "release", keys: rel[1].trim() };
    const wait = text.match(/^&macro_wait_time\s+(\d+)/);
    if (wait) return { kind: "wait", keys: wait[1] };
    return { kind: "raw", keys: text };
  });
}

export function formatMacroStep(step) {
  const keys = String(step.keys || "").trim();
  if (step.kind === "pause") return "&macro_pause_for_release";
  if (step.kind === "tap") return `&macro_tap ${keys || "&kp A"}`;
  if (step.kind === "press") return `&macro_press ${keys || "&kp LGUI"}`;
  if (step.kind === "release") return `&macro_release ${keys || "&kp LGUI"}`;
  if (step.kind === "wait") return `&macro_wait_time ${keys || "100"}`;
  return keys || "&macro_tap &kp A";
}

const HID_ALIAS = {
  LCTL: "LCTRL",
  LEFT_CONTROL: "LCTRL",
  RCTL: "RCTRL",
  LSHIFT: "LSHFT",
  LSFT: "LSHFT",
  LEFT_SHIFT: "LSHFT",
  RSHIFT: "RSHFT",
  RSFT: "RSHFT",
  LEFT_ALT: "LALT",
  LOPT: "LALT",
  RIGHT_ALT: "RALT",
  ROPT: "RALT",
  LWIN: "LGUI",
  LCMD: "LGUI",
  LEFT_GUI: "LGUI",
  RWIN: "RGUI",
  RCMD: "RGUI",
  RIGHT_GUI: "RGUI",
};

const MOD_TOKENS = new Set([
  "LCTRL",
  "RCTRL",
  "LSHFT",
  "RSHFT",
  "LALT",
  "RALT",
  "LGUI",
  "RGUI",
]);

const CHORD_INNER = /^(LC|LS|LA|LG|RC|RS|RA|RG)\((.+)\)$/i;

export function normalizeHidToken(raw) {
  const t = String(raw || "").trim().toUpperCase();
  return HID_ALIAS[t] || t;
}

export function expandHidToken(raw) {
  const t = String(raw || "").trim();
  if (!t) return [];
  const m = t.match(CHORD_INNER);
  if (m) return [chordPrefix(m[1]), ...expandHidToken(m[2])];
  return [normalizeHidToken(t)];
}

function chordPrefix(prefix) {
  return (
    {
      LC: "LCTRL",
      LS: "LSHFT",
      LA: "LALT",
      LG: "LGUI",
      RC: "RCTRL",
      RS: "RSHFT",
      RA: "RALT",
      RG: "RGUI",
    }[String(prefix).toUpperCase()] || String(prefix).toUpperCase()
  );
}

function tokensFromKeysField(keys) {
  const src = String(keys || "").trim();
  if (!src) return [];
  const out = [];
  const chunks = src.split(/(?=&)/).map((s) => s.trim()).filter(Boolean);
  const parts = chunks.length ? chunks : [src];
  for (const chunk of parts) {
    const bits = chunk.split(/\s+/).filter(Boolean);
    const args = bits[0]?.startsWith("&") ? bits.slice(1) : bits;
    for (const arg of args) out.push(...expandHidToken(arg));
  }
  return out;
}

function isModifierToken(token) {
  return MOD_TOKENS.has(normalizeHidToken(token));
}

/** Letters / keys the macro types — not the modifiers held around them. */
export function extractMacroTapTokens(steps) {
  const taps = (steps || []).filter((s) => s.kind === "tap");
  const source = taps.length ? taps : (steps || []).filter((s) => s.kind === "press" || s.kind === "raw");
  const seen = new Set();
  const out = [];
  for (const step of source) {
    for (const token of tokensFromKeysField(step.keys)) {
      if (isModifierToken(token) || seen.has(token)) continue;
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

export function prettyMacroToken(token) {
  const t = normalizeHidToken(token);
  const hold = prettyModToken(t);
  if (hold) return hold;
  if (/^N\d+$/.test(t)) return t.slice(1);
  if (t.length === 1) return t;
  return bindingLabel(`&kp ${t}`);
}

function tapTokenOfBinding(text) {
  const parts = String(text || "").trim().split(/\s+/);
  if (!parts[0]) return [];
  if (parts[0] === "&kp" || parts[0] === "&sk") return tokensFromKeysField(parts.slice(1).join(" "));
  if (parts.length >= 3) return expandHidToken(parts[parts.length - 1]);
  return [];
}

/**
 * Physical seats for the keys a macro types (Q for mac_lock), preferring
 * the base-layer `&kp Q` position so the letter is visible on every layer.
 */
export function findMacroKeySeats(steps, layers) {
  const tokens = extractMacroTapTokens(steps);
  const hits = [];
  for (const token of tokens) {
    const matches = [];
    (layers || []).forEach((layer, li) => {
      (layer.bindings || []).forEach((b, i) => {
        const taps = tapTokenOfBinding(b?.text || "").map(normalizeHidToken);
        if (taps.includes(token)) matches.push({ index: i, layer: li });
      });
    });
    const base = matches.filter((m) => m.layer === 0);
    const chosen = base.length ? base : matches;
    const seen = new Set();
    for (const m of chosen) {
      if (seen.has(m.index)) continue;
      seen.add(m.index);
      hits.push({ index: m.index, token });
    }
  }
  return hits;
}

function findNamedBlock(src, name) {
  let search = 0;
  while (search < src.length) {
    const idx = src.indexOf(name, search);
    if (idx < 0) return null;
    if (idx > 0 && /[A-Za-z0-9_]/.test(src[idx - 1])) {
      search = idx + name.length;
      continue;
    }
    let j = idx + name.length;
    while (j < src.length && /[ \t\n]/.test(src[j])) j++;
    if (src[j] === "{") return { open: j };
    search = idx + name.length;
  }
  return null;
}

export function parseMacros(src) {
  const found = findNamedBlock(src, "macros");
  if (!found) return { macros: [], macroInsertAt: -1 };
  const blockClose = matchBrace(src, found.open);
  if (blockClose < 0) return { macros: [], macroInsertAt: -1 };
  const macros = [];
  let i = found.open + 1;
  while (i < blockClose) {
    if (src[i] === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? blockClose : end + 2;
      continue;
    }
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < blockClose && src[i] !== "\n") i++;
      continue;
    }
    if (/[A-Za-z_]/.test(src[i])) {
      const labelStart = i;
      i = readIdent(src, i, blockClose);
      const label = src.slice(labelStart, i);
      let j = i;
      while (j < blockClose && /[ \t]/.test(src[j])) j++;
      let nodeName = label;
      if (src[j] === ":") {
        j++;
        while (j < blockClose && /[ \t]/.test(src[j])) j++;
        const ns = j;
        j = readIdent(src, j, blockClose);
        nodeName = src.slice(ns, j);
      }
      while (j < blockClose && /[ \t\n]/.test(src[j])) j++;
      if (src[j] !== "{") {
        i = j;
        continue;
      }
      const close = matchBrace(src, j);
      if (close < 0) break;
      let end = close + 1;
      while (end < src.length && /[ \t]/.test(src[end])) end++;
      if (src[end] === ";") end++;
      const body = src.slice(j + 1, close);
      const bindMatch = body.match(/bindings\s*=\s*([^;]+);/s);
      const bindRaw = bindMatch ? bindMatch[1] : "";
      macros.push({
        id: label,
        name: nodeName,
        waitMs: propNum(body, "wait-ms"),
        tapMs: propNum(body, "tap-ms"),
        steps: parseMacroSteps(parseBindingList(bindRaw)),
        start: labelStart,
        end,
        deleted: false,
        added: false,
        edited: false,
      });
      i = end;
      continue;
    }
    i++;
  }
  return { macros, macroInsertAt: blockClose };
}

export function formatMacroNode(m, mode = "insert") {
  const steps = (m.steps || []).map(formatMacroStep);
  const binds =
    steps.length === 0
      ? "<&macro_tap &kp A>"
      : steps
          .map((s, i) => (i === 0 ? `<${s}>` : `                     , <${s}>`))
          .join("\n");
  const extra = [];
  extra.push(`            compatible = "zmk,behavior-macro";`);
  extra.push(`            #binding-cells = <0>;`);
  if (m.waitMs != null) extra.push(`            wait-ms = <${m.waitMs}>;`);
  if (m.tapMs != null) extra.push(`            tap-ms = <${m.tapMs}>;`);
  extra.push(`            bindings = ${binds};`);
  const head = `${m.id}: ${m.name || m.id}`;
  const body = ` {\n${extra.join("\n")}\n        };`;
  if (mode === "replace") return `${head}${body}`;
  return `\n        ${head}${body}\n`;
}

export function applyMacros(src, macros, insertAt) {
  if (insertAt < 0) return src;
  let insert = insertAt;
  let out = src;
  const ops = [];
  for (const m of macros) {
    if (m.added || m.start == null) continue;
    if (m.deleted) ops.push({ start: m.start, end: m.end, text: "" });
    else if (m.edited) ops.push({ start: m.start, end: m.end, text: formatMacroNode(m, "replace") });
  }
  ops.sort((a, b) => b.start - a.start);
  for (const op of ops) {
    out = out.slice(0, op.start) + op.text + out.slice(op.end);
    if (op.start < insert) insert += op.text.length - (op.end - op.start);
  }
  const adds = macros.filter((m) => m.added && !m.deleted);
  if (adds.length) {
    out = out.slice(0, insert) + adds.map((m) => formatMacroNode(m, "insert")).join("") + out.slice(insert);
  }
  return out;
}

export function applyBehaviors(src, behaviors, insertAt) {
  if (insertAt < 0) return src;
  let insert = insertAt;
  let out = src;
  const ops = [];
  for (const b of behaviors) {
    if (b.added || b.start == null) continue;
    if (b.deleted) ops.push({ start: b.start, end: b.end, text: "" });
    else if (b.edited) ops.push({ start: b.start, end: b.end, text: formatBehaviorNode(b, "replace") });
  }
  ops.sort((a, b) => b.start - a.start);
  for (const op of ops) {
    out = out.slice(0, op.start) + op.text + out.slice(op.end);
    if (op.start < insert) insert += op.text.length - (op.end - op.start);
  }
  const adds = behaviors.filter((b) => b.added && !b.deleted);
  if (adds.length) {
    out = out.slice(0, insert) + adds.map((b) => formatBehaviorNode(b, "insert")).join("") + out.slice(insert);
  }
  return out;
}

export function applyBindings(original, layers) {
  const replacements = [];
  for (const layer of layers) {
    for (const b of layer.bindings) {
      if (b.start == null || b.end == null) continue;
      if (b.text !== original.slice(b.start, b.end)) {
        replacements.push({ start: b.start, end: b.end, text: b.text });
      }
    }
  }
  replacements.sort((a, b) => b.start - a.start);
  let out = original;
  for (const r of replacements) {
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  return out;
}

let labelOs = "mac";

export function setLabelOs(os) {
  labelOs = os === "windows" || os === "linux" ? "win" : "mac";
}

export function currentLabelOs() {
  return labelOs;
}

function prettyModToken(token) {
  const apple = labelOs !== "win";
  const map = apple
    ? {
        LSHFT: "⇧",
        RSHFT: "⇧",
        LCTRL: "⌃",
        RCTRL: "⌃",
        LALT: "⌥",
        RALT: "⌥",
        LGUI: "⌘",
        RGUI: "⌘",
      }
    : {
        LSHFT: "⇧",
        RSHFT: "⇧",
        LCTRL: "Ctrl",
        RCTRL: "Ctrl",
        LALT: "Alt",
        RALT: "Alt",
        LGUI: "Win",
        RGUI: "Win",
      };
  return map[token] || "";
}

export function bindingLabel(text) {
  const parts = text.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts[0] === "&trans") return "▽";
  if (parts[0] === "&none") return "∅";
  if (parts[0] === "&sys_reset") return "RST";
  if (parts[0] === "&host_log_dump") return "LOG";
  if (parts[0] === "&mac_lock") return "Mac";
  if (parts[0] === "&win_lock") return "Win";
  if (parts[0] === "&studio_unlock") return "STU";
  if (parts[0] === "&bt") {
    if (parts[1] === "BT_SEL") return `BT${parts[2] ?? ""}`;
    if (parts[1] === "BT_CLR") return "BTx";
    return parts[1] || "BT";
  }
  if (parts[0] === "&mmv") {
    return { MOVE_UP: "↑", MOVE_DOWN: "↓", MOVE_LEFT: "←", MOVE_RIGHT: "→" }[parts[1]] || parts[1] || "mmv";
  }
  if (parts[0] === "&msc") {
    return { SCRL_UP: "Scr↑", SCRL_DOWN: "Scr↓", SCRL_LEFT: "Scr←", SCRL_RIGHT: "Scr→" }[parts[1]] || parts[1] || "Scr";
  }
  if (parts[0] === "&mkp") {
    return { LCLK: "Lclk", RCLK: "Rclk", MCLK: "Mclk", MB1: "Lclk", MB2: "Rclk", MB3: "Mclk", MB4: "MB4", MB5: "MB5" }[parts[1]] || parts[1] || "Click";
  }
  if (parts[0] === "&kp") {
    const key = parts.slice(1).find((p) => p && p !== "0") || parts[1] || "";
    const prettyKp = formatChord(key);
    if (prettyKp) return prettyKp;
    parts[parts.length - 1] = key;
  }
  const last = parts[parts.length - 1];
  const prettyChord = formatChord(last);
  if (prettyChord) return prettyChord;
  const pretty = {
    BSPC: "⌫",
    SPACE: "␣",
    ENTER: "⏎",
    ESC: "Esc",
    LSHFT: prettyModToken("LSHFT") || "⇧",
    RSHFT: prettyModToken("RSHFT") || "⇧",
    LCTRL: prettyModToken("LCTRL") || "Ctrl",
    RCTRL: prettyModToken("RCTRL") || "Ctrl",
    LALT: prettyModToken("LALT") || "Alt",
    RALT: prettyModToken("RALT") || "Alt",
    LGUI: prettyModToken("LGUI") || "⌘",
    RGUI: prettyModToken("RGUI") || "⌘",
    LBKT: "[",
    RBKT: "]",
    SEMI: ";",
    COMMA: ",",
    DOT: ".",
    FSLH: "/",
    BSLH: "\\",
    UNDER: "_",
    MINUS: "-",
    PLUS: "+",
    STAR: "*",
    HASH: "#",
    AT: "@",
    GRAVE: "`",
    SQT: "'",
    DQT: '"',
    PIPE: "|",
    AMPS: "&",
    CARET: "^",
    EXCL: "!",
    TILDE: "~",
    DLLR: "$",
    PRCNT: "%",
    EQUAL: "=",
    LPAR: "(",
    RPAR: ")",
    TAB: "Tab",
    DEL: "Del",
    INS: "Ins",
    HOME: "Home",
    END: "End",
    UP: "↑",
    DOWN: "↓",
    LEFT: "←",
    RIGHT: "→",
    PG_UP: "PgUp",
    PG_DN: "PgDn",
    C_VOL_UP: "Vol+",
    C_VOL_DN: "Vol-",
    C_MUTE: "Mute",
    C_BRI_UP: "Bri+",
    C_BRI_DN: "Bri-",
    C_PP: "⏯",
    C_PREV: "⏮",
    C_NEXT: "⏭",
    CAPS: "Caps",
    N0: "0",
    N1: "1",
    N2: "2",
    N3: "3",
    N4: "4",
    N5: "5",
    N6: "6",
    N7: "7",
    N8: "8",
    N9: "9",
    MOVE_UP: "↑",
    MOVE_DOWN: "↓",
    MOVE_LEFT: "←",
    MOVE_RIGHT: "→",
    SCRL_UP: "Scr↑",
    SCRL_DOWN: "Scr↓",
    SCRL_LEFT: "Scr←",
    SCRL_RIGHT: "Scr→",
    LCLK: "Lclk",
    RCLK: "Rclk",
    MCLK: "Mclk",
    MB4: "MB4",
    MB5: "MB5",
    PSCRN: "PrtSc",
    PRINTSCREEN: "PrtSc",
    K_UNDO: "Undo",
  };
  if (pretty[last]) return pretty[last];
  if (/^N\d+$/.test(last)) return last.slice(1);
  if (last.length === 1) return last;
  return last.replace(/_/g, " ");
}

function chordMarks() {
  if (labelOs === "win") {
    return { LC: "Ctrl", LS: "⇧", LA: "Alt", LG: "Win", RC: "Ctrl", RS: "⇧", RA: "Alt", RG: "Win" };
  }
  return { LC: "⌃", LS: "⇧", LA: "⌥", LG: "⌘", RC: "⌃", RS: "⇧", RA: "⌥", RG: "⌘" };
}

function formatChord(token) {
  const m = String(token).match(/^(LC|LS|LA|LG|RC|RS|RA|RG)\((.+)\)$/);
  if (!m) return "";
  const inner = formatChord(m[2]) || bindingLabel(`&kp ${m[2]}`);
  return `${chordMarks()[m[1]]}${inner}`;
}

export function formatKeyLabel(text) {
  const raw = bindingLabel(text);
  const words = raw.split(/\s+/).filter(Boolean);
  let lines;
  if (raw.length <= 4) lines = [raw];
  else if (raw.includes("_")) lines = splitOnUnderscore(raw);
  else if (words.length > 1) lines = words;
  else lines = [raw];
  const longest = Math.max(...lines.map((l) => l.length), 1);
  const font =
    longest > 7 || lines.length > 2 ? 11 : lines.length > 1 || longest > 4 ? 13 : 28;
  return { lines, font, raw };
}

function splitOnUnderscore(s) {
  const bits = s.split("_").filter(Boolean);
  if (bits.length <= 1) return [s];
  if (bits.length === 2) return [bits[0], bits[1]];
  return [bits.slice(0, -1).join("_"), bits[bits.length - 1]];
}

function chunkLabel(s, n) {
  const out = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
}

export function shortLayerHint(token) {
  const raw = String(token || "").replace(/_layer$/i, "");
  if (/^LAYER_(\d+)$/i.test(raw)) return `L${raw.slice(6)}`;
  return raw.length > 4 ? raw.slice(0, 4) : raw;
}

export function bindingHoldHint(text) {
  const parts = text.trim().split(/\s+/);
  if (parts[0] === "&hml" || parts[0] === "&hmr") return prettyModToken(parts[1]) || parts[1] || "";
  if (parts[0] === "&lt" || parts[0] === "&mo" || parts[0] === "&sl" || parts[0] === "&to" || parts[0] === "&tog") {
    return shortLayerHint(parts[1] || "");
  }
  if (parts[0] === "&sk") return "sticky";
  return "";
}

/** Map an editor layer index onto a Studio keymap, or null if the firmware has no such layer. */
export function mapStudioLayerIndex(fileLayers, studioLayers, fileIndex) {
  const studio = studioLayers || [];
  if (!studio.length || fileIndex == null || fileIndex < 0) return null;
  const file = fileLayers?.[fileIndex];
  if (file) {
    const want = displayLayerName(file.id).toUpperCase();
    const byName = studio.findIndex((l) => String(l.name || l.id || "").replace(/_layer$/i, "").toUpperCase() === want);
    if (byName >= 0) return byName;
  }
  if (fileIndex < studio.length) return fileIndex;
  return null;
}

/**
 * Positions used by left-half recovery / combos.
 * `layers: "all"` matches combo nodes with no `layers` property (every layer).
 * Numbered layers match `layers = <0>` etc. Studio unlock (0+4) is omitted:
 * locking is off on production left.
 */
export const PROTECTED = {
  0: { why: "Q+W Escape combo (base layer only)", layers: [0] },
  1: { why: "Q+W Escape combo (base layer only)", layers: [0] },
  8: { why: "U+Y ñ combo (base layer only)", layers: [0] },
  9: { why: "U+Y ñ combo (base layer only)", layers: [0] },
  20: { why: "[+Z reset / [+X host-log dump (every layer)", layers: "all" },
  21: { why: "[+Z reset (every layer)", layers: "all" },
  22: { why: "[+X host-log dump (every layer)", layers: "all" },
  26: { why: "N+M dictation combo (base layer only)", layers: [0] },
  27: { why: "N+M dictation combo (base layer only)", layers: [0] },
};

export function comboTitle(combo) {
  return String(combo.id || "combo")
    .replace(/^combo_/, "")
    .replace(/_/g, " ");
}

export function bindingUsesId(text, id) {
  const needle = `&${String(id || "").replace(/^&/, "")}`;
  if (needle === "&") return false;
  return String(text || "").trim().split(/\s+/)[0] === needle;
}

/** Layer indexes where `&id` is placed on the board. Unused ids return []. */
export function layersUsingId(layers, id) {
  const out = [];
  (layers || []).forEach((layer, i) => {
    if ((layer.bindings || []).some((b) => bindingUsesId(b.text, id))) out.push(i);
  });
  return out;
}

export function comboActiveOnLayer(combo, layerIndex) {
  if (combo.deleted) return false;
  if (combo.layers === "all") return true;
  return Array.isArray(combo.layers) && combo.layers.includes(layerIndex);
}

export function protectionFor(index, layerIndex, combos) {
  if (Array.isArray(combos)) {
    const hits = combos.filter(
      (c) => !c.deleted && c.positions.includes(index) && comboActiveOnLayer(c, layerIndex)
    );
    if (!hits.length) return null;
    return hits.map((c) => `${comboTitle(c)} (${c.layers === "all" ? "every layer" : "this layer"})`).join(" / ");
  }
  const entry = PROTECTED[index];
  if (!entry) return null;
  if (entry.layers !== "all" && !entry.layers.includes(layerIndex)) return null;
  return entry.why;
}

const LAYER_BEHAVIORS = new Set(["&lt", "&mo", "&to", "&tog"]);

export function layerToken(layerId) {
  return String(layerId || "")
    .replace(/_layer$/, "")
    .toUpperCase();
}

export function displayLayerName(layerId) {
  return String(layerId || "").replace(/_layer$/, "") || "layer";
}

/** Stable editor layer id from a Studio keymap layer. */
export function studioLayerId(studioLayer, index, previousId) {
  const raw = String(studioLayer?.name ?? studioLayer?.id ?? "").trim();
  const name = raw.replace(/_layer$/i, "");
  if (name && !/^\d+$/.test(name)) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `layer_${index}`;
    return slug.endsWith("layer") ? slug : `${slug}_layer`;
  }
  if (previousId) return previousId;
  return `layer_${index}_layer`;
}

export function nextLayerId(layers) {
  let n = (layers || []).length;
  const taken = new Set((layers || []).map((l) => l.id));
  while (taken.has(`layer_${n}`) || taken.has(`layer_${n}_layer`)) n++;
  return `layer_${n}`;
}

export function emptyLayerBindings(count) {
  const n = Number(count);
  if (!n) throw new Error("emptyLayerBindings requires a key count from the layout profile.");
  return Array.from({ length: n }, () => ({ text: "&trans", start: null, end: null }));
}

export function formatLayerNode(layer, count, rowWidths) {
  const n = Number(count ?? layer.bindings?.length ?? 0);
  const cells = [];
  for (let i = 0; i < n; i++) cells.push(layer.bindings?.[i]?.text || "&trans");
  const widths = Array.isArray(rowWidths) && rowWidths.length ? rowWidths : [n];
  const rows = [];
  let at = 0;
  for (const w of widths) {
    rows.push(cells.slice(at, at + w));
    at += w;
  }
  if (at < n) rows.push(cells.slice(at));
  const body = rows.map((r) => `            ${r.join("    ")}`).join("\n");
  return `    ${layer.id} {\n        bindings = <\n${body}\n        >;\n    };\n`;
}

export function indexMapAfterDelete(len, removed) {
  const map = {};
  for (let i = 0; i < len; i++) {
    if (i === removed) continue;
    map[i] = i > removed ? i - 1 : i;
  }
  return map;
}

export function indexMapAfterInsert(len, at) {
  const map = {};
  for (let i = 0; i < len; i++) map[i] = i >= at ? i + 1 : i;
  return map;
}

export function indexMapAfterReorder(from, to, len) {
  const map = {};
  for (let i = 0; i < len; i++) {
    if (i === from) map[i] = to;
    else if (from < to && i > from && i <= to) map[i] = i - 1;
    else if (to < from && i >= to && i < from) map[i] = i + 1;
    else map[i] = i;
  }
  return map;
}

export function remapIndexList(list, oldToNew) {
  if (list === "all" || !Array.isArray(list)) return list;
  return list.map((i) => oldToNew[i]).filter((i) => i != null);
}

export function rewriteLayerToken(text, fromToken, toToken) {
  const parts = String(text || "").trim().split(/\s+/);
  if (!LAYER_BEHAVIORS.has(parts[0]) || parts[1] !== fromToken) return text;
  parts[1] = toToken;
  return parts.join(" ");
}

export function remapNumericLayerArg(text, oldToNew) {
  const parts = String(text || "").trim().split(/\s+/);
  if (!LAYER_BEHAVIORS.has(parts[0]) || !/^\d+$/.test(parts[1] || "")) return text;
  const next = oldToNew[Number(parts[1])];
  if (next == null) return "&trans";
  parts[1] = String(next);
  return parts.join(" ");
}

export function countLayerTokenUses(layers, token) {
  let n = 0;
  for (const layer of layers || []) {
    for (const b of layer.bindings || []) {
      const parts = String(b.text || "").trim().split(/\s+/);
      if (LAYER_BEHAVIORS.has(parts[0]) && parts[1] === token) n++;
    }
  }
  return n;
}

export function neutralizeLayerToken(layers, token) {
  let n = 0;
  for (const layer of layers || []) {
    for (const b of layer.bindings || []) {
      const parts = String(b.text || "").trim().split(/\s+/);
      if (LAYER_BEHAVIORS.has(parts[0]) && parts[1] === token) {
        b.text = "&trans";
        n++;
      }
    }
  }
  return n;
}

export function applyLayerIndexMap(layers, combos, oldToNew) {
  for (const layer of layers || []) {
    for (const b of layer.bindings || []) {
      b.text = remapNumericLayerArg(b.text, oldToNew);
    }
  }
  for (const c of combos || []) {
    if (c.deleted || c.layers === "all") continue;
    const next = remapIndexList(c.layers, oldToNew);
    if (Array.isArray(c.layers) && next.join(",") !== c.layers.join(",")) {
      c.layers = next;
      if (!next.length) c.deleted = true;
      else if (!c.added) c.edited = true;
    }
  }
}

function sliceLayerSource(src, layer, opts = {}) {
  if (layer.start == null || layer.end == null) {
    return formatLayerNode(layer, layer.bindings?.length, opts.rows);
  }
  let slice = src.slice(layer.start, layer.end);
  const rel = (layer.bindings || [])
    .filter((b) => b.start != null && b.end != null && b.text !== src.slice(b.start, b.end))
    .map((b) => ({ start: b.start - layer.start, end: b.end - layer.start, text: b.text }))
    .sort((a, b) => b.start - a.start);
  for (const r of rel) slice = slice.slice(0, r.start) + r.text + slice.slice(r.end);
  const idMatch = slice.match(/^[A-Za-z_][A-Za-z0-9_]*/);
  if (idMatch && idMatch[0] !== layer.id) slice = layer.id + slice.slice(idMatch[0].length);
  return slice;
}

export function applyLayerDefines(src, layers) {
  const tokens = (layers || []).map((l) => layerToken(l.id));
  if (!tokens.length) return src;
  const re = /^#define[ \t]+([A-Z][A-Z0-9_]*)[ \t]+(\d+)[ \t]*$/gm;
  const hits = [];
  let m;
  while ((m = re.exec(src))) {
    if (tokens.includes(m[1]) || !m[1].startsWith("ZMK_")) {
      hits.push({ start: m.index, end: m.index + m[0].length, name: m[1] });
    }
  }
  const block = tokens
    .map((t, i) => `#define ${t.padEnd(4, " ")} ${i}`)
    .join("\n");
  if (!hits.length) {
    const idx = src.search(/\n\/\s*\{/);
    if (idx < 0) return src;
    return src.slice(0, idx) + "\n\n" + block + src.slice(idx);
  }
  const start = hits[0].start;
  const end = hits[hits.length - 1].end;
  return src.slice(0, start) + block + src.slice(end);
}

export function applyLayers(src, layers, opts = {}) {
  const live = (layers || []).filter((l) => !l.deleted);
  const originals = live.filter((l) => l.start != null);
  if (!originals.length) return applyLayerDefines(src, live);
  const from = Math.min(...originals.map((l) => l.start));
  const to = Math.max(...originals.map((l) => l.end));
  const body = live.map((l) => sliceLayerSource(src, l, opts)).join("\n");
  return applyLayerDefines(src.slice(0, from) + body + src.slice(to), live);
}

/** Physical keys whose hold/switch target is this layer (usually thumbs on base). */
export function findLayerActivators(layers, layerIndex) {
  const layer = layers?.[layerIndex];
  if (!layer) return [];
  const name = layerToken(layer.id);
  const found = [];
  const seen = new Set();
  for (const src of layers) {
    src.bindings.forEach((b, i) => {
      const parts = (b.text || "").trim().split(/\s+/);
      if (!LAYER_BEHAVIORS.has(parts[0]) || parts[1] !== name) return;
      if (seen.has(i)) return;
      seen.add(i);
      found.push({ index: i, sourceLayer: src.id, text: b.text });
    });
  }
  return found;
}

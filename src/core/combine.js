/**
 * Unified combination builder: classify a trigger/output sketch as
 * hold-tap, combo, or macro, and build the matching ZMK pieces.
 */

const MOD_TOKENS = new Set([
  "LCTRL",
  "RCTRL",
  "LSHFT",
  "RSHFT",
  "LALT",
  "RALT",
  "LGUI",
  "RGUI",
  "LCTL",
  "RCTL",
  "LSFT",
  "RSFT",
  "LEFT_CONTROL",
  "LEFT_SHIFT",
  "LEFT_ALT",
  "LEFT_GUI",
  "RIGHT_CONTROL",
  "RIGHT_SHIFT",
  "RIGHT_ALT",
  "RIGHT_GUI",
]);

const MOD_NORM = {
  LCTL: "LCTRL",
  RCTL: "RCTRL",
  LSFT: "LSHFT",
  RSFT: "RSHFT",
  LEFT_CONTROL: "LCTRL",
  LEFT_SHIFT: "LSHFT",
  LEFT_ALT: "LALT",
  LEFT_GUI: "LGUI",
  RIGHT_CONTROL: "RCTRL",
  RIGHT_SHIFT: "RSHFT",
  RIGHT_ALT: "RALT",
  RIGHT_GUI: "RGUI",
};

export function normalizeModToken(raw) {
  const t = String(raw || "")
    .trim()
    .replace(/^&kp\s+/i, "")
    .replace(/^&sk\s+/i, "")
    .toUpperCase();
  return MOD_NORM[t] || t;
}

export function isModifierToken(raw) {
  return MOD_TOKENS.has(normalizeModToken(raw));
}

export function modifierFromBinding(text) {
  const parts = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "";
  if ((parts[0] === "&kp" || parts[0] === "&sk") && isModifierToken(parts[1])) {
    return normalizeModToken(parts[1]);
  }
  for (const part of parts.slice(1)) {
    if (isModifierToken(part)) return normalizeModToken(part);
  }
  return "";
}

export function tapTokenFromBinding(text) {
  const parts = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "";
  if (parts[0] === "&kp" || parts[0] === "&sk") {
    return parts.find((p, i) => i > 0 && p && p !== "0" && !isModifierToken(p)) || parts[1] || "";
  }
  if (parts.length >= 3) return parts[parts.length - 1];
  return "";
}

export function defaultModeForBinding(text) {
  return modifierFromBinding(text) ? "hold" : "tap";
}

/** Add or toggle a palette key on the output list. Never replaces the whole list. */
export function appendOutputKey(outputs, text) {
  const list = Array.isArray(outputs) ? outputs : [];
  const binding = String(text || "").trim();
  if (!binding) return list;
  const at = list.findIndex((o) => o.binding === binding);
  if (at >= 0) {
    list.splice(at, 1);
    return list;
  }
  list.push({ binding, mode: defaultModeForBinding(binding) });
  return list;
}

export function asBinding(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  return t.startsWith("&") ? t : `&kp ${t}`;
}

export function resolveHoldMod(trigger) {
  if (!trigger || trigger.mode !== "hold") return "";
  return normalizeModToken(trigger.holdMod) || modifierFromBinding(trigger.binding) || "";
}

const LAYER_BEHS = new Set(["mo", "lt", "sl", "to", "tog"]);

export function layerFromBinding(text) {
  const parts = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const beh = (parts[0] || "").replace(/^&/, "");
  if (LAYER_BEHS.has(beh) && parts[1]) return { behavior: beh, layer: parts[1], binding: parts.join(" ") };
  return null;
}

export function holdChoiceFromBinding(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const layer = layerFromBinding(raw);
  if (layer) return { kind: "layer", layer: layer.layer, behavior: layer.behavior, binding: layer.binding };
  const mod = modifierFromBinding(raw) || (isModifierToken(raw) ? normalizeModToken(raw) : "");
  if (mod) return { kind: "modifier", mod, binding: raw.startsWith("&") ? raw : `&kp ${mod}` };
  const key = tapTokenFromBinding(raw) || raw.replace(/^&kp\s+/, "");
  return { kind: "key", key, binding: asBinding(raw) };
}

export function resolvedHoldChoice(draft = {}) {
  if (draft.holdChoice) return draft.holdChoice;
  const t = draft.triggers?.[0];
  if (t?.mode === "hold" && t.holdMod && isModifierToken(t.holdMod)) {
    return { kind: "modifier", mod: normalizeModToken(t.holdMod), binding: `&kp ${t.holdMod}` };
  }
  if (draft.outputs?.[0]?.binding) return holdChoiceFromBinding(draft.outputs[0].binding);
  return null;
}

export function describeHoldConflict(text, holdIds = []) {
  const parts = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return null;
  const beh = (parts[0] || "").replace(/^&/, "");
  const layer = layerFromBinding(text);
  if (layer) {
    return { kind: "layer-hold", hold: layer.layer, label: `Hold → ${layer.layer} (Layer Hold)` };
  }
  const ids = new Set((holdIds || []).map(String));
  if (beh === "hml" || beh === "hmr" || /^ht_/.test(beh) || ids.has(beh)) {
    const hold = parts[1] && isModifierToken(parts[1]) ? normalizeModToken(parts[1]) : beh;
    return { kind: "hold-tap", hold, label: `Hold → ${hold} (Home-row mod)` };
  }
  if (parts.length >= 3 && isModifierToken(parts[1])) {
    return { kind: "hold-tap", hold: normalizeModToken(parts[1]), label: `Hold → ${normalizeModToken(parts[1])} (Hold-tap)` };
  }
  return null;
}

/** A combo can fire exactly one simple binding. Sequences need a macro. */
export function isSimpleComboOutput(outputs = []) {
  if (!Array.isArray(outputs) || outputs.length !== 1) return false;
  const bind = asBinding(outputs[0]?.binding);
  if (!bind || !bind.startsWith("&")) return false;
  if ((bind.match(/&/g) || []).length > 1) return false;
  if (isBrokenComboBinding(bind)) return false;
  return true;
}

/** Self-referential leftovers like `&combo f p 3` or `&combo_f_p_3`. */
export function isBrokenComboBinding(text) {
  const tok = String(text || "")
    .trim()
    .replace(/^&/, "");
  return /^combo([_\s]|$)/i.test(tok);
}

export function formatMacroStepLine(step = {}) {
  const keys = String(step.keys || "").trim();
  if (step.kind === "press") return `Press   ${keys}`;
  if (step.kind === "tap") return `Tap     ${keys}`;
  if (step.kind === "release") return `Release ${keys}`;
  if (step.kind === "pause") return "Pause   (wait for release)";
  if (step.kind === "wait") return `Wait    ${keys || "100"} ms`;
  return keys;
}

export function formatBuilderDefinition(draft = {}, classified) {
  const info = classified || classifyCombination(draft);
  if (info.kind === "combo") {
    const bind = info.output || asBinding(draft.outputs?.[0]?.binding) || "(none)";
    const timeout = draft.timeout ?? 50;
    const layers = draft.layers === "" || draft.layers == null ? "all" : draft.layers;
    return `Binding:  ${bind}\nTimeout:  ${timeout}\nLayers:   ${layers}`;
  }
  if (info.kind === "macro") {
    const steps = draft.stepsDirty ? draft.steps || [] : macroStepsFromKeys(draft.outputs);
    if (!steps.length) return "Add output keys to generate Press / Tap / Release steps.";
    return steps.map(formatMacroStepLine).join("\n");
  }
  if (info.kind === "remap") return info.binding ? `Binding:  ${info.binding}` : "Pick a remapped output.";
  if (info.kind === "layer-hold") return info.binding || "";
  return "";
}

export function classifyCombination(draft = {}) {
  const triggers = Array.isArray(draft.triggers) ? draft.triggers : [];
  const outputs = Array.isArray(draft.outputs) ? draft.outputs : [];
  if (triggers.length === 1) {
    const t = triggers[0];
    if (t.mode === "hold") {
      const choice = resolvedHoldChoice(draft);
      const tap = t.tap || tapTokenFromBinding(t.binding) || "";
      if (!choice) return { kind: "hold-pick", index: t.index, tap };
      if (choice.kind === "layer") {
        return {
          kind: "layer-hold",
          index: t.index,
          layer: choice.layer,
          behavior: choice.behavior || "lt",
          tap,
          binding: tap ? `&lt ${choice.layer} ${tap}` : `&mo ${choice.layer}`,
        };
      }
      if (choice.kind === "modifier") {
        const setKeys = (draft.setKeys || []).length ? draft.setKeys : [{ index: t.index, hold: choice.mod, tap }];
        if (draft.hrmMode === "set") {
          return { kind: "hold-tap-set", hold: choice.mod, tap, index: t.index, setKeys };
        }
        return { kind: "hold-tap", hold: choice.mod, tap, index: t.index };
      }
      return {
        kind: "hold-tap",
        hold: choice.key || tapTokenFromBinding(choice.binding),
        tap,
        index: t.index,
        holdIsKey: true,
      };
    }
    if (outputs.length > 1) {
      return { kind: "macro", needsCombo: false, bindIndex: t.index };
    }
    return {
      kind: "remap",
      index: t.index,
      binding: outputs[0] ? asBinding(outputs[0].binding) : "",
    };
  }
  if (triggers.length >= 2 && triggers.every((tr) => tr.mode === "hold")) {
    const setKeys = (draft.setKeys || []).length
      ? draft.setKeys
      : triggers.map((tr) => ({
          index: tr.index,
          hold: resolveHoldMod(tr) || draft.holdChoice?.mod || "",
          tap: tr.tap || tapTokenFromBinding(tr.binding) || "",
        }));
    if (draft.hrmMode === "set" || draft.holdChoice?.kind === "modifier" || !outputs.length) {
      return {
        kind: "hold-tap-set",
        hold: setKeys[0]?.hold || draft.holdChoice?.mod,
        tap: setKeys[0]?.tap,
        index: setKeys[0]?.index,
        setKeys,
      };
    }
  }
  if (triggers.length >= 2 && triggers.every((tr) => tr.mode === "tap")) {
    const positions = triggers.map((tr) => tr.index);
    if (!draft.stepsDirty && isSimpleComboOutput(outputs)) {
      return {
        kind: "combo",
        positions,
        output: asBinding(outputs[0].binding),
        needsMacro: false,
      };
    }
    return {
      kind: "macro",
      needsCombo: true,
      needsMacro: true,
      positions,
      bindIndex: null,
    };
  }
  return {
    kind: "macro",
    needsCombo: triggers.length >= 2,
    bindIndex: triggers.length === 1 ? triggers[0].index : null,
  };
}

export function macroStepsFromKeys(keys = []) {
  const holds = keys.filter((k) => k.mode === "hold");
  const taps = keys.filter((k) => k.mode === "tap");
  const steps = [];
  for (const h of holds) {
    const bind = asBinding(h.binding);
    if (bind) steps.push({ kind: "press", keys: bind });
  }
  for (const t of taps) {
    const bind = asBinding(t.binding);
    if (bind) steps.push({ kind: "tap", keys: bind });
  }
  for (const h of [...holds].reverse()) {
    const bind = asBinding(h.binding);
    if (bind) steps.push({ kind: "release", keys: bind });
  }
  return steps;
}

export function keymapStepsFromRuntimeSteps(steps = [], bindingText = () => "") {
  return (steps || []).map((step) => {
    if (step?.kind) return { kind: step.kind, keys: step.keys || "" };
    if (step?.type === "wait") return { kind: "wait", keys: String(step.ms ?? 0) };
    if (step?.type === "pauseUntilRelease") return { kind: "pause", keys: "" };
    return {
      kind: step?.type || "tap",
      keys: bindingText(step?.action) || step?.binding || step?.keys || "",
    };
  });
}

export function outputKeysFromSteps(steps = []) {
  const keys = [];
  let advanced = false;
  for (const step of steps) {
    if (step.kind === "press") keys.push({ binding: step.keys, mode: "hold" });
    else if (step.kind === "tap") keys.push({ binding: step.keys, mode: "tap" });
    else if (step.kind === "release") continue;
    else {
      advanced = true;
      break;
    }
  }
  return { keys, advanced };
}

export function uniqueSlug(base, used = new Set()) {
  const root =
    String(base || "combo")
      .trim()
      .toLowerCase()
      .replace(/^&/, "")
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_|_$/g, "") || "combo";
  if (!used.has(root)) return root;
  let n = 2;
  while (used.has(`${root}_${n}`)) n++;
  return `${root}_${n}`;
}

export function phraseKeys(keys, labelOf) {
  return (keys || [])
    .map((k) => {
      const label = labelOf(k);
      if (!label) return "";
      return k.mode === "hold" ? `Hold ${label}` : `tap ${label}`;
    })
    .filter(Boolean)
    .join(" + ");
}

export function compactOutput(keys, labelOf) {
  const parts = (keys || []).map((k) => labelOf(k)).filter(Boolean);
  if (!parts.length) return "";
  const short = parts.every((p) => String(p).length <= 2);
  return short ? parts.join("") : parts.join("+");
}

export function combinationSummary(draft = {}, labelOf = (k) => k.label || k.binding || "") {
  const classified = classifyCombination(draft);
  const triggers = draft.triggers || [];
  const outputs = draft.outputs || [];
  const trig = phraseKeys(triggers, labelOf);
  const out = compactOutput(outputs, labelOf);
  if (classified.kind === "hold-pick") {
    const key = labelOf(triggers[0]) || `P${classified.index}`;
    return `Hold ${key} — pick a layer, modifier, or key`;
  }
  if (classified.kind === "layer-hold") {
    const key = labelOf(triggers[0]) || `P${classified.index}`;
    return `Hold ${key} → ${classified.layer} (layer hold)`;
  }
  if (classified.kind === "hold-tap-set") {
    const bits = (classified.setKeys || [])
      .map((k) => {
        const name = labelOf({ index: k.index, binding: `&kp ${k.tap || ""}` }) || k.tap || `P${k.index}`;
        const hold = labelOf({ binding: `&kp ${k.hold}`, holdMod: k.hold }) || k.hold;
        return `${name}${hold}`;
      })
      .filter(Boolean);
    return bits.length ? `Home-row set: ${bits.join(" ")}` : "Home-row mod set — add keys and modifiers";
  }
  if (classified.kind === "hold-tap") {
    const key = labelOf(triggers[0]) || `P${classified.index}`;
    const hold = labelOf({ binding: `&kp ${classified.hold}`, holdMod: classified.hold, mode: "hold" }) || classified.hold;
    return classified.holdIsKey
      ? `Hold ${key} sends ${hold} — hold-tap`
      : `Hold ${key} as ${hold} — single home-row mod`;
  }
  if (classified.kind === "remap") {
    const key = labelOf(triggers[0]) || `P${classified.index}`;
    return classified.binding ? `${key} → ${out || labelOf({ binding: classified.binding })}` : `Tap ${key} — pick a remapped output`;
  }
  if (classified.kind === "combo") {
    return out ? `${trig} → ${out}` : `${trig} → pick an output`;
  }
  if (!triggers.length && !outputs.length) return "Click a key on the layout to begin.";
  if (!outputs.length) return `${trig} → pick what it should send`;
  if (!triggers.length) return `Defines a macro that sends ${out}`;
  return `${trig} → sends ${out}`;
}

export function suggestedName(draft = {}, classified) {
  const info = classified || classifyCombination(draft);
  const kind = info.kind;
  const name = String(draft.name || "").trim();
  if (name) return name;
  if (kind === "hold-tap" || kind === "hold-tap-set") {
    const tap = info.tap || tapTokenFromBinding(draft.triggers?.[0]?.binding) || "key";
    if (kind === "hold-tap-set") return "hml";
    return `ht_${String(tap).toLowerCase().replace(/[^a-z0-9]+/g, "") || "key"}`;
  }
  if (kind === "layer-hold") return `mo_${String(info.layer || "layer").toLowerCase()}`;
  if (kind === "remap") return "remap";
  if (kind === "combo") {
    const bits = (draft.triggers || []).map((t) => tapTokenFromBinding(t.binding) || t.index);
    return `combo_${bits.join("_")}`.toLowerCase();
  }
  const outBits = (draft.outputs || [])
    .map((o) => normalizeModToken(tapTokenFromBinding(o.binding) || o.binding) || "")
    .filter(Boolean)
    .slice(0, 4);
  return outBits.length ? `mac_${outBits.join("_")}`.toLowerCase() : "mac_combo";
}

/**
 * Convert parsed .keymap macros, combos, and behaviors into Runtime Config
 * objects. The result is a local draft plus editor binding rewrites. Nothing
 * is written to the keyboard here; Apply still uploads one validated snapshot.
 *
 * Skipped on purpose (behavior would change or firmware cannot represent it):
 * - hold-taps with positional triggers / hold-on-release
 * - combos limited to specific layers (runtime combos are all-layer)
 * - #ifdef-guarded combos
 * - custom C behaviors that are not a runtime engine
 * - nested or unencodable compiled bindings
 */

import { parseBindingText } from "./studio-bind.js";
import { HOLD_TAP_FLAVOR } from "./runtime-config.js";
import {
  RuntimeDraftError,
  capabilitySupportsCombos,
  capabilitySupportsObjectType,
  createRuntimeDraft,
  nextRuntimeComboId,
  nextRuntimeObjectId,
  runtimeBindingText,
  upsertRuntimeCombo,
  upsertRuntimeObject,
} from "./runtime-draft.js";

const HOLD_TAP_FLAVORS = {
  "hold-preferred": HOLD_TAP_FLAVOR.HOLD_PREFERRED,
  balanced: HOLD_TAP_FLAVOR.BALANCED,
  "tap-preferred": HOLD_TAP_FLAVOR.TAP_PREFERRED,
  "tap-unless-interrupted": HOLD_TAP_FLAVOR.TAP_UNLESS_INTERRUPTED,
};

const MOD_BITS = {
  LCTL: 0x01,
  LCTRL: 0x01,
  LSFT: 0x02,
  LSHFT: 0x02,
  LALT: 0x04,
  LGUI: 0x08,
  RCTL: 0x10,
  RCTRL: 0x10,
  RSFT: 0x20,
  RSHFT: 0x20,
  RALT: 0x40,
  RGUI: 0x80,
};

export function importKeymapRuntimeObjects({
  snapshot,
  capabilities,
  layers = [],
  macros = [],
  combos = [],
  behaviors = [],
  studioBehaviors,
  studioLayers,
} = {}) {
  let draft = createRuntimeDraft(snapshot);
  const encodeOpts = { behaviors: studioBehaviors, studioLayers };
  const imported = [];
  const skipped = [];
  const rewrites = [];
  const fileToRuntime = new Map();

  const remember = (fileId, runtimeId) => {
    if (fileId) fileToRuntime.set(fileId, runtimeId);
  };

  for (const macro of macros) {
    if (macro?.deleted) continue;
    const result = importMacro(draft, macro, capabilities, encodeOpts);
    if (result.skip) {
      skipped.push(result.skip);
      continue;
    }
    draft = result.draft;
    imported.push(result.imported);
    remember(macro.id, result.imported.runtimeId);
    rewrites.push(...rewritesForSimpleBinding(layers, macro.id, result.imported.runtimeId));
  }

  for (const behavior of behaviors) {
    if (behavior?.deleted) continue;
    const kind = behavior.kind || "";
    if (kind === "hold-tap") {
      const results = importHoldTaps(draft, behavior, layers, capabilities, encodeOpts);
      draft = results.draft;
      imported.push(...results.imported);
      skipped.push(...results.skipped);
      rewrites.push(...results.rewrites);
      continue;
    }
    if (kind === "mod-morph") {
      const result = importModMorph(draft, behavior, capabilities, encodeOpts);
      if (result.skip) {
        skipped.push(result.skip);
        continue;
      }
      draft = result.draft;
      imported.push(result.imported);
      remember(behavior.id, result.imported.runtimeId);
      rewrites.push(...rewritesForSimpleBinding(layers, behavior.id, result.imported.runtimeId));
      continue;
    }
    if (kind === "tap-dance") {
      const result = importTapDance(draft, behavior, capabilities, encodeOpts);
      if (result.skip) {
        skipped.push(result.skip);
        continue;
      }
      draft = result.draft;
      imported.push(result.imported);
      remember(behavior.id, result.imported.runtimeId);
      rewrites.push(...rewritesForSimpleBinding(layers, behavior.id, result.imported.runtimeId));
      continue;
    }
    skipped.push({
      kind: "behavior",
      id: behavior.id,
      reason: "custom compiled behaviors stay in firmware; runtime cannot load new C code",
    });
  }

  for (const combo of combos) {
    if (combo?.deleted) continue;
    const result = importCombo(draft, combo, capabilities, encodeOpts, fileToRuntime);
    if (result.skip) {
      skipped.push(result.skip);
      continue;
    }
    draft = result.draft;
    imported.push(result.imported);
  }

  return { draft, imported, skipped, rewrites };
}

export function formatRuntimeImportSummary({ imported = [], skipped = [] } = {}) {
  const importedLines = imported.map((item) => `- ${item.kind} ${item.id} → ${item.binding || `id ${item.runtimeId}`}`);
  const skippedLines = skipped.map((item) => `- ${item.kind} ${item.id}: ${item.reason}`);
  const head = imported.length
    ? `Import ${imported.length} keymap definition${imported.length === 1 ? "" : "s"} into the Runtime Config draft?`
    : "Nothing in this keymap can be imported as a runtime object.";
  const parts = [head, ""];
  if (importedLines.length) parts.push("Will import:", ...importedLines, "");
  if (skippedLines.length) parts.push("Skipped:", ...skippedLines, "");
  parts.push("Rewritten keys use &rt <id>. Nothing is written to the keyboard until Apply.");
  return parts.join("\n");
}

function importMacro(draft, macro, capabilities, encodeOpts) {
  if (!capabilitySupportsObjectType(capabilities, "macro")) {
    return { skip: { kind: "macro", id: macro.id, reason: "this firmware does not advertise runtime macros" } };
  }
  const steps = [];
  for (const step of macro.steps || []) {
    if (step.kind === "pause") {
      steps.push({ type: "pauseUntilRelease" });
      continue;
    }
    if (step.kind === "wait") {
      steps.push({ type: "wait", ms: Number(step.keys) || 0 });
      continue;
    }
    if (step.kind === "tap" || step.kind === "press" || step.kind === "release") {
      const bindings = splitMacroBindings(step.keys);
      if (!bindings.length) {
        return { skip: { kind: "macro", id: macro.id, reason: `${step.kind} step has no compiled binding` } };
      }
      for (const binding of bindings) steps.push({ type: step.kind, binding });
      continue;
    }
    return { skip: { kind: "macro", id: macro.id, reason: `unsupported macro step ${step.kind || "raw"}` } };
  }
  if (!steps.length) {
    return { skip: { kind: "macro", id: macro.id, reason: "macro has no steps" } };
  }
  const held = [];
  for (const step of steps) {
    if (step.type === "press") held.push(step.binding);
    if (step.type === "release") held.pop();
  }
  while (held.length) {
    steps.push({ type: "release", binding: held.pop() });
  }
  try {
    const merged = mergeObject(draft, {
      type: "macro",
      steps,
    }, capabilities, encodeOpts);
    const imported = {
      kind: "macro",
      id: macro.id,
      runtimeId: merged.object.id,
      binding: runtimeBindingText(merged.object.id),
      reused: merged.reused,
    };
    if (macro.waitMs) imported.warning = `wait-ms ${macro.waitMs} is file-only; add explicit wait steps if needed`;
    return { draft: merged.draft, imported };
  } catch (error) {
    return { skip: { kind: "macro", id: macro.id, reason: error.message } };
  }
}

function importHoldTaps(draft, behavior, layers, capabilities, encodeOpts) {
  const imported = [];
  const skipped = [];
  const rewrites = [];
  if (!capabilitySupportsObjectType(capabilities, "holdTap")) {
    skipped.push({ kind: "hold-tap", id: behavior.id, reason: "this firmware does not advertise runtime hold-taps" });
    return { draft, imported, skipped, rewrites };
  }
  if (behavior.triggerPositions?.length || behavior.holdOnRelease) {
    skipped.push({
      kind: "hold-tap",
      id: behavior.id,
      reason: "positional hold triggers stay firmware-compiled so homerow timing cannot silently change",
    });
    return { draft, imported, skipped, rewrites };
  }
  const flavor = HOLD_TAP_FLAVORS[behavior.flavor || "balanced"];
  if (!flavor) {
    skipped.push({ kind: "hold-tap", id: behavior.id, reason: `unsupported hold-tap flavor ${behavior.flavor}` });
    return { draft, imported, skipped, rewrites };
  }
  const tappingTermMs = Number(behavior.tappingTerm) || 280;
  const templates = behavior.bindingList || [];
  if (!isParametrizedHoldTap(behavior)) {
    try {
      const merged = mergeObject(draft, {
        type: "holdTap",
        tapBinding: templates[0] || "&kp A",
        holdBinding: templates[1] || templates[0] || "&trans",
        flavor,
        tappingTermMs,
        quickTapMs: Number(behavior.quickTap) || 0,
        requirePriorIdleMs: Number(behavior.priorIdle) || 0,
      }, capabilities, encodeOpts);
      imported.push({
        kind: "hold-tap",
        id: behavior.id,
        runtimeId: merged.object.id,
        binding: runtimeBindingText(merged.object.id),
        reused: merged.reused,
      });
      rewrites.push(...rewritesForSimpleBinding(layers, behavior.id, merged.object.id));
      return { draft: merged.draft, imported, skipped, rewrites };
    } catch (error) {
      skipped.push({ kind: "hold-tap", id: behavior.id, reason: error.message });
      return { draft, imported, skipped, rewrites };
    }
  }

  const instances = uniqueHoldTapInstances(layers, behavior.id);
  if (!instances.length) {
    skipped.push({ kind: "hold-tap", id: behavior.id, reason: "no keymap keys use this hold-tap" });
    return { draft, imported, skipped, rewrites };
  }
  let nextDraft = draft;
  for (const instance of instances) {
    const holdBinding = completeTemplate(templates[0] || "&kp", instance.hold);
    const tapBinding = completeTemplate(templates[1] || templates[0] || "&kp", instance.tap);
    try {
      const merged = mergeObject(nextDraft, {
        type: "holdTap",
        tapBinding,
        holdBinding,
        flavor,
        tappingTermMs,
        quickTapMs: Number(behavior.quickTap) || 0,
        requirePriorIdleMs: Number(behavior.priorIdle) || 0,
      }, capabilities, encodeOpts);
      nextDraft = merged.draft;
      imported.push({
        kind: "hold-tap",
        id: `${behavior.id} ${instance.hold} ${instance.tap}`.trim(),
        runtimeId: merged.object.id,
        binding: runtimeBindingText(merged.object.id),
        reused: merged.reused,
      });
      rewrites.push(
        ...rewritesForParametrizedBinding(layers, behavior.id, instance, merged.object.id)
      );
    } catch (error) {
      skipped.push({
        kind: "hold-tap",
        id: `${behavior.id} ${instance.hold} ${instance.tap}`.trim(),
        reason: error.message,
      });
    }
  }
  return { draft: nextDraft, imported, skipped, rewrites };
}

function importModMorph(draft, behavior, capabilities, encodeOpts) {
  if (!capabilitySupportsObjectType(capabilities, "modMorph")) {
    return { skip: { kind: "mod-morph", id: behavior.id, reason: "this firmware does not advertise runtime mod-morphs" } };
  }
  const modifiers = modMask(behavior.mods);
  if (!modifiers) {
    return { skip: { kind: "mod-morph", id: behavior.id, reason: "mod-morph needs at least one modifier" } };
  }
  const bindings = behavior.bindingList || [];
  try {
    const merged = mergeObject(draft, {
      type: "modMorph",
      modifiers,
      normalBinding: bindings[0] || "&kp DOT",
      morphedBinding: bindings[1] || "&kp COMMA",
    }, capabilities, encodeOpts);
    return {
      draft: merged.draft,
      imported: {
        kind: "mod-morph",
        id: behavior.id,
        runtimeId: merged.object.id,
        binding: runtimeBindingText(merged.object.id),
        reused: merged.reused,
      },
    };
  } catch (error) {
    return { skip: { kind: "mod-morph", id: behavior.id, reason: error.message } };
  }
}

function importTapDance(draft, behavior, capabilities, encodeOpts) {
  if (!capabilitySupportsObjectType(capabilities, "tapDance")) {
    return { skip: { kind: "tap-dance", id: behavior.id, reason: "this firmware does not advertise runtime tap-dances" } };
  }
  const bindings = (behavior.bindingList || []).filter(Boolean);
  if (!bindings.length) {
    return { skip: { kind: "tap-dance", id: behavior.id, reason: "tap-dance has no actions" } };
  }
  try {
    const merged = mergeObject(draft, {
      type: "tapDance",
      tappingTermMs: Number(behavior.tappingTerm) || 200,
      actions: bindings.map((binding) => ({
        tapBinding: binding,
        holdBinding: "&trans",
      })),
    }, capabilities, encodeOpts);
    return {
      draft: merged.draft,
      imported: {
        kind: "tap-dance",
        id: behavior.id,
        runtimeId: merged.object.id,
        binding: runtimeBindingText(merged.object.id),
        reused: merged.reused,
      },
    };
  } catch (error) {
    return { skip: { kind: "tap-dance", id: behavior.id, reason: error.message } };
  }
}

export function comboLinkedMacroId(combo, macroIds) {
  const ids =
    macroIds instanceof Set
      ? macroIds
      : new Set(
          macroIds && typeof macroIds[Symbol.iterator] === "function" ? [...macroIds] : []
        );
  const fromBinding = String(combo?.binding || "")
    .replace(/^&/, "")
    .split(/\s+/)[0];
  if (ids.has(fromBinding)) return fromBinding;
  const fromName = String(combo?.id || "").replace(/^combo_/, "");
  if (fromName && ids.has(fromName)) return fromName;
  return null;
}

function importCombo(draft, combo, capabilities, encodeOpts, fileToRuntime) {
  if (!capabilitySupportsCombos(capabilities)) {
    return { skip: { kind: "combo", id: combo.id, reason: "this firmware does not advertise runtime combos" } };
  }
  if (combo.guarded) {
    return { skip: { kind: "combo", id: combo.id, reason: "ifdef-guarded combos stay firmware-compiled" } };
  }
  const positions = (combo.positions || []).map(Number).filter((position) => Number.isInteger(position) && position >= 0);
  if (positions.length < 2) {
    return { skip: { kind: "combo", id: combo.id, reason: "a combo needs at least two keys" } };
  }
  const linkedMacro = comboLinkedMacroId(combo, new Set(fileToRuntime.keys()));
  const outputBinding = rewriteImportedBinding(
    linkedMacro ? `&${linkedMacro}` : combo.binding,
    fileToRuntime
  );
  try {
    const merged = mergeCombo(draft, {
      keyPositions: positions,
      timeoutMs: Number(combo.timeout) || 50,
      slowRelease: !!combo.slowRelease,
      requirePriorIdleMs: 0,
      layers: combo.layers,
      outputBinding,
    }, capabilities, encodeOpts);
    return {
      draft: merged.draft,
      imported: {
        kind: "combo",
        id: combo.id,
        runtimeId: merged.combo.id,
        binding: outputBinding,
        reused: merged.reused,
      },
    };
  } catch (error) {
    return { skip: { kind: "combo", id: combo.id, reason: error.message } };
  }
}

function mergeObject(draft, fields, capabilities, encodeOpts) {
  const trialId = nextRuntimeObjectId(draft);
  const trial = upsertRuntimeObject(draft, { ...fields, id: trialId }, capabilities, encodeOpts);
  const created = trial.runtimeObjects.find((object) => object.id === trialId);
  if (!created) throw new RuntimeDraftError("failed to stage imported runtime object");
  const existing = draft.runtimeObjects.find((object) => sameObject(object, created));
  if (existing) return { draft, object: existing, reused: true };
  return { draft: trial, object: created, reused: false };
}

function mergeCombo(draft, fields, capabilities, encodeOpts) {
  const trialId = nextRuntimeComboId(draft);
  const trial = upsertRuntimeCombo(draft, { ...fields, id: trialId }, capabilities, encodeOpts);
  const created = trial.combos.find((combo) => combo.id === trialId);
  if (!created) throw new RuntimeDraftError("failed to stage imported runtime combo");
  const existing = draft.combos.find((combo) => sameCombo(combo, created));
  if (existing) return { draft, combo: existing, reused: true };
  return { draft: trial, combo: created, reused: false };
}

function sameObject(left, right) {
  return stable(withoutId(left)) === stable(withoutId(right));
}

function sameCombo(left, right) {
  return stable(withoutId(left)) === stable(withoutId(right));
}

function withoutId(value) {
  const { id, ...rest } = value || {};
  return rest;
}

function stable(value) {
  return JSON.stringify(value);
}

function splitMacroBindings(keys) {
  const src = String(keys || "").trim();
  if (!src) return [];
  const chunks = src.split(/(?=&)/).map((part) => part.trim()).filter(Boolean);
  return chunks.length ? chunks : [src];
}

function isParametrizedHoldTap(behavior) {
  const list = behavior.bindingList || [];
  if (!list.length) return true;
  return list.some((binding) => {
    const parts = String(binding || "").trim().split(/\s+/);
    return parts.length === 1 && parts[0].startsWith("&");
  });
}

function completeTemplate(template, param) {
  const t = String(template || "").trim();
  const p = String(param || "").trim();
  if (!t) return p;
  const parts = t.split(/\s+/);
  if (parts.length === 1 && p) return `${parts[0]} ${p}`;
  return t;
}

function uniqueHoldTapInstances(layers, behaviorId) {
  const seen = new Set();
  const out = [];
  for (const layer of layers || []) {
    for (const binding of layer.bindings || []) {
      const parsed = parseBindingText(binding?.text);
      if (!parsed || parsed.name !== behaviorId || parsed.args.length < 2) continue;
      const hold = parsed.args[0];
      const tap = parsed.args.slice(1).join(" ");
      const key = `${hold}\0${tap}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ hold, tap, text: binding.text });
    }
  }
  return out;
}

function rewritesForSimpleBinding(layers, fileId, runtimeId) {
  const to = runtimeBindingText(runtimeId);
  const out = [];
  (layers || []).forEach((layer, layerIndex) => {
    (layer.bindings || []).forEach((binding, keyIndex) => {
      const parsed = parseBindingText(binding?.text);
      if (parsed?.name === fileId && parsed.args.length === 0) {
        out.push({ layerIndex, keyIndex, from: binding.text, to });
      }
    });
  });
  return out;
}

function rewritesForParametrizedBinding(layers, fileId, instance, runtimeId) {
  const to = runtimeBindingText(runtimeId);
  const out = [];
  (layers || []).forEach((layer, layerIndex) => {
    (layer.bindings || []).forEach((binding, keyIndex) => {
      const parsed = parseBindingText(binding?.text);
      if (
        parsed?.name === fileId &&
        parsed.args[0] === instance.hold &&
        parsed.args.slice(1).join(" ") === instance.tap
      ) {
        out.push({ layerIndex, keyIndex, from: binding.text, to });
      }
    });
  });
  return out;
}

function rewriteImportedBinding(text, fileToRuntime) {
  const parsed = parseBindingText(text);
  if (!parsed) return String(text || "").trim();
  const runtimeId = fileToRuntime.get(parsed.name);
  if (runtimeId && parsed.args.length === 0) return runtimeBindingText(runtimeId);
  return String(text || "").trim();
}

function modMask(names) {
  let mask = 0;
  for (const name of names || []) {
    const bit = MOD_BITS[String(name || "").toUpperCase()];
    if (bit) mask |= bit;
  }
  return mask;
}

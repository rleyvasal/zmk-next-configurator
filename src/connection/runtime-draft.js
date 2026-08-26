import { bindingToCells, cellsToBinding, parseBindingText } from "./studio-bind.js";
import {
  HOLD_TAP_FLAVOR,
  RUNTIME_OBJECT_TYPE,
  compiledAction,
  decodeRuntimeSnapshot,
  encodeRuntimeSnapshot,
  runtimeObjectAction,
  suppressCompiledAction,
} from "./runtime-config.js";

export class RuntimeDraftError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = "RuntimeDraftError";
    this.issues = issues;
  }
}

export const RUNTIME_BINDING = "rt";

export const RUNTIME_MODIFIERS = Object.freeze([
  ["LCTRL", 0x01, "Ctrl"],
  ["LSHFT", 0x02, "Shift"],
  ["LALT", 0x04, "Alt"],
  ["LGUI", 0x08, "GUI"],
  ["RCTRL", 0x10, "Ctrl R"],
  ["RSHFT", 0x20, "Shift R"],
  ["RALT", 0x40, "Alt R"],
  ["RGUI", 0x80, "GUI R"],
]);

export const RUNTIME_OBJECT_TYPES = Object.freeze(["modMorph", "macro", "holdTap", "tapDance"]);

const OBJECT_TYPE_CAPABILITY = {
  modMorph: RUNTIME_OBJECT_TYPE.MOD_MORPH,
  macro: RUNTIME_OBJECT_TYPE.MACRO,
  holdTap: RUNTIME_OBJECT_TYPE.HOLD_TAP,
  tapDance: RUNTIME_OBJECT_TYPE.TAP_DANCE,
};

const FEATURE = {
  KEYMAP_OVERRIDES: 1,
  COMBOS: 3,
  MOD_MORPHS: 4,
  MACROS: 5,
  HOLD_TAPS: 6,
  TAP_DANCES: 7,
  COMBO_SUPPRESS_COMPILED: 14,
};

const OBJECT_TYPE_FEATURE = {
  modMorph: FEATURE.MOD_MORPHS,
  macro: FEATURE.MACROS,
  holdTap: FEATURE.HOLD_TAPS,
  tapDance: FEATURE.TAP_DANCES,
};

/**
 * Produce an immutable, normalized local draft from the device's active
 * snapshot. Encoding then decoding keeps Uint8Array fields intact and ensures
 * UI code never shares nested references with the last device readback.
 */
export function createRuntimeDraft(snapshot) {
  return decodeRuntimeSnapshot(encodeRuntimeSnapshot(snapshot));
}

export function runtimeBindingText(objectId) {
  return `&${RUNTIME_BINDING} ${Number(objectId)}`;
}

export function parseRuntimeObjectId(text) {
  const parsed = parseBindingText(text);
  if (!parsed || parsed.name !== RUNTIME_BINDING) return null;
  const id = Number(parsed.args[0]);
  if (!Number.isInteger(id) || id < 1) return null;
  return id;
}

export function isRuntimeObjectBinding(text) {
  return parseRuntimeObjectId(text) != null;
}

export function capabilityHas(capabilities, feature) {
  return (capabilities?.supportedFeatures || []).includes(feature);
}

export function capabilitySupportsObjectType(capabilities, type) {
  const objectType = OBJECT_TYPE_CAPABILITY[type];
  const feature = OBJECT_TYPE_FEATURE[type];
  if (!objectType || !feature) return false;
  const types = capabilities?.supportedObjectTypes || [];
  return types.includes(objectType) && capabilityHas(capabilities, feature);
}

export function capabilitySupportsCombos(capabilities) {
  return capabilityHas(capabilities, FEATURE.COMBOS);
}

export function capabilitySupportsComboSuppression(capabilities) {
  return capabilitySupportsCombos(capabilities) && capabilityHas(capabilities, FEATURE.COMBO_SUPPRESS_COMPILED);
}

export function supportedRuntimeEditorTypes(capabilities) {
  const types = RUNTIME_OBJECT_TYPES.filter((type) => capabilitySupportsObjectType(capabilities, type));
  if (capabilitySupportsCombos(capabilities)) types.push("combo");
  return types;
}

export function findRuntimeObject(snapshot, objectId) {
  return (snapshot?.runtimeObjects || []).find((object) => object.id === Number(objectId)) || null;
}

export function findRuntimeCombo(snapshot, comboId) {
  return (snapshot?.combos || []).find((combo) => combo.id === Number(comboId)) || null;
}

export function nextRuntimeObjectId(snapshot) {
  return nextId((snapshot?.runtimeObjects || []).map((object) => object.id));
}

export function nextRuntimeComboId(snapshot) {
  return nextId((snapshot?.combos || []).map((combo) => combo.id));
}

function nextId(ids) {
  let max = 0;
  for (const id of ids) {
    const value = Number(id);
    if (Number.isInteger(value) && value > max) max = value;
  }
  return max + 1;
}

export function selectedToStockMap(capabilities, keyCount) {
  return stockPositions(capabilities, keyCount);
}

export function runtimeIssuesFromDiagnostics(diagnostics, capabilities) {
  return (diagnostics || []).map((diagnostic) => {
    if (diagnostic.runtimeObjectId) {
      return {
        kind: "object",
        id: diagnostic.runtimeObjectId,
        message: diagnostic.message || diagnostic.fieldPath || "invalid runtime object",
        fieldPath: diagnostic.fieldPath,
      };
    }
    if (diagnostic.comboId) {
      return {
        kind: "combo",
        id: diagnostic.comboId,
        message: diagnostic.message || diagnostic.fieldPath || "invalid runtime combo",
        fieldPath: diagnostic.fieldPath,
      };
    }
    if (diagnostic.keyLocation) {
      return {
        kind: "key",
        layerId: diagnostic.keyLocation.layerId,
        stockPosition: diagnostic.keyLocation.keyPosition,
        selectedIndex: stockToSelectedIndex(capabilities, diagnostic.keyLocation.keyPosition),
        message: diagnostic.message || diagnostic.fieldPath || "invalid keymap override",
        fieldPath: diagnostic.fieldPath,
      };
    }
    return { kind: "generic", message: diagnostic.message || diagnostic.fieldPath || "Runtime Config validation failed" };
  });
}

export function runtimeIssuesFromDraftError(error) {
  const issues = error?.issues || [];
  if (!issues.length) return [{ kind: "generic", message: error?.message || "Runtime Config draft is invalid" }];
  return issues.map((issue) => {
    if (issue.position != null || issue.layerIndex != null) {
      return {
        kind: "key",
        layerIndex: issue.layerIndex,
        selectedIndex: issue.position,
        message: issue.reason || error.message,
        text: issue.text,
      };
    }
    return { kind: "generic", message: issue.reason || error.message };
  });
}

export function stockToSelectedIndex(capabilities, stockPosition) {
  const positions = capabilities?.selectedToStockPositions;
  if (!Array.isArray(positions)) return -1;
  return positions.indexOf(Number(stockPosition));
}

export function selectedIndexesToStock(capabilities, selectedIndexes) {
  const positions = capabilities?.selectedToStockPositions || [];
  return selectedIndexes.map((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= positions.length) {
      throw new RuntimeDraftError(`Combo key P${index} is not in this keyboard's selected layout`);
    }
    return positions[index];
  });
}

export function comboLayerMask(layers) {
  if (layers == null || layers === "all" || layers === "") return 0;
  const list = Array.isArray(layers)
    ? layers
    : String(layers)
        .trim()
        .split(/[,\s]+/)
        .filter(Boolean)
        .map(Number);
  let mask = 0;
  for (const layer of list) {
    const n = Number(layer);
    if (!Number.isInteger(n) || n < 0 || n > 31) {
      throw new RuntimeDraftError("Combo layers must be 0–31 or blank for every layer");
    }
    mask |= 1 << n;
  }
  return mask >>> 0;
}

export function comboLayersFromMask(mask) {
  const value = Number(mask) >>> 0;
  if (!value) return "all";
  const layers = [];
  for (let i = 0; i < 32; i++) {
    if (value & (1 << i)) layers.push(i);
  }
  return layers;
}

export function runtimeComboActiveOnLayer(combo, layerIndex) {
  const mask = Number(combo?.layerMask) >>> 0;
  if (!mask) return true;
  const layer = Number(layerIndex);
  if (!Number.isInteger(layer) || layer < 0 || layer > 31) return false;
  return (mask & (1 << layer)) !== 0;
}

export function stockPositionsToSelectedIndexes(capabilities, stockPositionsList) {
  return (stockPositionsList || [])
    .map((position) => stockToSelectedIndex(capabilities, position))
    .filter((index) => index >= 0);
}

export function runtimeResourceUsage(snapshot) {
  const objects = snapshot?.runtimeObjects || [];
  const combos = snapshot?.combos || [];
  return {
    runtimeObjects: objects.length,
    combos: combos.length,
    macroSteps: objects.reduce((sum, object) => sum + (object.type === "macro" ? object.steps?.length || 0 : 0), 0),
    tapDanceActions: objects.reduce(
      (sum, object) => sum + (object.type === "tapDance" ? object.actions?.length || 0 : 0),
      0
    ),
    keymapOverrides: snapshot?.keymapOverrides?.length || 0,
  };
}

export function runtimeResourceRows(usage, capabilities) {
  const limits = capabilities?.limits || {};
  return [
    ["runtimeObjects", "maxRuntimeObjects", "objects"],
    ["combos", "maxCombos", "combos"],
    ["macroSteps", "maxMacroSteps", "macro steps"],
    ["tapDanceActions", "maxTapDanceActions", "tap-dance actions"],
    ["keymapOverrides", "maxKeymapOverrides", "keymap overrides"],
  ].map(([usedKey, limitKey, label]) => {
    const used = Number(usage?.[usedKey]) || 0;
    const limit = Number(limits[limitKey]);
    const finite = Number.isFinite(limit);
    return {
      key: usedKey,
      label,
      used,
      limit: finite ? limit : null,
      over: finite && used > limit,
    };
  });
}

export function runtimeResourceOverLimit(usage, capabilities) {
  const limits = capabilities?.limits || {};
  const checks = [
    ["runtimeObjects", "maxRuntimeObjects", "runtime objects"],
    ["combos", "maxCombos", "combos"],
    ["macroSteps", "maxMacroSteps", "macro steps"],
    ["tapDanceActions", "maxTapDanceActions", "tap-dance actions"],
    ["keymapOverrides", "maxKeymapOverrides", "keymap overrides"],
  ];
  for (const [usedKey, limitKey, label] of checks) {
    const used = usage[usedKey];
    const limit = Number(limits[limitKey]);
    if (Number.isFinite(limit) && used > limit) {
      return `${used} ${label}, but this firmware reserves ${limit}`;
    }
  }
  return null;
}

/**
 * Keys and combos that still point at a runtime object. Deleting the object
 * without rewriting those references would make the next snapshot invalid.
 */
export function runtimeObjectReferences(snapshot, objectId, capabilities) {
  const id = Number(objectId);
  const keys = [];
  for (const override of snapshot?.keymapOverrides || []) {
    if (override?.action?.runtimeObjectId === id) {
      keys.push({
        layerId: override.layerId,
        keyPosition: override.keyPosition,
        selectedIndex: stockToSelectedIndex(capabilities, override.keyPosition),
      });
    }
  }
  const combos = [];
  for (const combo of snapshot?.combos || []) {
    if (combo?.output?.runtimeObjectId === id) {
      combos.push({ id: combo.id });
    }
  }
  return { keys, combos };
}

export function bindingTextFromAction(action, { behaviors, studioLayers } = {}) {
  if (!action) return "";
  if (action.suppressCompiled) return "suppress compiled combo";
  if (action.runtimeObjectId) return runtimeBindingText(action.runtimeObjectId);
  if (action.compiledBehavior) {
    const decoded = cellsToBinding(
      {
        behaviorId: action.compiledBehavior.behaviorId,
        rawBehaviorId: action.compiledBehavior.behaviorId,
        param1: action.compiledBehavior.param1,
        param2: action.compiledBehavior.param2,
      },
      behaviors,
      studioLayers
    );
    return decoded.ok ? decoded.text : "";
  }
  return "";
}

export function actionFromBindingText(text, { behaviors, studioLayers, allowRuntimeObject = false, snapshot } = {}) {
  const objectId = parseRuntimeObjectId(text);
  if (objectId != null) {
    if (!allowRuntimeObject) {
      throw new RuntimeDraftError("Runtime objects cannot nest inside other runtime objects");
    }
    if (snapshot && !findRuntimeObject(snapshot, objectId)) {
      throw new RuntimeDraftError(`Runtime object ${objectId} is not in this draft`);
    }
    return runtimeObjectAction(objectId);
  }
  const binding = bindingToCells(text, behaviors, studioLayers);
  if (!binding.ok) throw new RuntimeDraftError(binding.reason || "Cannot encode binding");
  if (!binding.name || binding.name === RUNTIME_BINDING) {
    throw new RuntimeDraftError("compiled runtime-object bindings are not valid ActionRefs");
  }
  return compiledAction(binding.binding.behaviorId, binding.binding.param1, binding.binding.param2);
}

export function upsertRuntimeObject(snapshot, object, capabilities, { behaviors, studioLayers } = {}) {
  const draft = createRuntimeDraft(snapshot);
  const type = object?.type;
  if (!capabilitySupportsObjectType(capabilities, type)) {
    throw new RuntimeDraftError(`${type || "This object type"} is not advertised by this firmware`);
  }
  const normalized = normalizeRuntimeObject(object, { behaviors, studioLayers, snapshot: draft });
  const existing = draft.runtimeObjects.findIndex((item) => item.id === normalized.id);
  if (existing >= 0) draft.runtimeObjects[existing] = normalized;
  else draft.runtimeObjects.push(normalized);
  const over = runtimeResourceOverLimit(runtimeResourceUsage(draft), capabilities);
  if (over) throw new RuntimeDraftError(`Runtime Config needs ${over}`);
  return draft;
}

export function deleteRuntimeObject(snapshot, objectId, { force = false, capabilities } = {}) {
  const draft = createRuntimeDraft(snapshot);
  const id = Number(objectId);
  if (!findRuntimeObject(draft, id)) throw new RuntimeDraftError(`Runtime object ${id} is not in this draft`);
  const refs = runtimeObjectReferences(draft, id, capabilities);
  if (!force && (refs.keys.length || refs.combos.length)) {
    const where = [
      ...refs.keys.map((key) => `L${key.layerId} P${key.selectedIndex >= 0 ? key.selectedIndex : key.keyPosition}`),
      ...refs.combos.map((combo) => `combo ${combo.id}`),
    ].join(", ");
    throw new RuntimeDraftError(`Runtime object ${id} is still used by ${where}`, [refs]);
  }
  draft.runtimeObjects = draft.runtimeObjects.filter((object) => object.id !== id);
  if (force) {
    draft.keymapOverrides = draft.keymapOverrides.filter((override) => override.action?.runtimeObjectId !== id);
    for (const combo of draft.combos) {
      if (combo.output?.runtimeObjectId === id) {
        throw new RuntimeDraftError(`Combo ${combo.id} still targets runtime object ${id}; change its output first`);
      }
    }
  }
  return draft;
}

export function upsertRuntimeCombo(snapshot, combo, capabilities, { behaviors, studioLayers } = {}) {
  const draft = createRuntimeDraft(snapshot);
  if (!capabilitySupportsCombos(capabilities)) {
    throw new RuntimeDraftError("This firmware does not advertise runtime combos");
  }
  const normalized = normalizeRuntimeCombo(combo, { behaviors, studioLayers, snapshot: draft, capabilities });
  const existing = draft.combos.findIndex((item) => item.id === normalized.id);
  if (existing >= 0) draft.combos[existing] = normalized;
  else draft.combos.push(normalized);
  const over = runtimeResourceOverLimit(runtimeResourceUsage(draft), capabilities);
  if (over) throw new RuntimeDraftError(`Runtime Config needs ${over}`);
  return draft;
}

export function deleteRuntimeCombo(snapshot, comboId) {
  const draft = createRuntimeDraft(snapshot);
  const id = Number(comboId);
  if (!findRuntimeCombo(draft, id)) throw new RuntimeDraftError(`Runtime combo ${id} is not in this draft`);
  draft.combos = draft.combos.filter((combo) => combo.id !== id);
  return draft;
}

function stockPositions(capabilities, keyCount) {
  const count = Number(capabilities?.selectedPositionCount);
  const positions = capabilities?.selectedToStockPositions;
  if (!Array.isArray(positions) || count !== keyCount || positions.length !== keyCount) {
    throw new RuntimeDraftError(
      "Keyboard did not provide a complete selected-layout to stock-position map"
    );
  }

  const seen = new Set();
  for (const position of positions) {
    if (!Number.isInteger(position) || position < 0 || position > 0xffff || seen.has(position)) {
      throw new RuntimeDraftError("Keyboard reported an invalid selected-layout position map");
    }
    seen.add(position);
  }
  return positions;
}

function requireAction(action, binding, options, name) {
  if (action?.suppressCompiled) {
    if (!options.allowSuppressCompiled) {
      throw new RuntimeDraftError("Suppress-compiled actions are only valid as combo output");
    }
    return suppressCompiledAction();
  }
  if (action?.compiledBehavior) {
    const compiled = action.compiledBehavior;
    if (!compiled.behaviorId) throw new RuntimeDraftError(`${name} is required`);
    if (!options.allowRuntimeObject && parseRuntimeObjectId(binding)) {
      throw new RuntimeDraftError("Runtime objects cannot nest inside other runtime objects");
    }
    return compiledAction(compiled.behaviorId, compiled.param1, compiled.param2);
  }
  if (action?.runtimeObjectId) {
    if (!options.allowRuntimeObject) {
      throw new RuntimeDraftError("Runtime objects cannot nest inside other runtime objects");
    }
    if (options.snapshot && !findRuntimeObject(options.snapshot, action.runtimeObjectId)) {
      throw new RuntimeDraftError(`Runtime object ${action.runtimeObjectId} is not in this draft`);
    }
    return runtimeObjectAction(action.runtimeObjectId);
  }
  if (!String(binding || "").trim()) throw new RuntimeDraftError(`${name} is required`);
  return actionFromBindingText(binding, options);
}

function requireCompiledAction(action, binding, options, name) {
  return requireAction(action, binding, { ...options, allowRuntimeObject: false }, name);
}

function normalizeRuntimeObject(object, options) {
  const id = Number(object?.id);
  if (!Number.isInteger(id) || id < 1) throw new RuntimeDraftError("Runtime object ID must be a positive integer");
  switch (object.type) {
    case "modMorph": {
      const modifiers = Number(object.modifiers);
      if (!Number.isInteger(modifiers) || modifiers < 1 || modifiers > 0xff) {
        throw new RuntimeDraftError("Mod-morph needs at least one modifier");
      }
      return {
        id,
        type: "modMorph",
        modifiers,
        normalAction: requireCompiledAction(object.normalAction, object.normalBinding, options, "normal action"),
        morphedAction: requireCompiledAction(object.morphedAction, object.morphedBinding, options, "morphed action"),
      };
    }
    case "macro": {
      const steps = Array.isArray(object.steps) ? object.steps : [];
      if (!steps.length) throw new RuntimeDraftError("A runtime macro needs at least one step");
      const normalized = steps.map((step, index) => normalizeMacroStep(step, options, index));
      assertMacroBalance(normalized);
      return { id, type: "macro", steps: normalized };
    }
    case "holdTap": {
      const flavor = Number(object.flavor);
      if (!Object.values(HOLD_TAP_FLAVOR).includes(flavor)) {
        throw new RuntimeDraftError("Hold-tap flavor is not supported");
      }
      const tappingTermMs = Number(object.tappingTermMs);
      if (!Number.isInteger(tappingTermMs) || tappingTermMs < 1) {
        throw new RuntimeDraftError("Hold-tap tapping term must be a positive number of milliseconds");
      }
      return {
        id,
        type: "holdTap",
        tapAction: requireCompiledAction(object.tapAction, object.tapBinding, options, "tap action"),
        holdAction: requireCompiledAction(object.holdAction, object.holdBinding, options, "hold action"),
        flavor,
        tappingTermMs,
        quickTapMs: Number(object.quickTapMs) || 0,
        requirePriorIdleMs: Number(object.requirePriorIdleMs) || 0,
      };
    }
    case "tapDance": {
      const actions = Array.isArray(object.actions) ? object.actions : [];
      if (!actions.length) throw new RuntimeDraftError("A tap-dance needs at least one tap count");
      const tappingTermMs = Number(object.tappingTermMs);
      if (!Number.isInteger(tappingTermMs) || tappingTermMs < 1) {
        throw new RuntimeDraftError("Tap-dance tapping term must be a positive number of milliseconds");
      }
      return {
        id,
        type: "tapDance",
        tappingTermMs,
        actions: actions.map((action, index) => ({
          tapCount: index + 1,
          tapAction: requireCompiledAction(action.tapAction, action.tapBinding, options, `tap ${index + 1}`),
          holdAction: requireCompiledAction(action.holdAction, action.holdBinding, options, `hold ${index + 1}`),
        })),
      };
    }
    default:
      throw new RuntimeDraftError(`Unsupported runtime object type ${object?.type}`);
  }
}

function normalizeMacroStep(step, options, index) {
  const type = step?.type;
  const where = `macro step ${index + 1}`;
  if (type === "wait") {
    const ms = Number(step.ms);
    if (!Number.isInteger(ms) || ms < 0) throw new RuntimeDraftError(`${where} wait must be 0 or more milliseconds`);
    return { type: "wait", ms };
  }
  if (type === "pauseUntilRelease") return { type: "pauseUntilRelease" };
  if (type === "tap" || type === "press" || type === "release") {
    return { type, action: requireCompiledAction(step.action, step.binding, options, where) };
  }
  throw new RuntimeDraftError(`${where} has an unsupported instruction`);
}

function assertMacroBalance(steps) {
  const key = (action) =>
    action?.compiledBehavior
      ? `${action.compiledBehavior.behaviorId}:${action.compiledBehavior.param1}:${action.compiledBehavior.param2}`
      : "";
  const counts = new Map();
  for (const step of steps) {
    if (step.type !== "press" && step.type !== "release") continue;
    const id = key(step.action);
    const current = counts.get(id) || { press: 0, release: 0 };
    current[step.type] += 1;
    counts.set(id, current);
  }
  for (const { press, release } of counts.values()) {
    if (press !== release) {
      throw new RuntimeDraftError("Macro press and release steps must balance so a key cannot stay held");
    }
  }
}

function normalizeRuntimeCombo(combo, { behaviors, studioLayers, snapshot, capabilities }) {
  const id = Number(combo?.id);
  if (!Number.isInteger(id) || id < 1) throw new RuntimeDraftError("Combo ID must be a positive integer");
  const timeoutMs = Number(combo.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new RuntimeDraftError("Combo timeout must be a positive number of milliseconds");
  }
  let positions = Array.isArray(combo.keyPositions) ? combo.keyPositions.map(Number) : [];
  if (Array.isArray(combo.selectedPositions)) {
    positions = selectedIndexesToStock(capabilities, combo.selectedPositions.map(Number));
  }
  if (positions.length < 2) throw new RuntimeDraftError("A combo needs at least two keys");
  const maxKeys = Number(capabilities?.limits?.maxComboKeys);
  if (Number.isFinite(maxKeys) && positions.length > maxKeys) {
    throw new RuntimeDraftError(`This firmware allows ${maxKeys} keys per combo`);
  }
  const unique = new Set();
  for (const position of positions) {
    if (!Number.isInteger(position) || position < 0 || unique.has(position)) {
      throw new RuntimeDraftError("Combo keys must be distinct stock positions");
    }
    unique.add(position);
  }
  const output = requireAction(combo.output, combo.outputBinding, {
    behaviors,
    studioLayers,
    allowRuntimeObject: true,
    allowSuppressCompiled: true,
    snapshot,
  }, "combo output");
  return {
    id,
    keyPositions: positions,
    timeoutMs,
    output,
    slowRelease: !!combo.slowRelease,
    requirePriorIdleMs: Number(combo.requirePriorIdleMs) || 0,
    layerMask: comboLayerMask(combo.layers ?? comboLayersFromMask(combo.layerMask)),
  };
}

export function isStockCompiledBindingReason(reason) {
  const text = String(reason || "");
  if (/runtime object .* is not in this draft/i.test(text)) return false;
  return /no Studio parameter metadata|is not in this firmware|cannot be applied live|not live-editable|download and flash/i.test(
    text
  );
}

function normalizeBindingText(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ");
}

export function bindingsMatchForOverlay(editorText, compiledText) {
  const editor = normalizeBindingText(editorText);
  const compiled = normalizeBindingText(compiledText);
  if (editor === compiled) return true;
  // &trans/&none take no real params, but some firmware reports their param1/
  // param2 as a generic (non-nil) kind, so the decoder pads them with literal
  // zero args ("&trans 0 0") instead of the editor's own bare "&trans" - not
  // an actual override, just two encodings of the same no-op binding.
  const empty = (value) => !value || /^&(none|trans)(\s+0)*$/.test(value);
  return empty(editor) && empty(compiled);
}

/**
 * Replace only a draft's ordinary keymap overlay from the editor. Runtime
 * objects and combos already in the draft remain intact until their dedicated
 * editors update them. editorLayers use the selected physical-layout order;
 * the capability map converts that into firmware's canonical stock positions.
 *
 * `&rt <id>` becomes a runtime-object ActionRef. Firmware rejects compiled
 * `&rt` bindings inside ActionRefs, so this must never encode that behavior
 * as a compiled action.
 */
export function replaceDraftKeymapOverrides({
  snapshot,
  capabilities,
  editorLayers,
  deviceLayerIds,
  behaviors,
  studioLayers,
  compiledBindingTexts,
}) {
  const draft = createRuntimeDraft(snapshot);
  const layers = Array.isArray(editorLayers) ? editorLayers : [];
  const layerIds = Array.isArray(deviceLayerIds) ? deviceLayerIds : [];
  if (!layers.length) throw new RuntimeDraftError("There are no editor layers to apply");
  if (layers.length !== layerIds.length) {
    throw new RuntimeDraftError("Editor layers do not match the connected keyboard");
  }

  const keyCount = layers[0]?.bindings?.length || 0;
  if (!keyCount || layers.some((layer) => layer?.bindings?.length !== keyCount)) {
    throw new RuntimeDraftError("Editor layers have inconsistent key counts");
  }
  const selectedToStock = stockPositions(capabilities, keyCount);
  const overrides = [];
  const issues = [];

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layerId = layerIds[layerIndex];
    if (!Number.isInteger(layerId) || layerId < 0 || layerId > 0xff) {
      issues.push({ layerIndex, reason: "layer is not present in this firmware" });
      continue;
    }
    for (let position = 0; position < keyCount; position++) {
      const text = layers[layerIndex].bindings[position]?.text || "";
      const compiledText = compiledBindingTexts?.[layerIndex]?.[position];
      if (compiledText != null && bindingsMatchForOverlay(text, compiledText)) {
        continue;
      }
      try {
        overrides.push({
          layerId,
          keyPosition: selectedToStock[position],
          action: actionFromBindingText(text, {
            behaviors,
            studioLayers,
            allowRuntimeObject: true,
            snapshot: draft,
          }),
        });
      } catch (error) {
        const reason = error instanceof RuntimeDraftError ? error.message : String(error.message || error);
        issues.push({ layerIndex, position, text, reason });
      }
    }
  }

  const skippedBindings = issues.filter((issue) => isStockCompiledBindingReason(issue.reason));
  const fatal = issues.filter((issue) => !isStockCompiledBindingReason(issue.reason));
  if (fatal.length) {
    const first = fatal[0];
    const where = first.position == null ? `layer ${first.layerIndex}` : `L${first.layerIndex} P${first.position}`;
    throw new RuntimeDraftError(`Cannot build Runtime Config draft at ${where}: ${first.reason}`, fatal);
  }

  const limit = Number(capabilities?.limits?.maxKeymapOverrides);
  if (Number.isFinite(limit) && overrides.length > limit) {
    throw new RuntimeDraftError(
      `Runtime Config needs ${overrides.length} keymap overrides, but this firmware reserves ${limit}`
    );
  }

  draft.keymapOverrides = overrides;
  Object.defineProperty(draft, "skippedBindings", {
    value: skippedBindings,
    enumerable: false,
  });
  return draft;
}

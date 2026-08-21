/**
 * Portable editor document for Runtime Config snapshots.
 *
 * This is not the firmware Settings payload and not the protobuf wire format.
 * Bindings use symbolic names (&kp A, &mo NAV, &rt 12) so a document can be
 * inspected and moved between matching firmware builds.
 */

import { HOLD_TAP_FLAVOR } from "./runtime-config.js";
import {
  RUNTIME_MODIFIERS,
  RuntimeDraftError,
  actionFromBindingText,
  bindingTextFromAction,
  createRuntimeDraft,
  runtimeBindingText,
  upsertRuntimeCombo,
  upsertRuntimeObject,
} from "./runtime-draft.js";

export const RUNTIME_DOCUMENT_FORMAT = "zmk-next-runtime-document";
export const RUNTIME_DOCUMENT_VERSION = 1;

const FLAVOR_NAME = {
  [HOLD_TAP_FLAVOR.HOLD_PREFERRED]: "hold-preferred",
  [HOLD_TAP_FLAVOR.BALANCED]: "balanced",
  [HOLD_TAP_FLAVOR.TAP_PREFERRED]: "tap-preferred",
  [HOLD_TAP_FLAVOR.TAP_UNLESS_INTERRUPTED]: "tap-unless-interrupted",
};

const FLAVOR_ID = Object.fromEntries(Object.entries(FLAVOR_NAME).map(([id, name]) => [name, Number(id)]));

export function isRuntimeDocument(value) {
  return !!value && value.format === RUNTIME_DOCUMENT_FORMAT;
}

export function parseRuntimeDocument(input) {
  const value = typeof input === "string" ? JSON.parse(input) : input;
  if (!isRuntimeDocument(value)) {
    throw new RuntimeDraftError("File is not a ZMK Next Runtime Config document");
  }
  if (Number(value.version) !== RUNTIME_DOCUMENT_VERSION) {
    throw new RuntimeDraftError(`Runtime document version ${value.version} is not supported`);
  }
  return value;
}

export function encodeRuntimeDocument({
  snapshot,
  capabilities,
  profile,
  behaviors,
  studioLayers,
} = {}) {
  const draft = createRuntimeDraft(snapshot);
  const opts = { behaviors, studioLayers };
  return {
    format: RUNTIME_DOCUMENT_FORMAT,
    version: RUNTIME_DOCUMENT_VERSION,
    keyboard: profile?.id || "",
    keyboardName: profile?.name || "",
    protocolVersion: Number(capabilities?.protocolVersion) || 1,
    persistenceSchemaVersion: draft.persistenceSchemaVersion,
    capabilityFingerprint: bytesToHex(draft.capabilityFingerprint),
    objects: (draft.runtimeObjects || []).map((object) => encodeObject(object, opts)),
    combos: (draft.combos || []).map((combo) => encodeCombo(combo, opts)),
    keymap: (draft.keymapOverrides || []).map((override) => ({
      layerId: override.layerId,
      stockPosition: override.keyPosition,
      binding: bindingTextFromAction(override.action, opts),
    })),
  };
}

export function stringifyRuntimeDocument(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function applyRuntimeDocument({
  document,
  snapshot,
  capabilities,
  behaviors,
  studioLayers,
} = {}) {
  const parsed = parseRuntimeDocument(document);
  if (Number(parsed.protocolVersion) && Number(parsed.protocolVersion) !== 1) {
    throw new RuntimeDraftError(
      `Runtime document protocol ${parsed.protocolVersion} is incompatible with this editor`
    );
  }
  const warnings = [];
  const deviceHex = bytesToHex(snapshot?.capabilityFingerprint || capabilities?.capabilityFingerprint);
  if (parsed.capabilityFingerprint && deviceHex && parsed.capabilityFingerprint !== deviceHex) {
    warnings.push("Document firmware fingerprint does not match this keyboard; bindings are re-encoded for the connected build.");
  }
  let draft = createRuntimeDraft({
    ...snapshot,
    keymapOverrides: [],
    runtimeObjects: [],
    combos: [],
  });
  const encodeOpts = { behaviors, studioLayers };
  const idMap = new Map();
  const imported = [];
  const skipped = [];

  for (const object of parsed.objects || []) {
    try {
      const fields = decodeObject(object);
      const preferredId = Number(object.id);
      const id =
        Number.isInteger(preferredId) && preferredId > 0 && !draft.runtimeObjects.some((item) => item.id === preferredId)
          ? preferredId
          : nextFreeObjectId(draft);
      draft = upsertRuntimeObject(draft, { ...fields, id }, capabilities, encodeOpts);
      if (preferredId && preferredId !== id) idMap.set(preferredId, id);
      imported.push({ kind: object.type || fields.type, id: object.id, runtimeId: id });
    } catch (error) {
      skipped.push({ kind: object?.type || "object", id: object?.id, reason: error.message });
    }
  }

  for (const combo of parsed.combos || []) {
    try {
      const output = rewriteBinding(combo.output, idMap);
      const preferredId = Number(combo.id);
      const id =
        Number.isInteger(preferredId) && preferredId > 0 && !draft.combos.some((item) => item.id === preferredId)
          ? preferredId
          : nextFreeComboId(draft);
      draft = upsertRuntimeCombo(
        draft,
        {
          id,
          keyPositions: combo.keyPositions,
          timeoutMs: combo.timeoutMs,
          slowRelease: !!combo.slowRelease,
          requirePriorIdleMs: combo.requirePriorIdleMs || 0,
          outputBinding: output,
        },
        capabilities,
        encodeOpts
      );
      imported.push({ kind: "combo", id: combo.id, runtimeId: id });
    } catch (error) {
      skipped.push({ kind: "combo", id: combo?.id, reason: error.message });
    }
  }

  const keymap = [];
  for (const entry of parsed.keymap || []) {
    const binding = rewriteBinding(entry.binding, idMap);
    try {
      keymap.push({
        layerId: Number(entry.layerId),
        stockPosition: Number(entry.stockPosition ?? entry.keyPosition),
        binding,
        action: actionFromBindingText(binding, {
          behaviors,
          studioLayers,
          allowRuntimeObject: true,
          snapshot: draft,
        }),
      });
    } catch (error) {
      skipped.push({
        kind: "keymap",
        id: `L${entry.layerId} P${entry.stockPosition ?? entry.keyPosition}`,
        reason: error.message,
      });
    }
  }

  draft.keymapOverrides = keymap.map((entry) => ({
    layerId: entry.layerId,
    keyPosition: entry.stockPosition,
    action: entry.action,
  }));
  return { draft, keymap, imported, skipped, warnings, document: parsed };
}

function encodeObject(object, opts) {
  const base = { id: object.id, type: object.type };
  if (object.type === "macro") {
    return {
      ...base,
      steps: (object.steps || []).map((step) => {
        if (step.type === "wait") return { type: "wait", ms: step.ms || 0 };
        if (step.type === "pauseUntilRelease") return { type: "pauseUntilRelease" };
        return { type: step.type, binding: bindingTextFromAction(step.action, opts) };
      }),
    };
  }
  if (object.type === "holdTap") {
    return {
      ...base,
      tap: bindingTextFromAction(object.tapAction, opts),
      hold: bindingTextFromAction(object.holdAction, opts),
      flavor: FLAVOR_NAME[object.flavor] || "balanced",
      tappingTermMs: object.tappingTermMs,
      quickTapMs: object.quickTapMs || 0,
      requirePriorIdleMs: object.requirePriorIdleMs || 0,
    };
  }
  if (object.type === "modMorph") {
    return {
      ...base,
      modifiers: modifierNames(object.modifiers),
      normal: bindingTextFromAction(object.normalAction, opts),
      morphed: bindingTextFromAction(object.morphedAction, opts),
    };
  }
  if (object.type === "tapDance") {
    return {
      ...base,
      tappingTermMs: object.tappingTermMs,
      actions: (object.actions || []).map((action) => ({
        tap: bindingTextFromAction(action.tapAction, opts),
        hold: bindingTextFromAction(action.holdAction, opts),
      })),
    };
  }
  throw new RuntimeDraftError(`Unsupported runtime object type ${object.type}`);
}

function encodeCombo(combo, opts) {
  return {
    id: combo.id,
    keyPositions: [...(combo.keyPositions || [])],
    timeoutMs: combo.timeoutMs,
    output: bindingTextFromAction(combo.output, opts),
    slowRelease: !!combo.slowRelease,
    requirePriorIdleMs: combo.requirePriorIdleMs || 0,
  };
}

function decodeObject(object) {
  const type = object?.type;
  if (type === "macro") {
    return { type, steps: object.steps || [] };
  }
  if (type === "holdTap") {
    const flavor = FLAVOR_ID[object.flavor] || Number(object.flavor);
    return {
      type,
      tapBinding: object.tap || object.tapBinding,
      holdBinding: object.hold || object.holdBinding,
      flavor,
      tappingTermMs: object.tappingTermMs,
      quickTapMs: object.quickTapMs || 0,
      requirePriorIdleMs: object.requirePriorIdleMs || 0,
    };
  }
  if (type === "modMorph") {
    return {
      type,
      modifiers: Array.isArray(object.modifiers) ? modifierMask(object.modifiers) : Number(object.modifiers),
      normalBinding: object.normal || object.normalBinding,
      morphedBinding: object.morphed || object.morphedBinding,
    };
  }
  if (type === "tapDance") {
    return {
      type,
      tappingTermMs: object.tappingTermMs,
      actions: (object.actions || []).map((action) => ({
        tapBinding: action.tap || action.tapBinding,
        holdBinding: action.hold || action.holdBinding,
      })),
    };
  }
  throw new RuntimeDraftError(`Unsupported runtime object type ${type}`);
}

function nextFreeObjectId(draft) {
  const used = new Set((draft.runtimeObjects || []).map((object) => object.id));
  let id = 1;
  while (used.has(id)) id++;
  return id;
}

function nextFreeComboId(draft) {
  const used = new Set((draft.combos || []).map((combo) => combo.id));
  let id = 1;
  while (used.has(id)) id++;
  return id;
}

function rewriteBinding(text, idMap) {
  const src = String(text || "").trim();
  const match = src.match(/^&rt\s+(\d+)$/);
  if (!match) return src;
  const mapped = idMap.get(Number(match[1]));
  return mapped ? runtimeBindingText(mapped) : src;
}

function modifierNames(mask) {
  return RUNTIME_MODIFIERS.filter(([, bit]) => Number(mask) & bit).map(([name]) => name);
}

function modifierMask(names) {
  let mask = 0;
  for (const name of names || []) {
    const found = RUNTIME_MODIFIERS.find(([id]) => id === String(name).toUpperCase());
    if (found) mask |= found[1];
  }
  return mask;
}

export function bytesToHex(bytes) {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

export function hexToBytes(hex) {
  const src = String(hex || "");
  if (src.length % 2) throw new RuntimeDraftError("capability fingerprint hex is invalid");
  const out = new Uint8Array(src.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(src.slice(i * 2, i * 2 + 2), 16);
  return out;
}

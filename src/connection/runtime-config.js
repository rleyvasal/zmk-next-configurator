/**
 * ZMK Next Runtime Config v1 protobuf helpers.
 *
 * This is deliberately separate from the editor's .keymap model: a runtime
 * snapshot is the public device contract, not the firmware's private Settings
 * representation.
 */

import {
  concatBytes,
  decodeFields,
  encodeBool,
  encodeBytes,
  encodeKey,
  encodeRepeatedUint32,
  encodeSub,
  encodeUint32,
  encodeVarint,
  fieldBytes,
  fieldMsgs,
  fieldNums,
  fieldStr,
  fieldU32,
} from "./pb.js";

export const RUNTIME_PROTOCOL_VERSION = 1;

export const RUNTIME_OBJECT_TYPE = Object.freeze({
  MOD_MORPH: 1,
  MACRO: 2,
  HOLD_TAP: 3,
  TAP_DANCE: 4,
});

export const HOLD_TAP_FLAVOR = Object.freeze({
  HOLD_PREFERRED: 1,
  BALANCED: 2,
  TAP_PREFERRED: 3,
  TAP_UNLESS_INTERRUPTED: 4,
});

export class RuntimeValidationError extends Error {
  constructor(message, diagnostics = [], validation = null) {
    super(message);
    this.name = "RuntimeValidationError";
    this.diagnostics = diagnostics;
    this.validation = validation;
  }
}

function u32(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 0xffffffff) {
    throw new Error(`${name} must be an unsigned 32-bit integer`);
  }
  return number;
}

function array(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function bytes(value, name) {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return new Uint8Array(value);
  throw new Error(`${name} must be Uint8Array`);
}

export function compiledAction(behaviorId, param1 = 0, param2 = 0) {
  return {
    compiledBehavior: {
      behaviorId: u32(behaviorId, "behavior ID"),
      param1: u32(param1, "behavior param1"),
      param2: u32(param2, "behavior param2"),
    },
  };
}

export function runtimeObjectAction(objectId) {
  return { runtimeObjectId: u32(objectId, "runtime object ID") };
}

function normalizeAction(action, { allowRuntimeObject = true } = {}) {
  if (!action || typeof action !== "object") throw new Error("action is required");
  if (action.compiledBehavior) {
    const compiled = action.compiledBehavior;
    const behaviorId = u32(compiled.behaviorId, "compiled behavior ID");
    if (!behaviorId) throw new Error("compiled behavior ID must be nonzero");
    return compiledAction(behaviorId, compiled.param1 ?? 0, compiled.param2 ?? 0);
  }
  if (action.runtimeObjectId != null) {
    if (!allowRuntimeObject) throw new Error("runtime object actions are not supported here");
    const objectId = u32(action.runtimeObjectId, "runtime object ID");
    if (!objectId) throw new Error("runtime object ID must be nonzero");
    return runtimeObjectAction(objectId);
  }
  throw new Error("action must be compiledBehavior or runtimeObjectId");
}

function encodeAction(action, options) {
  const normalized = normalizeAction(action, options);
  if (normalized.compiledBehavior) {
    const compiled = normalized.compiledBehavior;
    return encodeSub(
      1,
      concatBytes([
        encodeUint32(1, compiled.behaviorId),
        encodeUint32(2, compiled.param1),
        encodeUint32(3, compiled.param2),
      ])
    );
  }
  return encodeUint32(2, normalized.runtimeObjectId);
}

function decodeAction(fields) {
  const compiled = fieldMsgs(fields, 1)[0];
  if (compiled) return compiledAction(fieldU32(compiled, 1), fieldU32(compiled, 2), fieldU32(compiled, 3));
  const ids = fieldNums(fields, 2);
  if (ids.length) return runtimeObjectAction(ids[0]);
  throw new Error("runtime action has no target");
}

function encodeKeymapOverride(override) {
  return concatBytes([
    encodeUint32(1, u32(override.layerId, "keymap override layer ID")),
    encodeUint32(2, u32(override.keyPosition, "keymap override position")),
    encodeSub(3, encodeAction(override.action)),
  ]);
}

function decodeKeymapOverride(fields) {
  const action = fieldMsgs(fields, 3)[0];
  if (!action) throw new Error("keymap override action is required");
  return {
    layerId: fieldU32(fields, 1),
    keyPosition: fieldU32(fields, 2),
    action: decodeAction(action),
  };
}

function encodeMacroStep(step) {
  if (!step || typeof step !== "object") throw new Error("macro step is required");
  switch (step.type) {
    case "tap":
      return encodeSub(1, encodeAction(step.action, { allowRuntimeObject: false }));
    case "press":
      return encodeSub(2, encodeAction(step.action, { allowRuntimeObject: false }));
    case "release":
      return encodeSub(3, encodeAction(step.action, { allowRuntimeObject: false }));
    case "wait":
      return concatBytes([encodeKey(4, 0), encodeVarint(u32(step.ms, "macro wait ms"))]);
    case "pauseUntilRelease":
      return encodeBool(5, true);
    default:
      throw new Error(`unsupported macro step ${step.type}`);
  }
}

function decodeMacroStep(fields) {
  const tap = fieldMsgs(fields, 1)[0];
  if (tap) return { type: "tap", action: decodeAction(tap) };
  const press = fieldMsgs(fields, 2)[0];
  if (press) return { type: "press", action: decodeAction(press) };
  const release = fieldMsgs(fields, 3)[0];
  if (release) return { type: "release", action: decodeAction(release) };
  if (fieldNums(fields, 4).length) return { type: "wait", ms: fieldU32(fields, 4) };
  if (fieldNums(fields, 5)[0]) return { type: "pauseUntilRelease" };
  throw new Error("macro step has no instruction");
}

function encodeRuntimeObject(object) {
  const id = u32(object.id, "runtime object ID");
  if (!id) throw new Error("runtime object ID must be nonzero");
  const base = [encodeUint32(1, id)];
  switch (object.type) {
    case "modMorph":
    case RUNTIME_OBJECT_TYPE.MOD_MORPH:
      return concatBytes([
        ...base,
        encodeSub(
          2,
          concatBytes([
            encodeUint32(1, u32(object.modifiers, "mod-morph modifiers")),
            encodeSub(2, encodeAction(object.normalAction, { allowRuntimeObject: false })),
            encodeSub(3, encodeAction(object.morphedAction, { allowRuntimeObject: false })),
          ])
        ),
      ]);
    case "macro":
    case RUNTIME_OBJECT_TYPE.MACRO:
      return concatBytes([
        ...base,
        encodeSub(3, concatBytes(array(object.steps, "macro steps").map((step) => encodeSub(1, encodeMacroStep(step))))),
      ]);
    case "holdTap":
    case RUNTIME_OBJECT_TYPE.HOLD_TAP:
      return concatBytes([
        ...base,
        encodeSub(
          4,
          concatBytes([
            encodeSub(1, encodeAction(object.tapAction, { allowRuntimeObject: false })),
            encodeSub(2, encodeAction(object.holdAction, { allowRuntimeObject: false })),
            encodeUint32(3, u32(object.flavor, "hold-tap flavor")),
            encodeUint32(4, u32(object.tappingTermMs, "hold-tap tapping term")),
            encodeUint32(5, u32(object.quickTapMs ?? 0, "hold-tap quick tap")),
            encodeUint32(6, u32(object.requirePriorIdleMs ?? 0, "hold-tap prior idle")),
          ])
        ),
      ]);
    case "tapDance":
    case RUNTIME_OBJECT_TYPE.TAP_DANCE: {
      const actions = array(object.actions, "tap-dance actions");
      if (!actions.length) throw new Error("tap dance needs at least one action");
      return concatBytes([
        ...base,
        encodeSub(
          5,
          concatBytes([
            ...actions.map((action, index) => {
              const count = u32(action.tapCount, "tap-dance tap count");
              if (count !== index + 1) throw new Error("tap-dance tap counts must be consecutive from one");
              return encodeSub(
                1,
                concatBytes([
                  encodeUint32(1, count),
                  encodeSub(2, encodeAction(action.tapAction, { allowRuntimeObject: false })),
                  encodeSub(3, encodeAction(action.holdAction, { allowRuntimeObject: false })),
                ])
              );
            }),
            encodeUint32(2, u32(object.tappingTermMs, "tap-dance tapping term")),
          ])
        ),
      ]);
    }
    default:
      throw new Error(`unsupported runtime object type ${object.type}`);
  }
}

function decodeRuntimeObject(fields) {
  const id = fieldU32(fields, 1);
  if (!id) throw new Error("runtime object ID is required");
  const modMorph = fieldMsgs(fields, 2)[0];
  if (modMorph) {
    return {
      id,
      type: "modMorph",
      modifiers: fieldU32(modMorph, 1),
      normalAction: decodeAction(fieldMsgs(modMorph, 2)[0]),
      morphedAction: decodeAction(fieldMsgs(modMorph, 3)[0]),
    };
  }
  const macro = fieldMsgs(fields, 3)[0];
  if (macro) return { id, type: "macro", steps: fieldMsgs(macro, 1).map(decodeMacroStep) };
  const holdTap = fieldMsgs(fields, 4)[0];
  if (holdTap) {
    return {
      id,
      type: "holdTap",
      tapAction: decodeAction(fieldMsgs(holdTap, 1)[0]),
      holdAction: decodeAction(fieldMsgs(holdTap, 2)[0]),
      flavor: fieldU32(holdTap, 3),
      tappingTermMs: fieldU32(holdTap, 4),
      quickTapMs: fieldU32(holdTap, 5),
      requirePriorIdleMs: fieldU32(holdTap, 6),
    };
  }
  const tapDance = fieldMsgs(fields, 5)[0];
  if (tapDance) {
    return {
      id,
      type: "tapDance",
      actions: fieldMsgs(tapDance, 1).map((action) => ({
        tapCount: fieldU32(action, 1),
        tapAction: decodeAction(fieldMsgs(action, 2)[0]),
        holdAction: decodeAction(fieldMsgs(action, 3)[0]),
      })),
      tappingTermMs: fieldU32(tapDance, 2),
    };
  }
  throw new Error("runtime object has no definition");
}

function encodeCombo(combo) {
  const positions = array(combo.keyPositions, "combo key positions");
  return concatBytes([
    encodeUint32(1, u32(combo.id, "combo ID")),
    ...positions.map((position) => encodeRepeatedUint32(2, u32(position, "combo position"))),
    encodeUint32(3, u32(combo.timeoutMs, "combo timeout")),
    encodeSub(4, encodeAction(combo.output)),
    encodeBool(5, !!combo.slowRelease),
    encodeUint32(6, u32(combo.requirePriorIdleMs ?? 0, "combo prior idle")),
  ]);
}

function decodeCombo(fields) {
  const output = fieldMsgs(fields, 4)[0];
  if (!output) throw new Error("combo output is required");
  return {
    id: fieldU32(fields, 1),
    keyPositions: fieldNums(fields, 2),
    timeoutMs: fieldU32(fields, 3),
    output: decodeAction(output),
    slowRelease: !!fieldU32(fields, 5),
    requirePriorIdleMs: fieldU32(fields, 6),
  };
}

export function encodeRuntimeSnapshot(snapshot) {
  const fingerprint = bytes(snapshot.capabilityFingerprint, "capability fingerprint");
  if (fingerprint.length !== 16) throw new Error("capability fingerprint must be 16 bytes");
  const layers = array(snapshot.layers || [], "layer metadata");
  if (layers.length) throw new Error("layer metadata is not supported by Runtime Config v1");
  return concatBytes([
    encodeUint32(1, u32(snapshot.persistenceSchemaVersion, "persistence schema version")),
    encodeUint32(2, u32(snapshot.generation ?? 0, "generation")),
    encodeBytes(3, fingerprint),
    ...array(snapshot.keymapOverrides || [], "keymap overrides").map((item) => encodeSub(4, encodeKeymapOverride(item))),
    ...array(snapshot.runtimeObjects || [], "runtime objects").map((item) => encodeSub(6, encodeRuntimeObject(item))),
    ...array(snapshot.combos || [], "combos").map((item) => encodeSub(7, encodeCombo(item))),
  ]);
}

export function decodeRuntimeSnapshot(data) {
  const fields = data instanceof Map ? data : decodeFields(data);
  return {
    persistenceSchemaVersion: fieldU32(fields, 1),
    generation: fieldU32(fields, 2),
    capabilityFingerprint: fieldBytes(fields, 3),
    keymapOverrides: fieldMsgs(fields, 4).map(decodeKeymapOverride),
    layers: fieldMsgs(fields, 5).map((layer) => ({
      layerId: fieldU32(layer, 1),
      name: fieldStr(layer, 2),
      order: fieldU32(layer, 3),
    })),
    runtimeObjects: fieldMsgs(fields, 6).map(decodeRuntimeObject),
    combos: fieldMsgs(fields, 7).map(decodeCombo),
  };
}

function decodeStatus(fields) {
  return {
    state: fieldU32(fields, 1),
    activeGeneration: fieldU32(fields, 2),
    pendingGeneration: fieldU32(fields, 3),
  };
}

function decodeDiagnostic(fields) {
  const keyLocation = fieldMsgs(fields, 6)[0];
  return {
    severity: fieldU32(fields, 1),
    code: fieldU32(fields, 2),
    message: fieldStr(fields, 3),
    runtimeObjectId: fieldNums(fields, 4)[0],
    comboId: fieldNums(fields, 5)[0],
    keyLocation: keyLocation
      ? { layerId: fieldU32(keyLocation, 1), keyPosition: fieldU32(keyLocation, 2) }
      : null,
    fieldPath: fieldStr(fields, 7),
  };
}

function decodeError(fields) {
  return {
    code: fieldU32(fields, 1),
    message: fieldStr(fields, 2),
    diagnostics: fieldMsgs(fields, 3).map(decodeDiagnostic),
  };
}

function decodeCapabilities(fields) {
  const limits = fieldMsgs(fields, 6)[0] || new Map();
  return {
    protocolVersion: fieldU32(fields, 1),
    persistenceSchemaVersion: fieldU32(fields, 2),
    capabilityFingerprint: fieldBytes(fields, 3),
    supportedObjectTypes: fieldNums(fields, 4),
    supportedFeatures: fieldNums(fields, 5),
    selectedPositionCount: fieldU32(fields, 8),
    selectedToStockPositions: fieldNums(fields, 9),
    limits: {
      maxRuntimeObjects: fieldU32(limits, 1),
      maxCombos: fieldU32(limits, 2),
      maxComboKeys: fieldU32(limits, 3),
      maxMacroSteps: fieldU32(limits, 4),
      maxPersistedBytes: fieldU32(limits, 5),
      maxLayers: fieldU32(limits, 6),
      maxKeymapOverrides: fieldU32(limits, 7),
      maxTapDanceActions: fieldU32(limits, 8),
    },
  };
}

function decodeValidation(fields) {
  const usage = fieldMsgs(fields, 4)[0] || new Map();
  const resourceUse = (field) => {
    const use = fieldMsgs(usage, field)[0] || new Map();
    return { used: fieldU32(use, 1), limit: fieldU32(use, 2) };
  };
  return {
    valid: !!fieldU32(fields, 1),
    errors: fieldMsgs(fields, 2).map(decodeDiagnostic),
    warnings: fieldMsgs(fields, 3).map(decodeDiagnostic),
    resourceUsage: {
      runtimeObjects: resourceUse(1),
      combos: resourceUse(2),
      macroSteps: resourceUse(3),
      persistedBytes: resourceUse(4),
      keymapOverrides: resourceUse(5),
      tapDanceActions: resourceUse(6),
    },
  };
}

function decodeCommit(fields) {
  const status = fieldMsgs(fields, 4)[0];
  return {
    generation: fieldU32(fields, 1),
    saved: !!fieldU32(fields, 2),
    activation: fieldU32(fields, 3),
    status: status ? decodeStatus(status) : null,
  };
}

/** Decode the zmk.runtime_config.Response nested in zmk.studio.RequestResponse. */
export function decodeRuntimeResponse(data) {
  const fields = data instanceof Map ? data : decodeFields(data);
  const error = fieldMsgs(fields, 2)[0];
  const out = { requestId: fieldU32(fields, 1) };
  if (error) out.error = decodeError(error);
  const capabilities = fieldMsgs(fields, 3)[0];
  if (capabilities) out.capabilities = decodeCapabilities(capabilities);
  const status = fieldMsgs(fields, 4)[0];
  if (status) out.status = decodeStatus(status);
  const config = fieldMsgs(fields, 5)[0];
  if (config) {
    const snapshot = fieldMsgs(config, 1)[0];
    const configStatus = fieldMsgs(config, 2)[0];
    out.config = {
      snapshot: snapshot ? decodeRuntimeSnapshot(snapshot) : null,
      status: configStatus ? decodeStatus(configStatus) : null,
    };
  }
  const begin = fieldMsgs(fields, 6)[0];
  if (begin) out.begin = { updateId: fieldU32(begin, 1), maxChunkBytes: fieldU32(begin, 2) };
  const chunk = fieldMsgs(fields, 7)[0];
  if (chunk) out.chunk = { acceptedBytes: fieldU32(chunk, 1), nextOffset: fieldU32(chunk, 2) };
  const validation = fieldMsgs(fields, 8)[0];
  if (validation) out.validation = decodeValidation(validation);
  const commit = fieldMsgs(fields, 9)[0];
  if (commit) out.commit = decodeCommit(commit);
  const abort = fieldMsgs(fields, 10)[0];
  if (abort) out.abort = { aborted: !!fieldU32(abort, 1) };
  const reset = fieldMsgs(fields, 11)[0];
  if (reset) out.reset = decodeCommit(reset);
  return out;
}

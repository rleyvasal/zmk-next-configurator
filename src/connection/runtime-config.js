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
  encodePackedRepeatedUint32,
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
import { FIELDS, ENUMS } from "./fields.generated.js";

const F = FIELDS.runtime_config;
const E = ENUMS.runtime_config;

export const RUNTIME_PROTOCOL_VERSION = 1;

export const RUNTIME_CONFIG_ERROR = Object.freeze({
  OK: E.RuntimeConfigErrorCode.RUNTIME_CONFIG_ERROR_OK,
  INVALID_REQUEST: E.RuntimeConfigErrorCode.RUNTIME_CONFIG_ERROR_INVALID_REQUEST,
  PROTOCOL_VERSION: E.RuntimeConfigErrorCode.RUNTIME_CONFIG_ERROR_PROTOCOL_VERSION,
  SNAPSHOT_SCHEMA_VERSION: E.RuntimeConfigErrorCode.RUNTIME_CONFIG_ERROR_SNAPSHOT_SCHEMA_VERSION,
  CAPABILITY_FINGERPRINT: E.RuntimeConfigErrorCode.RUNTIME_CONFIG_ERROR_CAPABILITY_FINGERPRINT,
  STALE_GENERATION: E.RuntimeConfigErrorCode.RUNTIME_CONFIG_ERROR_STALE_GENERATION,
  UPDATE_NOT_FOUND: E.RuntimeConfigErrorCode.RUNTIME_CONFIG_ERROR_UPDATE_NOT_FOUND,
  UPDATE_IN_PROGRESS: E.RuntimeConfigErrorCode.RUNTIME_CONFIG_ERROR_UPDATE_IN_PROGRESS,
  UPDATE_INCOMPLETE: E.RuntimeConfigErrorCode.RUNTIME_CONFIG_ERROR_UPDATE_INCOMPLETE,
  INVALID_CHUNK: E.RuntimeConfigErrorCode.RUNTIME_CONFIG_ERROR_INVALID_CHUNK,
  VALIDATION: E.RuntimeConfigErrorCode.RUNTIME_CONFIG_ERROR_VALIDATION,
  RESOURCE_LIMIT: E.RuntimeConfigErrorCode.RUNTIME_CONFIG_ERROR_RESOURCE_LIMIT,
  PERSISTENCE: E.RuntimeConfigErrorCode.RUNTIME_CONFIG_ERROR_PERSISTENCE,
  ACTIVATION: E.RuntimeConfigErrorCode.RUNTIME_CONFIG_ERROR_ACTIVATION,
  NOT_SUPPORTED: E.RuntimeConfigErrorCode.RUNTIME_CONFIG_ERROR_NOT_SUPPORTED,
  INTERNAL: E.RuntimeConfigErrorCode.RUNTIME_CONFIG_ERROR_INTERNAL,
});

const RUNTIME_CONFIG_ERROR_TEXT = {
  1: "invalid request",
  2: "protocol version mismatch",
  3: "persistence schema mismatch",
  4: "firmware capability mismatch",
  5: "stale generation — Load from Keyboard and Apply again",
  6: "no matching in-progress update",
  7: "an Apply is already in progress (a previous save did not finish)",
  8: "update is incomplete",
  9: "invalid upload chunk",
  10: "validation failed",
  11: "resource limit exceeded",
  12: "failed to persist the snapshot",
  13: "cannot activate while keys are held",
  14: "not supported by this firmware",
  15: "internal firmware error",
};

export function runtimeConfigErrorMessage(code, message = "") {
  const named = RUNTIME_CONFIG_ERROR_TEXT[Number(code)] || `error ${code}`;
  return `Runtime Config ${named}${message ? `: ${message}` : ""}`;
}

export const RUNTIME_OBJECT_TYPE = Object.freeze({
  MOD_MORPH: E.RuntimeObjectType.RUNTIME_OBJECT_TYPE_MOD_MORPH,
  MACRO: E.RuntimeObjectType.RUNTIME_OBJECT_TYPE_MACRO,
  HOLD_TAP: E.RuntimeObjectType.RUNTIME_OBJECT_TYPE_HOLD_TAP,
  TAP_DANCE: E.RuntimeObjectType.RUNTIME_OBJECT_TYPE_TAP_DANCE,
});

export const HOLD_TAP_FLAVOR = Object.freeze({
  HOLD_PREFERRED: E.HoldTapFlavor.HOLD_TAP_FLAVOR_HOLD_PREFERRED,
  BALANCED: E.HoldTapFlavor.HOLD_TAP_FLAVOR_BALANCED,
  TAP_PREFERRED: E.HoldTapFlavor.HOLD_TAP_FLAVOR_TAP_PREFERRED,
  TAP_UNLESS_INTERRUPTED: E.HoldTapFlavor.HOLD_TAP_FLAVOR_TAP_UNLESS_INTERRUPTED,
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
      F.ActionReference.compiled_behavior,
      concatBytes([
        encodeUint32(F.CompiledBehaviorAction.behavior_id, compiled.behaviorId),
        encodeUint32(F.CompiledBehaviorAction.param1, compiled.param1),
        encodeUint32(F.CompiledBehaviorAction.param2, compiled.param2),
      ])
    );
  }
  return encodeUint32(F.ActionReference.runtime_object_id, normalized.runtimeObjectId);
}

function decodeAction(fields) {
  const compiled = fieldMsgs(fields, F.ActionReference.compiled_behavior)[0];
  if (compiled) {
    return compiledAction(
      fieldU32(compiled, F.CompiledBehaviorAction.behavior_id),
      fieldU32(compiled, F.CompiledBehaviorAction.param1),
      fieldU32(compiled, F.CompiledBehaviorAction.param2)
    );
  }
  const ids = fieldNums(fields, F.ActionReference.runtime_object_id);
  if (ids.length) return runtimeObjectAction(ids[0]);
  throw new Error("runtime action has no target");
}

function encodeKeymapOverride(override) {
  return concatBytes([
    encodeUint32(F.KeymapOverride.layer_id, u32(override.layerId, "keymap override layer ID")),
    encodeUint32(F.KeymapOverride.key_position, u32(override.keyPosition, "keymap override position")),
    encodeSub(F.KeymapOverride.action, encodeAction(override.action)),
  ]);
}

function decodeKeymapOverride(fields) {
  const action = fieldMsgs(fields, F.KeymapOverride.action)[0];
  if (!action) throw new Error("keymap override action is required");
  return {
    layerId: fieldU32(fields, F.KeymapOverride.layer_id),
    keyPosition: fieldU32(fields, F.KeymapOverride.key_position),
    action: decodeAction(action),
  };
}

function encodeMacroStep(step) {
  if (!step || typeof step !== "object") throw new Error("macro step is required");
  switch (step.type) {
    case "tap":
      return encodeSub(F.MacroStep.tap, encodeAction(step.action, { allowRuntimeObject: false }));
    case "press":
      return encodeSub(F.MacroStep.press, encodeAction(step.action, { allowRuntimeObject: false }));
    case "release":
      return encodeSub(F.MacroStep.release, encodeAction(step.action, { allowRuntimeObject: false }));
    case "wait":
      return concatBytes([encodeKey(F.MacroStep.wait_ms, 0), encodeVarint(u32(step.ms, "macro wait ms"))]);
    case "pauseUntilRelease":
      return encodeBool(F.MacroStep.pause_until_release, true);
    default:
      throw new Error(`unsupported macro step ${step.type}`);
  }
}

function decodeMacroStep(fields) {
  const tap = fieldMsgs(fields, F.MacroStep.tap)[0];
  if (tap) return { type: "tap", action: decodeAction(tap) };
  const press = fieldMsgs(fields, F.MacroStep.press)[0];
  if (press) return { type: "press", action: decodeAction(press) };
  const release = fieldMsgs(fields, F.MacroStep.release)[0];
  if (release) return { type: "release", action: decodeAction(release) };
  if (fieldNums(fields, F.MacroStep.wait_ms).length) {
    return { type: "wait", ms: fieldU32(fields, F.MacroStep.wait_ms) };
  }
  if (fieldNums(fields, F.MacroStep.pause_until_release)[0]) return { type: "pauseUntilRelease" };
  throw new Error("macro step has no instruction");
}

function encodeRuntimeObject(object) {
  const id = u32(object.id, "runtime object ID");
  if (!id) throw new Error("runtime object ID must be nonzero");
  const base = [encodeUint32(F.RuntimeObject.id, id)];
  switch (object.type) {
    case "modMorph":
    case RUNTIME_OBJECT_TYPE.MOD_MORPH:
      return concatBytes([
        ...base,
        encodeSub(
          F.RuntimeObject.mod_morph,
          concatBytes([
            encodeUint32(F.ModMorphObject.modifiers, u32(object.modifiers, "mod-morph modifiers")),
            encodeSub(F.ModMorphObject.normal_action, encodeAction(object.normalAction, { allowRuntimeObject: false })),
            encodeSub(F.ModMorphObject.morphed_action, encodeAction(object.morphedAction, { allowRuntimeObject: false })),
          ])
        ),
      ]);
    case "macro":
    case RUNTIME_OBJECT_TYPE.MACRO:
      return concatBytes([
        ...base,
        encodeSub(
          F.RuntimeObject.macro,
          concatBytes(
            array(object.steps, "macro steps").map((step) => encodeSub(F.MacroObject.steps, encodeMacroStep(step)))
          )
        ),
      ]);
    case "holdTap":
    case RUNTIME_OBJECT_TYPE.HOLD_TAP:
      return concatBytes([
        ...base,
        encodeSub(
          F.RuntimeObject.hold_tap,
          concatBytes([
            encodeSub(F.HoldTapObject.tap_action, encodeAction(object.tapAction, { allowRuntimeObject: false })),
            encodeSub(F.HoldTapObject.hold_action, encodeAction(object.holdAction, { allowRuntimeObject: false })),
            encodeUint32(F.HoldTapObject.flavor, u32(object.flavor, "hold-tap flavor")),
            encodeUint32(F.HoldTapObject.tapping_term_ms, u32(object.tappingTermMs, "hold-tap tapping term")),
            encodeUint32(F.HoldTapObject.quick_tap_ms, u32(object.quickTapMs ?? 0, "hold-tap quick tap")),
            encodeUint32(F.HoldTapObject.require_prior_idle_ms, u32(object.requirePriorIdleMs ?? 0, "hold-tap prior idle")),
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
          F.RuntimeObject.tap_dance,
          concatBytes([
            ...actions.map((action, index) => {
              const count = u32(action.tapCount, "tap-dance tap count");
              if (count !== index + 1) throw new Error("tap-dance tap counts must be consecutive from one");
              return encodeSub(
                F.TapDanceObject.actions,
                concatBytes([
                  encodeUint32(F.TapDanceAction.tap_count, count),
                  encodeSub(F.TapDanceAction.tap_action, encodeAction(action.tapAction, { allowRuntimeObject: false })),
                  encodeSub(F.TapDanceAction.hold_action, encodeAction(action.holdAction, { allowRuntimeObject: false })),
                ])
              );
            }),
            encodeUint32(F.TapDanceObject.tapping_term_ms, u32(object.tappingTermMs, "tap-dance tapping term")),
          ])
        ),
      ]);
    }
    default:
      throw new Error(`unsupported runtime object type ${object.type}`);
  }
}

function decodeRuntimeObject(fields) {
  const id = fieldU32(fields, F.RuntimeObject.id);
  if (!id) throw new Error("runtime object ID is required");
  const modMorph = fieldMsgs(fields, F.RuntimeObject.mod_morph)[0];
  if (modMorph) {
    return {
      id,
      type: "modMorph",
      modifiers: fieldU32(modMorph, F.ModMorphObject.modifiers),
      normalAction: decodeAction(fieldMsgs(modMorph, F.ModMorphObject.normal_action)[0]),
      morphedAction: decodeAction(fieldMsgs(modMorph, F.ModMorphObject.morphed_action)[0]),
    };
  }
  const macro = fieldMsgs(fields, F.RuntimeObject.macro)[0];
  if (macro) return { id, type: "macro", steps: fieldMsgs(macro, F.MacroObject.steps).map(decodeMacroStep) };
  const holdTap = fieldMsgs(fields, F.RuntimeObject.hold_tap)[0];
  if (holdTap) {
    return {
      id,
      type: "holdTap",
      tapAction: decodeAction(fieldMsgs(holdTap, F.HoldTapObject.tap_action)[0]),
      holdAction: decodeAction(fieldMsgs(holdTap, F.HoldTapObject.hold_action)[0]),
      flavor: fieldU32(holdTap, F.HoldTapObject.flavor),
      tappingTermMs: fieldU32(holdTap, F.HoldTapObject.tapping_term_ms),
      quickTapMs: fieldU32(holdTap, F.HoldTapObject.quick_tap_ms),
      requirePriorIdleMs: fieldU32(holdTap, F.HoldTapObject.require_prior_idle_ms),
    };
  }
  const tapDance = fieldMsgs(fields, F.RuntimeObject.tap_dance)[0];
  if (tapDance) {
    return {
      id,
      type: "tapDance",
      actions: fieldMsgs(tapDance, F.TapDanceObject.actions).map((action) => ({
        tapCount: fieldU32(action, F.TapDanceAction.tap_count),
        tapAction: decodeAction(fieldMsgs(action, F.TapDanceAction.tap_action)[0]),
        holdAction: decodeAction(fieldMsgs(action, F.TapDanceAction.hold_action)[0]),
      })),
      tappingTermMs: fieldU32(tapDance, F.TapDanceObject.tapping_term_ms),
    };
  }
  throw new Error("runtime object has no definition");
}

function encodeCombo(combo) {
  const positions = array(combo.keyPositions, "combo key positions");
  return concatBytes([
    encodeUint32(F.ComboDefinition.id, u32(combo.id, "combo ID")),
    encodePackedRepeatedUint32(
      F.ComboDefinition.key_positions,
      positions.map((position) => u32(position, "combo position"))
    ),
    encodeUint32(F.ComboDefinition.timeout_ms, u32(combo.timeoutMs, "combo timeout")),
    encodeSub(F.ComboDefinition.output, encodeAction(combo.output)),
    encodeBool(F.ComboDefinition.slow_release, !!combo.slowRelease),
    encodeUint32(F.ComboDefinition.require_prior_idle_ms, u32(combo.requirePriorIdleMs ?? 0, "combo prior idle")),
    encodeUint32(F.ComboDefinition.layer_mask, u32(combo.layerMask ?? 0, "combo layer mask")),
  ]);
}

function decodeCombo(fields) {
  const output = fieldMsgs(fields, F.ComboDefinition.output)[0];
  if (!output) throw new Error("combo output is required");
  return {
    id: fieldU32(fields, F.ComboDefinition.id),
    keyPositions: fieldNums(fields, F.ComboDefinition.key_positions),
    timeoutMs: fieldU32(fields, F.ComboDefinition.timeout_ms),
    output: decodeAction(output),
    slowRelease: !!fieldU32(fields, F.ComboDefinition.slow_release),
    requirePriorIdleMs: fieldU32(fields, F.ComboDefinition.require_prior_idle_ms),
    layerMask: fieldU32(fields, F.ComboDefinition.layer_mask),
  };
}

export function encodeRuntimeSnapshot(snapshot) {
  const fingerprint = bytes(snapshot.capabilityFingerprint, "capability fingerprint");
  if (fingerprint.length !== 16) throw new Error("capability fingerprint must be 16 bytes");
  const layers = array(snapshot.layers || [], "layer metadata");
  if (layers.length) throw new Error("layer metadata is not supported by Runtime Config v1");
  return concatBytes([
    encodeUint32(F.RuntimeConfigSnapshot.persistence_schema_version, u32(snapshot.persistenceSchemaVersion, "persistence schema version")),
    encodeUint32(F.RuntimeConfigSnapshot.generation, u32(snapshot.generation ?? 0, "generation")),
    encodeBytes(F.RuntimeConfigSnapshot.capability_fingerprint, fingerprint),
    ...array(snapshot.keymapOverrides || [], "keymap overrides").map((item) =>
      encodeSub(F.RuntimeConfigSnapshot.keymap_overrides, encodeKeymapOverride(item))
    ),
    ...array(snapshot.runtimeObjects || [], "runtime objects").map((item) =>
      encodeSub(F.RuntimeConfigSnapshot.runtime_objects, encodeRuntimeObject(item))
    ),
    ...array(snapshot.combos || [], "combos").map((item) => encodeSub(F.RuntimeConfigSnapshot.combos, encodeCombo(item))),
  ]);
}

export function decodeRuntimeSnapshot(data) {
  const fields = data instanceof Map ? data : decodeFields(data);
  return {
    persistenceSchemaVersion: fieldU32(fields, F.RuntimeConfigSnapshot.persistence_schema_version),
    generation: fieldU32(fields, F.RuntimeConfigSnapshot.generation),
    capabilityFingerprint: fieldBytes(fields, F.RuntimeConfigSnapshot.capability_fingerprint),
    keymapOverrides: fieldMsgs(fields, F.RuntimeConfigSnapshot.keymap_overrides).map(decodeKeymapOverride),
    layers: fieldMsgs(fields, F.RuntimeConfigSnapshot.layers).map((layer) => ({
      layerId: fieldU32(layer, F.LayerMetadata.layer_id),
      name: fieldStr(layer, F.LayerMetadata.name),
      order: fieldU32(layer, F.LayerMetadata.order),
    })),
    runtimeObjects: fieldMsgs(fields, F.RuntimeConfigSnapshot.runtime_objects).map(decodeRuntimeObject),
    combos: fieldMsgs(fields, F.RuntimeConfigSnapshot.combos).map(decodeCombo),
  };
}

function decodeStatus(fields) {
  return {
    state: fieldU32(fields, F.RuntimeConfigStatus.state),
    activeGeneration: fieldU32(fields, F.RuntimeConfigStatus.active_generation),
    pendingGeneration: fieldU32(fields, F.RuntimeConfigStatus.pending_generation),
  };
}

function decodeDiagnostic(fields) {
  const keyLocation = fieldMsgs(fields, F.RuntimeConfigDiagnostic.key_location)[0];
  return {
    severity: fieldU32(fields, F.RuntimeConfigDiagnostic.severity),
    code: fieldU32(fields, F.RuntimeConfigDiagnostic.code),
    message: fieldStr(fields, F.RuntimeConfigDiagnostic.message),
    runtimeObjectId: fieldNums(fields, F.RuntimeConfigDiagnostic.runtime_object_id)[0],
    comboId: fieldNums(fields, F.RuntimeConfigDiagnostic.combo_id)[0],
    keyLocation: keyLocation
      ? { layerId: fieldU32(keyLocation, F.KeyLocation.layer_id), keyPosition: fieldU32(keyLocation, F.KeyLocation.key_position) }
      : null,
    fieldPath: fieldStr(fields, F.RuntimeConfigDiagnostic.field_path),
  };
}

function decodeError(fields) {
  return {
    code: fieldU32(fields, F.RuntimeConfigError.code),
    message: fieldStr(fields, F.RuntimeConfigError.message),
    diagnostics: fieldMsgs(fields, F.RuntimeConfigError.diagnostics).map(decodeDiagnostic),
  };
}

function decodeCapabilities(fields) {
  const limits = fieldMsgs(fields, F.RuntimeCapabilities.limits)[0] || new Map();
  return {
    protocolVersion: fieldU32(fields, F.RuntimeCapabilities.protocol_version),
    persistenceSchemaVersion: fieldU32(fields, F.RuntimeCapabilities.persistence_schema_version),
    capabilityFingerprint: fieldBytes(fields, F.RuntimeCapabilities.capability_fingerprint),
    supportedObjectTypes: fieldNums(fields, F.RuntimeCapabilities.supported_object_types),
    supportedFeatures: fieldNums(fields, F.RuntimeCapabilities.supported_features),
    selectedPositionCount: fieldU32(fields, F.RuntimeCapabilities.selected_position_count),
    selectedToStockPositions: fieldNums(fields, F.RuntimeCapabilities.selected_to_stock_positions),
    limits: {
      maxRuntimeObjects: fieldU32(limits, F.RuntimeConfigLimits.max_runtime_objects),
      maxCombos: fieldU32(limits, F.RuntimeConfigLimits.max_combos),
      maxComboKeys: fieldU32(limits, F.RuntimeConfigLimits.max_combo_keys),
      maxMacroSteps: fieldU32(limits, F.RuntimeConfigLimits.max_macro_steps),
      maxPersistedBytes: fieldU32(limits, F.RuntimeConfigLimits.max_persisted_bytes),
      maxLayers: fieldU32(limits, F.RuntimeConfigLimits.max_layers),
      maxKeymapOverrides: fieldU32(limits, F.RuntimeConfigLimits.max_keymap_overrides),
      maxTapDanceActions: fieldU32(limits, F.RuntimeConfigLimits.max_tap_dance_actions),
    },
  };
}

function decodeValidation(fields) {
  const usage = fieldMsgs(fields, F.ValidationResult.resource_usage)[0] || new Map();
  const resourceUse = (field) => {
    const use = fieldMsgs(usage, field)[0] || new Map();
    return { used: fieldU32(use, F.ResourceUse.used), limit: fieldU32(use, F.ResourceUse.limit) };
  };
  return {
    valid: !!fieldU32(fields, F.ValidationResult.valid),
    errors: fieldMsgs(fields, F.ValidationResult.errors).map(decodeDiagnostic),
    warnings: fieldMsgs(fields, F.ValidationResult.warnings).map(decodeDiagnostic),
    resourceUsage: {
      runtimeObjects: resourceUse(F.RuntimeConfigResourceUsage.runtime_objects),
      combos: resourceUse(F.RuntimeConfigResourceUsage.combos),
      macroSteps: resourceUse(F.RuntimeConfigResourceUsage.macro_steps),
      persistedBytes: resourceUse(F.RuntimeConfigResourceUsage.persisted_bytes),
      keymapOverrides: resourceUse(F.RuntimeConfigResourceUsage.keymap_overrides),
      tapDanceActions: resourceUse(F.RuntimeConfigResourceUsage.tap_dance_actions),
    },
  };
}

function decodeCommit(fields) {
  const status = fieldMsgs(fields, F.CommitRuntimeUpdateResult.status)[0];
  return {
    generation: fieldU32(fields, F.CommitRuntimeUpdateResult.generation),
    saved: !!fieldU32(fields, F.CommitRuntimeUpdateResult.saved),
    activation: fieldU32(fields, F.CommitRuntimeUpdateResult.activation),
    status: status ? decodeStatus(status) : null,
  };
}

/** Decode the zmk.runtime_config.Response nested in zmk.studio.RequestResponse. */
export function decodeRuntimeResponse(data) {
  const fields = data instanceof Map ? data : decodeFields(data);
  const error = fieldMsgs(fields, F.Response.error)[0];
  const out = { requestId: fieldU32(fields, F.Response.request_id) };
  if (error) out.error = decodeError(error);
  const capabilities = fieldMsgs(fields, F.Response.get_runtime_capabilities)[0];
  if (capabilities) out.capabilities = decodeCapabilities(capabilities);
  const status = fieldMsgs(fields, F.Response.get_runtime_config_status)[0];
  if (status) out.status = decodeStatus(status);
  const config = fieldMsgs(fields, F.Response.get_runtime_config)[0];
  if (config) {
    const snapshot = fieldMsgs(config, F.GetRuntimeConfigResponse.snapshot)[0];
    const configStatus = fieldMsgs(config, F.GetRuntimeConfigResponse.status)[0];
    out.config = {
      snapshot: snapshot ? decodeRuntimeSnapshot(snapshot) : null,
      status: configStatus ? decodeStatus(configStatus) : null,
    };
  }
  const begin = fieldMsgs(fields, F.Response.begin_runtime_update)[0];
  if (begin) {
    out.begin = {
      updateId: fieldU32(begin, F.BeginRuntimeUpdateResponse.update_id),
      maxChunkBytes: fieldU32(begin, F.BeginRuntimeUpdateResponse.max_chunk_bytes),
    };
  }
  const chunk = fieldMsgs(fields, F.Response.upload_runtime_update_chunk)[0];
  if (chunk) {
    out.chunk = {
      acceptedBytes: fieldU32(chunk, F.UploadRuntimeUpdateChunkResponse.accepted_bytes),
      nextOffset: fieldU32(chunk, F.UploadRuntimeUpdateChunkResponse.next_offset),
    };
  }
  const validation = fieldMsgs(fields, F.Response.validate_runtime_update)[0];
  if (validation) out.validation = decodeValidation(validation);
  const commit = fieldMsgs(fields, F.Response.commit_runtime_update)[0];
  if (commit) out.commit = decodeCommit(commit);
  const abort = fieldMsgs(fields, F.Response.abort_runtime_update)[0];
  if (abort) out.abort = { aborted: !!fieldU32(abort, F.AbortRuntimeUpdateResponse.aborted) };
  const reset = fieldMsgs(fields, F.Response.reset_runtime_config)[0];
  if (reset) out.reset = decodeCommit(reset);
  return out;
}

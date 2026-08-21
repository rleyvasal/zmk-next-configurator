import { bindingToCells } from "./studio-bind.js";
import { compiledAction, decodeRuntimeSnapshot, encodeRuntimeSnapshot } from "./runtime-config.js";

export class RuntimeDraftError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = "RuntimeDraftError";
    this.issues = issues;
  }
}

/**
 * Produce an immutable, normalized local draft from the device's active
 * snapshot. Encoding then decoding keeps Uint8Array fields intact and ensures
 * UI code never shares nested references with the last device readback.
 */
export function createRuntimeDraft(snapshot) {
  return decodeRuntimeSnapshot(encodeRuntimeSnapshot(snapshot));
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

/**
 * Replace only a draft's ordinary keymap overlay from the editor. Runtime
 * objects and combos already in the draft remain intact until their dedicated
 * editors update them. editorLayers use the selected physical-layout order;
 * the capability map converts that into firmware's canonical stock positions.
 */
export function replaceDraftKeymapOverrides({
  snapshot,
  capabilities,
  editorLayers,
  deviceLayerIds,
  behaviors,
  studioLayers,
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
      const binding = bindingToCells(text, behaviors, studioLayers);
      if (!binding.ok) {
        issues.push({ layerIndex, position, text, reason: binding.reason });
        continue;
      }
      overrides.push({
        layerId,
        keyPosition: selectedToStock[position],
        action: compiledAction(binding.binding.behaviorId, binding.binding.param1, binding.binding.param2),
      });
    }
  }

  if (issues.length) {
    const first = issues[0];
    const where = first.position == null ? `layer ${first.layerIndex}` : `L${first.layerIndex} P${first.position}`;
    throw new RuntimeDraftError(`Cannot build Runtime Config draft at ${where}: ${first.reason}`, issues);
  }

  const limit = Number(capabilities?.limits?.maxKeymapOverrides);
  if (Number.isFinite(limit) && overrides.length > limit) {
    throw new RuntimeDraftError(
      `Runtime Config needs ${overrides.length} keymap overrides, but this firmware reserves ${limit}`
    );
  }

  draft.keymapOverrides = overrides;
  return draft;
}

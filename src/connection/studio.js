/**
 * ZMK Studio RPC over Web Serial. Framing is SOF 0xAB / ESC 0xAC / EOF 0xAD.
 * Requests/responses are the zmk-studio-messages protobufs.
 */

import {
  concatBytes,
  decodeFields,
  encodeBool,
  encodeBytes,
  encodeInt32,
  encodeKey,
  encodeSint32,
  encodeString,
  encodeSub,
  encodeUint32,
  encodeVarint,
  fieldMsgs,
  fieldNums,
  fieldStr,
  fieldU32,
  unzigzag32,
} from "./pb.js";
import { bindingToCells, rememberStudioBehaviors } from "./studio-bind.js";
import { FIELDS } from "./fields.generated.js";
import {
  RUNTIME_CONFIG_ERROR,
  RUNTIME_PROTOCOL_VERSION,
  RuntimeValidationError,
  decodeRuntimeResponse,
  encodeRuntimeSnapshot,
  runtimeConfigErrorMessage,
} from "./runtime-config.js";
import { waitForRuntimeStatus } from "./runtime-activation.js";

const Fs = FIELDS.studio;
const Fc = FIELDS.core;
const Fb = FIELDS.behaviors;
const Fk = FIELDS.keymap;
const Fm = FIELDS.meta;
const Fr = FIELDS.runtime_config;

const SOF = 0xab;
const ESC = 0xac;
const EOF = 0xad;

export function frameBytes(payload) {
  const out = [SOF];
  for (const b of payload) {
    if (b === SOF || b === ESC || b === EOF) out.push(ESC);
    out.push(b);
  }
  out.push(EOF);
  return new Uint8Array(out);
}

export function deframeAll(bytes, state = { mode: "idle", buf: [] }) {
  const frames = [];
  for (const b of bytes) {
    if (state.mode === "idle") {
      if (b === SOF) {
        state.mode = "data";
        state.buf = [];
      }
      continue;
    }
    if (state.mode === "esc") {
      state.buf.push(b);
      state.mode = "data";
      continue;
    }
    if (b === ESC) {
      state.mode = "esc";
      continue;
    }
    if (b === SOF) {
      state.buf = [];
      continue;
    }
    if (b === EOF) {
      frames.push(new Uint8Array(state.buf));
      state.mode = "idle";
      state.buf = [];
      continue;
    }
    state.buf.push(b);
  }
  return { frames, state };
}

function encodeRequest(id, subsystemField, body) {
  return concatBytes([encodeUint32(Fs.Request.request_id, id), encodeSub(subsystemField, body)]);
}

function encodeCore(id, typeField) {
  return encodeRequest(id, Fs.Request.core, encodeBool(typeField, true));
}

function encodeBehaviors(id, typeField, body = new Uint8Array()) {
  const inner = body.length ? encodeSub(typeField, body) : encodeBool(typeField, true);
  return encodeRequest(id, Fs.Request.behaviors, inner);
}

function encodeKeymap(id, typeField, body = new Uint8Array()) {
  const inner = body.length ? encodeSub(typeField, body) : encodeBool(typeField, true);
  return encodeRequest(id, Fs.Request.keymap, inner);
}

function encodeRuntime(id, typeField, body = new Uint8Array()) {
  // Runtime Config uses message-valued oneofs, including for empty requests.
  const request = body.length
    ? encodeSub(typeField, body)
    : concatBytes([encodeKey(typeField, 2), encodeVarint(0)]);
  const inner = concatBytes([encodeUint32(Fr.Request.request_id, id), request]);
  return encodeRequest(id, Fs.Request.runtime_config, inner);
}

function parseParamDesc(fields) {
  const name = fieldStr(fields, Fb.BehaviorParameterValueDescription.name);
  const out = { name };
  if (fieldMsgs(fields, Fb.BehaviorParameterValueDescription.nil).length) out.nil = true;
  const constants = fieldNums(fields, Fb.BehaviorParameterValueDescription.constant);
  if (constants.length) out.constant = constants[0];
  if (fieldMsgs(fields, Fb.BehaviorParameterValueDescription.hid_usage).length) out.hid = true;
  if (fieldMsgs(fields, Fb.BehaviorParameterValueDescription.layer_id).length) out.layer = true;
  return out;
}

function parseBehaviorDetails(fields) {
  const sets = fieldMsgs(fields, Fb.GetBehaviorDetailsResponse.metadata);
  const param1 = [];
  const param2 = [];
  for (const set of sets.length ? sets : [new Map()]) {
    param1.push(...fieldMsgs(set, Fb.BehaviorBindingParametersSet.param1).map(parseParamDesc));
    param2.push(...fieldMsgs(set, Fb.BehaviorBindingParametersSet.param2).map(parseParamDesc));
  }
  return {
    id: fieldU32(fields, Fb.GetBehaviorDetailsResponse.id),
    displayName: fieldStr(fields, Fb.GetBehaviorDetailsResponse.display_name),
    param1,
    param2,
  };
}

function parseBinding(fields) {
  const rawId = fieldU32(fields, Fk.BehaviorBinding.behavior_id, 0);
  return {
    rawBehaviorId: rawId,
    behaviorId: unzigzag32(rawId),
    param1: fieldU32(fields, Fk.BehaviorBinding.param1),
    param2: fieldU32(fields, Fk.BehaviorBinding.param2),
  };
}

function parseLayer(fields) {
  return {
    id: fieldU32(fields, Fk.Layer.id),
    name: fieldStr(fields, Fk.Layer.name),
    bindings: fieldMsgs(fields, Fk.Layer.bindings).map(parseBinding),
  };
}

function parseKeymap(fields) {
  return {
    layers: fieldMsgs(fields, Fk.Keymap.layers).map(parseLayer),
    availableLayers: fieldU32(fields, Fk.Keymap.available_layers),
  };
}

function parsePhysicalKey(fields) {
  return {
    w: unzigzag32(fieldU32(fields, Fk.KeyPhysicalAttrs.width)),
    h: unzigzag32(fieldU32(fields, Fk.KeyPhysicalAttrs.height)),
    x: unzigzag32(fieldU32(fields, Fk.KeyPhysicalAttrs.x)),
    y: unzigzag32(fieldU32(fields, Fk.KeyPhysicalAttrs.y)),
    r: unzigzag32(fieldU32(fields, Fk.KeyPhysicalAttrs.r)),
    rx: unzigzag32(fieldU32(fields, Fk.KeyPhysicalAttrs.rx)),
    ry: unzigzag32(fieldU32(fields, Fk.KeyPhysicalAttrs.ry)),
  };
}

function parsePhysicalLayouts(fields) {
  return {
    activeLayoutIndex: fieldU32(fields, Fk.PhysicalLayouts.active_layout_index),
    layouts: fieldMsgs(fields, Fk.PhysicalLayouts.layouts).map((layout) => ({
      name: fieldStr(layout, Fk.PhysicalLayout.name),
      keys: fieldMsgs(layout, Fk.PhysicalLayout.keys).map(parsePhysicalKey),
    })),
  };
}

function parseResponse(bytes) {
  const top = decodeFields(bytes);
  const rr = fieldMsgs(top, Fs.Response.request_response)[0];
  if (!rr) return { notification: true };
  const requestId = fieldU32(rr, Fs.RequestResponse.request_id);
  const meta = fieldMsgs(rr, Fs.RequestResponse.meta)[0];
  const core = fieldMsgs(rr, Fs.RequestResponse.core)[0];
  const behaviors = fieldMsgs(rr, Fs.RequestResponse.behaviors)[0];
  const keymap = fieldMsgs(rr, Fs.RequestResponse.keymap)[0];
  const runtimeConfig = fieldMsgs(rr, Fs.RequestResponse.runtime_config)[0];
  const out = { requestId };
  if (meta) {
    if (fieldU32(meta, Fm.Response.no_response)) out.noResponse = true;
    if (fieldNums(meta, Fm.Response.simple_error).length) out.error = fieldU32(meta, Fm.Response.simple_error);
  }
  if (core) {
    const info = fieldMsgs(core, Fc.Response.get_device_info)[0];
    if (info) out.deviceInfo = { name: fieldStr(info, Fc.GetDeviceInfoResponse.name) };
    if (fieldNums(core, Fc.Response.get_lock_state).length) out.lockState = fieldU32(core, Fc.Response.get_lock_state);
    if (fieldU32(core, Fc.Response.reset_settings)) out.resetSettings = true;
  }
  if (behaviors) {
    const list = fieldMsgs(behaviors, Fb.Response.list_all_behaviors)[0];
    if (list) out.behaviorIds = fieldNums(list, Fb.ListAllBehaviorsResponse.behaviors);
    const details = fieldMsgs(behaviors, Fb.Response.get_behavior_details)[0];
    if (details) out.behavior = parseBehaviorDetails(details);
  }
  if (keymap) {
    const km = fieldMsgs(keymap, Fk.Response.get_keymap)[0];
    if (km) out.keymap = parseKeymap(km);
    const physicalLayouts = fieldMsgs(keymap, Fk.Response.get_physical_layouts)[0];
    if (physicalLayouts) out.physicalLayouts = parsePhysicalLayouts(physicalLayouts);
    // SetLayerBindingResponse is the plain enum SET_LAYER_BINDING_RESP_* on
    // the wire (a varint), in both zmk-next-messages and real upstream
    // zmk-studio-messages — never a submessage.
    if (fieldNums(keymap, Fk.Response.set_layer_binding).length) {
      out.setLayerBinding = fieldU32(keymap, Fk.Response.set_layer_binding);
    }
    const save = fieldMsgs(keymap, Fk.Response.save_changes)[0];
    if (save) {
      out.saveOk =
        fieldU32(save, Fk.SaveChangesResponse.ok) === 1 ||
        fieldMsgs(save, Fk.SaveChangesResponse.ok).length > 0 ||
        fieldU32(save, Fk.SaveChangesResponse.ok) > 0;
      if (fieldNums(save, Fk.SaveChangesResponse.ok).length) out.saveOk = !!fieldU32(save, Fk.SaveChangesResponse.ok);
      if (fieldNums(save, Fk.SaveChangesResponse.err).length) {
        out.saveOk = false;
        out.saveErr = fieldU32(save, Fk.SaveChangesResponse.err);
      }
    }
    if (fieldU32(keymap, Fk.Response.save_changes) && !save) out.saveOk = true;

    const moveLayer = fieldMsgs(keymap, Fk.Response.move_layer)[0];
    if (moveLayer) {
      const ok = fieldMsgs(moveLayer, Fk.MoveLayerResponse.ok)[0];
      if (ok) out.moveLayer = parseKeymap(ok);
      else out.moveLayerErr = fieldU32(moveLayer, Fk.MoveLayerResponse.err);
    }

    const addLayer = fieldMsgs(keymap, Fk.Response.add_layer)[0];
    if (addLayer) {
      const ok = fieldMsgs(addLayer, Fk.AddLayerResponse.ok)[0];
      if (ok) {
        out.addLayer = {
          index: fieldU32(ok, Fk.AddLayerResponseDetails.index),
          layer: parseLayer(fieldMsgs(ok, Fk.AddLayerResponseDetails.layer)[0] || new Map()),
        };
      } else out.addLayerErr = fieldU32(addLayer, Fk.AddLayerResponse.err);
    }

    const removeLayer = fieldMsgs(keymap, Fk.Response.remove_layer)[0];
    if (removeLayer) {
      if (!fieldMsgs(removeLayer, Fk.RemoveLayerResponse.ok).length) {
        out.removeLayerErr = fieldU32(removeLayer, Fk.RemoveLayerResponse.err);
      }
    }

    const restoreLayer = fieldMsgs(keymap, Fk.Response.restore_layer)[0];
    if (restoreLayer) {
      const ok = fieldMsgs(restoreLayer, Fk.RestoreLayerResponse.ok)[0];
      if (ok) out.restoreLayer = parseLayer(ok);
      else out.restoreLayerErr = fieldU32(restoreLayer, Fk.RestoreLayerResponse.err);
    }

    // SetLayerPropsResponse is a bare enum on the wire, like set_layer_binding.
    if (fieldNums(keymap, Fk.Response.set_layer_props).length) {
      out.setLayerProps = fieldU32(keymap, Fk.Response.set_layer_props);
    }
  }
  if (runtimeConfig) out.runtimeConfig = decodeRuntimeResponse(runtimeConfig);
  return out;
}

export class StudioClient {
  constructor(port) {
    this.port = port;
    this.nextId = 1;
    this.pending = new Map();
    this.frameState = { mode: "idle", buf: [] };
    this.reader = port.readable.getReader();
    this.writer = port.writable.getWriter();
    this.closed = false;
    this.deviceName = "";
    this.behaviors = [];
    this.layers = [];
    this.physicalLayouts = [];
    this.activePhysicalLayout = null;
    this.lastRuntimeUpdateId = 0;
    this._loop = this.readLoop();
  }

  async readLoop() {
    try {
      while (!this.closed) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value) continue;
        const { frames, state } = deframeAll(value, this.frameState);
        this.frameState = state;
        for (const frame of frames) {
          let parsed;
          try {
            parsed = parseResponse(frame);
          } catch {
            continue;
          }
          if (parsed.notification || parsed.requestId == null) continue;
          const waiter = this.pending.get(parsed.requestId);
          if (waiter) {
            this.pending.delete(parsed.requestId);
            waiter.resolve(parsed);
          }
        }
      }
    } catch (err) {
      this.failAll(err);
    }
    this.failAll(new Error("Studio serial closed"));
  }

  failAll(err) {
    for (const w of this.pending.values()) w.reject(err);
    this.pending.clear();
  }

  async call(build, timeoutMs = 3000, timeoutMessage) {
    const id = this.nextId++;
    const bytes = build(id);
    const framed = frameBytes(bytes);
    const p = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            timeoutMessage ||
              "Studio RPC timed out. Pick the silent RPC port (often cu.usbmodem104), not the printk console (101). Close zmk.studio / Helium first."
          )
        );
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
    await this.writer.write(framed);
    const resp = await p;
    if (resp.error) throw new Error(`Studio error ${resp.error}`);
    if (resp.runtimeConfig?.error) {
      const error = resp.runtimeConfig.error;
      const details = error.diagnostics
        .map((diagnostic) => diagnostic.message || diagnostic.fieldPath)
        .filter(Boolean)
        .join("; ");
      const err = new Error(
        `${runtimeConfigErrorMessage(error.code, error.message)}${details ? ` (${details})` : ""}`
      );
      err.runtimeConfigCode = error.code;
      throw err;
    }
    if (resp.noResponse) throw new Error("Studio sent no_response");
    return resp;
  }

  async handshake() {
    const info = await this.call(
      (id) => encodeCore(id, Fc.Request.get_device_info),
      1500,
      "This USB serial port didn't answer the Studio RPC handshake. If the keyboard exposes more than one serial port, reconnect and pick a different one."
    );
    this.deviceName = info.deviceInfo?.name || "Keyboard";
    const lock = await this.call((id) => encodeCore(id, Fc.Request.get_lock_state));
    if (lock.lockState === 0) {
      throw new Error("Studio is locked. This image should be unlocked; try unplugging USB and reconnecting.");
    }
    const listed = await this.call((id) => encodeBehaviors(id, Fb.Request.list_all_behaviors));
    const ids = listed.behaviorIds || [];
    const behaviors = [];
    for (const behaviorId of ids) {
      const details = await this.call((id) =>
        encodeBehaviors(id, Fb.Request.get_behavior_details, encodeUint32(Fb.GetBehaviorDetailsRequest.behavior_id, behaviorId))
      );
      if (details.behavior) behaviors.push(details.behavior);
    }
    this.behaviors = behaviors;
    await this.getKeymap();
    if (!this.layers.length) throw new Error("Studio returned an empty keymap.");
    return this;
  }

  async getKeymap() {
    const km = await this.call((id) => encodeKeymap(id, Fk.Request.get_keymap), 10000);
    this.layers = km.keymap?.layers || [];
    this.availableLayers = km.keymap?.availableLayers ?? 0;
    this.inferredBehaviors = rememberStudioBehaviors(this.behaviors, this.layers);
    try {
      await this.getPhysicalLayouts();
    } catch (error) {
      // Older Studio firmware may not expose geometry. The editor can still
      // use a profile loaded from the user's config repository.
      console.debug("Studio physical layout discovery unavailable", error);
    }
    return this.layers;
  }

  async getPhysicalLayouts() {
    const resp = await this.call(
      (id) => encodeKeymap(id, Fk.Request.get_physical_layouts),
      3000,
      "The keyboard did not return its physical layout."
    );
    const result = resp.physicalLayouts;
    this.physicalLayouts = result?.layouts || [];
    const active = Number(result?.activeLayoutIndex || 0);
    this.activePhysicalLayout = this.physicalLayouts[active] || this.physicalLayouts[0] || null;
    return this.physicalLayouts;
  }

  async addLayer() {
    // AddLayerRequest is an empty MESSAGE in the oneof, not a bool.
    // encodeKeymap's empty-body fallback assumes a bool field (right for
    // get_keymap/save_changes/etc., all real bool fields) - for a message
    // field that has to stay an explicit tag + zero-length submessage even
    // when empty, or the firmware never recognizes the oneof case at all
    // and the request just times out with no response.
    const emptyAddLayer = concatBytes([encodeKey(Fk.Request.add_layer, 2), encodeVarint(0)]);
    const resp = await this.call((id) => encodeRequest(id, Fs.Request.keymap, emptyAddLayer));
    if (resp.addLayerErr) {
      const reason = ["ok", "generic", "no-space"][resp.addLayerErr] || String(resp.addLayerErr);
      return { ok: false, reason };
    }
    await this.getKeymap();
    return { ok: true, index: resp.addLayer.index, layerId: resp.addLayer.layer.id };
  }

  async moveLayer(startIndex, destIndex) {
    const body = concatBytes([
      encodeUint32(Fk.MoveLayerRequest.start_index, startIndex),
      encodeUint32(Fk.MoveLayerRequest.dest_index, destIndex),
    ]);
    const resp = await this.call((id) => encodeKeymap(id, Fk.Request.move_layer, body));
    if (resp.moveLayerErr) {
      const reason =
        ["ok", "generic", "invalid-layer", "invalid-destination"][resp.moveLayerErr] || String(resp.moveLayerErr);
      return { ok: false, reason };
    }
    this.layers = resp.moveLayer?.layers || this.layers;
    return { ok: true };
  }

  async removeLayer(layerIndex) {
    const body = encodeUint32(Fk.RemoveLayerRequest.layer_index, layerIndex);
    const resp = await this.call((id) => encodeKeymap(id, Fk.Request.remove_layer, body));
    if (resp.removeLayerErr) {
      const reason = ["ok", "generic", "invalid-index"][resp.removeLayerErr] || String(resp.removeLayerErr);
      return { ok: false, reason };
    }
    await this.getKeymap();
    return { ok: true };
  }

  async restoreLayer(layerId, atIndex) {
    const body = concatBytes([
      encodeUint32(Fk.RestoreLayerRequest.layer_id, layerId),
      encodeUint32(Fk.RestoreLayerRequest.at_index, atIndex),
    ]);
    const resp = await this.call((id) => encodeKeymap(id, Fk.Request.restore_layer, body));
    if (resp.restoreLayerErr) {
      const reason =
        ["ok", "generic", "invalid-id", "invalid-index"][resp.restoreLayerErr] || String(resp.restoreLayerErr);
      return { ok: false, reason };
    }
    await this.getKeymap();
    return { ok: true, layer: resp.restoreLayer };
  }

  async setLayerProps(layerId, name) {
    const body = concatBytes([
      encodeUint32(Fk.SetLayerPropsRequest.layer_id, layerId),
      encodeString(Fk.SetLayerPropsRequest.name, name),
    ]);
    const resp = await this.call((id) => encodeKeymap(id, Fk.Request.set_layer_props, body));
    if (resp.setLayerProps) {
      const reason = ["ok", "generic", "invalid-id"][resp.setLayerProps] || String(resp.setLayerProps);
      return { ok: false, reason };
    }
    const layer = this.layers.find((l) => l.id === layerId);
    if (layer) layer.name = name;
    return { ok: true };
  }

  async setBinding(layerIndex, keyPosition, text, layers = this.layers) {
    const layer = this.layers[layerIndex];
    if (!layer) throw new Error(`No Studio layer ${layerIndex}`);
    const mapped = bindingToCells(text, this.behaviors, layers);
    if (!mapped.ok) return mapped;
    const body = concatBytes([
      encodeUint32(Fk.SetLayerBindingRequest.layer_id, layer.id),
      encodeInt32(Fk.SetLayerBindingRequest.key_position, keyPosition),
      encodeSub(
        Fk.SetLayerBindingRequest.binding,
        concatBytes([
          encodeSint32(Fk.BehaviorBinding.behavior_id, mapped.binding.behaviorId),
          encodeUint32(Fk.BehaviorBinding.param1, mapped.binding.param1),
          encodeUint32(Fk.BehaviorBinding.param2, mapped.binding.param2),
        ])
      ),
    ]);
    const resp = await this.call((id) => encodeKeymap(id, Fk.Request.set_layer_binding, body));
    if (resp.setLayerBinding && resp.setLayerBinding !== 0) {
      const why = ["ok", "invalid location", "invalid behavior", "invalid parameters"][resp.setLayerBinding] || String(resp.setLayerBinding);
      return { ok: false, reason: why };
    }
    return { ok: true, binding: mapped.binding };
  }

  async save() {
    const resp = await this.call((id) => encodeKeymap(id, Fk.Request.save_changes));
    if (resp.saveErr) throw new Error(`Studio save failed (${resp.saveErr})`);
    return true;
  }

  async resetKeymapSettings() {
    const resp = await this.call((id) => encodeCore(id, Fc.Request.reset_settings), 10000);
    if (!resp.resetSettings) {
      throw new Error("Keyboard did not restore the compiled Studio keymap");
    }
    return true;
  }

  async getRuntimeCapabilities({ timeoutMs = 10000 } = {}) {
    const resp = await this.call((id) => encodeRuntime(id, Fr.Request.get_runtime_capabilities), timeoutMs);
    const capabilities = resp.runtimeConfig?.capabilities;
    if (!capabilities) throw new Error("Keyboard did not return Runtime Config capabilities");
    if (capabilities.protocolVersion !== RUNTIME_PROTOCOL_VERSION) {
      throw new Error(
        `Runtime Config protocol ${capabilities.protocolVersion} is incompatible with this editor (needs ${RUNTIME_PROTOCOL_VERSION})`
      );
    }
    this.runtimeCapabilities = capabilities;
    return capabilities;
  }

  async getRuntimeConfigStatus({ timeoutMs = 10000 } = {}) {
    const resp = await this.call((id) => encodeRuntime(id, Fr.Request.get_runtime_config_status), timeoutMs);
    const status = resp.runtimeConfig?.status;
    if (!status) throw new Error("Keyboard did not return Runtime Config status");
    this.runtimeStatus = status;
    return status;
  }

  async getRuntimeConfig({ timeoutMs = 10000 } = {}) {
    const resp = await this.call((id) => encodeRuntime(id, Fr.Request.get_runtime_config), timeoutMs);
    const config = resp.runtimeConfig?.config;
    if (!config?.snapshot || !config.status) {
      throw new Error("Keyboard did not return a Runtime Config snapshot");
    }
    this.runtimeSnapshot = config.snapshot;
    this.runtimeStatus = config.status;
    return config;
  }

  async abortRuntimeUpdate(updateId = this.lastRuntimeUpdateId) {
    try {
      await this.call(
        (id) =>
          encodeRuntime(
            id,
            Fr.Request.abort_runtime_update,
            encodeUint32(Fr.AbortRuntimeUpdateRequest.update_id, updateId || 0)
          ),
        1500
      );
    } catch {
      return false;
    }
    if (!updateId || this.lastRuntimeUpdateId === updateId) this.lastRuntimeUpdateId = 0;
    return true;
  }

  async abortAnyRuntimeUpdate() {
    const known = this.lastRuntimeUpdateId;
    if (known && (await this.abortRuntimeUpdate(known))) return true;
    // Flashed firmware requires the exact update id; 0 only works after that
    // firmware change. Scan a small range so a dropped Apply can recover.
    if (await this.abortRuntimeUpdate(0)) return true;
    for (let id = 1; id <= 16; id++) {
      if (id === known) continue;
      if (await this.abortRuntimeUpdate(id)) return true;
    }
    return false;
  }

  async recoverRuntimeCommit(expectedActiveGeneration = 0) {
    try {
      const config = await this.getRuntimeConfig({ timeoutMs: 8000 });
      const status = config.status || this.runtimeStatus;
      const generation = Math.max(status?.pendingGeneration || 0, status?.activeGeneration || 0);
      if (generation > expectedActiveGeneration) {
        this.lastRuntimeUpdateId = 0;
        this.runtimeStatus = status;
        this.runtimeSnapshot = { ...config.snapshot, generation };
        return {
          validation: { valid: true },
          commit: { saved: true, generation, status },
          recovered: true,
        };
      }
    } catch {
      // Keyboard may still be writing flash; caller decides whether to wait.
    }
    return null;
  }

  async applyRuntimeSnapshot(snapshot, { expectedActiveGeneration, retried, onProgress } = {}) {
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("Runtime Config snapshot is required");
    }
    const progress = (message) => {
      try {
        onProgress?.(message);
      } catch {
        // Status updates must not fail the save.
      }
    };
    const uploadSnapshot = { ...snapshot, generation: 0 };
    const bytes = encodeRuntimeSnapshot(uploadSnapshot);
    const expected =
      expectedActiveGeneration ?? this.runtimeStatus?.activeGeneration ?? snapshot.generation ?? 0;
    let updateId = 0;
    let commitSent = false;
    let step = "start";
    const applyTimeout = (name) =>
      `Keyboard timed out during ${name}. Keep USB connected. Do not Load from Keyboard yet.`;

    if (!retried && this.lastRuntimeUpdateId) {
      await this.abortRuntimeUpdate(this.lastRuntimeUpdateId);
    }

    try {
      step = "begin";
      progress(`Starting Runtime Config update (${bytes.length} bytes, ${snapshot.keymapOverrides?.length || 0} keys)…`);
      const beginResponse = await this.call(
        (id) =>
          encodeRuntime(
            id,
            Fr.Request.begin_runtime_update,
            concatBytes([
              encodeUint32(Fr.BeginRuntimeUpdateRequest.expected_active_generation, expected),
              encodeUint32(Fr.BeginRuntimeUpdateRequest.snapshot_size, bytes.length),
            ])
          ),
        20000,
        applyTimeout("begin")
      );
      const begin = beginResponse.runtimeConfig?.begin;
      if (!begin?.updateId || !begin.maxChunkBytes) {
        throw new Error("Keyboard did not accept the Runtime Config update");
      }
      updateId = begin.updateId;
      this.lastRuntimeUpdateId = updateId;
      // Stock Studio UART RX ring is 30 bytes. A 48-byte snapshot in one
      // chunk overruns it, so USB drops the frame and upload times out.
      const maxChunk = Math.max(1, Math.min(begin.maxChunkBytes || 8, 8));

      for (let offset = 0; offset < bytes.length; ) {
        step = "upload";
        progress(`Uploading Runtime Config… ${offset}/${bytes.length} bytes`);
        const chunk = bytes.slice(offset, offset + maxChunk);
        const chunkResponse = await this.call(
          (id) =>
            encodeRuntime(
              id,
              Fr.Request.upload_runtime_update_chunk,
              concatBytes([
                encodeUint32(Fr.UploadRuntimeUpdateChunkRequest.update_id, updateId),
                encodeUint32(Fr.UploadRuntimeUpdateChunkRequest.offset, offset),
                encodeBytes(Fr.UploadRuntimeUpdateChunkRequest.chunk, chunk),
              ])
            ),
          15000,
          applyTimeout("upload")
        );
        const accepted = chunkResponse.runtimeConfig?.chunk;
        if (!accepted || accepted.acceptedBytes !== chunk.length || accepted.nextOffset !== offset + chunk.length) {
          throw new Error("Keyboard rejected a Runtime Config upload chunk");
        }
        offset = accepted.nextOffset;
      }

      step = "validate";
      progress("Validating Runtime Config snapshot…");
      const validationResponse = await this.call(
        (id) => encodeRuntime(id, Fr.Request.validate_runtime_update, encodeUint32(Fr.ValidateRuntimeUpdateRequest.update_id, updateId)),
        30000,
        applyTimeout("validate")
      );
      const validation = validationResponse.runtimeConfig?.validation;
      if (!validation?.valid) {
        const diagnostics = validation?.errors || [];
        const errors = diagnostics.map((error) => error.message || error.fieldPath).filter(Boolean).join("; ");
        throw new RuntimeValidationError(
          `Runtime Config validation failed${errors ? `: ${errors}` : ""}`,
          diagnostics,
          validation
        );
      }

      step = "save";
      progress("Saving Runtime Config to keyboard flash. Keep USB connected…");
      commitSent = true;
      const commitResponse = await this.call(
        (id) => encodeRuntime(id, Fr.Request.commit_runtime_update, encodeUint32(Fr.CommitRuntimeUpdateRequest.update_id, updateId)),
        60000,
        applyTimeout("save")
      );
      const commit = commitResponse.runtimeConfig?.commit;
      if (!commit?.saved) throw new Error("Keyboard did not save the Runtime Config update");
      this.runtimeStatus = commit.status || this.runtimeStatus;
      this.runtimeSnapshot = { ...uploadSnapshot, generation: commit.generation };
      this.lastRuntimeUpdateId = 0;
      return { validation, commit };
    } catch (error) {
      const timedOut = /did not finish this Runtime Config step|timed out/i.test(error?.message || "");
      if (timedOut) {
        progress("Save timed out; checking whether the keyboard finished writing…");
        const recovered = await this.recoverRuntimeCommit(expected);
        if (recovered) return recovered;
      }
      if (updateId && !commitSent) {
        await this.abortRuntimeUpdate(updateId);
      }
      if (!retried && error.runtimeConfigCode === RUNTIME_CONFIG_ERROR.UPDATE_IN_PROGRESS) {
        // Firmware returns busy while a persisted generation is waiting for
        // idle. Aborting staging does not clear that. Wait, then retry with
        // the generation that is actually active.
        progress("Waiting for the keyboard to go idle. Lift all keys…");
        const waited = await waitForRuntimeStatus(() => this.getRuntimeConfigStatus({ timeoutMs: 2000 }), {
          wantedGeneration: 0,
          timeoutMs: 60000,
          onWaiting: () => progress("Waiting for the keyboard to go idle. Lift all keys…"),
        });
        if (waited.ok) {
          return this.applyRuntimeSnapshot(snapshot, {
            expectedActiveGeneration: waited.status?.activeGeneration ?? 0,
            retried: true,
            onProgress,
          });
        }
      }
      if (error.runtimeConfigCode === RUNTIME_CONFIG_ERROR.UPDATE_IN_PROGRESS) {
        throw new Error(
          "A Runtime Config save is waiting for the keyboard to go idle. Lift all keys, then try again."
        );
      }
      if (timedOut) {
        throw new Error(
          `Keyboard timed out during ${step}. Keep USB connected and wait a few seconds. Do not Load from Keyboard. If the overlay is still generation 0, Apply that one key change once more.`
        );
      }
      throw error;
    }
  }

  async resetRuntimeConfig({ expectedActiveGeneration } = {}) {
    const expected = expectedActiveGeneration ?? this.runtimeStatus?.activeGeneration ?? 0;
    const response = await this.call(
      (id) => encodeRuntime(id, Fr.Request.reset_runtime_config, encodeUint32(Fr.ResetRuntimeConfigRequest.expected_active_generation, expected)),
      10000
    );
    const reset = response.runtimeConfig?.reset;
    if (!reset?.saved) throw new Error("Keyboard did not restore the stock Runtime Config");
    this.runtimeStatus = reset.status || this.runtimeStatus;
    if (this.runtimeCapabilities) {
      this.runtimeSnapshot = {
        persistenceSchemaVersion: this.runtimeCapabilities.persistenceSchemaVersion,
        generation: reset.generation,
        capabilityFingerprint: this.runtimeCapabilities.capabilityFingerprint,
        keymapOverrides: [],
        layers: [],
        runtimeObjects: [],
        combos: [],
      };
    }
    return reset;
  }

  async close() {
    this.closed = true;
    this.failAll(new Error("disconnected"));
    try {
      this.reader.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      this.writer.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      await this.port.close();
    } catch {
      /* ignore */
    }
  }
}

async function openAndHandshake(port) {
  await port.open({ baudRate: 12500 });
  try {
    if (port.setSignals) {
      await port.setSignals({ dataTerminalReady: true, requestToSend: true });
    }
  } catch {
    /* some CDC stacks ignore this */
  }
  const client = new StudioClient(port);
  try {
    await client.handshake();
    return client;
  } catch (err) {
    await client.close();
    throw err;
  }
}

// Tries every port already granted access in an earlier session, silently.
// Returns null (never throws) if none exist or none answer the RPC
// handshake, so callers - like an auto-connect on page load - can treat
// "nothing to connect to yet" as a normal, unremarkable outcome rather than
// an error.
export async function connectKnownStudioPort() {
  if (!navigator.serial) return null;
  for (const port of await navigator.serial.getPorts()) {
    try {
      return await openAndHandshake(port);
    } catch (err) {
      // Not the RPC port, or not reachable right now - keep looking. Logged
      // (not swallowed silently) since a previously-working known port that
      // stops answering is exactly the kind of thing worth being able to
      // see in devtools instead of just falling back to the picker unexplained.
      console.debug("connectKnownStudioPort: a known port didn't answer", port.getInfo?.(), err);
    }
  }
  return null;
}

export async function connectStudio() {
  if (!navigator.serial) {
    throw new Error("Web Serial is only in Chrome / Edge. Open this editor there.");
  }

  // A keyboard's USB serial functions all enumerate under the identical
  // device-level product name in Chrome's port picker (there is no
  // per-interface string this browser API exposes), so if it exposes more
  // than one - a debug console, some other future port - picking the wrong
  // one is easy. If any port was already granted access in an earlier
  // session, probe those first and skip the picker entirely on success.
  const known = await connectKnownStudioPort();
  if (known) return known;

  const port = await navigator.serial.requestPort({});
  return await openAndHandshake(port);
}

export function encodeSetLayerBindingForTest(requestId, layerId, keyPosition, binding) {
  const body = concatBytes([
    encodeUint32(Fk.SetLayerBindingRequest.layer_id, layerId),
    encodeInt32(Fk.SetLayerBindingRequest.key_position, keyPosition),
    encodeSub(
      Fk.SetLayerBindingRequest.binding,
      concatBytes([
        encodeSint32(Fk.BehaviorBinding.behavior_id, binding.behaviorId),
        encodeUint32(Fk.BehaviorBinding.param1, binding.param1),
        encodeUint32(Fk.BehaviorBinding.param2, binding.param2),
      ])
    ),
  ]);
  return encodeKeymap(requestId, Fk.Request.set_layer_binding, body);
}

export function encodeRuntimeRequestForTest(requestId, typeField, body = new Uint8Array()) {
  return encodeRuntime(requestId, typeField, body);
}

export { parseResponse };

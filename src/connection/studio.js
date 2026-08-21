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
import {
  RUNTIME_PROTOCOL_VERSION,
  decodeRuntimeResponse,
  encodeRuntimeSnapshot,
} from "./runtime-config.js";

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
  return concatBytes([encodeUint32(1, id), encodeSub(subsystemField, body)]);
}

function encodeCore(id, typeField) {
  return encodeRequest(id, 3, encodeBool(typeField, true));
}

function encodeBehaviors(id, typeField, body = new Uint8Array()) {
  const inner = body.length ? encodeSub(typeField, body) : encodeBool(typeField, true);
  return encodeRequest(id, 4, inner);
}

function encodeKeymap(id, typeField, body = new Uint8Array()) {
  const inner = body.length ? encodeSub(typeField, body) : encodeBool(typeField, true);
  return encodeRequest(id, 5, inner);
}

function encodeRuntime(id, typeField, body = new Uint8Array()) {
  // Runtime Config uses message-valued oneofs, including for empty requests.
  const request = body.length
    ? encodeSub(typeField, body)
    : concatBytes([encodeKey(typeField, 2), encodeVarint(0)]);
  const inner = concatBytes([encodeUint32(1, id), request]);
  return encodeRequest(id, 6, inner);
}

function parseParamDesc(fields) {
  const name = fieldStr(fields, 1);
  const out = { name };
  if (fieldMsgs(fields, 2).length) out.nil = true;
  const constants = fieldNums(fields, 3);
  if (constants.length) out.constant = constants[0];
  if (fieldMsgs(fields, 5).length) out.hid = true;
  if (fieldMsgs(fields, 6).length) out.layer = true;
  return out;
}

function parseBehaviorDetails(fields) {
  const sets = fieldMsgs(fields, 3);
  const param1 = [];
  const param2 = [];
  for (const set of sets.length ? sets : [new Map()]) {
    param1.push(...fieldMsgs(set, 1).map(parseParamDesc));
    param2.push(...fieldMsgs(set, 2).map(parseParamDesc));
  }
  return {
    id: fieldU32(fields, 1),
    displayName: fieldStr(fields, 2),
    param1,
    param2,
  };
}

function parseBinding(fields) {
  const rawId = fieldU32(fields, 1, 0);
  return {
    rawBehaviorId: rawId,
    behaviorId: unzigzag32(rawId),
    param1: fieldU32(fields, 2),
    param2: fieldU32(fields, 3),
  };
}

function parseLayer(fields) {
  return {
    id: fieldU32(fields, 1),
    name: fieldStr(fields, 2),
    bindings: fieldMsgs(fields, 3).map(parseBinding),
  };
}

function parseKeymap(fields) {
  return {
    layers: fieldMsgs(fields, 1).map(parseLayer),
    availableLayers: fieldU32(fields, 2),
  };
}

function parseResponse(bytes) {
  const top = decodeFields(bytes);
  const rr = fieldMsgs(top, 1)[0];
  if (!rr) return { notification: true };
  const requestId = fieldU32(rr, 1);
  const meta = fieldMsgs(rr, 2)[0];
  const core = fieldMsgs(rr, 3)[0];
  const behaviors = fieldMsgs(rr, 4)[0];
  const keymap = fieldMsgs(rr, 5)[0];
  const runtimeConfig = fieldMsgs(rr, 6)[0];
  const out = { requestId };
  if (meta) {
    if (fieldU32(meta, 1)) out.noResponse = true;
    if (fieldNums(meta, 2).length) out.error = fieldU32(meta, 2);
  }
  if (core) {
    const info = fieldMsgs(core, 1)[0];
    if (info) out.deviceInfo = { name: fieldStr(info, 1) };
    if (fieldNums(core, 2).length) out.lockState = fieldU32(core, 2);
    if (fieldU32(core, 4)) out.resetSettings = true;
  }
  if (behaviors) {
    const list = fieldMsgs(behaviors, 1)[0];
    if (list) out.behaviorIds = fieldNums(list, 1);
    const details = fieldMsgs(behaviors, 2)[0];
    if (details) out.behavior = parseBehaviorDetails(details);
  }
  if (keymap) {
    const km = fieldMsgs(keymap, 1)[0];
    if (km) out.keymap = parseKeymap(km);
    // SetLayerBindingResponse is a message whose `result` enum is field 1.
    // It is not the enum directly on the keymap subsystem response. The
    // direct numeric fallback keeps this parser tolerant of old/nonstandard
    // firmware that flattened the response.
    const setBinding = fieldMsgs(keymap, 2)[0];
    if (setBinding) out.setLayerBinding = fieldU32(setBinding, 1);
    else if (fieldNums(keymap, 2).length) out.setLayerBinding = fieldU32(keymap, 2);
    const save = fieldMsgs(keymap, 4)[0];
    if (save) {
      out.saveOk = fieldU32(save, 1) === 1 || fieldMsgs(save, 1).length > 0 || fieldU32(save, 1) > 0;
      if (fieldNums(save, 1).length) out.saveOk = !!fieldU32(save, 1);
      if (fieldNums(save, 2).length) {
        out.saveOk = false;
        out.saveErr = fieldU32(save, 2);
      }
    }
    if (fieldU32(keymap, 4) && !save) out.saveOk = true;
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

  async call(build, timeoutMs = 3000) {
    const id = this.nextId++;
    const bytes = build(id);
    const framed = frameBytes(bytes);
    const p = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Studio RPC timed out. Pick the silent RPC port (often cu.usbmodem104), not the printk console (101). Close zmk.studio / Helium first."));
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
      throw new Error(
        `Runtime Config error ${error.code}${error.message ? `: ${error.message}` : ""}${
          details ? ` (${details})` : ""
        }`
      );
    }
    if (resp.noResponse) throw new Error("Studio sent no_response");
    return resp;
  }

  async handshake() {
    const info = await this.call((id) => encodeCore(id, 1));
    this.deviceName = info.deviceInfo?.name || "Totem";
    const lock = await this.call((id) => encodeCore(id, 2));
    if (lock.lockState === 0) {
      throw new Error("Studio is locked. This image should be unlocked; try unplugging USB and reconnecting.");
    }
    const listed = await this.call((id) => encodeBehaviors(id, 1));
    const ids = listed.behaviorIds || [];
    const behaviors = [];
    for (const behaviorId of ids) {
      const details = await this.call((id) =>
        encodeBehaviors(id, 2, encodeUint32(1, behaviorId))
      );
      if (details.behavior) behaviors.push(details.behavior);
    }
    this.behaviors = behaviors;
    await this.getKeymap();
    if (!this.layers.length) throw new Error("Studio returned an empty keymap.");
    return this;
  }

  async getKeymap() {
    const km = await this.call((id) => encodeKeymap(id, 1), 10000);
    this.layers = km.keymap?.layers || [];
    this.inferredBehaviors = rememberStudioBehaviors(this.behaviors, this.layers);
    return this.layers;
  }

  async setBinding(layerIndex, keyPosition, text, layers = this.layers) {
    const layer = this.layers[layerIndex];
    if (!layer) throw new Error(`No Studio layer ${layerIndex}`);
    const mapped = bindingToCells(text, this.behaviors, layers);
    if (!mapped.ok) return mapped;
    const body = concatBytes([
      encodeUint32(1, layer.id),
      encodeInt32(2, keyPosition),
      encodeSub(
        3,
        concatBytes([
          encodeSint32(1, mapped.binding.behaviorId),
          encodeUint32(2, mapped.binding.param1),
          encodeUint32(3, mapped.binding.param2),
        ])
      ),
    ]);
    const resp = await this.call((id) => encodeKeymap(id, 2, body));
    if (resp.setLayerBinding && resp.setLayerBinding !== 0) {
      const why = ["ok", "invalid location", "invalid behavior", "invalid parameters"][resp.setLayerBinding] || String(resp.setLayerBinding);
      return { ok: false, reason: why };
    }
    return { ok: true, binding: mapped.binding };
  }

  async save() {
    const resp = await this.call((id) => encodeKeymap(id, 4));
    if (resp.saveErr) throw new Error(`Studio save failed (${resp.saveErr})`);
    return true;
  }

  async getRuntimeCapabilities({ timeoutMs = 10000 } = {}) {
    const resp = await this.call((id) => encodeRuntime(id, 2), timeoutMs);
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
    const resp = await this.call((id) => encodeRuntime(id, 3), timeoutMs);
    const status = resp.runtimeConfig?.status;
    if (!status) throw new Error("Keyboard did not return Runtime Config status");
    this.runtimeStatus = status;
    return status;
  }

  async getRuntimeConfig({ timeoutMs = 10000 } = {}) {
    const resp = await this.call((id) => encodeRuntime(id, 4), timeoutMs);
    const config = resp.runtimeConfig?.config;
    if (!config?.snapshot || !config.status) {
      throw new Error("Keyboard did not return a Runtime Config snapshot");
    }
    this.runtimeSnapshot = config.snapshot;
    this.runtimeStatus = config.status;
    return config;
  }

  async applyRuntimeSnapshot(snapshot, { expectedActiveGeneration } = {}) {
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("Runtime Config snapshot is required");
    }
    const uploadSnapshot = { ...snapshot, generation: 0 };
    const bytes = encodeRuntimeSnapshot(uploadSnapshot);
    const expected =
      expectedActiveGeneration ?? this.runtimeStatus?.activeGeneration ?? snapshot.generation ?? 0;
    let updateId = 0;

    try {
      const beginResponse = await this.call(
        (id) =>
          encodeRuntime(
            id,
            5,
            concatBytes([
              encodeUint32(1, expected),
              encodeUint32(2, bytes.length),
            ])
          ),
        10000
      );
      const begin = beginResponse.runtimeConfig?.begin;
      if (!begin?.updateId || !begin.maxChunkBytes) {
        throw new Error("Keyboard did not accept the Runtime Config update");
      }
      updateId = begin.updateId;

      for (let offset = 0; offset < bytes.length; ) {
        const chunk = bytes.slice(offset, offset + begin.maxChunkBytes);
        const chunkResponse = await this.call(
          (id) =>
            encodeRuntime(
              id,
              6,
              concatBytes([
                encodeUint32(1, updateId),
                encodeUint32(2, offset),
                encodeBytes(3, chunk),
              ])
            ),
          10000
        );
        const accepted = chunkResponse.runtimeConfig?.chunk;
        if (!accepted || accepted.acceptedBytes !== chunk.length || accepted.nextOffset !== offset + chunk.length) {
          throw new Error("Keyboard rejected a Runtime Config upload chunk");
        }
        offset = accepted.nextOffset;
      }

      const validationResponse = await this.call(
        (id) => encodeRuntime(id, 7, encodeUint32(1, updateId)),
        10000
      );
      const validation = validationResponse.runtimeConfig?.validation;
      if (!validation?.valid) {
        const errors = validation?.errors?.map((error) => error.message || error.fieldPath).filter(Boolean).join("; ");
        throw new Error(`Runtime Config validation failed${errors ? `: ${errors}` : ""}`);
      }

      const commitResponse = await this.call(
        (id) => encodeRuntime(id, 8, encodeUint32(1, updateId)),
        10000
      );
      const commit = commitResponse.runtimeConfig?.commit;
      if (!commit?.saved) throw new Error("Keyboard did not save the Runtime Config update");
      this.runtimeStatus = commit.status || this.runtimeStatus;
      this.runtimeSnapshot = { ...uploadSnapshot, generation: commit.generation };
      return { validation, commit };
    } catch (error) {
      if (updateId) {
        try {
          await this.call((id) => encodeRuntime(id, 9, encodeUint32(1, updateId)), 10000);
        } catch {
          // The primary request failure is more useful; a retry can recover the staged update.
        }
      }
      throw error;
    }
  }

  async resetRuntimeConfig({ expectedActiveGeneration } = {}) {
    const expected = expectedActiveGeneration ?? this.runtimeStatus?.activeGeneration ?? 0;
    const response = await this.call(
      (id) => encodeRuntime(id, 10, encodeUint32(1, expected)),
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

export async function connectStudio() {
  if (!navigator.serial) {
    throw new Error("Web Serial is only in Chrome / Edge. Open this editor there.");
  }
  const port = await navigator.serial.requestPort({});
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

export function encodeSetLayerBindingForTest(requestId, layerId, keyPosition, binding) {
  const body = concatBytes([
    encodeUint32(1, layerId),
    encodeInt32(2, keyPosition),
    encodeSub(
      3,
      concatBytes([
        encodeSint32(1, binding.behaviorId),
        encodeUint32(2, binding.param1),
        encodeUint32(3, binding.param2),
      ])
    ),
  ]);
  return encodeKeymap(requestId, 2, body);
}

export function encodeRuntimeRequestForTest(requestId, typeField, body = new Uint8Array()) {
  return encodeRuntime(requestId, typeField, body);
}

export { parseResponse };

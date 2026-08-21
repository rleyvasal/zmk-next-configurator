import {
  HOLD_TAP_FLAVOR,
  compiledAction,
  decodeRuntimeSnapshot,
  encodeRuntimeSnapshot,
  runtimeObjectAction,
} from "../src/connection/runtime-config.js";
import {
  RuntimeDraftError,
  actionFromBindingText,
  bindingTextFromAction,
  capabilitySupportsObjectType,
  createRuntimeDraft,
  deleteRuntimeCombo,
  deleteRuntimeObject,
  isRuntimeObjectBinding,
  nextRuntimeObjectId,
  parseRuntimeObjectId,
  replaceDraftKeymapOverrides,
  runtimeObjectReferences,
  runtimeResourceUsage,
  selectedIndexesToStock,
  supportedRuntimeEditorTypes,
  upsertRuntimeCombo,
  upsertRuntimeObject,
} from "../src/connection/runtime-draft.js";
import {
  concatBytes,
  decodeFields,
  encodeBytes,
  encodeRepeatedUint32,
  encodeSub,
  encodeUint32,
  fieldMsgs,
  fieldU32,
} from "../src/connection/pb.js";
import { encodeRuntimeRequestForTest, parseResponse } from "../src/connection/studio.js";

const fingerprint = new Uint8Array(Array.from({ length: 16 }, (_, index) => index + 1));
const kpA = compiledAction(7, 0x070004);
const kpB = compiledAction(7, 0x070005);
const kpC = compiledAction(7, 0x070006);

const snapshot = {
  persistenceSchemaVersion: 6,
  generation: 21,
  capabilityFingerprint: fingerprint,
  keymapOverrides: [{ layerId: 1, keyPosition: 4, action: runtimeObjectAction(13) }],
  runtimeObjects: [
    {
      id: 11,
      type: "modMorph",
      modifiers: 2,
      normalAction: kpA,
      morphedAction: kpB,
    },
    {
      id: 12,
      type: "macro",
      steps: [
        { type: "tap", action: kpA },
        { type: "wait", ms: 0 },
        { type: "press", action: kpB },
        { type: "release", action: kpB },
        { type: "pauseUntilRelease" },
      ],
    },
    {
      id: 13,
      type: "holdTap",
      tapAction: kpA,
      holdAction: kpB,
      flavor: HOLD_TAP_FLAVOR.BALANCED,
      tappingTermMs: 200,
      quickTapMs: 125,
      requirePriorIdleMs: 50,
    },
    {
      id: 14,
      type: "tapDance",
      tappingTermMs: 180,
      actions: [
        { tapCount: 1, tapAction: kpA, holdAction: kpB },
        { tapCount: 2, tapAction: kpB, holdAction: kpC },
      ],
    },
  ],
  combos: [
    {
      id: 31,
      keyPositions: [0, 4],
      timeoutMs: 50,
      output: runtimeObjectAction(12),
      slowRelease: true,
      requirePriorIdleMs: 20,
    },
  ],
};

const wireSnapshot = encodeRuntimeSnapshot(snapshot);
const roundTrip = decodeRuntimeSnapshot(wireSnapshot);
if (roundTrip.persistenceSchemaVersion !== 6 || roundTrip.generation !== 21) {
  throw new Error(`snapshot header ${JSON.stringify(roundTrip)}`);
}
if (roundTrip.capabilityFingerprint.length !== 16 || roundTrip.capabilityFingerprint[15] !== 16) {
  throw new Error("snapshot fingerprint");
}
if (roundTrip.keymapOverrides[0].action.runtimeObjectId !== 13) throw new Error("keymap action");
if (roundTrip.runtimeObjects[1].steps[1].type !== "wait" || roundTrip.runtimeObjects[1].steps[1].ms !== 0) {
  throw new Error(`zero wait did not round-trip ${JSON.stringify(roundTrip.runtimeObjects[1])}`);
}
if (roundTrip.runtimeObjects[3].actions[1].holdAction.compiledBehavior.param1 !== 0x070006) {
  throw new Error("tap-dance action");
}
if (roundTrip.combos[0].output.runtimeObjectId !== 12) throw new Error("combo action");
if (roundTrip.combos[0].keyPositions.join(",") !== "0,4") throw new Error("combo positions");

let rejectedLayers = false;
try {
  encodeRuntimeSnapshot({ ...snapshot, layers: [{ layerId: 1, name: "nav", order: 1 }] });
} catch {
  rejectedLayers = true;
}
if (!rejectedLayers) throw new Error("layer metadata must remain unsupported");

const draftCapabilities = {
  selectedPositionCount: 3,
  selectedToStockPositions: [2, 0, 1],
  limits: { maxKeymapOverrides: 6 },
};
const draftBehaviors = [
  { id: 7, displayName: "Key Press", param1: [{ hid: true }], param2: [{ nil: true }] },
  { id: 9, displayName: "Momentary Layer", param1: [{ layer: true }], param2: [{ nil: true }] },
];
const draftStudioLayers = [{ id: 0, name: "base" }, { id: 2, name: "nav" }];
const editorLayers = [
  { bindings: [{ text: "&kp A" }, { text: "&kp B" }, { text: "&mo NAV" }] },
  { bindings: [{ text: "&kp C" }, { text: "&kp D" }, { text: "&kp E" }] },
];
const editorDraft = replaceDraftKeymapOverrides({
  snapshot,
  capabilities: draftCapabilities,
  editorLayers,
  deviceLayerIds: [0, 2],
  behaviors: draftBehaviors,
  studioLayers: draftStudioLayers,
});
if (
  editorDraft.keymapOverrides.length !== 6 ||
  editorDraft.keymapOverrides.slice(0, 3).map((entry) => entry.keyPosition).join(",") !== "2,0,1" ||
  editorDraft.keymapOverrides[2].action.compiledBehavior.param1 !== 2 ||
  editorDraft.runtimeObjects.length !== snapshot.runtimeObjects.length ||
  editorDraft.combos.length !== snapshot.combos.length
) {
  throw new Error(`runtime draft ${JSON.stringify(editorDraft)}`);
}
const mouseBehaviors = [
  ...draftBehaviors,
  { id: 40, displayName: "Move Mouse", param1: [], param2: [] },
  { id: 41, displayName: "Mouse Scroll", param1: [], param2: [] },
];
const mouseDraft = replaceDraftKeymapOverrides({
  snapshot,
  capabilities: { ...draftCapabilities, limits: { maxKeymapOverrides: 6 } },
  editorLayers: [{ bindings: [{ text: "&kp A" }, { text: "&msc SCRL_UP" }, { text: "&mmv MOVE_LEFT" }] }],
  deviceLayerIds: [0],
  behaviors: mouseBehaviors,
  studioLayers: draftStudioLayers,
});
if (mouseDraft.keymapOverrides.length !== 1 || mouseDraft.keymapOverrides[0].keyPosition !== 2) {
  throw new Error(`mouse-axis keys must stay compiled ${JSON.stringify(mouseDraft.keymapOverrides)}`);
}
if ((mouseDraft.skippedBindings || []).length !== 2) {
  throw new Error(`mouse skips ${JSON.stringify(mouseDraft.skippedBindings)}`);
}
const customDraft = replaceDraftKeymapOverrides({
  snapshot,
  capabilities: { ...draftCapabilities, limits: { maxKeymapOverrides: 6 } },
  editorLayers: [{ bindings: [{ text: "&host_log_dump" }, { text: "&kp B" }, { text: "&kp C" }] }],
  deviceLayerIds: [0],
  behaviors: draftBehaviors,
  studioLayers: draftStudioLayers,
});
if (customDraft.keymapOverrides.length !== 2 || (customDraft.skippedBindings || [])[0]?.text !== "&host_log_dump") {
  throw new Error(`custom compiled bindings must stay stock ${JSON.stringify(customDraft.skippedBindings)}`);
}
let draftRejected = false;
try {
  replaceDraftKeymapOverrides({
    snapshot,
    capabilities: draftCapabilities,
    editorLayers: [{ bindings: [{ text: "&rt 999" }, { text: "&kp B" }, { text: "&kp C" }] }],
    deviceLayerIds: [0],
    behaviors: draftBehaviors,
    studioLayers: draftStudioLayers,
  });
} catch (error) {
  draftRejected = error instanceof RuntimeDraftError && /not in this draft/.test(error.message);
}
if (!draftRejected) throw new Error("runtime draft must reject unknown &rt object IDs");

const request = decodeFields(encodeRuntimeRequestForTest(44, 2));
if (fieldU32(request, 1) !== 44) throw new Error("outer runtime request ID");
const runtimeRequest = fieldMsgs(request, 6)[0];
if (!runtimeRequest || fieldU32(runtimeRequest, 1) !== 44 || !fieldMsgs(runtimeRequest, 2).length) {
  throw new Error("runtime request envelope");
}
const resetRequest = decodeFields(encodeRuntimeRequestForTest(45, 10, encodeUint32(1, 21)));
const resetBody = fieldMsgs(fieldMsgs(resetRequest, 6)[0], 10)[0];
if (fieldU32(resetBody, 1) !== 21) throw new Error("reset request generation");

const capabilities = concatBytes([
  encodeUint32(1, 1),
  encodeUint32(2, 6),
  encodeBytes(3, fingerprint),
  encodeUint32(4, 1),
  encodeUint32(4, 4),
  encodeUint32(5, 7),
  encodeSub(
    6,
    concatBytes([
      encodeUint32(1, 64),
      encodeUint32(2, 32),
      encodeUint32(3, 5),
      encodeUint32(4, 512),
      encodeUint32(5, 4096),
      encodeUint32(6, 5),
      encodeUint32(7, 256),
      encodeUint32(8, 64),
    ])
  ),
  encodeUint32(8, 3),
  encodeRepeatedUint32(9, 2),
  encodeRepeatedUint32(9, 0),
  encodeRepeatedUint32(9, 1),
]);
const runtimeResponse = concatBytes([encodeUint32(1, 44), encodeSub(3, capabilities)]);
const response = parseResponse(
  encodeSub(1, concatBytes([encodeUint32(1, 44), encodeSub(6, runtimeResponse)]))
);
if (
  response.requestId !== 44 ||
  response.runtimeConfig?.requestId !== 44 ||
  response.runtimeConfig?.capabilities?.limits.maxTapDanceActions !== 64 ||
  response.runtimeConfig?.capabilities?.selectedPositionCount !== 3 ||
  response.runtimeConfig?.capabilities?.selectedToStockPositions.join(",") !== "2,0,1" ||
  response.runtimeConfig?.capabilities?.supportedObjectTypes.join(",") !== "1,4"
) {
  throw new Error(`runtime response ${JSON.stringify(response)}`);
}

const resetResponse = parseResponse(
  encodeSub(
    1,
    concatBytes([
      encodeUint32(1, 45),
      encodeSub(
        6,
        concatBytes([
          encodeUint32(1, 45),
          encodeSub(
            11,
            concatBytes([
              encodeUint32(1, 22),
              new Uint8Array([0x10, 0x01]),
              encodeUint32(3, 2),
              encodeSub(4, concatBytes([encodeUint32(1, 4), encodeUint32(2, 21), encodeUint32(3, 22)])),
            ])
          ),
        ])
      ),
    ])
  )
);
if (
  !resetResponse.runtimeConfig?.reset?.saved ||
  resetResponse.runtimeConfig.reset.generation !== 22 ||
  resetResponse.runtimeConfig.reset.status?.pendingGeneration !== 22
) {
  throw new Error(`reset response ${JSON.stringify(resetResponse)}`);
}

const editorCaps = {
  ...draftCapabilities,
  supportedObjectTypes: [1, 2, 3, 4],
  supportedFeatures: [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  limits: {
    maxKeymapOverrides: 16,
    maxRuntimeObjects: 8,
    maxCombos: 4,
    maxComboKeys: 3,
    maxMacroSteps: 16,
    maxTapDanceActions: 8,
  },
};
const encodeOpts = { behaviors: draftBehaviors, studioLayers: draftStudioLayers };

if (parseRuntimeObjectId("&rt 13") !== 13 || !isRuntimeObjectBinding("&rt 13")) {
  throw new Error("parse runtime binding");
}
if (actionFromBindingText("&rt 13", { allowRuntimeObject: true, snapshot }).runtimeObjectId !== 13) {
  throw new Error("runtime action from binding");
}
let nestedRejected = false;
try {
  actionFromBindingText("&rt 13", { allowRuntimeObject: false, snapshot });
} catch (error) {
  nestedRejected = error instanceof RuntimeDraftError;
}
if (!nestedRejected) throw new Error("nested runtime object must be rejected");

const holdTap = upsertRuntimeObject(
  snapshot,
  {
    id: nextRuntimeObjectId(snapshot),
    type: "holdTap",
    tapBinding: "&kp A",
    holdBinding: "&mo NAV",
    flavor: HOLD_TAP_FLAVOR.BALANCED,
    tappingTermMs: 280,
    quickTapMs: 175,
    requirePriorIdleMs: 150,
  },
  editorCaps,
  encodeOpts
);
const holdTapId = holdTap.runtimeObjects.at(-1).id;
if (holdTapId !== 15 || holdTap.runtimeObjects.length !== 5) {
  throw new Error(`hold-tap upsert ${JSON.stringify(holdTap.runtimeObjects.map((o) => o.id))}`);
}
if (bindingTextFromAction(holdTap.runtimeObjects.at(-1).tapAction, encodeOpts) !== "&kp A") {
  throw new Error("hold-tap tap decode");
}

const withKey = replaceDraftKeymapOverrides({
  snapshot: holdTap,
  capabilities: editorCaps,
  editorLayers: [{ bindings: [{ text: `&rt ${holdTapId}` }, { text: "&kp B" }, { text: "&kp C" }] }],
  deviceLayerIds: [0],
  ...encodeOpts,
});
if (withKey.keymapOverrides[0].action.runtimeObjectId !== holdTapId) {
  throw new Error(`&rt must encode as a runtime object ActionRef ${JSON.stringify(withKey.keymapOverrides[0])}`);
}
if (withKey.keymapOverrides[0].action.compiledBehavior) {
  throw new Error("compiled &rt ActionRefs are invalid");
}

const refs = runtimeObjectReferences(withKey, holdTapId, editorCaps);
if (refs.keys.length !== 1 || refs.keys[0].selectedIndex !== 0) {
  throw new Error(`object refs ${JSON.stringify(refs)}`);
}
let deleteBlocked = false;
try {
  deleteRuntimeObject(withKey, holdTapId);
} catch (error) {
  deleteBlocked = error instanceof RuntimeDraftError && /still used/.test(error.message);
}
if (!deleteBlocked) throw new Error("delete must warn while keys still reference the object");

const comboDraft = upsertRuntimeCombo(
  holdTap,
  {
    id: 40,
    selectedPositions: [0, 2],
    timeoutMs: 50,
    outputBinding: `&rt ${holdTapId}`,
    slowRelease: true,
    requirePriorIdleMs: 20,
  },
  editorCaps,
  encodeOpts
);
if (comboDraft.combos.at(-1).keyPositions.join(",") !== "2,1") {
  throw new Error(`combo stock map ${JSON.stringify(comboDraft.combos.at(-1))}`);
}
if (selectedIndexesToStock(editorCaps, [0, 2]).join(",") !== "2,1") {
  throw new Error("selected to stock");
}

let unbalanced = false;
try {
  upsertRuntimeObject(
    snapshot,
    {
      id: 50,
      type: "macro",
      steps: [{ type: "press", binding: "&kp A" }, { type: "tap", binding: "&kp B" }],
    },
    editorCaps,
    encodeOpts
  );
} catch (error) {
  unbalanced = error instanceof RuntimeDraftError && /balance/.test(error.message);
}
if (!unbalanced) throw new Error("unbalanced macro must be rejected");

let nestedMacro = false;
try {
  upsertRuntimeObject(
    holdTap,
    {
      id: 51,
      type: "macro",
      steps: [{ type: "tap", binding: `&rt ${holdTapId}` }],
    },
    editorCaps,
    encodeOpts
  );
} catch (error) {
  nestedMacro = error instanceof RuntimeDraftError && /cannot nest/.test(error.message);
}
if (!nestedMacro) throw new Error("macro child runtime objects must be rejected");

const gatedCaps = { ...editorCaps, supportedObjectTypes: [2], supportedFeatures: [5] };
if (capabilitySupportsObjectType(gatedCaps, "holdTap") || supportedRuntimeEditorTypes(gatedCaps).includes("combo")) {
  throw new Error("unsupported types must stay hidden");
}
let gated = false;
try {
  upsertRuntimeObject(snapshot, { id: 52, type: "holdTap", tapBinding: "&kp A", holdBinding: "&kp B", flavor: 2, tappingTermMs: 200 }, gatedCaps, encodeOpts);
} catch (error) {
  gated = error instanceof RuntimeDraftError && /not advertised/.test(error.message);
}
if (!gated) throw new Error("capability gating must reject unadvertised engines");

const limited = { ...editorCaps, limits: { ...editorCaps.limits, maxRuntimeObjects: snapshot.runtimeObjects.length } };
let overLimit = false;
try {
  upsertRuntimeObject(
    snapshot,
    { id: 60, type: "macro", steps: [{ type: "tap", binding: "&kp A" }] },
    limited,
    encodeOpts
  );
} catch (error) {
  overLimit = error instanceof RuntimeDraftError && /reserves/.test(error.message);
}
if (!overLimit) throw new Error("object pool overflow must be rejected locally");

const cleared = deleteRuntimeObject(
  replaceDraftKeymapOverrides({
    snapshot: deleteRuntimeCombo(comboDraft, 40),
    capabilities: editorCaps,
    editorLayers: [{ bindings: [{ text: "&kp A" }, { text: "&kp B" }, { text: "&kp C" }] }],
    deviceLayerIds: [0],
    ...encodeOpts,
  }),
  holdTapId
);
if (cleared.runtimeObjects.some((object) => object.id === holdTapId)) {
  throw new Error("deleted hold-tap is still in the draft");
}
if (runtimeResourceUsage(createRuntimeDraft(cleared)).runtimeObjects !== snapshot.runtimeObjects.length) {
  throw new Error("resource usage after delete");
}

console.log("runtime-config client codec tests passed");

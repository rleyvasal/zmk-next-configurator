import {
  HOLD_TAP_FLAVOR,
  compiledAction,
  runtimeObjectAction,
} from "../src/connection/runtime-config.js";
import { createRuntimeDraft, runtimeIssuesFromDiagnostics, runtimeResourceRows } from "../src/connection/runtime-draft.js";
import {
  RUNTIME_DOCUMENT_FORMAT,
  applyRuntimeDocument,
  encodeRuntimeDocument,
  isRuntimeDocument,
  parseRuntimeDocument,
  stringifyRuntimeDocument,
} from "../src/connection/runtime-document.js";

const fingerprint = new Uint8Array(Array.from({ length: 16 }, (_, index) => index + 1));
const kpA = compiledAction(7, 0x070004);
const snapshot = {
  persistenceSchemaVersion: 6,
  generation: 9,
  capabilityFingerprint: fingerprint,
  keymapOverrides: [{ layerId: 0, keyPosition: 4, action: runtimeObjectAction(12) }],
  runtimeObjects: [
    {
      id: 12,
      type: "macro",
      steps: [
        { type: "tap", action: kpA },
        { type: "wait", ms: 0 },
        { type: "pauseUntilRelease" },
      ],
    },
    {
      id: 13,
      type: "holdTap",
      tapAction: kpA,
      holdAction: compiledAction(9, 2),
      flavor: HOLD_TAP_FLAVOR.BALANCED,
      tappingTermMs: 200,
      quickTapMs: 125,
      requirePriorIdleMs: 50,
    },
    {
      id: 14,
      type: "modMorph",
      modifiers: 0x02,
      normalAction: kpA,
      morphedAction: compiledAction(7, 0x070005),
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
const capabilities = {
  protocolVersion: 1,
  persistenceSchemaVersion: 6,
  capabilityFingerprint: fingerprint,
  selectedPositionCount: 3,
  selectedToStockPositions: [2, 0, 1],
  supportedObjectTypes: [1, 2, 3, 4],
  supportedFeatures: [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  limits: {
    maxRuntimeObjects: 8,
    maxCombos: 4,
    maxComboKeys: 5,
    maxMacroSteps: 16,
    maxKeymapOverrides: 16,
    maxTapDanceActions: 8,
  },
};
const behaviors = [
  { id: 7, displayName: "Key Press", param1: [{ hid: true }], param2: [{ nil: true }] },
  { id: 9, displayName: "Momentary Layer", param1: [{ layer: true }], param2: [{ nil: true }] },
  { id: 3, displayName: "Transparent", param1: [{ nil: true }], param2: [{ nil: true }] },
];
const studioLayers = [{ id: 0, name: "base" }, { id: 2, name: "nav" }];

if (isRuntimeDocument({ format: "nope" })) throw new Error("random json must not look like a runtime document");
let rejected = false;
try {
  parseRuntimeDocument({ format: "zmk-map" });
} catch {
  rejected = true;
}
if (!rejected) throw new Error("unknown json must be rejected");

const document = encodeRuntimeDocument({
  snapshot,
  capabilities,
  profile: { id: "totem", name: "Totem" },
  behaviors,
  studioLayers,
});
if (document.format !== RUNTIME_DOCUMENT_FORMAT || document.keyboard !== "totem") {
  throw new Error(`header ${JSON.stringify(document)}`);
}
const json = stringifyRuntimeDocument(document);
if (json.includes("behaviorId") || json.includes("compiledBehavior")) {
  throw new Error("portable document must use symbolic bindings, not firmware IDs");
}
if (!json.includes("&kp A") || !json.includes("&rt 12") || !json.includes("balanced")) {
  throw new Error(`symbolic bindings ${json}`);
}

const roundTrip = applyRuntimeDocument({
  document,
  snapshot,
  capabilities,
  behaviors,
  studioLayers,
});
if (roundTrip.draft.runtimeObjects.length !== 3 || roundTrip.draft.combos.length !== 1) {
  throw new Error(`round trip counts ${JSON.stringify(roundTrip.draft)}`);
}
if (roundTrip.draft.keymapOverrides[0].action.runtimeObjectId !== 12) {
  throw new Error("keymap overlay lost runtime object ref");
}
if (roundTrip.warnings.length) throw new Error(`unexpected warnings ${roundTrip.warnings}`);
createRuntimeDraft(roundTrip.draft);

const otherFp = applyRuntimeDocument({
  document: { ...document, capabilityFingerprint: "ff".repeat(16) },
  snapshot,
  capabilities,
  behaviors,
  studioLayers,
});
if (!otherFp.warnings.some((warning) => /fingerprint/.test(warning))) {
  throw new Error("fingerprint mismatch must warn");
}

const rows = runtimeResourceRows(
  { runtimeObjects: 9, combos: 1, macroSteps: 3, tapDanceActions: 0, keymapOverrides: 1 },
  capabilities
);
if (!rows[0].over || rows[0].used !== 9 || rows[1].over) throw new Error(`resource rows ${JSON.stringify(rows)}`);

const issues = runtimeIssuesFromDiagnostics(
  [
    { runtimeObjectId: 12, message: "macro too long", fieldPath: "macro.steps" },
    { comboId: 31, message: "duplicate keys" },
    { keyLocation: { layerId: 0, keyPosition: 0 }, message: "bad key" },
  ],
  capabilities
);
if (issues[0].kind !== "object" || issues[1].kind !== "combo" || issues[2].selectedIndex !== 1) {
  throw new Error(`mapped issues ${JSON.stringify(issues)}`);
}

console.log("runtime document tests passed");

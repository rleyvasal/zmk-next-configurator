import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseKeymap } from "../src/keymap/keymap.js";
import { normalizeProfile } from "../src/layouts/layout.js";
import { createRuntimeDraft, parseRuntimeObjectId } from "../src/connection/runtime-draft.js";
import { comboLinkedMacroId, formatRuntimeImportSummary, importKeymapRuntimeObjects } from "../src/connection/runtime-import.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const profile = normalizeProfile(JSON.parse(readFileSync(join(root, "layouts/totem.json"), "utf8")));
const keymap = readFileSync(join(root, "examples/totem.keymap"), "utf8");
const parsed = parseKeymap(keymap, profile.keyCount);
const fingerprint = new Uint8Array(Array.from({ length: 16 }, (_, index) => index + 1));
const snapshot = {
  persistenceSchemaVersion: 6,
  generation: 3,
  capabilityFingerprint: fingerprint,
  keymapOverrides: [],
  runtimeObjects: [],
  combos: [],
};
const capabilities = {
  selectedPositionCount: profile.keyCount,
  selectedToStockPositions: Array.from({ length: profile.keyCount }, (_, index) => index),
  supportedObjectTypes: [1, 2, 3, 4],
  supportedFeatures: [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  limits: {
    maxRuntimeObjects: 64,
    maxCombos: 32,
    maxComboKeys: 5,
    maxMacroSteps: 512,
    maxKeymapOverrides: 256,
    maxTapDanceActions: 64,
  },
};
const studioBehaviors = [
  { id: 7, displayName: "Key Press", param1: [{ hid: true }], param2: [{ nil: true }] },
  { id: 3, displayName: "Transparent", param1: [{ nil: true }], param2: [{ nil: true }] },
  { id: 9, displayName: "Momentary Layer", param1: [{ layer: true }], param2: [{ nil: true }] },
  { id: 32, displayName: "Reset", param1: [{ nil: true }], param2: [{ nil: true }] },
];
const studioLayers = parsed.layers.map((layer, index) => ({
  id: index,
  name: layer.id,
}));
const encode = { studioBehaviors, studioLayers };

const totem = importKeymapRuntimeObjects({
  snapshot,
  capabilities,
  layers: parsed.layers,
  macros: parsed.macros,
  combos: parsed.combos,
  behaviors: parsed.behaviors,
  ...encode,
});
const importedKinds = totem.imported.map((item) => `${item.kind}:${item.id}`).sort().join(",");
if (!importedKinds.includes("macro:mac_lock") || !importedKinds.includes("macro:win_lock")) {
  throw new Error(`totem imported ${importedKinds}`);
}
if (!totem.imported.some((item) => item.kind === "combo" && item.id === "combo_reset_left")) {
  throw new Error(`missing all-layer reset combo ${JSON.stringify(totem.imported)}`);
}
const skippedIds = totem.skipped.map((item) => item.id);
if (!skippedIds.includes("hml") || !skippedIds.includes("hmr")) {
  throw new Error(`homerow should stay compiled ${JSON.stringify(totem.skipped)}`);
}
const escCombo = totem.draft.combos.find((combo) => combo.keyPositions.join(",") === "0,1");
if (!escCombo || escCombo.layerMask !== 1) {
  throw new Error(`layered combo_esc should import on BASE only ${JSON.stringify(escCombo)}`);
}
if (!totem.skipped.some((item) => item.id === "combo_studio_unlock" && /ifdef/.test(item.reason))) {
  throw new Error("guarded studio combo must be skipped");
}
if (!totem.skipped.some((item) => item.id === "host_log_dump")) {
  throw new Error("custom C behavior must be skipped");
}
const macRewrite = totem.rewrites.find((item) => item.from === "&mac_lock");
if (!macRewrite || parseRuntimeObjectId(macRewrite.to) == null) {
  throw new Error(`mac_lock rewrite ${JSON.stringify(totem.rewrites)}`);
}
if (totem.rewrites.some((item) => String(item.from).startsWith("&hml"))) {
  throw new Error("hml keys must not be rewritten");
}
const again = importKeymapRuntimeObjects({
  snapshot: totem.draft,
  capabilities,
  layers: parsed.layers,
  macros: parsed.macros,
  combos: parsed.combos,
  behaviors: parsed.behaviors,
  ...encode,
});
if (again.draft.runtimeObjects.length !== totem.draft.runtimeObjects.length) {
  throw new Error("second import must reuse equivalent runtime objects");
}
if (again.draft.combos.length !== totem.draft.combos.length) {
  throw new Error("second import must reuse equivalent combos");
}
if (!again.imported.every((item) => item.reused)) {
  throw new Error(`import should be idempotent ${JSON.stringify(again.imported)}`);
}

const syntheticSrc = `
/ {
    behaviors {
        comma_dot: comma_dot {
            compatible = "zmk,behavior-mod-morph";
            #binding-cells = <0>;
            bindings = <&kp DOT>, <&kp COMMA>;
            mods = <(MOD_LSFT|MOD_RSFT)>;
        };
        td12: td12 {
            compatible = "zmk,behavior-tap-dance";
            #binding-cells = <0>;
            tapping-term-ms = <200>;
            bindings = <&kp N1>, <&kp N2>;
        };
        simple_ht: simple_ht {
            compatible = "zmk,behavior-hold-tap";
            #binding-cells = <2>;
            tapping-term-ms = <220>;
            flavor = "balanced";
            bindings = <&kp>, <&kp>;
        };
        named_ht: named_ht {
            compatible = "zmk,behavior-hold-tap";
            #binding-cells = <0>;
            tapping-term-ms = <200>;
            flavor = "tap-preferred";
            bindings = <&kp A>, <&mo NAV>;
        };
    };
    combos {
        compatible = "zmk,combos";
        combo_all {
            timeout-ms = <40>;
            key-positions = <2 3>;
            bindings = <&kp ESC>;
            slow-release;
        };
        combo_base {
            timeout-ms = <40>;
            key-positions = <0 1>;
            bindings = <&kp TAB>;
            layers = <0>;
        };
    };
    macros {
        just_q: just_q {
            compatible = "zmk,behavior-macro";
            #binding-cells = <0>;
            bindings = <&macro_tap &kp Q>;
        };
    };
    keymap {
        compatible = "zmk,keymap";
        base_layer {
            bindings = <
                &just_q &comma_dot &simple_ht LGUI A &simple_ht LGUI A
                &td12 &named_ht &kp C &kp D
            >;
        };
    };
};
`;
const synthetic = parseKeymap(syntheticSrc, 8);
const imported = importKeymapRuntimeObjects({
  snapshot,
  capabilities,
  layers: synthetic.layers,
  macros: synthetic.macros,
  combos: synthetic.combos,
  behaviors: synthetic.behaviors,
  studioBehaviors,
  studioLayers: [{ id: 0, name: "base_layer" }, { id: 2, name: "nav" }],
});
const kinds = imported.imported.map((item) => `${item.kind}:${item.id}`).sort();
if (!kinds.includes("macro:just_q") || !kinds.includes("mod-morph:comma_dot") || !kinds.includes("tap-dance:td12")) {
  throw new Error(`synthetic imported ${kinds}`);
}
if (!kinds.includes("hold-tap:simple_ht LGUI A") || !kinds.includes("hold-tap:named_ht")) {
  throw new Error(`hold-tap instances ${kinds}`);
}
if (!kinds.includes("combo:combo_all")) throw new Error("all-layer combo");
if (imported.skipped.some((item) => item.id === "combo_all")) throw new Error("combo_all should import");
if (!kinds.includes("combo:combo_base")) throw new Error("layered combo_base should import");
const baseCombo = imported.draft.combos.find((combo) => combo.keyPositions.join(",") === "0,1");
if (!baseCombo || baseCombo.layerMask !== 1) {
  throw new Error(`combo_base layer ${JSON.stringify(baseCombo)}`);
}
const allCombo = imported.draft.combos.find((combo) => combo.keyPositions.join(",") === "2,3");
if (!allCombo || allCombo.layerMask) throw new Error(`combo_all should be every layer ${JSON.stringify(allCombo)}`);
const htRewrites = imported.rewrites.filter((item) => item.from === "&simple_ht LGUI A");
if (htRewrites.length !== 2 || new Set(htRewrites.map((item) => item.to)).size !== 1) {
  throw new Error(`shared hold-tap instance ${JSON.stringify(htRewrites)}`);
}
const dance = imported.draft.runtimeObjects.find((object) => object.type === "tapDance");
if (!dance || dance.actions.length !== 2 || dance.actions[0].holdAction.compiledBehavior.behaviorId !== 3) {
  throw new Error(`tap-dance hold falls back to trans ${JSON.stringify(dance)}`);
}
const morph = imported.draft.runtimeObjects.find((object) => object.type === "modMorph");
if (!morph || morph.modifiers !== (0x02 | 0x20)) throw new Error(`mod mask ${JSON.stringify(morph)}`);
const combo = imported.draft.combos.find((item) => item.keyPositions.join(",") === "2,3");
if (!combo || !combo.slowRelease) throw new Error(`combo ${JSON.stringify(imported.draft.combos)}`);
createRuntimeDraft(imported.draft);

const gated = importKeymapRuntimeObjects({
  snapshot,
  capabilities: { ...capabilities, supportedObjectTypes: [], supportedFeatures: [] },
  layers: synthetic.layers,
  macros: synthetic.macros,
  combos: synthetic.combos,
  behaviors: synthetic.behaviors,
  ...encode,
});
if (gated.imported.length) throw new Error("gated firmware must import nothing");
if (!gated.skipped.length) throw new Error("gated firmware should report skips");

if (comboLinkedMacroId({ id: "combo_mac_lgui_lctrl_q", binding: "&kp LGUI" }, ["mac_lgui_lctrl_q"]) !== "mac_lgui_lctrl_q") {
  throw new Error("combo id should link to the matching macro when binding is a key");
}
if (comboLinkedMacroId({ id: "combo_esc", binding: "&kp ESC" }, ["mac_lgui_lctrl_q"]) != null) {
  throw new Error("unrelated combo must not link a lock macro");
}

const lock = importKeymapRuntimeObjects({
  snapshot,
  capabilities,
  macros: [
    {
      id: "mac_lgui_lctrl_q",
      steps: [
        { kind: "press", keys: "&kp LGUI" },
        { kind: "press", keys: "&kp LCTRL" },
        { kind: "tap", keys: "&kp Q" },
        { kind: "release", keys: "&kp LCTRL" },
        { kind: "release", keys: "&kp LGUI" },
      ],
    },
  ],
  combos: [
    {
      id: "combo_mac_lgui_lctrl_q",
      positions: [2, 3],
      binding: "&kp LGUI",
      layers: "all",
      timeout: 50,
    },
  ],
  ...encode,
});
const lockCombo = lock.draft.combos[0];
const lockObjectId = lockCombo?.output?.runtimeObjectId;
if (!lockObjectId || !lock.draft.runtimeObjects.some((item) => item.id === lockObjectId && item.type === "macro")) {
  throw new Error(`lock combo output must be the imported macro ${JSON.stringify(lockCombo)}`);
}
if (lockCombo.keyPositions.join(",") !== "2,3") throw new Error(`lock positions ${lockCombo.keyPositions}`);

const summary = formatRuntimeImportSummary(totem);
if (!summary.includes("mac_lock") || !summary.includes("Skipped:") || !summary.includes("until Apply")) {
  throw new Error(summary);
}

console.log("runtime keymap import tests passed");

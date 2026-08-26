import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  comboDeleteLivePlan,
  comboHighlightIndexes,
  extraRuntimeCombinationItems,
  isLiveRuntimeCombo,
  markSuppressedKeymapCombos,
  runtimeOverlayCounts,
} from "../src/connection/runtime-display.js";
import { parseKeymap } from "../src/keymap/keymap.js";
import { normalizeProfile } from "../src/layouts/layout.js";

const keymapItems = [
  { type: "combo", positions: [0, 1], source: { positions: [0, 1] } },
  { type: "macro", id: "mac_lock" },
];
const runtimeItems = [
  { type: "combo", positions: [2, 3], source: { keyPositions: [2, 3] } },
  { type: "combo", positions: [0, 1], source: { keyPositions: [0, 1] } },
  { type: "macro", id: 1 },
];
const extras = extraRuntimeCombinationItems(keymapItems, runtimeItems);
if (extras.length !== 2) throw new Error(`extras ${JSON.stringify(extras)}`);
if (!extras.some((item) => item.type === "combo" && item.positions.join(",") === "2,3")) {
  throw new Error("runtime combo on different keys must still show");
}
if (extras.some((item) => item.type === "combo" && item.positions.join(",") === "0,1")) {
  throw new Error("runtime combo that matches a compiled combo should not duplicate");
}
if (!extras.some((item) => item.type === "macro")) {
  throw new Error("runtime macros must show even when the keymap already has macros");
}

if (isLiveRuntimeCombo({ output: { suppressCompiled: true } })) {
  throw new Error("suppress-compiled combo must not count as a live combination");
}
if (!isLiveRuntimeCombo({ output: { compiledBehavior: { behaviorId: 1 } } })) {
  throw new Error("ordinary runtime combo must remain visible");
}

const overlayCounts = runtimeOverlayCounts({
  keymapOverrides: [{ layerId: 0, keyPosition: 4 }],
  runtimeObjects: [{ id: 1 }],
  combos: [
    { keyPositions: [0, 1], output: { compiledBehavior: { behaviorId: 1 } } },
    { keyPositions: [0, 4], output: { suppressCompiled: true } },
  ],
});
if (
  overlayCounts.keyOverrides !== 1 ||
  overlayCounts.comboKeys !== 3 ||
  overlayCounts.liveCombos !== 1 ||
  overlayCounts.suppressedCombos !== 1 ||
  overlayCounts.runtimeObjects !== 1
) {
  throw new Error(`overlay counts ${JSON.stringify(overlayCounts)}`);
}

const suppressExtras = extraRuntimeCombinationItems(
  [],
  [
    {
      type: "combo",
      positions: [20, 21],
      source: { keyPositions: [20, 21], output: { suppressCompiled: true } },
    },
    { type: "combo", positions: [0, 4], source: { keyPositions: [0, 4] } },
  ]
);
if (suppressExtras.some((item) => item.positions?.join(",") === "20,21")) {
  throw new Error("suppress-compiled markers must not appear as combination chips");
}
if (!suppressExtras.some((item) => item.positions?.join(",") === "0,4")) {
  throw new Error("live runtime combos must still appear as combination chips");
}

// Screenshot case: deleting compiled [+Z reset and [+X host-log dump stages
// suppress-compiled markers. Those keys must not stay combo-tinted; Q+B
// studio unlock, still present, should.
const highlighted = comboHighlightIndexes({
  combos: [
    { id: "combo_esc", positions: [0, 1], layers: [0], deleted: true },
    { id: "combo_reset_left", positions: [20, 21], layers: "all", deleted: true },
    { id: "combo_host_log_dump", positions: [20, 22], layers: "all", deleted: true },
    { id: "combo_studio_unlock", positions: [0, 4], layers: "all", deleted: false },
  ],
  runtimeCombos: [
    { keyPositions: [20, 21], layerMask: 0, output: { suppressCompiled: true } },
    { keyPositions: [20, 22], layerMask: 0, output: { suppressCompiled: true } },
  ],
  layerIndex: 0,
});
if ([...highlighted].sort((a, b) => a - b).join(",") !== "0,4") {
  throw new Error(`deleted combo keys still highlighted ${[...highlighted]}`);
}

const liveOverlay = comboHighlightIndexes({
  combos: [{ id: "combo_esc", positions: [0, 1], layers: [0], deleted: true }],
  runtimeCombos: [{ keyPositions: [2, 3], layerMask: 0, output: { compiledBehavior: { behaviorId: 1 } } }],
  layerIndex: 0,
});
if ([...liveOverlay].join(",") !== "2,3") {
  throw new Error(`live overlay combo should still tint ${[...liveOverlay]}`);
}

const identity = (positions) => positions || [];
const newComboPlan = comboDeleteLivePlan(
  { added: true, positions: [2, 3], runtimeComboId: 9 },
  {
    draft: { combos: [{ id: 9, keyPositions: [2, 3], output: { compiledBehavior: { behaviorId: 1 } } }] },
    stockToSelected: identity,
  }
);
if (newComboPlan.overlayId !== 9 || newComboPlan.suppress) {
  throw new Error(`new combo delete should drop overlay only ${JSON.stringify(newComboPlan)}`);
}

const compiledPlan = comboDeleteLivePlan(
  { added: false, positions: [0, 1] },
  { draft: { combos: [] }, stockToSelected: identity }
);
if (compiledPlan.overlayId != null || !compiledPlan.suppress) {
  throw new Error(`compiled combo delete should suppress ${JSON.stringify(compiledPlan)}`);
}

const importedCompiledPlan = comboDeleteLivePlan(
  { added: false, positions: [0, 1], runtimeComboId: 4 },
  {
    draft: { combos: [{ id: 4, keyPositions: [0, 1], output: { compiledBehavior: { behaviorId: 1 } } }] },
    stockToSelected: identity,
  }
);
if (importedCompiledPlan.overlayId !== 4 || !importedCompiledPlan.suppress) {
  throw new Error(`imported compiled combo must drop overlay and suppress ${JSON.stringify(importedCompiledPlan)}`);
}
const reorderedPlan = comboDeleteLivePlan(
  { added: true, positions: [1, 0] },
  {
    draft: { combos: [{ id: 7, keyPositions: [0, 1], output: { compiledBehavior: { behaviorId: 1 } } }] },
    stockToSelected: identity,
  }
);
if (reorderedPlan.overlayId !== 7) {
  throw new Error(`combo trigger matching must ignore order ${JSON.stringify(reorderedPlan)}`);
}

const leakedEditPlan = comboDeleteLivePlan(
  { added: false, positions: [0, 1], runtimeComboId: 5 },
  {
    draft: {
      combos: [
        { id: 4, keyPositions: [0, 1], output: { compiledBehavior: { behaviorId: 1 } } },
        { id: 5, keyPositions: [0, 1], output: { compiledBehavior: { behaviorId: 2 } } },
      ],
    },
    stockToSelected: identity,
  }
);
if (leakedEditPlan.overlayIds.sort((a, b) => a - b).join(",") !== "4,5") {
  throw new Error(`delete must clean leaked edit overlays ${JSON.stringify(leakedEditPlan)}`);
}

const alreadySuppressed = comboDeleteLivePlan(
  { added: false, positions: [20, 21] },
  {
    draft: { combos: [{ id: 8, keyPositions: [20, 21], output: { suppressCompiled: true } }] },
    stockToSelected: identity,
  }
);
if (alreadySuppressed.overlayId != null || alreadySuppressed.suppress) {
  throw new Error(`existing suppress marker must not be duplicated ${JSON.stringify(alreadySuppressed)}`);
}

const sameKeysDifferentLayers = {
  combos: [
    { id: 20, keyPositions: [0, 1], layerMask: 1, output: { suppressCompiled: true } },
    { id: 21, keyPositions: [0, 1], layerMask: 2, output: { compiledBehavior: { behaviorId: 1 } } },
  ],
};
const layerZeroPlan = comboDeleteLivePlan(
  { added: false, positions: [0, 1], layers: [0] },
  { draft: sameKeysDifferentLayers, stockToSelected: identity }
);
if (layerZeroPlan.overlayIds.length || layerZeroPlan.suppress) {
  throw new Error(`layer-zero suppression must not consume the layer-one overlay ${JSON.stringify(layerZeroPlan)}`);
}
const layerOnePlan = comboDeleteLivePlan(
  { added: false, positions: [0, 1], layers: [1] },
  { draft: sameKeysDifferentLayers, stockToSelected: identity }
);
if (layerOnePlan.overlayIds.join(",") !== "21" || !layerOnePlan.suppress) {
  throw new Error(`same-key combos must match their own layer scope ${JSON.stringify(layerOnePlan)}`);
}

const fromFile = [
  { id: "combo_esc", positions: [0, 1], added: false, deleted: false },
  { id: "combo_new", positions: [2, 3], added: true, deleted: false },
  { id: "combo_replaced", positions: [4, 5], added: false, deleted: false },
];
const marked = markSuppressedKeymapCombos(
  fromFile,
  {
    combos: [
      { id: 8, keyPositions: [0, 1], output: { suppressCompiled: true } },
      { id: 9, keyPositions: [2, 3], output: { compiledBehavior: { behaviorId: 1 } } },
      { id: 10, keyPositions: [4, 5], output: { suppressCompiled: true } },
      { id: 11, keyPositions: [4, 5], output: { compiledBehavior: { behaviorId: 1 } } },
    ],
  },
  { stockToSelected: identity }
);
if (marked !== 1 || !fromFile[0].deleted || fromFile[1].deleted || fromFile[2].deleted) {
  throw new Error(`reload must keep live deletes ${JSON.stringify(fromFile)}`);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const profile = normalizeProfile(JSON.parse(readFileSync(join(root, "layouts/totem.json"), "utf8")));
const parsed = parseKeymap(readFileSync(join(root, "examples/totem.keymap"), "utf8"), profile.keyCount);
if (parsed.macros.some((item) => item.id === "mac_lgui_lctrl_q")) {
  throw new Error("compiled keymap must not include the editor-only lock macro name");
}
if (!parsed.macros.some((item) => item.id === "mac_lock")) {
  throw new Error("compiled keymap should still include mac_lock");
}
if (parsed.combos.some((item) => item.positions.join(",") === "2,3" && /mac/.test(item.binding))) {
  throw new Error("compiled keymap must not include an F+P / Q+P lock combo");
}

console.log("runtime display tests passed");

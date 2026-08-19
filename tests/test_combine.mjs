import {
  isModifierToken,
  modifierFromBinding,
  tapTokenFromBinding,
  defaultModeForBinding,
  classifyCombination,
  isSimpleComboOutput,
  isBrokenComboBinding,
  formatBuilderDefinition,
  holdChoiceFromBinding,
  describeHoldConflict,
  macroStepsFromKeys,
  outputKeysFromSteps,
  uniqueSlug,
  combinationSummary,
  suggestedName,
  appendOutputKey,
} from "../src/core/combine.js";

if (!isModifierToken("LCTRL") || !isModifierToken("lgui") || isModifierToken("T")) {
  throw new Error("modifier tokens");
}
if (modifierFromBinding("&kp LGUI") !== "LGUI") throw new Error("mod from binding");
if (modifierFromBinding("&hml LCTRL T") !== "LCTRL") throw new Error("hml hold");
if (tapTokenFromBinding("&hml LCTRL T") !== "T") throw new Error("hml tap");
if (defaultModeForBinding("&kp LALT") !== "hold") throw new Error("mod default hold");
if (defaultModeForBinding("&kp T") !== "tap") throw new Error("letter default tap");

const outs = [];
appendOutputKey(outs, "&kp LGUI");
appendOutputKey(outs, "&kp LCTRL");
appendOutputKey(outs, "&kp Q");
if (outs.length !== 3 || outs[0].mode !== "hold" || outs[1].mode !== "hold" || outs[2].mode !== "tap") {
  throw new Error(`append ${JSON.stringify(outs)}`);
}
appendOutputKey(outs, "&kp LCTRL");
if (outs.length !== 2 || outs.some((o) => o.binding === "&kp LCTRL")) throw new Error("toggle output");
appendOutputKey(outs, "&kp LCTRL");
if (outs.map((o) => o.binding).join(",") !== "&kp LGUI,&kp Q,&kp LCTRL") throw new Error("re-add order");

const hrm = classifyCombination({
  triggers: [{ index: 13, mode: "hold", holdMod: "LCTRL", binding: "&kp T", tap: "T" }],
});
if (hrm.kind !== "hold-tap" || hrm.hold !== "LCTRL" || hrm.tap !== "T" || hrm.index !== 13) {
  throw new Error(`hrm ${JSON.stringify(hrm)}`);
}

const combo = classifyCombination({
  triggers: [
    { index: 0, mode: "tap", binding: "&kp Q" },
    { index: 1, mode: "tap", binding: "&kp W" },
  ],
  outputs: [{ binding: "&kp ESC", mode: "tap" }],
});
if (combo.kind !== "combo" || combo.needsMacro || combo.output !== "&kp ESC") {
  throw new Error(`combo ${JSON.stringify(combo)}`);
}

const comboMacro = classifyCombination({
  triggers: [
    { index: 0, mode: "tap", binding: "&kp Q" },
    { index: 1, mode: "tap", binding: "&kp W" },
  ],
  outputs: [
    { binding: "&kp LGUI", mode: "hold" },
    { binding: "&kp Q", mode: "tap" },
  ],
});
if (comboMacro.kind !== "macro" || !comboMacro.needsCombo) throw new Error(`combo+macro ${JSON.stringify(comboMacro)}`);
if (isSimpleComboOutput([
  { binding: "&kp LGUI", mode: "hold" },
  { binding: "&kp Q", mode: "tap" },
])) throw new Error("multi output is not a simple combo");
if (!isSimpleComboOutput([{ binding: "&kp ESC", mode: "tap" }])) throw new Error("single key is a simple combo output");
if (!isBrokenComboBinding("&combo f p 3") || !isBrokenComboBinding("&combo_f_p_3")) {
  throw new Error("broken combo binding");
}
if (isSimpleComboOutput([{ binding: "&combo f p 3", mode: "tap" }])) {
  throw new Error("self-referential combo is not a simple output");
}
const broken = classifyCombination({
  triggers: [
    { index: 3, mode: "tap", binding: "&kp F" },
    { index: 4, mode: "tap", binding: "&kp P" },
  ],
  outputs: [{ binding: "&combo f p 3", mode: "tap" }],
});
if (broken.kind !== "macro") throw new Error(`broken combo should become macro ${JSON.stringify(broken)}`);
const comboDef = formatBuilderDefinition(
  {
    timeout: 50,
    layers: "0",
    outputs: [{ binding: "&kp ESC", mode: "tap" }],
  },
  { kind: "combo", output: "&kp ESC" }
);
if (!comboDef.includes("Binding:  &kp ESC") || !comboDef.includes("Timeout:  50") || !comboDef.includes("Layers:   0")) {
  throw new Error(comboDef);
}
const macDef = formatBuilderDefinition({
  outputs: [
    { binding: "&kp LGUI", mode: "hold" },
    { binding: "&kp LCTRL", mode: "hold" },
    { binding: "&kp Q", mode: "tap" },
  ],
  stepsDirty: false,
}, { kind: "macro", needsCombo: true });
if (
  macDef !==
  "Press   &kp LGUI\nPress   &kp LCTRL\nTap     &kp Q\nRelease &kp LCTRL\nRelease &kp LGUI"
) {
  throw new Error(macDef);
}

const lock = classifyCombination({
  triggers: [
    { index: 3, mode: "tap", binding: "&kp F" },
    { index: 4, mode: "tap", binding: "&kp P" },
  ],
  outputs: [
    { binding: "&kp LGUI", mode: "hold" },
    { binding: "&kp LCTRL", mode: "hold" },
    { binding: "&kp Q", mode: "tap" },
  ],
});
if (lock.kind !== "macro" || !lock.needsCombo) throw new Error(`lock-screen ${JSON.stringify(lock)}`);
const lockName = suggestedName({
  outputs: [
    { binding: "&kp LGUI", mode: "hold" },
    { binding: "&kp LCTRL", mode: "hold" },
    { binding: "&kp Q", mode: "tap" },
  ],
}, lock);
if (lockName !== "mac_lgui_lctrl_q") throw new Error(`lock name ${lockName}`);

const mac = classifyCombination({
  triggers: [
    { index: 32, mode: "hold", binding: "&kp TAB" },
    { index: 0, mode: "tap", binding: "&kp Q" },
  ],
  outputs: [
    { binding: "&kp LGUI", mode: "hold" },
    { binding: "&kp LCTRL", mode: "hold" },
    { binding: "&kp Q", mode: "tap" },
  ],
});
if (mac.kind !== "macro" || !mac.needsCombo) throw new Error(`macro ${JSON.stringify(mac)}`);

const steps = macroStepsFromKeys([
  { binding: "&kp LGUI", mode: "hold" },
  { binding: "&kp LCTRL", mode: "hold" },
  { binding: "&kp Q", mode: "tap" },
]);
if (steps.map((s) => `${s.kind}:${s.keys}`).join("|") !== "press:&kp LGUI|press:&kp LCTRL|tap:&kp Q|release:&kp LCTRL|release:&kp LGUI") {
  throw new Error(`steps ${JSON.stringify(steps)}`);
}

const back = outputKeysFromSteps(steps);
if (back.advanced || back.keys.length !== 3 || back.keys[0].mode !== "hold" || back.keys[2].mode !== "tap") {
  throw new Error(`reverse ${JSON.stringify(back)}`);
}
if (!outputKeysFromSteps([...steps, { kind: "wait", keys: "100" }]).advanced) throw new Error("wait is advanced");

if (uniqueSlug("ht_t", new Set(["ht_t", "ht_t_2"])) !== "ht_t_3") throw new Error("slug");

const label = (k) => {
  const t = String(k.binding || k.holdMod || "");
  if (t.includes("LGUI")) return "⌘";
  if (t.includes("LCTRL")) return "⌃";
  if (t.includes("TAB")) return "Tab";
  if (t.includes("ESC")) return "Esc";
  if (t.includes("Q")) return "Q";
  if (t.includes("W")) return "W";
  if (t.includes("T")) return "T";
  if (t.includes("F")) return "F";
  if (t.includes("P")) return "P";
  return t;
};
const sumHrm = combinationSummary(
  { triggers: [{ index: 13, mode: "hold", holdMod: "LCTRL", binding: "&kp T", tap: "T" }] },
  label
);
if (!sumHrm.includes("home-row") || !sumHrm.includes("T")) throw new Error(sumHrm);

const sumCombo = combinationSummary(
  {
    triggers: [
      { index: 0, mode: "tap", binding: "&kp Q" },
      { index: 1, mode: "tap", binding: "&kp W" },
    ],
    outputs: [{ binding: "&kp ESC", mode: "tap" }],
  },
  label
);
if (sumCombo !== "tap Q + tap W → Esc") throw new Error(sumCombo);

const sumLock = combinationSummary(
  {
    triggers: [
      { index: 3, mode: "tap", binding: "&kp F" },
      { index: 4, mode: "tap", binding: "&kp P" },
    ],
    outputs: [
      { binding: "&kp LGUI", mode: "hold" },
      { binding: "&kp LCTRL", mode: "hold" },
      { binding: "&kp Q", mode: "tap" },
    ],
  },
  label
);
if (sumLock !== "tap F + tap P → sends ⌘⌃Q") throw new Error(sumLock);

const sumMac = combinationSummary(
  {
    triggers: [
      { index: 32, mode: "hold", binding: "&kp TAB" },
      { index: 0, mode: "tap", binding: "&kp Q" },
    ],
    outputs: [
      { binding: "&kp LGUI", mode: "hold" },
      { binding: "&kp LCTRL", mode: "hold" },
      { binding: "&kp Q", mode: "tap" },
    ],
  },
  label
);
if (sumMac !== "Hold Tab + tap Q → sends ⌘⌃Q") throw new Error(sumMac);

if (suggestedName({ triggers: [{ binding: "&kp T", tap: "T", mode: "hold", holdMod: "LCTRL" }] }) !== "ht_t") {
  throw new Error("suggested hrm name");
}

if (holdChoiceFromBinding("&mo NAV")?.kind !== "layer") throw new Error("layer choice");
if (holdChoiceFromBinding("&kp LCTRL")?.kind !== "modifier") throw new Error("mod choice");
if (holdChoiceFromBinding("&kp ESC")?.kind !== "key") throw new Error("key choice");

const layerHold = classifyCombination({
  triggers: [{ index: 32, mode: "hold", binding: "&kp TAB", tap: "TAB" }],
  holdChoice: { kind: "layer", layer: "NAV", behavior: "mo", binding: "&mo NAV" },
});
if (layerHold.kind !== "layer-hold" || layerHold.binding !== "&lt NAV TAB") throw new Error(JSON.stringify(layerHold));

const pick = classifyCombination({
  triggers: [{ index: 13, mode: "hold", binding: "&kp T", tap: "T" }],
});
if (pick.kind !== "hold-pick") throw new Error(`pick ${pick.kind}`);

const hrmSet = classifyCombination({
  triggers: [{ index: 13, mode: "hold", binding: "&kp T", tap: "T" }],
  holdChoice: { kind: "modifier", mod: "LCTRL", binding: "&kp LCTRL" },
  hrmMode: "set",
  setKeys: [
    { index: 10, hold: "LGUI", tap: "A" },
    { index: 13, hold: "LCTRL", tap: "T" },
  ],
});
if (hrmSet.kind !== "hold-tap-set" || hrmSet.setKeys.length !== 2) throw new Error(JSON.stringify(hrmSet));

const remap = classifyCombination({
  triggers: [{ index: 0, mode: "tap", binding: "&kp Q" }],
  outputs: [{ binding: "&kp ESC", mode: "tap" }],
});
if (remap.kind !== "remap" || remap.binding !== "&kp ESC") throw new Error(JSON.stringify(remap));

const conflict = describeHoldConflict("&lt NAV SPACE");
if (!conflict || conflict.kind !== "layer-hold" || !conflict.label.includes("NAV")) throw new Error(JSON.stringify(conflict));
if (!describeHoldConflict("&hml LGUI A")?.label.includes("Home-row")) throw new Error("hrm conflict");
if (describeHoldConflict("&kp Q")) throw new Error("plain key is not a hold conflict");

console.log("ok combine");

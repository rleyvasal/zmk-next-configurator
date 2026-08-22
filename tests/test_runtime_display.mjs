import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extraRuntimeCombinationItems } from "../src/connection/runtime-display.js";
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

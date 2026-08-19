import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeProfile } from "../src/layouts/layout.js";
import { parseKeymap, emptyLayerBindings, formatLayerNode } from "../src/keymap/keymap.js";
import { clickKeyAction } from "../src/core/drag.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const totem = normalizeProfile(JSON.parse(readFileSync(join(root, "layouts/totem.json"), "utf8")));
if (totem.id !== "totem" || totem.keyCount !== 38) throw new Error("totem profile");
if (totem.rows.reduce((a, b) => a + b, 0) !== 38) throw new Error("totem rows");
if (totem.keys.filter((k) => k.hand === "left").length !== 19) throw new Error("totem left hand");
if (!totem.homeRowBehaviors.includes("hml")) throw new Error("totem home-row ids");

const example = normalizeProfile(JSON.parse(readFileSync(join(root, "layouts/example-split.json"), "utf8")));
if (example.keyCount !== 6) throw new Error("example keyCount");
if (example.keys[0].hand !== "left" || example.keys[5].hand !== "right") throw new Error("example hands");

const tiny = readFileSync(join(root, "examples/example-split.keymap"), "utf8");
const parsed = parseKeymap(tiny, example.keyCount);
if (parsed.layers.length !== 1) throw new Error(`example layers ${parsed.layers.length}`);
if (parsed.layers[0].bindings.length !== 6) throw new Error("example bindings");
if (parsed.layers[0].bindings[0].text !== "&kp Q") throw new Error("example Q");

const asTotem = parseKeymap(tiny, 38);
if (asTotem.layers.length !== 0) throw new Error("6-key keymap should not parse as 38");

const node = formatLayerNode({ id: "base_layer", bindings: emptyLayerBindings(6) }, 6, example.rows);
if (!node.includes("&trans") || node.split("\n").filter((l) => l.includes("&trans")).length < 2) {
  throw new Error(`example wrap ${node}`);
}

try {
  normalizeProfile({ id: "bad", keyCount: 2, rows: [1], keys: [{ w: 1, h: 1, x: 0, y: 0 }] });
  throw new Error("bad profile should fail");
} catch (err) {
  if (err.message.includes("should fail")) throw err;
}

const click = (opts) => clickKeyAction(opts);
if (click({ wasSelected: true, multiSelected: false, moved: false, shift: false, over: 3, from: 3 }) !== "clear") {
  throw new Error("second click on selected key should deselect");
}
if (click({ wasSelected: true, multiSelected: true, moved: false, shift: false, over: 3, from: 3 }) !== "isolate") {
  throw new Error("second click among many should isolate");
}
if (click({ wasSelected: false, multiSelected: false, moved: false, shift: false, over: 3, from: 3 }) !== "select") {
  throw new Error("first click should select");
}
if (click({ wasSelected: true, multiSelected: false, moved: true, shift: false, over: 3, from: 3 }) !== "keep") {
  throw new Error("drag on same key should keep selection");
}
if (click({ wasSelected: true, multiSelected: false, moved: false, shift: true, over: 3, from: 3 }) !== "keep") {
  throw new Error("shift click is handled on pointerdown");
}

console.log("ok layout", totem.id, example.id);

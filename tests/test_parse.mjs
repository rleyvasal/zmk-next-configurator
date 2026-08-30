import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseKeymap,
  applyBindings,
  applyLayers,
  applyCombos,
  applyBehaviors,
  parseBindingsBlock,
  protectionFor,
  findLayerActivators,
  bindingLabel,
  bindingHoldHint,
  formatKeyLabel,
  mapStudioLayerIndex,
  shortLayerHint,
  studioLayerId,
  formatBehaviorNode,
  parseModFlags,
  parseMacroSteps,
  formatMacroStep,
  formatMacroNode,
  extractMacroTapTokens,
  findMacroKeySeats,
  prettyMacroToken,
  layersUsingId,
  nextLayerId,
  emptyLayerBindings,
  formatLayerNode,
  indexMapAfterDelete,
  indexMapAfterReorder,
  applyLayerIndexMap,
} from "../src/keymap/keymap.js";
import { normalizeProfile } from "../src/layouts/layout.js";
import { buildKeymapSvg } from "../src/ui/svg.js";
import { THEME, svgColors } from "../src/ui/theme.js";
import { CATEGORIES, PALETTE, EMPTY_BINDING } from "../src/ui/palette.js";
import { planDrop, cloneBinding } from "../src/core/drag.js";
import { History, BindingSetCommand } from "../src/core/history.js";
import { parseBinding, formatBinding, convertBinding, unwrapChord, wrapChord, isHomeRowBinding, isHomeRowBehavior, isLayerHoldBinding } from "../src/behaviors/inspect.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const profile = normalizeProfile(JSON.parse(readFileSync(join(root, "layouts/totem.json"), "utf8")));
const keymap = readFileSync(join(root, "examples/totem.keymap"), "utf8");
const HR = { homeRowBehaviors: profile.homeRowBehaviors };

const keys = profile.keys;
if (keys.length !== profile.keyCount) throw new Error(`layout keys ${keys.length}`);

const parsed = parseKeymap(keymap, profile.keyCount);
if (parsed.layers.length !== 5) throw new Error(`layers ${parsed.layers.length}`);
if (parsed.layers[0].id !== "base_layer") throw new Error(`name ${parsed.layers[0].id}`);
if (parsed.layers[0].start == null || !keymap.slice(parsed.layers[0].start, parsed.layers[0].end).startsWith("base_layer")) {
  throw new Error("layer span");
}

const base = parsed.layers[0].bindings.map((b) => b.text);
if (base[0] !== "&kp Q") throw new Error(`P0 ${base[0]}`);
if (base[2] !== "&kp F") throw new Error(`P2 ${base[2]}`);
if (base[3] !== "&kp P") throw new Error(`P3 ${base[3]}`);
if (base[10] !== "&hml LGUI A") throw new Error(`P10 ${base[10]}`);
if (base[35] !== "&lt ADJ ENTER") throw new Error(`P35 ${base[35]}`);
if (base[18] !== "&hmr RALT I") throw new Error(`P18 ${base[18]}`);

const adj = parsed.layers[4].bindings.map((b) => b.text);
if (adj[20] !== "&sys_reset") throw new Error(`adj P20 ${adj[20]}`);
if (adj[27] !== "&bt BT_SEL 0") throw new Error(`adj P27 ${adj[27]}`);

const nav = parsed.layers[2].bindings[8];
if (!nav.text.includes("LC(LS(DOWN))") && parsed.layers[2].bindings[28].text !== "&kp LC(LS(DOWN))") {
  const found = parsed.layers[2].bindings.find((b) => b.text.includes("LC(LS(DOWN))"));
  if (!found) throw new Error("missing LC(LS(DOWN))");
}

parsed.layers[0].bindings[0].text = "&kp A";
const out = applyBindings(keymap, parsed.layers);
if (!out.includes("&kp A") || out === keymap) throw new Error("apply did not change Q");
if (!out.includes("tapping-term-ms 200 -> 280")) throw new Error("lost comment");
if (out.split("\n").length !== keymap.split("\n").length) throw new Error("rewrote line count");

const tiny = "bindings = <&kp Q  &hml LGUI A\n// c\n&trans>;";
const inner = tiny.indexOf("<") + 1;
const toks = parseBindingsBlock(tiny, inner, tiny.lastIndexOf(">"));
if (toks.map((t) => t.text).join("|") !== "&kp Q|&hml LGUI A|&trans") {
  throw new Error(`tiny ${toks.map((t) => t.text)}`);
}

const svg = buildKeymapSvg(keys, parsed.layers, { ...parsed, homeRowBehaviors: profile.homeRowBehaviors });
const paints = svgColors();
if (!svg.includes(`fill="${paints.key}"`)) throw new Error("svg missing key fill");
if (!svg.includes(`fill="${paints.ink}"`)) throw new Error("svg missing label fill");
if (!svg.includes(`fill="${paints.bg}"`)) throw new Error("svg missing navy background");
if (!svg.includes(THEME.holdTap)) throw new Error("svg missing hold-tap stroke");
if (!svg.includes(THEME.layerHold)) throw new Error("svg missing layer-hold stroke");
if (!svg.includes(THEME.macro)) throw new Error("svg missing macro stroke");
if (!svg.includes(THEME.combo)) throw new Error("svg missing combo stroke");
if (!svg.includes(THEME.other)) throw new Error("svg missing other-behavior stroke");
if ((svg.match(/data-layer="/g) || []).length !== 5) throw new Error("svg missing layers");
for (const name of ["base", "code", "nav", "mod", "adj"]) {
  if (!svg.includes(`data-layer="${name}"`)) throw new Error(`svg missing ${name}`);
}
if ((svg.match(/<rect /g) || []).length < 5 * 38) throw new Error("svg missing keys");
if (svg.includes('class="key-hit"')) throw new Error("svg still uses editor classes");

if (parsed.combos.length < 5) throw new Error(`combos ${parsed.combos.length}`);
const esc = parsed.combos.find((c) => c.id === "combo_esc");
if (!esc || esc.positions.join(",") !== "0,1" || esc.binding !== "&kp ESC") throw new Error(JSON.stringify(esc));
if (esc.layers[0] !== 0) throw new Error("esc layers");
const reset = parsed.combos.find((c) => c.id === "combo_reset_left");
if (reset.layers?.join(",") !== "0") throw new Error(`reset should be BASE only ${JSON.stringify(reset)}`);
const logCombo = parsed.combos.find((c) => c.id === "combo_host_log_dump");
if (logCombo.layers?.join(",") !== "0") throw new Error(`log should be BASE only ${JSON.stringify(logCombo)}`);
const stu = parsed.combos.find((c) => c.id === "combo_studio_unlock");
if (!stu?.guarded) throw new Error("studio unlock should be ifdef-guarded");
if (stu.layers?.join(",") !== "0") throw new Error(`studio unlock should be BASE only ${JSON.stringify(stu)}`);

if (protectionFor(0, 0, parsed.combos) == null) throw new Error("Q+W should warn on base");
if (protectionFor(1, 2, parsed.combos) != null) throw new Error("W should not be a nav combo");
if (protectionFor(0, 2, parsed.combos) != null) throw new Error("studio unlock must not protect P0 on NAV");
if (protectionFor(20, 0, parsed.combos) == null) throw new Error("[+Z should warn on BASE");
if (protectionFor(20, 2, parsed.combos) != null) throw new Error("[+Z must not warn on NAV");

if (shortLayerHint("LAYER_5") !== "L5") throw new Error(`short ${shortLayerHint("LAYER_5")}`);
if (bindingHoldHint("&lt LAYER_5 A") !== "L5") throw new Error(`lt hint ${bindingHoldHint("&lt LAYER_5 A")}`);
const studioLayers = [{ name: "base" }, { name: "code" }, { name: "nav" }, { name: "mod" }, { name: "adj" }];
const editorLayers = parsed.layers.concat([{ id: "layer_5" }]);
if (mapStudioLayerIndex(editorLayers, studioLayers, 0) !== 0) throw new Error("map base");
if (mapStudioLayerIndex(editorLayers, studioLayers, 4) !== 4) throw new Error("map adj by position when names match or index exists");
if (mapStudioLayerIndex(editorLayers, [{ name: "" }, { name: "" }, { name: "" }, { name: "" }, { name: "" }], 2) !== 2) {
  throw new Error("map by position when studio names are empty");
}
if (mapStudioLayerIndex(editorLayers, studioLayers, 5) != null) throw new Error("new layer must not map onto the board");
if (studioLayerId({ name: "base" }, 0) !== "base_layer") throw new Error(studioLayerId({ name: "base" }, 0));
if (studioLayerId({ name: "NAV" }, 2, "nav_layer") !== "nav_layer") throw new Error("studio nav");
if (studioLayerId({ name: "" }, 3, "mod_layer") !== "mod_layer") throw new Error("keep previous id");

if (bindingLabel("&mmv MOVE_UP") !== "↑") throw new Error("mouse label");
if (bindingLabel("&kp LC(LS(DOWN))") !== "⌃⇧↓") throw new Error(`chord ${bindingLabel("&kp LC(LS(DOWN))")}`);
if (formatKeyLabel("&kp A").font !== 28) throw new Error("short font");
if (formatKeyLabel("&kp LC(LS(DOWN))").lines.join("").length > 6) throw new Error("chord should stay short");
if (bindingLabel("&bt BT_CLR_ALL") !== "BT_CLR_ALL") throw new Error("bt name");
if (formatKeyLabel("&bt BT_CLR_ALL").lines.join("_") !== "BT_CLR_ALL") {
  throw new Error(`bt lines ${formatKeyLabel("&bt BT_CLR_ALL").lines}`);
}

esc.deleted = true;
const gone = applyCombos(keymap, parsed.combos, parsed.comboInsertAt);
if (gone.includes("combo_esc")) throw new Error("delete combo failed");
if (!gone.includes("combo_reset_left")) throw new Error("delete removed neighbor");
parsed.combos.push({
  id: "combo_test_add",
  positions: [2, 3],
  binding: "&kp TAB",
  layers: [0],
  timeout: 50,
  added: true,
  deleted: false,
});
const added = applyCombos(keymap, parsed.combos.filter((c) => c.id === "combo_test_add" || !c.deleted), parsed.comboInsertAt);
if (!added.includes("combo_test_add") || !added.includes("key-positions = <2 3>")) throw new Error("add combo failed");

if (parsed.behaviors.length < 3) throw new Error(`behaviors ${parsed.behaviors.length}`);
const hml = parsed.behaviors.find((b) => b.id === "hml");
if (!hml || hml.kind !== "hold-tap" || hml.tappingTerm !== 280) throw new Error(JSON.stringify(hml));
if (!hml.triggerPositions.includes(5) || !hml.holdOnRelease) throw new Error("hml triggers");
const dump = parsed.behaviors.find((b) => b.id === "host_log_dump");
if (!dump || dump.kind !== "other") throw new Error("host_log_dump");
hml.tappingTerm = 300;
hml.edited = true;
const behOut = applyBehaviors(keymap, parsed.behaviors, parsed.behaviorInsertAt);
if (!behOut.includes("tapping-term-ms = <300>")) throw new Error("edit behavior failed");
if (!behOut.includes("hmr: homerow_mods_right")) throw new Error("edit removed neighbor");

const morphSrc = formatBehaviorNode({
  id: "comma_dot",
  name: "comma_dot",
  kind: "mod-morph",
  bindingList: ["&kp DOT", "&kp COMMA"],
  mods: ["LSFT", "RSFT"],
  keepMods: [],
}, "insert");
if (!morphSrc.includes("zmk,behavior-mod-morph") || !morphSrc.includes("MOD_LSFT|MOD_RSFT")) {
  throw new Error(`morph ${morphSrc}`);
}
if (parseModFlags("mods = <(MOD_LSFT|MOD_RSFT)>;", "mods").join(",") !== "LSFT,RSFT") {
  throw new Error("parse mods");
}
const danceSrc = formatBehaviorNode({
  id: "td12",
  name: "td12",
  kind: "tap-dance",
  tappingTerm: 200,
  bindingList: ["&kp N1", "&kp N2"],
}, "insert");
if (!danceSrc.includes("zmk,behavior-tap-dance") || !danceSrc.includes("&kp N1")) throw new Error(danceSrc);

if (parsed.macros.length < 2) throw new Error(`macros ${parsed.macros.length}`);
const mac = parsed.macros.find((m) => m.id === "mac_lock");
if (!mac || mac.steps.map((s) => s.kind).join(",") !== "press,pause,tap,release") {
  throw new Error(JSON.stringify(mac?.steps));
}
if (mac.steps[2].keys !== "&kp Q") throw new Error("mac tap Q");
if (extractMacroTapTokens(mac.steps).join(",") !== "Q") throw new Error("mac tap tokens");
if (prettyMacroToken("Q") !== "Q") throw new Error("pretty Q");
const win = parsed.macros.find((m) => m.id === "win_lock");
if (win.steps.length !== 3) throw new Error("win steps");
if (formatMacroStep({ kind: "pause" }) !== "&macro_pause_for_release") throw new Error("pause fmt");
const macOut = formatMacroNode({ ...mac, edited: true }, "replace");
if (!macOut.includes("&macro_press &kp LGUI &kp LCTRL") || !macOut.includes("&macro_tap &kp Q")) {
  throw new Error(macOut);
}

const fresh = parseKeymap(keymap, 38);
const macSeats = findMacroKeySeats(mac.steps, fresh.layers);
if (macSeats.length !== 1 || macSeats[0].index !== 0 || macSeats[0].token !== "Q") {
  throw new Error(`mac seats ${JSON.stringify(macSeats)}`);
}
if (macSeats.some((s) => s.token === "LGUI" || s.token === "LCTRL")) throw new Error("mods should not seat");
const winSeats = findMacroKeySeats(win.steps, fresh.layers);
if (winSeats.length !== 1 || winSeats[0].index !== 6 || winSeats[0].token !== "L") {
  throw new Error(`win seats ${JSON.stringify(winSeats)}`);
}
if (layersUsingId(fresh.layers, "mac_lock").join(",") !== "3") throw new Error("mac_lock layer");
if (layersUsingId(fresh.layers, "win_lock").join(",") !== "3") throw new Error("win_lock layer");
if (layersUsingId(fresh.layers, "hml").join(",") !== "0,1") throw new Error("hml layers");
if (layersUsingId(fresh.layers, "host_log_dump").join(",") !== "4") throw new Error("host_log layer");
if (fresh.behaviors.some((b) => b.id === "td_bs_pipe")) throw new Error("td_bs_pipe should be gone");
const enye = fresh.combos.find((c) => c.id === "combo_enye");
enye.binding = "&kp N";
enye.edited = true;
const edited = applyCombos(keymap, fresh.combos, fresh.comboInsertAt);
if (!edited.includes("bindings = <&kp N>") || !edited.includes("combo_enye")) throw new Error("edit combo failed");

const navHolds = findLayerActivators(parsed.layers, 2);
if (!navHolds.some((a) => a.index === 36 && a.text === "&lt NAV SPACE")) {
  throw new Error(`nav activator ${JSON.stringify(navHolds)}`);
}
const codeHolds = findLayerActivators(parsed.layers, 1);
if (!codeHolds.some((a) => a.index === 33 && a.text === "&lt CODE BSPC")) {
  throw new Error(`code activator ${JSON.stringify(codeHolds)}`);
}
const baseHolds = findLayerActivators(parsed.layers, 0);
if (baseHolds.length !== 0) throw new Error(`base should have no hold-in ${JSON.stringify(baseHolds)}`);

if (!CATEGORIES.some((c) => c.id === "numbers")) throw new Error("missing numbers category");
if (!PALETTE.some((p) => p.binding === "&kp N1")) throw new Error("missing number palette");
if (!PALETTE.some((p) => p.binding === "&kp HASH")) throw new Error("missing symbol palette");
if (!svg.includes(THEME.layerHold)) throw new Error("svg missing layer-hold stroke");

if (unwrapChord("LC(LS(DOWN))").key !== "DOWN") throw new Error("unwrap chord");
if (wrapChord("DOWN", ["LC", "LS"]) !== "LC(LS(DOWN))") throw new Error("wrap chord");
if (formatBinding(parseBinding("&kp LC(LS(DOWN))")) !== "&kp LC(LS(DOWN))") throw new Error("chord rt");
if (formatBinding(parseBinding("&lt NAV SPACE")) !== "&lt NAV SPACE") throw new Error("lt rt");
if (formatBinding(parseBinding("&hml LGUI A")) !== "&hml LGUI A") throw new Error("hml rt");
if (formatBinding(parseBinding("&bt BT_SEL 0")) !== "&bt BT_SEL 0") throw new Error("bt rt");
if (convertBinding(parseBinding("&kp Q"), "lt") !== "&lt NAV Q") throw new Error("convert lt");
if (convertBinding(parseBinding("&lt MOD TAB"), "kp") !== "&kp TAB") throw new Error("convert kp");
const stock = parseKeymap(keymap, 38);
for (const layer of stock.layers) {
  for (const b of layer.bindings) {
    const again = formatBinding(parseBinding(b.text));
    if (again !== b.text) throw new Error(`inspect rt ${layer.id} ${b.text} → ${again}`);
  }
}

if (EMPTY_BINDING !== "&none") throw new Error("empty default");
if (cloneBinding("&hml LGUI A") !== "&hml LGUI A") throw new Error("clone");
const moved = planDrop({ from: 0, to: 3, binding: "&kp Q", targetBinding: "&kp W", empty: "&none" });
if (moved.kind !== "move" || moved.sets[0].text !== "&kp Q" || moved.sets[1].text !== "&none") {
  throw new Error(`move ${JSON.stringify(moved)}`);
}
const swapped = planDrop({
  from: 0,
  to: 3,
  binding: "&kp Q",
  targetBinding: "&hml LGUI A",
  modifiers: { alt: true },
});
if (swapped.kind !== "swap" || swapped.sets[1].text !== "&hml LGUI A") throw new Error("swap");
const copied = planDrop({
  from: 0,
  to: 3,
  binding: "&kp Q",
  targetBinding: "&kp W",
  modifiers: { meta: true },
});
if (copied.kind !== "copy" || copied.sets.length !== 1 || copied.sets[0].index !== 3) throw new Error("copy");
const assigned = planDrop({ from: null, to: 2, binding: "&kp Z" });
if (assigned.kind !== "assign" || assigned.sets[0].text !== "&kp Z") throw new Error("assign");
const same = planDrop({ from: 4, to: 4, binding: "&kp A" });
if (same != null) throw new Error("same key");

if (nextLayerId(parsed.layers) !== "layer_5") throw new Error("next layer id");
if (emptyLayerBindings(38).length !== 38 || emptyLayerBindings(38)[0].text !== "&trans") {
  throw new Error("empty layer");
}
const delMap = indexMapAfterDelete(5, 2);
if (delMap[3] !== 2 || delMap[2] != null) throw new Error("del map");
const mvMap = indexMapAfterReorder(1, 3, 5);
if (mvMap[1] !== 3 || mvMap[3] !== 2) throw new Error("reorder map");
const layerClone = parseKeymap(keymap, 38);
layerClone.layers.push({
  id: "layer_5",
  added: true,
  bindings: emptyLayerBindings(38),
});
const layered = applyLayers(keymap, layerClone.layers);
if (!layered.includes("layer_5") || !layered.includes("#define LAYER_5 5")) throw new Error("apply add layer");
if (!layered.includes("#define BASE 0") || !layered.includes("hmr: homerow_mods_right")) {
  throw new Error("apply layers clobbered source");
}
if (!formatLayerNode({ id: "layer_5", bindings: emptyLayerBindings(38) }).includes("&trans")) {
  throw new Error("format layer");
}
const comboNav = { layers: [2, 4], added: false, edited: false };
applyLayerIndexMap([], [comboNav], indexMapAfterDelete(5, 2));
if (comboNav.layers.join(",") !== "3" || !comboNav.edited) throw new Error("combo remap");

const store = { Q: "&kp Q", W: "&kp W" };
const hist = new History(2);
const move = new BindingSetCommand({
  layer: 0,
  description: "Move Key",
  changes: [
    { index: 0, before: store.Q, after: "&none" },
    { index: 1, before: store.W, after: store.Q },
  ],
  apply(layer, changes, field) {
    store.Q = field === "after" ? changes[0].after : changes[0].before;
    store.W = field === "after" ? changes[1].after : changes[1].before;
  },
});
hist.execute(move);
if (store.Q !== "&none" || store.W !== "&kp Q") throw new Error("hist execute");
hist.undo();
if (store.Q !== "&kp Q" || store.W !== "&kp W") throw new Error("hist undo");
hist.redo();
if (store.W !== "&kp Q") throw new Error("hist redo");
hist.execute(new BindingSetCommand({
  layer: 0,
  description: "Assign",
  changes: [{ index: 0, before: "&none", after: "&kp A" }],
  apply() {},
}));
if (hist.canRedo) throw new Error("redo should clear");
if (hist.undoStack.length > 2) throw new Error("hist max");
if (hist.peekUndo()?.description !== "Assign") throw new Error("peek undo");
if (hist.peekRedo()) throw new Error("peek redo empty");

if (!THEME.selected || !THEME.holdTap || !THEME.layerHold || !THEME.combo || !THEME.macro || !THEME.other) {
  throw new Error("theme missing role colors");
}
if (THEME.layerHold === THEME.holdTap) throw new Error("layer hold must not share hold-tap color");
if (svgColors().holdStroke !== THEME.holdTap) throw new Error("svg theme unlink");
if (svgColors().layerStroke !== THEME.layerHold) throw new Error("svg layer-hold unlink");
if (!isHomeRowBinding(parseBinding("&hml LGUI A"), HR)) throw new Error("hml should be home-row");
if (!isHomeRowBinding(parseBinding("&hmr RALT I"), HR)) throw new Error("hmr should be home-row");
if (isHomeRowBinding(parseBinding("&lt NAV SPACE"), HR)) throw new Error("lt is not home-row");
if (!isHomeRowBehavior(hml, HR)) throw new Error("hml behavior should be home-row");
if (!isLayerHoldBinding(parseBinding("&lt NAV SPACE"))) throw new Error("lt should be layer hold");
if (!isLayerHoldBinding(parseBinding("&mo MOD"))) throw new Error("mo should be layer hold");
if (!isLayerHoldBinding(parseBinding("&sl NAV"))) throw new Error("sl should be layer hold");
if (isLayerHoldBinding(parseBinding("&hml LGUI A"))) throw new Error("hml is not layer hold");
if (formatBinding(parseBinding("&sl NAV")) !== "&sl NAV") throw new Error("sl rt");

console.log("ok", parsed.layers.map((l) => l.id).join(", "));

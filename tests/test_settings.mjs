import {
  detectOs,
  defaultSettings,
  normalizeSettings,
  loadSettings,
  saveSettings,
  holdModChoices,
  inspectModChoices,
  modifiersForOs,
  SETTINGS_KEY,
  LEGACY_EMPTY_KEY,
} from "../src/core/settings.js";
import { bindingLabel, bindingHoldHint, setLabelOs } from "../src/keymap/keymap.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeProfile } from "../src/layouts/layout.js";
import { parseKeymap } from "../src/keymap/keymap.js";
import { buildKeymapSvg } from "../src/ui/svg.js";
import { THEME } from "../src/ui/theme.js";

if (detectOs("MacIntel") !== "mac") throw new Error("detect mac");
if (detectOs("Win32") !== "windows") throw new Error("detect windows");
if (detectOs("Linux x86_64") !== "linux") throw new Error("detect linux");

const macMods = holdModChoices("mac").map(([id]) => id);
if (macMods.slice(0, 4).join(",") !== "LGUI,LALT,LCTRL,LSHFT") throw new Error(`mac order ${macMods}`);
const winMods = holdModChoices("windows").map(([id]) => id);
if (winMods.slice(0, 4).join(",") !== "LCTRL,LALT,LSHFT,LGUI") throw new Error(`win order ${winMods}`);
if (holdModChoices("linux")[3][1] !== "Win") throw new Error("linux win label");

const macInspect = inspectModChoices("mac").map(([id]) => id);
if (macInspect.slice(0, 4).join(",") !== "LG,LA,LC,LS") throw new Error(`mac inspect ${macInspect}`);
const winInspect = inspectModChoices("windows").map(([id]) => id);
if (winInspect.slice(0, 4).join(",") !== "LC,LA,LS,LG") throw new Error(`win inspect ${winInspect}`);

if (modifiersForOs("mac")[0].binding !== "&kp LGUI") throw new Error("mac palette starts with cmd");
if (modifiersForOs("windows")[0].binding !== "&kp LCTRL") throw new Error("win palette starts with ctrl");

setLabelOs("mac");
if (bindingLabel("&kp LGUI") !== "⌘") throw new Error(`mac gui ${bindingLabel("&kp LGUI")}`);
if (bindingLabel("&kp LC(LS(DOWN))") !== "⌃⇧↓") throw new Error(`mac chord ${bindingLabel("&kp LC(LS(DOWN))")}`);
if (bindingHoldHint("&hml LGUI A") !== "⌘") throw new Error("mac hold hint");

setLabelOs("windows");
if (bindingLabel("&kp LGUI") !== "Win") throw new Error(`win gui ${bindingLabel("&kp LGUI")}`);
if (bindingLabel("&kp LCTRL") !== "Ctrl") throw new Error("win ctrl");
if (!bindingLabel("&kp LC(LS(DOWN))").includes("Ctrl")) throw new Error(`win chord ${bindingLabel("&kp LC(LS(DOWN))")}`);
if (bindingHoldHint("&hml LCTRL A") !== "Ctrl") throw new Error("win hold hint");
setLabelOs("mac");

const store = new Map();
const memory = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const first = loadSettings(memory, "MacIntel");
if (first.os !== "mac" || first.emptyBinding !== "&none" || first.confirmApply !== true) {
  throw new Error(`defaults ${JSON.stringify(first)}`);
}

store.set(LEGACY_EMPTY_KEY, "&trans");
const migrated = loadSettings(memory, "Win32");
if (migrated.emptyBinding !== "&trans" || migrated.os !== "windows") throw new Error(`legacy ${JSON.stringify(migrated)}`);

const saved = saveSettings({ ...migrated, showPositions: false, tappingTerm: 12, comboTimeout: 999 }, memory);
if (saved.tappingTerm !== 50) throw new Error(`clamp tap ${saved.tappingTerm}`);
if (saved.comboTimeout !== 500) throw new Error(`clamp combo ${saved.comboTimeout}`);
if (saved.showPositions !== false) throw new Error("positions persist");
if (!store.has(SETTINGS_KEY) || store.has(LEGACY_EMPTY_KEY)) throw new Error("storage key");

const again = loadSettings(memory);
if (again.showPositions !== false || again.emptyBinding !== "&trans") throw new Error(`reload ${JSON.stringify(again)}`);

const clamped = normalizeSettings({ os: "amiga", emptyBinding: "&kp A", tappingTerm: "x", showColors: false });
if (clamped.os !== "mac" || clamped.emptyBinding !== "&none" || clamped.showColors !== false) {
  throw new Error(`normalize ${JSON.stringify(clamped)}`);
}

const defs = defaultSettings("Linux");
if (defs.os !== "linux" || defs.tappingTerm !== 280 || defs.comboTimeout !== 50) throw new Error("linux defaults");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const profile = normalizeProfile(JSON.parse(readFileSync(join(root, "layouts/totem.json"), "utf8")));
const parsed = parseKeymap(readFileSync(join(root, "examples/totem.keymap"), "utf8"), profile.keyCount);
const extras = { ...parsed, homeRowBehaviors: profile.homeRowBehaviors };
const colored = buildKeymapSvg(profile.keys, parsed.layers, extras);
if (!colored.includes(THEME.holdTap) || !colored.includes(">" + "0" + "<")) throw new Error("svg defaults");
const plain = buildKeymapSvg(profile.keys, parsed.layers, { ...extras, showColors: false, showPositions: false });
if (plain.includes(THEME.holdTap) || plain.includes(THEME.layerHold)) throw new Error("svg colors should be off");
if (plain.includes(`>${0}<`) && (plain.match(/font-family="ui-monospace/g) || []).length) {
  throw new Error("svg positions should be off");
}
if ((plain.match(/ui-monospace/g) || []).length) throw new Error("svg still has index labels");

console.log("ok settings");

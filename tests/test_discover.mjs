import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { discoverRepoFiles, pickDiscovery, keymapScore, matchBuiltinLayout } from "../src/layouts/discover.js";
import {
  inferRowCounts,
  inferHands,
  profileFromPhysicalKeys,
  parsePhysicalLayout,
  parseMatrixTransform,
  parseDtsiLayout,
  profileFromDtsi,
} from "../src/layouts/layout.js";
import { parseGithubInput } from "../src/connection/github.js";

const builtins = [
  { id: "totem", name: "Totem" },
  { id: "example-split", name: "Example split (6)" },
];

const totemTree = [
  "config/totem.keymap",
  "config/west.yml",
  "README.md",
  "boards/shields/totem/totem.dtsi",
  "boards/shields/totem/totem-layouts.dtsi",
  "node_modules/foo/layout.json",
  "modules/zmk/app/boards/foo.dtsi",
  "examples/demo.keymap",
];

const found = discoverRepoFiles(totemTree);
if (found.keymap[0].path !== "config/totem.keymap") throw new Error(`keymap ${found.keymap[0]?.path}`);
if (found.keymap.some((k) => k.path.includes("node_modules"))) throw new Error("ignored node_modules keymap");
if (found.layout.some((l) => l.path.includes("modules/"))) throw new Error("ignored modules dtsi");
if (!found.layout.some((l) => l.path.includes("totem.dtsi"))) throw new Error("missing shield dtsi");
if (found.layout.some((l) => l.path.includes("node_modules"))) throw new Error("ignored node_modules layout");

const picked = pickDiscovery(totemTree, { repoName: "rleyvasal/totem-zmk-config", builtins });
if (picked.keymap.path !== "config/totem.keymap") throw new Error("pick keymap");
if (picked.layout.source !== "builtin" || picked.layout.id !== "totem") throw new Error(`builtin ${JSON.stringify(picked.layout)}`);
if (!picked.auto) throw new Error("totem should auto-pick");

const jsonTree = ["config/board.keymap", "zmk-map-layout.json", "foo.dtsi"];
const jsonPick = pickDiscovery(jsonTree, { repoName: "custom/keeb", builtins: [{ id: "totem", name: "Totem" }] });
if (jsonPick.layout.path !== "zmk-map-layout.json" || jsonPick.layout.source !== "json") {
  throw new Error(`json layout ${JSON.stringify(jsonPick.layout)}`);
}

const manyDtsi = pickDiscovery(
  ["config/keeb.keymap", "boards/shields/a/a.dtsi", "boards/shields/b/b.dtsi", "boards/foo.dtsi"],
  { repoName: "mystery-board", builtins }
);
if (manyDtsi.auto) throw new Error("unknown board with several dtsi files should ask");
if (manyDtsi.layout.source !== "dtsi") throw new Error("should still default a dtsi");

const oneTransform = pickDiscovery(["config/keeb.keymap", "config/keeb-transform.dtsi"], {
  repoName: "mystery-board",
  builtins,
});
if (!oneTransform.auto || oneTransform.layout.path !== "config/keeb-transform.dtsi") {
  throw new Error(`single transform should auto ${JSON.stringify(oneTransform.layout)}`);
}

if (matchBuiltinLayout("glove80-config", [{ id: "totem", name: "Totem" }])) throw new Error("false builtin");
if (matchBuiltinLayout("autotemplate", [{ id: "totem", name: "Totem" }])) throw new Error("totem substring");
if (keymapScore("config/foo.keymap") <= keymapScore("deep/a/b/c.keymap")) throw new Error("config keymap should rank higher");

const dtsi = `
  keys = <
    <&key_physical_attrs 100 100 0 0 0 0 0>
    <&key_physical_attrs 100 100 120 0 0 0 0>
    <&key_physical_attrs 100 100 800 0 0 0 0>
    <&key_physical_attrs 100 100 920 0 0 0 0>
  >;
`;
const phys = parsePhysicalLayout(dtsi);
if (phys.length !== 4) throw new Error(`phys ${phys.length}`);
const rows = inferRowCounts(phys);
if (rows.length !== 1 || rows[0] !== 4) throw new Error(`rows ${rows}`);
const hands = inferHands(phys);
if (hands[0] !== "left" || hands[3] !== "right") throw new Error(`hands ${hands}`);
const prof = profileFromPhysicalKeys(phys, { id: "mini", name: "Mini" });
if (prof.keyCount !== 4 || !prof.split) throw new Error(JSON.stringify(prof));

const transformOnly = `
  default_transform: keymap_transform_0 {
    compatible = "zmk,matrix-transform";
    columns = <10>;
    rows = <4>;
    map = <
      RC(0,0) RC(0,1) RC(0,2) RC(0,3) RC(0,4)    RC(0,5) RC(0,6) RC(0,7) RC(0,8) RC(0,9)
      RC(1,0) RC(1,1) RC(1,2) RC(1,3) RC(1,4)    RC(1,5) RC(1,6) RC(1,7) RC(1,8) RC(1,9)
    >;
  };
`;
const cells = parseMatrixTransform(transformOnly);
if (cells.length !== 20) throw new Error(`transform ${cells.length}`);
const grid = parseDtsiLayout(transformOnly);
if (grid.source !== "transform" || grid.keys.length !== 20) throw new Error("transform layout");
if (grid.keys[0].hand !== "left" || grid.keys[19].hand !== "right") throw new Error("transform hands");

const both = `
  compatible = "zmk,matrix-transform";
  map = < RC(0,0) RC(0,1) >;
  display-name = "Mini Board";
  keys = < &key_physical_attrs 100 100 0 0 0 0 0 , &key_physical_attrs 100 100 120 0 0 0 0 >;
`;
const prefer = parseDtsiLayout(both);
if (prefer.source !== "physical" || prefer.keys.length !== 2) throw new Error("physical should win");
const fromDtsi = profileFromDtsi(both, { id: "mini-board" });
if (fromDtsi.keyCount !== 2 || fromDtsi.name !== "Mini Board") throw new Error(JSON.stringify(fromDtsi));

const gh = parseGithubInput("https://github.com/rleyvasal/totem-zmk-config");
if (gh.owner !== "rleyvasal" || gh.repo !== "totem-zmk-config") throw new Error(JSON.stringify(gh));
const blob = parseGithubInput("https://github.com/a/b/blob/main/config/foo.keymap");
if (blob.path !== "config/foo.keymap" || blob.branch !== "main") throw new Error(JSON.stringify(blob));
const local = parseGithubInput("/Users/admin/totem-zmk-config");
if (local.local !== "/Users/admin/totem-zmk-config") throw new Error(JSON.stringify(local));
if (parseGithubInput("just-one-word")) throw new Error("single token should be invalid");

function walkFiles(dir, acc = [], prefix = "") {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules" || name === "build") continue;
    const rel = prefix ? `${prefix}/${name}` : name;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkFiles(full, acc, rel);
    else acc.push(rel);
  }
  return acc;
}

const totemRoot = "/Users/admin/totem-zmk-config";
if (existsSync(join(totemRoot, "config/totem.keymap"))) {
  const real = pickDiscovery(walkFiles(totemRoot), { repoName: "totem-zmk-config", builtins });
  if (real.keymap.path !== "config/totem.keymap") throw new Error(`real keymap ${real.keymap?.path}`);
  if (real.layout.id !== "totem" || !real.auto) throw new Error(`real layout ${JSON.stringify(real.layout)}`);
}

console.log("ok discover");

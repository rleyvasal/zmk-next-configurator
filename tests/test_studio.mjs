import { encodeUint32, encodeSint32, zigzag32, unzigzag32, decodeFields, fieldU32, concatBytes } from "../src/connection/pb.js";
import { frameBytes, deframeAll } from "../src/connection/studio.js";
import { hidUsage, parseBindingText, bindingToCells, cellsToBinding, hidToken, findBehavior, isEmptyStudioCell, isPlaceholderBinding } from "../src/connection/studio-bind.js";

if (hidUsage("A") !== 0x070004) throw new Error(`A ${hidUsage("A").toString(16)}`);
if (hidUsage("Q") !== 0x070014) throw new Error(`Q ${hidUsage("Q").toString(16)}`);
if (hidUsage("N1") !== 0x07001e) throw new Error(`N1 ${hidUsage("N1").toString(16)}`);
if (hidUsage("AT") !== 0x0207001f) throw new Error(`AT ${hidUsage("AT").toString(16)}`);
if (hidUsage("LC(LS(DOWN))") !== 0x03070051) throw new Error(`chord ${hidUsage("LC(LS(DOWN))").toString(16)}`);
if (hidUsage("C_MUTE") !== 0x0c00e2) throw new Error("mute");

const parsed = parseBindingText("&hml LGUI A");
if (parsed.name !== "hml" || parsed.args.join(",") !== "LGUI,A") throw new Error(JSON.stringify(parsed));
const bt = parseBindingText("&bt BT_SEL 0");
if (bt.args.join(",") !== "BT_SEL,0") throw new Error(JSON.stringify(bt));

const behaviors = [
  { id: 7, displayName: "Key Press", param1: [{ name: "keycode", hid: true }], param2: [{ nil: true }] },
  { id: 3, displayName: "Transparent", param1: [{ nil: true }], param2: [{ nil: true }] },
  { id: 9, displayName: "Momentary Layer", param1: [{ name: "layer", layer: true }], param2: [{ nil: true }] },
  { id: 11, displayName: "Bluetooth", param1: [{ name: "BT_SEL", constant: 3 }, { name: "BT_CLR", constant: 0 }], param2: [{ name: "profile" }] },
  { id: 4, displayName: "hml", param1: [{ hid: true }], param2: [{ hid: true }] },
];
const layers = [
  { id: 0, name: "base" },
  { id: 1, name: "code" },
  { id: 2, name: "nav" },
];

const kp = bindingToCells("&kp A", behaviors, layers);
if (!kp.ok || kp.binding.behaviorId !== 7 || kp.binding.param1 !== 0x070004) throw new Error(JSON.stringify(kp));

const trans = bindingToCells("&trans", behaviors, layers);
if (!trans.ok || trans.binding.behaviorId !== 3) throw new Error(JSON.stringify(trans));

if (findBehavior(behaviors, "to")) throw new Error("to must not match momentary");
const homerowFw = [
  { id: 20, displayName: "Homerow Mods Left", param1: [{ hid: true }], param2: [{ hid: true }] },
  { id: 21, displayName: "homerow_mods_right", param1: [{ hid: true }], param2: [{ hid: true }] },
];
if (findBehavior(homerowFw, "hml")?.id !== 20) throw new Error("hml should match Homerow Mods Left");
if (findBehavior(homerowFw, "hmr")?.id !== 21) throw new Error("hmr should match homerow_mods_right");
const mo = bindingToCells("&mo NAV", behaviors, layers);
if (!mo.ok || mo.binding.param1 !== 2) throw new Error(JSON.stringify(mo));

const sel = bindingToCells("&bt BT_SEL 0", behaviors, layers);
if (!sel.ok || sel.binding.param1 !== 3 || sel.binding.param2 !== 0) throw new Error(JSON.stringify(sel));

const hml = bindingToCells("&hml LGUI A", behaviors, layers);
if (!hml.ok || hml.binding.param1 !== hidUsage("LGUI") || hml.binding.param2 !== hidUsage("A")) {
  throw new Error(JSON.stringify(hml));
}

const skip = bindingToCells("&mac_lock", behaviors, layers);
if (skip.ok) throw new Error("mac_lock should skip when missing");

if (hidToken(hidUsage("A")) !== "A") throw new Error("hidToken A");
if (hidToken(hidUsage("LC(LS(DOWN))")) !== "LC(LS(DOWN))") throw new Error("hidToken chord");
if (hidToken(0) != null) throw new Error("hidToken 0");
if (hidToken(0x14) !== "Q") throw new Error("hidToken bare Q");
if (isEmptyStudioCell({ behaviorId: 0, param1: 0, param2: 0 }) !== true) throw new Error("empty cell");
if (isEmptyStudioCell({ behaviorId: 7, param1: 0x070014, param2: 0 }) !== false) throw new Error("kp Q not empty");
if (isPlaceholderBinding("&kp 0") !== true) throw new Error("kp 0 placeholder");
if (isPlaceholderBinding("&kp N0") !== true) throw new Error("kp N0 placeholder");
if (isPlaceholderBinding("&kp Q") !== false) throw new Error("kp Q not placeholder");
const emptyKp = cellsToBinding({ behaviorId: 7, param1: 0, param2: 0 }, behaviors, layers);
if (emptyKp.ok) throw new Error("zero keypress should not replace a file key");
const hidNoMeta = [
  { id: 7, displayName: "Key Press", param1: [{ name: "Key" }], param2: [{ nil: true }] },
];
const fromRaw = cellsToBinding({ behaviorId: 7, param1: 0x070014, param2: 0 }, hidNoMeta, layers);
if (!fromRaw.ok || fromRaw.text !== "&kp Q") throw new Error(`hid without metadata ${JSON.stringify(fromRaw)}`);
const fromT = cellsToBinding({ behaviorId: 7, param1: 0x070017, param2: 0 }, hidNoMeta, layers);
if (!fromT.ok || fromT.text !== "&kp T") throw new Error(`hid T ${JSON.stringify(fromT)}`);
const mixed = [
  { id: 2, displayName: "Move Mouse", param1: [{ name: "MOVE_UP", constant: 0 }], param2: [{ nil: true }] },
  { id: 4, displayName: "Key Press", param1: [{ hid: true }], param2: [{ nil: true }] },
];
const fromWire = cellsToBinding({ behaviorId: 2, rawBehaviorId: 4, param1: 0x070013, param2: 0 }, mixed, layers);
if (!fromWire.ok || fromWire.text !== "&kp P") throw new Error(`raw id 4 should be kp P, got ${JSON.stringify(fromWire)}`);
const kpWithNil = cellsToBinding({ behaviorId: 4, rawBehaviorId: 4, param1: 0x070019, param2: 0 }, mixed, layers);
if (!kpWithNil.ok || kpWithNil.text !== "&kp V") throw new Error(`kp V 0 should be &kp V, got ${JSON.stringify(kpWithNil)}`);
if (isPlaceholderBinding("&kp V 0")) throw new Error("kp V 0 is not a placeholder");
const emptyCell = cellsToBinding({ behaviorId: 0, param1: 0, param2: 0 }, behaviors, layers);
if (emptyCell.ok) throw new Error("zero cell should be empty");
for (const token of ["&kp A", "&trans", "&mo NAV", "&bt BT_SEL 0", "&hml LGUI A", "&kp LC(LS(DOWN))"]) {
  const cells = bindingToCells(token, behaviors, layers);
  if (!cells.ok) throw new Error(`encode ${token}`);
  const back = cellsToBinding(cells.binding, behaviors, layers);
  if (!back.ok || back.text !== token) throw new Error(`roundtrip ${token} → ${back.text}`);
}

const packed = concatBytes([encodeSint32(1, 7), encodeUint32(2, 0x070014)]);
const pf = decodeFields(packed);
if (unzigzag32(fieldU32(pf, 1)) !== 7) throw new Error("bind id");
if (fieldU32(pf, 2) !== 0x070014) throw new Error(`bind p1 ${fieldU32(pf, 2)}`);

if (zigzag32(7) !== 14) throw new Error("zigzag");
if (unzigzag32(14) !== 7) throw new Error("unzigzag");

const payload = encodeUint32(1, 3);
const framed = frameBytes(payload);
if (framed[0] !== 0xab || framed[framed.length - 1] !== 0xad) throw new Error("frame ends");
const { frames } = deframeAll(framed);
if (frames.length !== 1) throw new Error("deframe count");
const fields = decodeFields(frames[0]);
if (fieldU32(fields, 1) !== 3) throw new Error("roundtrip id");

const escaped = frameBytes(new Uint8Array([0xab, 0x01]));
const dec = deframeAll(escaped);
if (dec.frames[0][0] !== 0xab || dec.frames[0][1] !== 0x01) throw new Error("escape");

const sint = encodeSint32(1, 7);
const sf = decodeFields(sint);
if (unzigzag32(fieldU32(sf, 1)) !== 7) throw new Error("sint field");

console.log("studio ok");

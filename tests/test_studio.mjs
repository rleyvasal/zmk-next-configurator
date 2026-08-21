import { encodeUint32, encodeSint32, zigzag32, unzigzag32, decodeFields, fieldU32, concatBytes, encodeSub } from "../src/connection/pb.js";
import { frameBytes, deframeAll, parseResponse } from "../src/connection/studio.js";
import { hidUsage, parseBindingText, bindingToCells, cellsToBinding, hidToken, findBehavior, isEmptyStudioCell, isPlaceholderBinding, resolveLayerId, MOUSE_MOVE, MOUSE_SCROLL, MOUSE_BTN, rememberStudioBehaviors } from "../src/connection/studio-bind.js";

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
const namedFw = [
  { id: 30, displayName: "Sticky Key", param1: [{ hid: true }], param2: [{ nil: true }] },
  { id: 31, displayName: "Sticky Layer", param1: [{ layer: true }], param2: [{ nil: true }] },
  { id: 32, displayName: "Reset", param1: [{ nil: true }], param2: [{ nil: true }] },
  { id: 33, displayName: "Bootloader", param1: [{ nil: true }], param2: [{ nil: true }] },
];
if (findBehavior(namedFw, "sk")?.id !== 30) throw new Error("sk should match Sticky Key");
if (findBehavior(namedFw, "sl")?.id !== 31) throw new Error("sl should match Sticky Layer");
if (findBehavior(namedFw, "sys_reset")?.id !== 32) throw new Error("sys_reset should match Reset");
if (findBehavior(namedFw, "bootloader")?.id !== 33) throw new Error("bootloader should match Bootloader");
const sk = bindingToCells("&sk LSHFT", namedFw, layers);
if (!sk.ok || sk.binding.behaviorId !== 30 || sk.binding.param1 !== hidUsage("LSHFT")) {
  throw new Error(`sk LSHFT ${JSON.stringify(sk)}`);
}
const skAlias = bindingToCells("&sk LSHIFT", namedFw, layers);
if (!skAlias.ok || skAlias.binding.param1 !== hidUsage("LSHFT")) throw new Error("LSHIFT alias");
const rst = bindingToCells("&sys_reset", namedFw, layers);
if (!rst.ok || rst.binding.behaviorId !== 32) throw new Error(`sys_reset ${JSON.stringify(rst)}`);
const skBack = cellsToBinding({ behaviorId: 30, rawBehaviorId: 30, param1: hidUsage("LALT"), param2: 0 }, namedFw, layers);
if (!skBack.ok || skBack.text !== "&sk LALT") throw new Error(`decode sk ${JSON.stringify(skBack)}`);
const rstBack = cellsToBinding({ behaviorId: 32, rawBehaviorId: 32, param1: 0, param2: 0 }, namedFw, layers);
if (!rstBack.ok || rstBack.text !== "&sys_reset") throw new Error(`decode reset ${JSON.stringify(rstBack)}`);
const runtimeFw = [{ id: 18, displayName: "Runtime Object", param1: [{ name: "object" }], param2: [{ nil: true }] }];
if (findBehavior(runtimeFw, "rt")?.id !== 18) throw new Error("rt should match Runtime Object");
const rtBack = cellsToBinding({ behaviorId: 18, rawBehaviorId: 18, param1: 13, param2: 0 }, runtimeFw, layers);
if (!rtBack.ok || rtBack.text !== "&rt 13") throw new Error(`decode rt ${JSON.stringify(rtBack)}`);

const mouseFw = [
  { id: 40, displayName: "mouse_move", param1: [{ name: "MOVE_UP", constant: MOUSE_MOVE.MOVE_UP }], param2: [{ nil: true }] },
  { id: 41, displayName: "", param1: [{ name: "SCRL_UP", constant: MOUSE_SCROLL.SCRL_UP }], param2: [{ nil: true }] },
  { id: 42, displayName: "Mouse Key Press", param1: [{ name: "LCLK", constant: 1 }], param2: [{ nil: true }] },
  { id: 14, displayName: "Homerow Mods Right", param1: [{ hid: true }], param2: [{ hid: true }] },
];
if (findBehavior(mouseFw, "mmv")?.id !== 40) throw new Error("mmv from mouse_move");
if (findBehavior(mouseFw, "msc")?.id !== 41) throw new Error("msc from SCRL constants");
if (findBehavior(mouseFw, "mkp")?.id !== 42) throw new Error("mkp from Mouse Key Press");
const up = bindingToCells("&mmv MOVE_UP", mouseFw, layers);
if (!up.ok || up.binding.param1 !== (MOUSE_MOVE.MOVE_UP >>> 0)) throw new Error(`MOVE_UP ${JSON.stringify(up)}`);
const scrl = bindingToCells("&msc SCRL_LEFT", mouseFw, layers);
if (!scrl.ok || scrl.binding.param1 !== (MOUSE_SCROLL.SCRL_LEFT >>> 0)) throw new Error(`SCRL_LEFT ${JSON.stringify(scrl)}`);
const lclk = bindingToCells("&mkp LCLK", mouseFw, layers);
if (!lclk.ok || lclk.binding.param1 !== 1) throw new Error(`LCLK ${JSON.stringify(lclk)}`);
const upBack = cellsToBinding({ behaviorId: 40, rawBehaviorId: 40, param1: MOUSE_MOVE.MOVE_UP, param2: 0 }, mouseFw, layers);
if (!upBack.ok || upBack.text !== "&mmv MOVE_UP") throw new Error(`decode mmv ${JSON.stringify(upBack)}`);
const steal = cellsToBinding(
  { behaviorId: 14, rawBehaviorId: 14, param1: MOUSE_MOVE.MOVE_LEFT, param2: 0 },
  mouseFw,
  layers
);
if (!steal.ok || steal.text !== "&mmv MOVE_LEFT") throw new Error(`mouse stolen by hmr ${JSON.stringify(steal)}`);

const unnamedMouse = [
  { id: 50, displayName: "", param1: [], param2: [] },
  { id: 51, displayName: "", param1: [], param2: [] },
  { id: 7, displayName: "Key Press", param1: [{ hid: true }], param2: [{ nil: true }] },
];
const learned = rememberStudioBehaviors(unnamedMouse, [
  {
    bindings: [
      { rawBehaviorId: 50, behaviorId: 50, param1: MOUSE_MOVE.MOVE_UP, param2: 0 },
      { rawBehaviorId: 51, behaviorId: 51, param1: MOUSE_SCROLL.SCRL_DOWN, param2: 0 },
    ],
  },
]);
if (learned.mmv !== 50 || learned.msc !== 51) throw new Error(`infer ${JSON.stringify(learned)}`);
const encMove = bindingToCells("&mmv MOVE_LEFT", unnamedMouse, layers);
if (encMove.ok || !/no Studio parameter metadata/.test(encMove.reason)) {
  throw new Error(`unmetadata'd mmv must be flash-only ${JSON.stringify(encMove)}`);
}
const encScrl = bindingToCells("&msc SCRL_UP", unnamedMouse, layers);
if (encScrl.ok || !/no Studio parameter metadata/.test(encScrl.reason)) {
  throw new Error(`unmetadata'd msc must be flash-only ${JSON.stringify(encScrl)}`);
}
const scrlAsG = cellsToBinding({ behaviorId: 14, rawBehaviorId: 14, param1: 10, param2: 0 }, unnamedMouse, layers);
if (!scrlAsG.ok || scrlAsG.text !== "&msc SCRL_UP") throw new Error(`SCRL_UP not G ${JSON.stringify(scrlAsG)}`);

// Both two-axis instances often share a generic Studio name and have no constants.
// A poisoned NVS (hmr + leftover SCRL_UP=10 / MOVE_UP) must not steal those ids.
const genericAxis = [
  { id: 8, displayName: "Input Two Axis", param1: [], param2: [] },
  { id: 9, displayName: "Input Two Axis", param1: [], param2: [] },
  { id: 14, displayName: "Homerow Mods Right", param1: [{ hid: true }], param2: [{ hid: true }] },
  { id: 7, displayName: "Key Press", param1: [{ hid: true }], param2: [{ nil: true }] },
  { id: 60, displayName: "", param1: [{ nil: true }], param2: [{ nil: true }] },
];
const poisoned = rememberStudioBehaviors(genericAxis, [
  {
    bindings: [
      { rawBehaviorId: 14, behaviorId: 14, param1: 10, param2: 0 },
      { rawBehaviorId: 14, behaviorId: 14, param1: MOUSE_MOVE.MOVE_UP, param2: 0 },
      { rawBehaviorId: 7, behaviorId: 7, param1: 0x07000a, param2: 0 },
    ],
  },
]);
if (poisoned.mmv !== 8 || poisoned.msc !== 9) {
  throw new Error(`generic two-axis / poisoned NVS ${JSON.stringify(poisoned)}`);
}
const encGenericMove = bindingToCells("&mmv MOVE_LEFT", genericAxis, layers);
if (encGenericMove.ok || !/no Studio parameter metadata/.test(encGenericMove.reason)) {
  throw new Error(`generic mmv must be flash-only ${JSON.stringify(encGenericMove)}`);
}
const encGenericScrl = bindingToCells("&msc SCRL_UP", genericAxis, layers);
if (encGenericScrl.ok || !/no Studio parameter metadata/.test(encGenericScrl.reason)) {
  throw new Error(`generic msc must be flash-only ${JSON.stringify(encGenericScrl)}`);
}
if (findBehavior(genericAxis, "mmv")?.id !== 8) throw new Error("find mmv generic axis");
if (findBehavior(genericAxis, "msc")?.id !== 9) throw new Error("find msc generic axis");
if (findBehavior(genericAxis, "hmr")?.id !== 14) throw new Error("hmr still hmr");
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
if (hidToken(10) != null) throw new Error("SCRL_UP=10 must not decode as HID G");
if (hidToken(0x07000a) !== "G") throw new Error("full HID G");
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
const fromWire = cellsToBinding(
  { behaviorId: 4, rawBehaviorId: zigzag32(4), param1: 0x070013, param2: 0 },
  mixed,
  layers
);
if (!fromWire.ok || fromWire.text !== "&kp P") throw new Error(`decoded id 4 should be kp P, got ${JSON.stringify(fromWire)}`);

// Exercise the actual protobuf response path, not just the binding decoder.
const readbackBinding = concatBytes([
  encodeSint32(1, 7),
  encodeUint32(2, MOUSE_SCROLL.SCRL_UP),
  encodeUint32(3, 0),
]);
const readbackResponse = parseResponse(
  encodeSub(
    1,
    concatBytes([
      encodeUint32(1, 1),
      encodeSub(
        5,
        encodeSub(
          1,
          encodeSub(1, concatBytes([encodeUint32(1, 2), encodeSub(3, readbackBinding)]))
        )
      ),
    ])
  )
);
const parsedReadback = readbackResponse.keymap.layers[0].bindings[0];
if (parsedReadback.behaviorId !== 7 || parsedReadback.rawBehaviorId !== zigzag32(7)) {
  throw new Error(`sint32 readback ${JSON.stringify(parsedReadback)}`);
}

// SetLayerBindingResponse is nested under the keymap response. A flattened
// read would miss INVALID_PARAMETERS and make the UI claim a rejected write
// succeeded.
const rejectedSetResponse = parseResponse(
  encodeSub(
    1,
    concatBytes([
      encodeUint32(1, 2),
      encodeSub(5, encodeSub(2, encodeUint32(1, 3))),
    ])
  )
);
if (rejectedSetResponse.setLayerBinding !== 3) {
  throw new Error(`nested set-layer result ${JSON.stringify(rejectedSetResponse)}`);
}

// The wire value can collide with another local behavior ID. The decoded
// logical ID must still win; otherwise a mouse binding can read back as hmr.
const colliding = [
  { id: 7, displayName: "Input Two Axis", param1: [], param2: [] },
  { id: 14, displayName: "Homerow Mods Right", param1: [{ hid: true }], param2: [{ hid: true }] },
];
const collidingCell = cellsToBinding(
  { behaviorId: 7, rawBehaviorId: zigzag32(7), param1: MOUSE_MOVE.MOVE_LEFT, param2: 0 },
  colliding,
  layers
);
if (!collidingCell.ok || collidingCell.text !== "&mmv MOVE_LEFT") {
  throw new Error(`logical behavior id must beat raw wire id ${JSON.stringify(collidingCell)}`);
}

// Persisted ZMK local IDs are not ordered by behavior meaning. Keymap values
// identify the two generic input-axis behaviors, so inferred IDs must beat the
// sorted fallback used only when the device gives us no such evidence.
const arbitraryMouseIds = [
  { id: 7, displayName: "Input Two Axis", param1: [], param2: [] },
  { id: 8, displayName: "Input Two Axis", param1: [], param2: [] },
  { id: 14, displayName: "Homerow Mods Right", param1: [{ hid: true }], param2: [{ hid: true }] },
];
const remembered = rememberStudioBehaviors(arbitraryMouseIds, [
  {
    bindings: [
      { behaviorId: 8, rawBehaviorId: zigzag32(8), param1: MOUSE_MOVE.MOVE_UP, param2: 0 },
      { behaviorId: 7, rawBehaviorId: zigzag32(7), param1: MOUSE_SCROLL.SCRL_UP, param2: 0 },
    ],
  },
]);
if (remembered.mmv !== 8 || remembered.msc !== 7) throw new Error(`inferred mouse IDs ${JSON.stringify(remembered)}`);
const arbitraryMove = bindingToCells("&mmv MOVE_LEFT", arbitraryMouseIds, layers);
const arbitraryScroll = bindingToCells("&msc SCRL_UP", arbitraryMouseIds, layers);
if (arbitraryMove.ok || arbitraryScroll.ok) throw new Error("unmetadata'd arbitrary mouse IDs must be flash-only");

// After Apply, GET returns sint32 wire = zigzag(actual). Prefer unzigzag so
// macros / &bt / consumer HID are not decoded as some other local id.
const afterApply = [
  { id: 7, displayName: "Key Press", param1: [{ hid: true }], param2: [{ nil: true }] },
  { id: 14, displayName: "Homerow Mods Left", param1: [{ hid: true }], param2: [{ hid: true }] },
  { id: 11, displayName: "Bluetooth", param1: [{ name: "BT_SEL", constant: 3 }, { name: "BT_CLR", constant: 0 }], param2: [{ name: "profile" }] },
  { id: 22, displayName: "Some Other", param1: [{ hid: true }], param2: [{ nil: true }] },
];
const mute = cellsToBinding(
  { behaviorId: 7, rawBehaviorId: zigzag32(7), param1: 0x0c00e2, param2: 0 },
  afterApply,
  layers
);
if (!mute.ok || mute.text !== "&kp C_MUTE") throw new Error(`consumer after apply ${JSON.stringify(mute)}`);
const btBack = cellsToBinding(
  { behaviorId: 11, rawBehaviorId: zigzag32(11), param1: 3, param2: 0 },
  afterApply,
  layers
);
if (!btBack.ok || btBack.text !== "&bt BT_SEL 0") throw new Error(`bt after apply ${JSON.stringify(btBack)}`);
if (resolveLayerId("CODE", [{ id: 1, name: "code_layer" }]) !== 1) throw new Error("CODE from code_layer");
if (resolveLayerId("NAV", [{ id: 2, name: "" }, { id: 2, name: "nav_layer" }]) !== 2) throw new Error("NAV");
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

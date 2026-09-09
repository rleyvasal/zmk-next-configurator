import { classifyLogLine, glossLogLine, parseBatteryLine } from "../src/connection/console-log.js";
import { frameBytes, deframeAll } from "../src/connection/studio.js";

const cases = [
  ["totem_ble bg_evict addr=AA idx=2 disc_reason=0x13 thrash_win=4", "evict"],
  ["totem_ble CLASS_A_SUSPECT profile=0 auth_fails=3 thrash_win=0", "fail"],
  ["totem_ble security_ok addr=AA idx=0 active=0 security_err=0 level=2", "ok"],
  ["totem_ble watch step=1 mode=light densify profile=0", "watch"],
  ["totem_prof 0* AA:BB:CC:DD:EE:FF", "boot"],
  ["hello", ""],
];
for (const [line, want] of cases) {
  const got = classifyLogLine(line);
  if (got !== want) throw new Error(`${line} => ${got}, want ${want}`);
}
const logPayload = Uint8Array.from([0x4c, ...new TextEncoder().encode("totem_ble hi")]);
const { frames } = deframeAll(frameBytes(logPayload));
if (frames.length !== 1 || frames[0][0] !== 0x4c) throw new Error("log frame prefix");
if (new TextDecoder().decode(frames[0].slice(1)) !== "totem_ble hi") throw new Error("log frame text");
const ctlOn = Uint8Array.from([0x43, 0x31]);
const ctl = deframeAll(frameBytes(ctlOn));
if (ctl.frames.length !== 1 || ctl.frames[0][0] !== 0x43 || ctl.frames[0][1] !== 0x31) {
  throw new Error("control frame");
}
const g = glossLogLine("totem_ble disc addr=AA idx=-19 disc_reason=0x08 active_up=0");
if (!g.includes("split") || !g.includes("supervision") || !g.includes("selected computer")) {
  throw new Error(`gloss ${g}`);
}
const lv4 = glossLogLine("totem_ble security_ok addr=AA idx=0 security_err=0 level=4");
if (!lv4.includes("Secure Connections")) throw new Error(`level4 gloss ${lv4}`);
const lv2 = glossLogLine("totem_ble security_ok addr=AA idx=-19 security_err=0 level=2");
if (!lv2.includes("Just Works") || !lv2.includes("split")) throw new Error(`level2 gloss ${lv2}`);
const hid = glossLogLine("totem_log t=10s usb=1 hid=usb adv=on hosts=1 split=1");
if (!hid.includes("USB") || !hid.includes("heartbeat")) throw new Error(`hid gloss ${hid}`);
const skip = glossLogLine("totem_ble skip_evict why=usb idx=2");
if (!skip.includes("did not kick")) throw new Error(`skip gloss ${skip}`);
if (classifyLogLine("totem_ble skip_evict why=usb idx=2") !== "evict") {
  throw new Error("skip_evict class");
}
const usbGloss = glossLogLine("totem_batt tick t=10s left=usb right=65");
if (!usbGloss.includes("USB")) throw new Error(`usb gloss ${usbGloss}`);
const battLog = parseBatteryLine("totem_batt tick t=10s left=usb right=65");
if (!battLog?.leftUsb || battLog.left != null || battLog.right !== 65) {
  throw new Error(`batt log ${JSON.stringify(battLog)}`);
}
const battLast = parseBatteryLine("left=87 usb right=65");
if (!battLast?.leftUsb || battLast.left !== 87 || battLast.right !== 65) {
  throw new Error(`batt last ${JSON.stringify(battLast)}`);
}
const battB = parseBatteryLine("left=87 right=--");
if (battB?.left !== 87 || battB.right != null) throw new Error(`batt B ${JSON.stringify(battB)}`);
const batPayload = Uint8Array.from([0x42, ...new TextEncoder().encode("left=usb right=65")]);
const batFrames = deframeAll(frameBytes(batPayload));
if (batFrames.frames.length !== 1 || batFrames.frames[0][0] !== 0x42) {
  throw new Error("battery frame prefix");
}

console.log("test_console_log ok");

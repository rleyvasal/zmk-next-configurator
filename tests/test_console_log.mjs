import { classifyLogLine } from "../src/connection/console-log.js";

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
console.log("test_console_log ok");

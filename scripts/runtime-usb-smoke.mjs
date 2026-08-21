#!/usr/bin/env node
/**
 * USB smoke test for ZMK Next Runtime Config over Studio serial.
 *
 *   node scripts/runtime-usb-smoke.mjs            # print framed GetRuntimeCapabilities hex
 *   python3 scripts/runtime-usb-smoke.py /dev/cu.usbmodem*
 *
 * Does not flash. Safe to run against a test image. Uses the same framing and
 * protobuf codec as the configurator.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { frameBytes, encodeRuntimeRequestForTest, parseResponse } from "../src/connection/studio.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const request = encodeRuntimeRequestForTest(1, 2);
const framed = frameBytes(request);
const hex = Buffer.from(framed).toString("hex");

if (process.argv.includes("--hex")) {
  process.stdout.write(hex);
  process.exit(0);
}

const port = process.argv[2];
if (!port) {
  console.log("framed GetRuntimeCapabilities:", hex);
  console.log("pass a serial port to send it: node scripts/runtime-usb-smoke.mjs /dev/cu.usbmodemXXXX");
  process.exit(0);
}

const py = spawnSync(
  process.env.PYTHON || `${process.env.HOME}/zmk-venv/bin/python`,
  [join(root, "scripts/runtime-usb-smoke.py"), port, hex],
  { encoding: "utf8" }
);
if (py.stdout) process.stdout.write(py.stdout);
if (py.stderr) process.stderr.write(py.stderr);
if (py.status !== 0) process.exit(py.status || 1);
const replyHex = py.stdout.trim().split("\n").at(-1) || "";
if (!/^[0-9a-f]+$/i.test(replyHex)) {
  console.error("no hex reply from serial");
  process.exit(1);
}
const reply = Buffer.from(replyHex, "hex");
const parsed = parseResponse(reply);
const caps = parsed.runtimeConfig?.capabilities;
if (!caps) {
  console.error("reply was not Runtime Config capabilities", JSON.stringify(parsed, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      protocolVersion: caps.protocolVersion,
      persistenceSchemaVersion: caps.persistenceSchemaVersion,
      selectedPositionCount: caps.selectedPositionCount,
      selectedToStockPositions: caps.selectedToStockPositions,
      supportedObjectTypes: caps.supportedObjectTypes,
      limits: caps.limits,
    },
    null,
    2
  )
);
if (caps.protocolVersion !== 1 || !caps.selectedToStockPositions?.length) {
  process.exit(1);
}

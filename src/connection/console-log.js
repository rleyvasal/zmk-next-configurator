/**
 * Keyboard log lines: either 'L' frames on the Studio connection (the
 * zmk-studio-log module, or Totem firmware) or a plain-text board console.
 */

const MAX_LINES = 400;

// Zephyr log backend output: "[00:00:01.234,000] <wrn> module: message".
const ZEPHYR_LOG = /^\[[\d:.,]+\] <(err|wrn|inf|dbg)> /;

/**
 * The zmk-studio-log module answers "Enable log" with
 * "zmk_studio_log v1 history=32 line_max=120" before anything else.
 */
export function parseStreamHello(line) {
  const m = /^zmk_studio_log v(\d+)\b/.exec(line || "");
  if (!m) return null;
  const num = (key) => {
    const v = new RegExp(`\\b${key}=(\\d+)`).exec(line);
    return v ? Number(v[1]) : null;
  };
  return {
    version: Number(m[1]),
    history: num("history"),
    lineMax: num("line_max"),
    retained: num("retained") === 1,
    blackBox: num("blackbox") === 1,
  };
}

/** "zmk_diag dump end saved=12 unsaved=3" closes a black box dump. */
export function parseDumpEnd(line) {
  const m = /^zmk_diag dump end saved=(\d+) unsaved=(\d+)/.exec(line || "");
  return m ? { saved: Number(m[1]), unsaved: Number(m[2]) } : null;
}

/** Totem firmware tags its own diagnostics; other keyboards never do. */
export function isTotemLogLine(line) {
  return /^totem_/.test(line || "");
}

export function classifyLogLine(line) {
  const level = ZEPHYR_LOG.exec(line);
  if (level) return level[1] === "err" ? "fail" : level[1] === "wrn" ? "evict" : "";
  if (/^zmk_studio_log /.test(line)) return "boot";
  if (/^zmk_diag /.test(line)) {
    if (/ crash |reset=\S*(watchdog|brownout|cpu_lockup)| fault reason=/.test(line)) return "fail";
    const cause = /reset_cause=0x([0-9a-fA-F]+)/.exec(line);
    if (cause && parseInt(cause[1], 16) & (0x4 | 0x10 | 0x100)) return "fail";
    if (/ ble_disconnect | ble_connect_failed | dropped=/.test(line)) return "evict";
    if (/^zmk_diag (boot|fault none|dump)| boot reset_cause=/.test(line)) return "boot";
    return "";
  }
  if (/CLASS_A|security_fail|connect_fail|bg_evict_fail|totem_fault CRASH/.test(line)) return "fail";
  if (/bg_evict|thrash_win|skip_evict/.test(line)) return "evict";
  if (/security_ok|watch done|watch arm/.test(line)) return "ok";
  if (/watch |active_down/.test(line)) return "watch";
  if (/totem_prof|totem_wdt|totem_fault|Booting Zephyr/.test(line)) return "boot";
  if (/totem_log |totem_batt |totem_ble rssi/.test(line)) return "boot";
  return "";
}

const REASON = {
  "0x05": "auth failed",
  "0x08": "supervision timeout",
  "0x13": "we kicked this host",
  "0x16": "connection terminated",
};

// Why a keyboard restarted, from the reset causes the zmk-studio-log module prints.
const RESET_CAUSE = {
  power_on: "power applied (cable, switch or battery)",
  reset_pin: "reset button or bootloader double-tap",
  software: "firmware rebooted itself (crash, bootloader or settings reset)",
  watchdog: "watchdog: the firmware hung",
  brownout: "brownout: supply voltage dropped (battery or cable)",
  cpu_lockup: "CPU lockup: a fault inside the fault handler",
  wake_from_sleep: "woke from deep sleep",
  debug: "debugger",
};

// HCI disconnect reasons as seen from the keyboard (Bluetooth Core spec, vol 1 part F).
const DISCONNECT_REASON = {
  "0x05": "pairing/authentication failed",
  "0x08": "signal lost (supervision timeout)",
  "0x13": "the other device disconnected",
  "0x16": "the keyboard disconnected",
  "0x22": "link layer timeout",
  "0x3d": "encryption failed (MIC)",
  "0x3e": "connection failed to establish",
};

// Zephyr hwinfo reset cause bits, as stored in the black box's boot events.
const RESET_BITS = [
  "reset_pin", "software", "brownout", "power_on", "watchdog", "debug", "security",
  "wake_from_sleep", "cpu_lockup", "parity", "pll", "clock", "hardware", "user", "temperature",
];

function resetCausesFromBits(value) {
  const names = RESET_BITS.filter((_, bit) => value & (1 << bit));
  return names.length ? names : ["power_on"];
}

function glossDiagLine(line) {
  const bits = [];
  const reset = /reset=(\S+)/.exec(line);
  const resetBits = /reset_cause=0x([0-9a-fA-F]+)/.exec(line);
  const causes = reset ? reset[1].split(",") : resetBits ? resetCausesFromBits(parseInt(resetBits[1], 16)) : [];
  for (const cause of causes) bits.push(RESET_CAUSE[cause] || cause);
  if (/ crash | fault reason=/.test(line)) {
    bits.push("crash: run arm-zephyr-eabi-addr2line -e zmk.elf <pc> on the matching build");
  }
  if (/^zmk_diag fault none/.test(line)) bits.push("no crash recorded before this boot");
  const reason = /\breason=(0x[0-9a-fA-F]{2})\b/.exec(line);
  if (reason && DISCONNECT_REASON[reason[1].toLowerCase()]) {
    bits.push(DISCONNECT_REASON[reason[1].toLowerCase()]);
  }
  if (/\bprofile=-1\b/.test(line)) bits.push("not a paired computer (likely the split half)");
  if (/ unsaved#/.test(line)) bits.push("not yet in flash");
  return bits.join("; ");
}

export function glossLogLine(line) {
  if (/^zmk_diag /.test(line)) return glossDiagLine(line);
  // The glosses below decode Totem's key=value diagnostics; don't guess at other firmware's lines.
  if (ZEPHYR_LOG.test(line) || /^zmk_studio_log /.test(line)) return "";
  const bits = [];
  if (/\bidx=-19\b/.test(line) || /\bsplit=--/.test(line) || /\bsplit=-?\d{2}/.test(line)) {
    bits.push("split right half");
  }
  const reason = line.match(/disc_reason=(0x[0-9a-fA-F]+)/);
  if (reason && REASON[reason[1].toLowerCase()]) bits.push(REASON[reason[1].toLowerCase()]);
  if (/\bactive_up=0\b/.test(line)) bits.push("selected computer not linked");
  if (/\bEMPTY\b/.test(line)) bits.push("unpaired slot");
  if (/no report yet/.test(line)) bits.push("right half has not sent battery yet");
  if (/\bleft=\d+\s+usb\b/.test(line)) bits.push("left last cell reading; on USB now");
  else if (/\bleft=usb\b/.test(line)) bits.push("left on USB, no last cell reading yet");
  if (/totem_ble rssi none/.test(line)) bits.push("no BLE links right now");
  if (/totem_log .*usb=1/.test(line)) bits.push("heartbeat");
  const level = line.match(/\blevel=(\d+)/);
  if (level) {
    if (level[1] === "2") bits.push("Just Works");
    else if (level[1] === "3") bits.push("authenticated encryption");
    else if (level[1] === "4") bits.push("LE Secure Connections");
  }
  if (/\brole=0\b/.test(line)) bits.push("we are central");
  if (/\brole=1\b/.test(line)) bits.push("we are peripheral");
  if (/\bselected=1\b/.test(line) || /\bhid=usb\b/.test(line)) bits.push("HID is USB");
  if (/\bselected=2\b/.test(line) || /\bhid=ble\b/.test(line)) bits.push("HID is Bluetooth");
  if (/\badv=dark\b/.test(line)) bits.push("advertising paused");
  if (/\badv=off\b/.test(line)) bits.push("not advertising");
  if (/skip_evict why=usb/.test(line)) bits.push("did not kick a host; USB typing");
  if (/\b\d+mV\b/.test(line) && /usb/.test(line)) bits.push("mV is charge voltage if USB");
  return bits.join("; ");
}

export function parseBatteryLine(line) {
  if (!line) return null;
  const leftUsbNum = line.match(/\bleft=(\d+)\s+usb\b/);
  const leftUsbBare = /\bleft=usb\b/.test(line);
  const leftNum = line.match(/\bleft=(\d+)/);
  const rightNone = /\bright=--/.test(line);
  const rightNum = line.match(/\bright=(\d+)/);
  const leftUsb = !!(leftUsbNum || leftUsbBare);
  if (!leftUsb && !leftNum && !rightNone && !rightNum) return null;
  return {
    leftUsb,
    left: leftUsbNum
      ? Number(leftUsbNum[1])
      : leftUsbBare
        ? null
        : leftNum
          ? Number(leftNum[1])
          : null,
    right: rightNone ? null : rightNum ? Number(rightNum[1]) : null,
  };
}

export class KeyboardConsole {
  constructor({ onLine, onStatus } = {}) {
    this.onLine = onLine;
    this.onStatus = onStatus;
    this.port = null;
    this.reader = null;
    this.closed = true;
  }

  async attachBeside(rpcPort) {
    if (!navigator.serial) return false;
    const ports = await navigator.serial.getPorts();
    for (const port of ports) {
      if (port === rpcPort) continue;
      try {
        await this.open(port);
        return true;
      } catch (err) {
        console.debug("keyboard console: skip granted port", port.getInfo?.(), err);
      }
    }
    return false;
  }

  async requestPort() {
    if (!navigator.serial) {
      throw new Error("Web Serial is only in Chrome / Edge.");
    }
    const port = await navigator.serial.requestPort({});
    await this.open(port);
  }

  async open(port) {
    await this.close();
    await port.open({ baudRate: 115200 });
    try {
      if (port.setSignals) {
        await port.setSignals({ dataTerminalReady: true, requestToSend: true });
      }
    } catch {
      /* some CDC stacks ignore this */
    }
    this.port = port;
    this.closed = false;
    this.onStatus?.("live");
    this.readLoop();
  }

  async readLoop() {
    const decoder = new TextDecoder();
    let buf = "";
    try {
      this.reader = this.port.readable.getReader();
      while (!this.closed) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value) continue;
        buf += decoder.decode(value, { stream: true });
        buf = buf.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
        const parts = buf.split("\n");
        buf = parts.pop() ?? "";
        for (const line of parts) {
          if (line) this.onLine?.(line);
        }
      }
    } catch (err) {
      if (!this.closed) this.onStatus?.("error", err?.message || String(err));
    }
    this.onStatus?.("idle");
  }

  async close() {
    this.closed = true;
    try {
      await this.reader?.cancel();
    } catch {
      /* ignore */
    }
    try {
      this.reader?.releaseLock();
    } catch {
      /* ignore */
    }
    this.reader = null;
    try {
      await this.port?.close();
    } catch {
      /* ignore */
    }
    this.port = null;
  }
}

export function appendLogLine(pre, line, { max = MAX_LINES } = {}) {
  if (!pre) return;
  const row = document.createElement("div");
  const kind = classifyLogLine(line);
  if (kind) row.className = kind;
  row.textContent = line;
  const gloss = glossLogLine(line);
  if (gloss) {
    const note = document.createElement("span");
    note.className = "gloss";
    note.textContent = `  — ${gloss}`;
    row.append(note);
  }
  pre.append(row);
  while (pre.childElementCount > max) pre.firstElementChild.remove();
  pre.scrollTop = pre.scrollHeight;
}

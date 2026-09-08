/**
 * Live printk tail from the keyboard's second USB CDC (board console).
 * Studio RPC stays on the other port; this one is plain text.
 */

const MAX_LINES = 400;

export function classifyLogLine(line) {
  if (/CLASS_A|security_fail|connect_fail|bg_evict_fail|totem_fault CRASH/.test(line)) return "fail";
  if (/bg_evict|thrash_win/.test(line)) return "evict";
  if (/security_ok|watch done|watch arm/.test(line)) return "ok";
  if (/watch |active_down/.test(line)) return "watch";
  if (/totem_prof|totem_wdt|totem_fault|Booting Zephyr/.test(line)) return "boot";
  return "";
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
  pre.append(row);
  while (pre.childElementCount > max) pre.firstElementChild.remove();
  pre.scrollTop = pre.scrollHeight;
}

#!/usr/bin/env python3
"""Send a framed Studio request hex over serial and print the deframed reply hex."""

import sys
import time

import serial

SOF, ESC, EOF = 0xAB, 0xAC, 0xAD


def deframe(buf: bytes) -> bytes | None:
    mode = "idle"
    out = bytearray()
    for b in buf:
        if mode == "idle":
            if b == SOF:
                mode = "data"
                out = bytearray()
            continue
        if mode == "esc":
            out.append(b)
            mode = "data"
            continue
        if b == ESC:
            mode = "esc"
            continue
        if b == SOF:
            out = bytearray()
            continue
        if b == EOF:
            return bytes(out)
        out.append(b)
    return None


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: runtime-usb-smoke.py PORT FRAMED_HEX", file=sys.stderr)
        return 2
    port, framed_hex = sys.argv[1], sys.argv[2]
    payload = bytes.fromhex(framed_hex)
    ser = serial.Serial(port, 115200, timeout=0.2)
    try:
        ser.reset_input_buffer()
        ser.write(payload)
        ser.flush()
        deadline = time.time() + 3.0
        buf = bytearray()
        while time.time() < deadline:
            chunk = ser.read(1024)
            if chunk:
                buf.extend(chunk)
                frame = deframe(bytes(buf))
                if frame:
                    print(frame.hex())
                    return 0
            else:
                time.sleep(0.05)
    finally:
        ser.close()
    print("no framed reply", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

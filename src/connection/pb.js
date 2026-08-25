/** Minimal protobuf3 encode/decode for ZMK Studio messages. */

export function encodeVarint(n) {
  n = Number(n) >>> 0;
  const out = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}

export function zigzag32(n) {
  return ((n << 1) ^ (n >> 31)) >>> 0;
}

export function unzigzag32(n) {
  return (n >>> 1) ^ -(n & 1);
}

export function encodeKey(field, wire) {
  return encodeVarint((field << 3) | wire);
}

export function concatBytes(chunks) {
  const parts = chunks.flatMap((c) => (c instanceof Uint8Array ? [c] : [new Uint8Array(c)]));
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function encodeUint32(field, value) {
  if (!value) return new Uint8Array();
  return concatBytes([encodeKey(field, 0), encodeVarint(value)]);
}

/**
 * Repeated scalar fields must retain zero: proto3 only elides zero for an
 * optional/singular scalar. Position 0 is valid for runtime combos and
 * physical-layout mappings.
 */
export function encodeRepeatedUint32(field, value) {
  return concatBytes([encodeKey(field, 0), encodeVarint(value)]);
}

/** Proto3 packed repeated uint32 (wire type 2). */
export function encodePackedRepeatedUint32(field, values) {
  const nums = (values || []).map((value) => Number(value) >>> 0);
  if (!nums.length) return new Uint8Array();
  const payload = concatBytes(nums.map((value) => encodeVarint(value)));
  return concatBytes([encodeKey(field, 2), encodeVarint(payload.length), payload]);
}

export function encodeSint32(field, value) {
  if (!value) return new Uint8Array();
  return concatBytes([encodeKey(field, 0), encodeVarint(zigzag32(value))]);
}

export function encodeInt32(field, value) {
  if (!value) return new Uint8Array();
  return concatBytes([encodeKey(field, 0), encodeVarint(value)]);
}

export function encodeBool(field, value) {
  if (!value) return new Uint8Array();
  return concatBytes([encodeKey(field, 0), [1]]);
}

export function encodeBytes(field, bytes) {
  if (!bytes?.length) return new Uint8Array();
  return concatBytes([encodeKey(field, 2), encodeVarint(bytes.length), bytes]);
}

export function encodeString(field, value) {
  if (!value) return new Uint8Array();
  return encodeBytes(field, new TextEncoder().encode(value));
}

export function encodeSub(field, bytes) {
  return encodeBytes(field, bytes);
}

export function decodeFields(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const fields = new Map();
  let i = 0;
  const readVarint = () => {
    let n = 0;
    let shift = 0;
    while (i < u8.length) {
      const b = u8[i++];
      n += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 35) break;
    }
    return n >>> 0;
  };
  while (i < u8.length) {
    const tag = readVarint();
    const field = tag >>> 3;
    const wire = tag & 7;
    let v;
    if (wire === 0) v = readVarint();
    else if (wire === 2) {
      const len = readVarint();
      v = u8.subarray(i, i + len);
      i += len;
    } else if (wire === 5) {
      v = u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16) | (u8[i + 3] * 2 ** 24);
      i += 4;
    } else if (wire === 1) {
      i += 8;
      continue;
    } else {
      break;
    }
    if (!fields.has(field)) fields.set(field, []);
    fields.get(field).push({ wire, v });
  }
  return fields;
}

export function fieldNums(fields, n) {
  const out = [];
  for (const x of fields.get(n) || []) {
    if (x.wire === 0 || x.wire === 5) out.push(Number(x.v) >>> 0);
    else if (x.wire === 2) {
      const buf = x.v;
      let i = 0;
      while (i < buf.length) {
        let num = 0;
        let shift = 0;
        while (i < buf.length) {
          const b = buf[i++];
          num += (b & 0x7f) * 2 ** shift;
          if ((b & 0x80) === 0) break;
          shift += 7;
          if (shift > 35) break;
        }
        out.push(num >>> 0);
      }
    }
  }
  return out;
}

export function fieldMsgs(fields, n) {
  return (fields.get(n) || []).filter((x) => x.wire === 2).map((x) => decodeFields(x.v));
}

export function fieldStr(fields, n) {
  const x = (fields.get(n) || []).find((e) => e.wire === 2);
  return x ? new TextDecoder().decode(x.v) : "";
}

export function fieldU32(fields, n, fallback = 0) {
  const nums = fieldNums(fields, n);
  return nums.length ? nums[0] : fallback;
}

export function fieldBytes(fields, n) {
  const value = (fields.get(n) || []).find((entry) => entry.wire === 2);
  return value ? new Uint8Array(value.v) : new Uint8Array();
}

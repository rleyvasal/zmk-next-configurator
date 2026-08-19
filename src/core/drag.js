/**
 * Drop planner for the fixed-geometry board.
 * Bindings are source tokens (`&hml LGUI A`); cloning the string is enough
 * because hold-tap / macro params live on that token, not a shared object.
 */

export function cloneBinding(text) {
  return String(text ?? "");
}

export function planDrop({
  from,
  to,
  binding,
  targetBinding,
  modifiers = {},
  empty = "&none",
  clearPx = 0,
  distance = 0,
} = {}) {
  if (from == null) {
    if (to == null) return null;
    return { kind: "assign", sets: [{ index: to, text: cloneBinding(binding) }] };
  }
  if (to == null) {
    if (distance < clearPx) return null;
    return { kind: "clear", sets: [{ index: from, text: empty }] };
  }
  if (from === to) return null;
  const src = cloneBinding(binding);
  if (modifiers.ctrl || modifiers.meta) {
    return { kind: "copy", sets: [{ index: to, text: src }] };
  }
  if (modifiers.alt) {
    return {
      kind: "swap",
      sets: [
        { index: to, text: src },
        { index: from, text: cloneBinding(targetBinding) },
      ],
    };
  }
  return {
    kind: "move",
    sets: [
      { index: to, text: src },
      { index: from, text: empty },
    ],
  };
}

/** Click (no drag) on a key: isolate one of many, or clear a sole selection. */
export function clickKeyAction({ wasSelected, multiSelected, moved, shift, over, from } = {}) {
  if (moved || shift) return over != null && over !== from ? "select" : "keep";
  if (over == null) return "keep";
  if (over !== from) return "select";
  if (!wasSelected) return "select";
  return multiSelected ? "isolate" : "clear";
}

export function dropLabel(kind, from, to, bindingText) {
  if (kind === "assign") return `P${to} → ${bindingText}`;
  if (kind === "copy") return `Copied P${from} → P${to}`;
  if (kind === "swap") return `Swapped P${from} ↔ P${to}`;
  if (kind === "move") return `Moved P${from} → P${to}`;
  if (kind === "clear") return `Cleared P${from}`;
  return "";
}

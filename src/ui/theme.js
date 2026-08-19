/**
 * ─────────────────────────────────────────────────────────────
 *  COLOR THEME  —  edit the hex values below, save, reload.
 *  This is the only palette. The board, chips, legend, and
 *  SVG export all read from THEME.
 *  File: editor/js/theme.js
 * ─────────────────────────────────────────────────────────────
 */
export const THEME = {
  // Surfaces (Quizlet-like navy)
  bg: "#0B1120",
  bgRaise: "#0F172A",
  bgKey: "#1E293B",
  bgKeyHover: "#334155",
  ink: "#E2E8F0",
  muted: "#94A3B8",
  line: "#1E293B",
  keyIdx: "#64748B",
  pickDim: "#0B1220",

  // Selected / accent — bright cyan
  selected: "#22D3EE",
  selectedFill: "#155E75",
  accent: "#22D3EE",
  accentDim: "#0891B2",
  accentInk: "#082F49",

  // Hold-tap / home-row mods — vivid blue (&hml, &hmr, ht_*)
  holdTap: "#3B82F6",
  holdTapFill: "#1E3A8A",
  holdTapChip: "#172554",

  // Layer hold — strong amber (&mo, &lt, &sl, &to). Stands out more than hold-taps.
  layerHold: "#F59E0B",
  layerHoldFill: "#78350F",
  layerHoldChip: "#451A03",

  // Home-row (same as hold-tap unless you want them split again)
  homeRow: "#3B82F6",
  homeRowFill: "#1E3A8A",
  homeRowChip: "#172554",

  // Combos — bright emerald
  combo: "#10B981",
  comboFill: "#064E3B",
  comboChip: "#022C22",

  // Macros — soft rose
  macro: "#F472B6",
  macroFill: "#4A044E",
  macroChip: "#3B0764",

  // Other behaviors — soft coral
  other: "#FB7185",
  otherFill: "#4C0519",
  otherChip: "#3F0D1A",

  // Status
  ok: "#10B981",
  danger: "#FBBF24",
  dangerBg: "#422006",
  dangerInk: "#FDE68A",
};

/** CSS custom properties written onto :root from THEME. */
const CSS_FROM_THEME = {
  "--bg": "bg",
  "--bg-raise": "bgRaise",
  "--bg-key": "bgKey",
  "--bg-key-hover": "bgKeyHover",
  "--ink": "ink",
  "--muted": "muted",
  "--line": "line",
  "--key-idx": "keyIdx",
  "--pick-dim": "pickDim",
  "--accent": "accent",
  "--accent-dim": "accentDim",
  "--accent-ink": "accentInk",
  "--select": "selected",
  "--select-fill": "selectedFill",
  "--ok": "ok",
  "--danger": "danger",
  "--danger-bg": "dangerBg",
  "--danger-ink": "dangerInk",
  "--holdtap": "holdTap",
  "--holdtap-fill": "holdTapFill",
  "--holdtap-chip": "holdTapChip",
  "--hold-fill": "layerHoldFill",
  "--layerhold": "layerHold",
  "--layerhold-fill": "layerHoldFill",
  "--layerhold-chip": "layerHoldChip",
  "--homerow": "holdTap",
  "--homerow-fill": "holdTapFill",
  "--homerow-chip": "holdTapChip",
  "--hrm-fill": "holdTapFill",
  "--hrm-stroke": "holdTap",
  "--behavior": "holdTap",
  "--behavior-fill": "holdTapFill",
  "--behavior-stroke": "holdTap",
  "--behavior-chip": "holdTapChip",
  "--combo-color": "combo",
  "--combo-stroke": "combo",
  "--combo-fill": "comboFill",
  "--combo-chip": "comboChip",
  "--macro": "macro",
  "--macro-stroke": "macro",
  "--macro-fill": "macroFill",
  "--macro-chip": "macroChip",
  "--other": "other",
  "--other-fill": "otherFill",
  "--other-chip": "otherChip",
};

export function applyTheme(theme = THEME, root = globalThis.document?.documentElement) {
  if (!root?.style) return;
  for (const [prop, key] of Object.entries(CSS_FROM_THEME)) {
    root.style.setProperty(prop, theme[key]);
  }
}

/** Inline paints for standalone SVG export (no editor.css). */
export function svgColors(theme = THEME) {
  return {
    bg: theme.bg,
    key: theme.bgKey,
    keyStroke: theme.bgKeyHover,
    ink: theme.ink,
    muted: theme.muted,
    idx: theme.keyIdx,
    title: theme.selected,
    holdFill: theme.holdTapFill,
    holdStroke: theme.holdTap,
    homeFill: theme.holdTapFill,
    homeStroke: theme.holdTap,
    layerFill: theme.layerHoldFill,
    layerStroke: theme.layerHold,
    comboFill: theme.comboFill,
    comboStroke: theme.combo,
    macroFill: theme.macroFill,
    macroStroke: theme.macro,
    otherFill: theme.otherFill,
    otherStroke: theme.other,
  };
}

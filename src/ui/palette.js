function letters() {
  return "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((ch) => ({
    label: ch,
    binding: `&kp ${ch}`,
    category: "letters",
    description: `Letter ${ch}`,
  }));
}

function nums() {
  return "0123456789".split("").map((ch) => ({
    label: ch,
    binding: `&kp N${ch}`,
    category: "numbers",
    description: `Digit ${ch}`,
  }));
}

function item(category, label, binding, description = binding) {
  return { category, label, binding, description };
}

const SYMBOLS = [
  item("symbols", "`", "&kp GRAVE"),
  item("symbols", "~", "&kp TILDE"),
  item("symbols", "!", "&kp EXCL"),
  item("symbols", "@", "&kp AT"),
  item("symbols", "#", "&kp HASH"),
  item("symbols", "$", "&kp DLLR"),
  item("symbols", "%", "&kp PRCNT"),
  item("symbols", "^", "&kp CARET"),
  item("symbols", "&", "&kp AMPS"),
  item("symbols", "*", "&kp STAR"),
  item("symbols", "(", "&kp LPAR"),
  item("symbols", ")", "&kp RPAR"),
  item("symbols", "-", "&kp MINUS"),
  item("symbols", "_", "&kp UNDER"),
  item("symbols", "=", "&kp EQUAL"),
  item("symbols", "+", "&kp PLUS"),
  item("symbols", "[", "&kp LBKT"),
  item("symbols", "]", "&kp RBKT"),
  item("symbols", ";", "&kp SEMI"),
  item("symbols", "'", "&kp SQT"),
  item("symbols", '"', "&kp DQT"),
  item("symbols", ",", "&kp COMMA"),
  item("symbols", ".", "&kp DOT"),
  item("symbols", "/", "&kp FSLH"),
  item("symbols", "\\", "&kp BSLH"),
  item("symbols", "|", "&kp PIPE"),
];

const NAVIGATION = [
  item("navigation", "Esc", "&kp ESC"),
  item("navigation", "Tab", "&kp TAB"),
  item("navigation", "⌫", "&kp BSPC"),
  item("navigation", "Del", "&kp DEL"),
  item("navigation", "Ins", "&kp INS"),
  item("navigation", "⏎", "&kp ENTER"),
  item("navigation", "␣", "&kp SPACE"),
  item("navigation", "↑", "&kp UP"),
  item("navigation", "↓", "&kp DOWN"),
  item("navigation", "←", "&kp LEFT"),
  item("navigation", "→", "&kp RIGHT"),
  item("navigation", "Home", "&kp HOME"),
  item("navigation", "End", "&kp END"),
  item("navigation", "PgUp", "&kp PG_UP"),
  item("navigation", "PgDn", "&kp PG_DN"),
  item("navigation", "Caps", "&kp CAPS"),
];

const MODIFIERS = [
  item("modifiers", "⇧", "&kp LSHFT", "Left Shift"),
  item("modifiers", "⇧R", "&kp RSHFT", "Right Shift"),
  item("modifiers", "Ctrl", "&kp LCTRL", "Left Ctrl"),
  item("modifiers", "CtrlR", "&kp RCTRL", "Right Ctrl"),
  item("modifiers", "Alt", "&kp LALT", "Left Alt"),
  item("modifiers", "AltR", "&kp RALT", "Right Alt"),
  item("modifiers", "GUI", "&kp LGUI", "Left GUI"),
  item("modifiers", "GUIR", "&kp RGUI", "Right GUI"),
  item("modifiers", "sk⇧", "&sk LSHFT", "Sticky Shift"),
  item("modifiers", "skCtrl", "&sk LCTRL", "Sticky Ctrl"),
  item("modifiers", "skAlt", "&sk LALT", "Sticky Alt"),
  item("modifiers", "skGUI", "&sk LGUI", "Sticky GUI"),
];

const FUNCTION = Array.from({ length: 12 }, (_, i) =>
  item("function", `F${i + 1}`, `&kp F${i + 1}`)
);

const MEDIA = [
  item("media", "Vol+", "&kp C_VOL_UP"),
  item("media", "Vol-", "&kp C_VOL_DN"),
  item("media", "Mute", "&kp C_MUTE"),
  item("media", "⏯", "&kp C_PP"),
  item("media", "⏮", "&kp C_PREV"),
  item("media", "⏭", "&kp C_NEXT"),
  item("media", "Bri+", "&kp C_BRI_UP"),
  item("media", "Bri-", "&kp C_BRI_DN"),
  item("media", "Undo", "&kp K_UNDO"),
  item("media", "PrtSc", "&kp PSCRN"),
];

const MOUSE = [
  item("mouse", "↑", "&mmv MOVE_UP", "Mouse up"),
  item("mouse", "↓", "&mmv MOVE_DOWN", "Mouse down"),
  item("mouse", "←", "&mmv MOVE_LEFT", "Mouse left"),
  item("mouse", "→", "&mmv MOVE_RIGHT", "Mouse right"),
  item("mouse", "Scr↑", "&msc SCRL_UP", "Scroll up"),
  item("mouse", "Scr↓", "&msc SCRL_DOWN", "Scroll down"),
  item("mouse", "Scr←", "&msc SCRL_LEFT", "Scroll left"),
  item("mouse", "Scr→", "&msc SCRL_RIGHT", "Scroll right"),
  item("mouse", "Lclk", "&mkp LCLK", "Left click"),
  item("mouse", "Rclk", "&mkp RCLK", "Right click"),
  item("mouse", "Mclk", "&mkp MCLK", "Middle click"),
  item("mouse", "MB4", "&mkp MB4"),
  item("mouse", "MB5", "&mkp MB5"),
];

const SYSTEM = [
  item("system", "▽", "&trans", "Transparent / empty"),
  item("system", "∅", "&none", "None (no-op)"),
  item("system", "RST", "&sys_reset", "Soft reset"),
  item("system", "LOG", "&host_log_dump", "Dump host log"),
  item("system", "BT0", "&bt BT_SEL 0"),
  item("system", "BT1", "&bt BT_SEL 1"),
  item("system", "BT2", "&bt BT_SEL 2"),
  item("system", "BTx", "&bt BT_CLR", "Clear current bond"),
  item("system", "BT*", "&bt BT_CLR_ALL", "Clear all bonds"),
  item("system", "Studio", "&studio_unlock", "Unlock ZMK Studio"),
  item("system", "Mac", "&mac_lock", "macOS lock"),
  item("system", "Win", "&win_lock", "Windows lock"),
];

const LAYERS = [
  item("layers", "▽", "&trans", "Transparent / empty"),
  item("layers", "∅", "&none", "None (no-op)"),
  item("layers", "mo CODE", "&mo CODE", "Hold for code"),
  item("layers", "mo NAV", "&mo NAV", "Hold for nav"),
  item("layers", "mo MOD", "&mo MOD", "Hold for mod"),
  item("layers", "mo ADJ", "&mo ADJ", "Hold for adj"),
  item("layers", "sl CODE", "&sl CODE", "Sticky code"),
  item("layers", "sl NAV", "&sl NAV", "Sticky nav"),
  item("layers", "to BASE", "&to BASE", "Switch to base"),
  item("layers", "to CODE", "&to CODE", "Switch to code"),
  item("layers", "to NAV", "&to NAV", "Switch to nav"),
  item("layers", "to MOD", "&to MOD", "Switch to mod"),
  item("layers", "to ADJ", "&to ADJ", "Switch to adj"),
];

export const CATEGORIES = [
  { id: "letters", label: "Letters", cols: 13 },
  { id: "numbers", label: "Numbers", cols: 10 },
  { id: "symbols", label: "Symbols", cols: 13 },
  { id: "navigation", label: "Navigation", cols: "auto" },
  { id: "modifiers", label: "Modifiers", cols: "auto" },
  { id: "function", label: "Function", cols: 12 },
  { id: "media", label: "Media", cols: "auto" },
  { id: "mouse", label: "Mouse", cols: "auto" },
  { id: "system", label: "System", cols: "auto" },
  { id: "layers", label: "Layers", cols: "auto" },
  { id: "behaviors", label: "Behaviors", cols: "auto" },
];

export const PALETTE = [
  ...letters(),
  ...nums(),
  ...SYMBOLS,
  ...NAVIGATION,
  ...MODIFIERS,
  ...FUNCTION,
  ...MEDIA,
  ...MOUSE,
  ...SYSTEM,
  ...LAYERS,
];

/** @deprecated use PALETTE filtered to letters */
export const LETTERS = PALETTE.filter((it) => it.category === "letters");

/** Left behind by Move / Clear. Switch to "&trans" for layer fall-through. */
export const EMPTY_BINDING = "&none";
export const EMPTY_CHOICES = ["&none", "&trans"];

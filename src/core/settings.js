/**
 * Global editor preferences. One localStorage blob; does not change keycodes.
 */

export const SETTINGS_KEY = "zmkmap-settings";
export const LEGACY_EMPTY_KEY = "zmkmap-empty-binding";

export const OS_CHOICES = [
  { id: "mac", label: "Mac" },
  { id: "windows", label: "Windows" },
  { id: "linux", label: "Linux" },
];

export const EMPTY_CHOICES = ["&none", "&trans"];

export const SETTING_LIMITS = {
  tappingTerm: { min: 50, max: 800, fallback: 280 },
  comboTimeout: { min: 10, max: 500, fallback: 50 },
};

export function detectOs(platform = "") {
  const p = String(platform || "").toLowerCase();
  if (/\bmac|iphone|ipad|darwin\b/.test(p)) return "mac";
  if (/\bwin/.test(p)) return "windows";
  if (/\blinux|x11/.test(p)) return "linux";
  return "mac";
}

export function detectOsFromEnv() {
  if (typeof navigator === "undefined") return "mac";
  const uaPlat = navigator.userAgentData?.platform || "";
  const plat = navigator.platform || "";
  const ua = navigator.userAgent || "";
  return detectOs(`${uaPlat} ${plat} ${ua}`);
}

export function defaultSettings(platform) {
  return {
    os: platform != null ? detectOs(platform) : detectOsFromEnv(),
    emptyBinding: "&none",
    showPositions: true,
    showColors: true,
    tappingTerm: 280,
    comboTimeout: 50,
    confirmApply: true,
  };
}

function clampInt(value, { min, max, fallback }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeSettings(raw, platform) {
  const base = defaultSettings(platform);
  const src = raw && typeof raw === "object" ? raw : {};
  const os = OS_CHOICES.some((o) => o.id === src.os) ? src.os : base.os;
  const emptyBinding = EMPTY_CHOICES.includes(src.emptyBinding) ? src.emptyBinding : base.emptyBinding;
  return {
    os,
    emptyBinding,
    showPositions: src.showPositions !== false,
    showColors: src.showColors !== false,
    tappingTerm: clampInt(src.tappingTerm, SETTING_LIMITS.tappingTerm),
    comboTimeout: clampInt(src.comboTimeout, SETTING_LIMITS.comboTimeout),
    confirmApply: src.confirmApply !== false,
  };
}

export function loadSettings(storage, platform) {
  const store = storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  let parsed = null;
  try {
    const raw = store?.getItem(SETTINGS_KEY);
    if (raw) parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!parsed) {
    const legacy = store?.getItem(LEGACY_EMPTY_KEY);
    if (EMPTY_CHOICES.includes(legacy)) parsed = { emptyBinding: legacy };
  }
  return normalizeSettings(parsed, platform);
}

export function saveSettings(settings, storage) {
  const store = storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  const next = normalizeSettings(settings);
  if (!store) return next;
  store.setItem(SETTINGS_KEY, JSON.stringify(next));
  store.removeItem(LEGACY_EMPTY_KEY);
  return next;
}

export function isAppleOs(os) {
  return os !== "windows" && os !== "linux";
}

export function holdModChoices(os) {
  if (isAppleOs(os)) {
    return [
      ["LGUI", "⌘"],
      ["LALT", "⌥"],
      ["LCTRL", "⌃"],
      ["LSHFT", "⇧"],
      ["RGUI", "⌘ R"],
      ["RALT", "⌥ R"],
      ["RCTRL", "⌃ R"],
      ["RSHFT", "⇧ R"],
    ];
  }
  return [
    ["LCTRL", "Ctrl"],
    ["LALT", "Alt"],
    ["LSHFT", "Shift"],
    ["LGUI", "Win"],
    ["RCTRL", "Ctrl R"],
    ["RALT", "Alt R"],
    ["RSHFT", "Shift R"],
    ["RGUI", "Win R"],
  ];
}

export function inspectModChoices(os) {
  if (isAppleOs(os)) {
    return [
      ["LG", "⌘"],
      ["LA", "⌥"],
      ["LC", "⌃"],
      ["LS", "⇧"],
      ["RG", "⌘ R"],
      ["RA", "⌥ R"],
      ["RC", "⌃ R"],
      ["RS", "⇧ R"],
    ];
  }
  return [
    ["LC", "Ctrl"],
    ["LA", "Alt"],
    ["LS", "Shift"],
    ["LG", "Win"],
    ["RC", "Ctrl R"],
    ["RA", "Alt R"],
    ["RS", "Shift R"],
    ["RG", "Win R"],
  ];
}

export function keycapModLabel(token, os) {
  const apple = isAppleOs(os);
  const map = apple
    ? {
        LGUI: "⌘",
        RGUI: "⌘",
        LALT: "⌥",
        RALT: "⌥",
        LCTRL: "⌃",
        RCTRL: "⌃",
        LSHFT: "⇧",
        RSHFT: "⇧",
      }
    : {
        LGUI: "Win",
        RGUI: "Win",
        LALT: "Alt",
        RALT: "Alt",
        LCTRL: "Ctrl",
        RCTRL: "Ctrl",
        LSHFT: "⇧",
        RSHFT: "⇧",
      };
  return map[token] || token;
}

export function chordMarks(os) {
  if (isAppleOs(os)) {
    return { LC: "⌃", LS: "⇧", LA: "⌥", LG: "⌘", RC: "⌃", RS: "⇧", RA: "⌥", RG: "⌘" };
  }
  return { LC: "Ctrl", LS: "⇧", LA: "Alt", LG: "Win", RC: "Ctrl", RS: "⇧", RA: "Alt", RG: "Win" };
}

export function modifiersForOs(os) {
  if (isAppleOs(os)) {
    return [
      { category: "modifiers", label: "⌘", binding: "&kp LGUI", description: "Left Command" },
      { category: "modifiers", label: "⌥", binding: "&kp LALT", description: "Left Option" },
      { category: "modifiers", label: "⌃", binding: "&kp LCTRL", description: "Left Control" },
      { category: "modifiers", label: "⇧", binding: "&kp LSHFT", description: "Left Shift" },
      { category: "modifiers", label: "⌘R", binding: "&kp RGUI", description: "Right Command" },
      { category: "modifiers", label: "⌥R", binding: "&kp RALT", description: "Right Option" },
      { category: "modifiers", label: "⌃R", binding: "&kp RCTRL", description: "Right Control" },
      { category: "modifiers", label: "⇧R", binding: "&kp RSHFT", description: "Right Shift" },
      { category: "modifiers", label: "sk⌘", binding: "&sk LGUI", description: "Sticky Command" },
      { category: "modifiers", label: "sk⌥", binding: "&sk LALT", description: "Sticky Option" },
      { category: "modifiers", label: "sk⌃", binding: "&sk LCTRL", description: "Sticky Control" },
      { category: "modifiers", label: "sk⇧", binding: "&sk LSHFT", description: "Sticky Shift" },
    ];
  }
  return [
    { category: "modifiers", label: "Ctrl", binding: "&kp LCTRL", description: "Left Ctrl" },
    { category: "modifiers", label: "CtrlR", binding: "&kp RCTRL", description: "Right Ctrl" },
    { category: "modifiers", label: "Alt", binding: "&kp LALT", description: "Left Alt" },
    { category: "modifiers", label: "AltR", binding: "&kp RALT", description: "Right Alt" },
    { category: "modifiers", label: "Shift", binding: "&kp LSHFT", description: "Left Shift" },
    { category: "modifiers", label: "ShiftR", binding: "&kp RSHFT", description: "Right Shift" },
    { category: "modifiers", label: "Win", binding: "&kp LGUI", description: "Left Win" },
    { category: "modifiers", label: "WinR", binding: "&kp RGUI", description: "Right Win" },
    { category: "modifiers", label: "skCtrl", binding: "&sk LCTRL", description: "Sticky Ctrl" },
    { category: "modifiers", label: "skAlt", binding: "&sk LALT", description: "Sticky Alt" },
    { category: "modifiers", label: "skShift", binding: "&sk LSHFT", description: "Sticky Shift" },
    { category: "modifiers", label: "skWin", binding: "&sk LGUI", description: "Sticky Win" },
  ];
}

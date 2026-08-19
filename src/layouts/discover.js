/**
 * Rank keymap + geometry files in a repo (GitHub tree or local file list).
 */

const IGNORE = /(^|\/)(node_modules|\.git|\.west|zephyr|build|dist|modules)(\/|$)/i;

export function normalizeRepoPath(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

export function ignoreRepoPath(path) {
  return IGNORE.test(normalizeRepoPath(path));
}

export function keymapScore(path) {
  const p = normalizeRepoPath(path);
  if (!p.endsWith(".keymap")) return -1;
  let s = 20;
  if (/^config\/[^/]+\.keymap$/i.test(p)) s += 50;
  else if (/\/config\/[^/]+\.keymap$/i.test(p)) s += 40;
  if (/(^|\/)(example|examples|test|tests)\//i.test(p)) s -= 25;
  s -= Math.min(8, p.split("/").length);
  return s;
}

export function layoutScore(path) {
  const p = normalizeRepoPath(path);
  if (/(^|\/)zmk-map-layout\.json$/i.test(p)) return { kind: "zmk-map-json", score: 100 };
  if (/(^|\/)layout\.json$/i.test(p)) return { kind: "layout-json", score: 90 };
  if (/physical-layout/i.test(p)) return { kind: "physical", score: 80 };
  if (/transform/i.test(p) && p.endsWith(".dtsi")) return { kind: "transform", score: 70 };
  if (/\/boards\/shields\/.+\.dtsi$/i.test(p)) return { kind: "shield-dtsi", score: 55 };
  if (/\/boards\/.+\.dtsi$/i.test(p)) return { kind: "board-dtsi", score: 40 };
  if (p.endsWith(".dtsi")) return { kind: "dtsi", score: 12 };
  return null;
}

export function discoverRepoFiles(paths) {
  const keymap = [];
  const layout = [];
  for (const raw of paths || []) {
    const path = normalizeRepoPath(raw);
    if (!path || ignoreRepoPath(path)) continue;
    const ks = keymapScore(path);
    if (ks >= 0) keymap.push({ path, score: ks, kind: "keymap" });
    const ls = layoutScore(path);
    if (ls) layout.push({ path, score: ls.score, kind: ls.kind });
  }
  keymap.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  layout.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return { keymap, layout };
}

function nameTokenHit(text, name) {
  const token = String(name || "").trim();
  if (!token) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

export function matchBuiltinLayout(haystack, builtins = []) {
  const text = String(haystack || "");
  if (!text.trim()) return null;
  let best = null;
  for (const b of builtins) {
    const id = String(b.id || "");
    const name = String(b.name || "");
    if (!id) continue;
    const hitId = nameTokenHit(text, id);
    const hitName = name && name.toLowerCase() !== id.toLowerCase() && nameTokenHit(text, name);
    if (hitId || hitName) {
      const hit = id.length + (hitName ? 2 : 0);
      if (!best || hit > best.hit) best = { id: b.id, name: b.name || b.id, hit };
    }
  }
  return best ? { id: best.id, name: best.name, source: "builtin" } : null;
}

function layoutSourceOf(item) {
  if (!item) return null;
  if (item.source) return item.source;
  if (item.kind === "builtin") return "builtin";
  return String(item.kind || "").includes("json") ? "json" : "dtsi";
}

export function pickDiscovery(paths, { repoName = "", builtins = [] } = {}) {
  const found = discoverRepoFiles(paths);
  const hay = `${repoName} ${found.keymap.map((k) => k.path).join(" ")} ${found.layout.map((l) => l.path).join(" ")}`;
  const builtin = matchBuiltinLayout(hay, builtins);
  const jsonHits = found.layout.filter((l) => l.score >= 80);
  const plausible = found.layout.filter((l) => l.score >= 40 && l.score < 80);
  const keymap = found.keymap[0] || null;
  let layout = null;
  if (jsonHits[0]) {
    layout = { ...jsonHits[0], source: layoutSourceOf(jsonHits[0]) };
  } else if (builtin) {
    layout = { ...builtin, path: "", kind: "builtin", score: 95, source: "builtin" };
  } else if (plausible[0]) {
    layout = { ...plausible[0], source: "dtsi" };
  } else if (found.layout[0]) {
    layout = { ...found.layout[0], source: layoutSourceOf(found.layout[0]) };
  }
  const keymapClear =
    found.keymap.length <= 1 || (found.keymap.length > 1 && found.keymap[0].score - found.keymap[1].score >= 15);
  const layoutClear = jsonHits.length === 1 || (!jsonHits.length && !!(builtin || plausible.length === 1));
  return {
    keymap,
    layout,
    keymaps: found.keymap,
    layouts: found.layout,
    builtin,
    auto: !!(keymap && layout && keymapClear && layoutClear),
  };
}

/**
 * Standalone multi-layer SVG. Inline paints so the file opens without editor.css.
 */

import { formatKeyLabel, bindingHoldHint, findLayerActivators, comboActiveOnLayer } from "../keymap/keymap.js";
import { parseBinding, classifyBinding, isHomeRowBinding, isLayerHoldBinding } from "../behaviors/inspect.js";
import { layoutBounds } from "../layouts/layout.js";
import { svgColors } from "./theme.js";

const COLORS = svgColors();

const TITLE_H = 72;
const GAP = 56;
const OUTER = 24;

export function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layerTitle(id) {
  return id.replace(/_layer$/, "");
}

function keyRole(text, index, layerIndex, extras, activator) {
  const model = parseBinding(text);
  const kind = classifyBinding(model, extras || {});
  if (kind === "macro") return "macro";
  if (isLayerHoldBinding(model) || kind === "layer" || kind === "layer-tap" || activator) return "layerhold";
  if (isHomeRowBinding(model, extras || {}) || kind === "hold-tap") return "holdtap";
  const custom = (extras?.behaviors || []).find((b) => !b.deleted && b.id === model.behavior);
  if (custom) return custom.kind === "hold-tap" ? "holdtap" : "other";
  if (
    (extras?.combos || []).some(
      (c) => !c.deleted && c.positions.includes(index) && comboActiveOnLayer(c, layerIndex)
    )
  ) {
    return "combo";
  }
  return "";
}

function paintFor(role) {
  if (role === "macro") return { fill: COLORS.macroFill, stroke: COLORS.macroStroke, sw: 5, dash: null };
  if (role === "holdtap") return { fill: COLORS.holdFill, stroke: COLORS.holdStroke, sw: 5, dash: null };
  if (role === "homerow") return { fill: COLORS.holdFill, stroke: COLORS.holdStroke, sw: 5, dash: null };
  if (role === "layerhold") return { fill: COLORS.layerFill, stroke: COLORS.layerStroke, sw: 6, dash: null };
  if (role === "other") return { fill: COLORS.otherFill, stroke: COLORS.otherStroke, sw: 5, dash: null };
  if (role === "combo") return { fill: COLORS.comboFill, stroke: COLORS.comboStroke, sw: 5, dash: "8 5" };
  return { fill: COLORS.key, stroke: COLORS.keyStroke, sw: 4, dash: null };
}

function keyMarkup(k, i, binding, role, activator, opts = {}) {
  const cx = k.x + k.w / 2;
  const cy = k.y + k.h / 2;
  const transform = k.r ? ` transform="rotate(${k.r} ${k.rx || cx} ${k.ry || cy})"` : "";
  const text = binding?.text ?? "";
  const formatted = formatKeyLabel(text);
  const hold = bindingHoldHint(text) || (activator ? "HOLD" : "");
  const paint = opts.showColors === false ? paintFor("") : paintFor(role);
  const dash = paint.dash ? ` stroke-dasharray="${paint.dash}"` : "";
  const parts = [
    `<rect x="${k.x}" y="${k.y}" width="${k.w}" height="${k.h}" rx="14" ry="14" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="${paint.sw}"${dash}/>`,
  ];
  if (hold) {
    parts.push(
      `<text x="${cx}" y="${k.y + 20}" fill="${COLORS.muted}" font-size="16" text-anchor="middle" font-family="system-ui,sans-serif">${xmlEscape(hold)}</text>`
    );
  }
  const lineH = formatted.font + 2;
  const startY = cy - ((formatted.lines.length - 1) * lineH) / 2 + 2;
  const spans = formatted.lines
    .map((line, li) => `<tspan x="${cx}" y="${startY + li * lineH}">${xmlEscape(line)}</tspan>`)
    .join("");
  parts.push(
    `<text fill="${COLORS.ink}" font-size="${formatted.font}" font-weight="600" text-anchor="middle" font-family="system-ui,sans-serif">${spans}</text>`
  );
  if (opts.showPositions !== false) {
    parts.push(
      `<text x="${k.x + 10}" y="${k.y + k.h - 10}" fill="${COLORS.idx}" font-size="12" font-family="ui-monospace,Menlo,monospace">${i}</text>`
    );
  }
  return `<g${transform}>${parts.join("")}</g>`;
}

export function buildKeymapSvg(keys, layers, extras = {}) {
  if (!keys?.length) {
    throw new Error("No physical layout loaded.");
  }
  if (!layers?.length) {
    throw new Error("No layers to export.");
  }
  const box = layoutBounds(keys);
  const layerH = TITLE_H + box.height;
  const width = box.width + OUTER * 2;
  const height = OUTER + layers.length * layerH + (layers.length - 1) * GAP + OUTER;
  const out = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<rect width="100%" height="100%" fill="${COLORS.bg}"/>`,
  ];
  layers.forEach((layer, li) => {
    const y = OUTER + li * (layerH + GAP);
    const name = xmlEscape(layerTitle(layer.id));
    out.push(`<g data-layer="${name}" transform="translate(${OUTER} ${y})">`);
    out.push(
      `<text x="8" y="44" fill="${COLORS.title}" font-size="32" font-weight="600" font-family="system-ui,sans-serif">${name}</text>`
    );
    const activators = new Set(findLayerActivators(layers, li).map((a) => a.index));
    out.push(`<g transform="translate(${-box.minX} ${TITLE_H - box.minY})">`);
    keys.forEach((k, i) => {
      const activator = activators.has(i);
      out.push(
        keyMarkup(k, i, layer.bindings[i], keyRole(layer.bindings[i]?.text, i, li, extras, activator), activator, extras)
      );
    });
    out.push(`</g></g>`);
  });
  out.push(`</svg>`);
  return out.join("\n");
}

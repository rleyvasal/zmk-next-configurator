/**
 * Helpers for showing Runtime Config items next to compiled keymap combinations.
 * Load from Keyboard must not hide a live overlay combo just because the
 * firmware keymap already has other combos.
 */

import { comboActiveOnLayer } from "../keymap/keymap.js";
import {
  comboLayerMask,
  runtimeComboActiveOnLayer,
  stockPositionsToSelectedIndexes,
} from "./runtime-draft.js";

function comboPositionKey(positions) {
  return (positions || [])
    .map((position) => Number(position))
    .filter((position) => Number.isInteger(position) && position >= 0)
    .sort((left, right) => left - right)
    .join(",");
}

/** Suppress-compiled markers occupy a firmware combo slot so they can hide a
 *  stock combo. They are bookkeeping, not a combination on the board. */
export function isLiveRuntimeCombo(combo) {
  return Boolean(combo) && !combo.output?.suppressCompiled;
}

/** Counts shown in the connection banner. Combo trigger positions are an
 * overlay too, even though they do not replace the keys' ordinary bindings. */
export function runtimeOverlayCounts(snapshot = {}) {
  const comboKeys = new Set();
  let liveCombos = 0;
  let suppressedCombos = 0;
  for (const combo of snapshot.combos || []) {
    for (const position of combo?.keyPositions || []) comboKeys.add(Number(position));
    if (isLiveRuntimeCombo(combo)) liveCombos += 1;
    else suppressedCombos += 1;
  }
  return {
    keyOverrides: (snapshot.keymapOverrides || []).length,
    comboKeys: comboKeys.size,
    liveCombos,
    suppressedCombos,
    runtimeObjects: (snapshot.runtimeObjects || []).length,
  };
}

/**
 * Layout indexes that should receive combo tint / pair badges.
 * Deleted compiled combos and suppress-compiled markers both drop out, so
 * deleting a stock combo does not leave its trigger keys green.
 */
export function comboHighlightIndexes({
  combos = [],
  runtimeCombos = [],
  layerIndex = 0,
  stockToSelected = (positions) => positions || [],
} = {}) {
  const indexes = new Set();
  for (const combo of combos) {
    if (combo?.deleted || !comboActiveOnLayer(combo, layerIndex)) continue;
    for (const index of combo.positions || []) indexes.add(index);
  }
  for (const combo of runtimeCombos) {
    if (!isLiveRuntimeCombo(combo) || !runtimeComboActiveOnLayer(combo, layerIndex)) continue;
    for (const index of stockToSelected(combo.keyPositions || [])) indexes.add(index);
  }
  return indexes;
}

function selectedIndexesForRuntimeCombo(combo, { capabilities, stockToSelected } = {}) {
  if (typeof stockToSelected === "function") return stockToSelected(combo?.keyPositions || []);
  return stockPositionsToSelectedIndexes(capabilities, combo?.keyPositions);
}

function comboLayerScopeMatches(editorCombo, runtimeCombo, { suppression = false } = {}) {
  const expected = comboLayerMask(editorCombo?.layers);
  const actual = Number(runtimeCombo?.layerMask) >>> 0;
  // Firmware deliberately treats a zero-mask suppression saved by an older
  // build as a wildcard. Ordinary live combos must match layer scope exactly.
  return suppression ? actual === 0 || actual === expected : actual === expected;
}

/** Overlay combo that matches an editor combo by remembered id or trigger keys. */
export function editorComboOverlayIds(combo, draft, opts = {}) {
  const ids = new Set();
  if (combo?.runtimeComboId != null) {
    const remembered = (draft?.combos || []).find((item) => item.id === Number(combo.runtimeComboId));
    if (remembered && isLiveRuntimeCombo(remembered)) ids.add(remembered.id);
  }
  const want = comboPositionKey(combo?.positions);
  if (!want) return [...ids];
  for (const item of draft?.combos || []) {
    if (!isLiveRuntimeCombo(item)) continue;
    if (!comboLayerScopeMatches(combo, item)) continue;
    if (comboPositionKey(selectedIndexesForRuntimeCombo(item, opts)) === want) ids.add(item.id);
  }
  return [...ids];
}

export function editorComboOverlayId(combo, draft, opts = {}) {
  return editorComboOverlayIds(combo, draft, opts)[0] ?? null;
}

export function editorComboSuppressId(combo, draft, opts = {}) {
  const want = comboPositionKey(combo?.positions);
  if (!want) return null;
  const found = (draft?.combos || []).find((item) => {
    if (!item?.output?.suppressCompiled) return false;
    if (!comboLayerScopeMatches(combo, item, { suppression: true })) return false;
    return comboPositionKey(selectedIndexesForRuntimeCombo(item, opts)) === want;
  });
  return found?.id ?? null;
}

/**
 * What a live delete must do: drop the overlay copy if we created/imported one,
 * and suppress the firmware-compiled combo when this entry came from the keymap.
 * Session-added combos only exist in the overlay, so they must not spend a
 * suppress slot on positions the firmware never compiled.
 */
export function comboDeleteLivePlan(combo, { draft, capabilities, stockToSelected } = {}) {
  const opts = { capabilities, stockToSelected };
  const overlayIds = editorComboOverlayIds(combo, draft, opts);
  return {
    overlayId: overlayIds[0] ?? null,
    overlayIds,
    suppress: !combo?.added && editorComboSuppressId(combo, draft, opts) == null,
  };
}

/** Compiled keymap combos stay in the .keymap file. A live delete only
 *  stages a suppress-compiled overlay, so reloading the file would bring
 *  them back unless we re-apply those markers as deleted. */
export function markSuppressedKeymapCombos(combos = [], draft, opts = {}) {
  let marked = 0;
  for (const combo of combos) {
    if (!combo || combo.added) continue;
    if (editorComboSuppressId(combo, draft, opts) == null) continue;
    // A live combo plus a suppress marker is a replacement of the compiled
    // definition, not a deletion. Keep the keymap entry visible/editable and
    // let the matching runtime item supply its active output.
    if (editorComboOverlayId(combo, draft, opts) != null) continue;
    if (!combo.deleted) marked += 1;
    combo.deleted = true;
  }
  return marked;
}

export function extraRuntimeCombinationItems(keymapItems = [], runtimeItems = []) {
  const used = new Set(
    keymapItems
      .filter((item) => item?.type === "combo")
      .map((item) => comboPositionKey(item.positions || item.source?.positions))
      .filter(Boolean)
  );
  return runtimeItems.filter((item) => {
    if (item?.type !== "combo") return true;
    if (item.source?.output?.suppressCompiled) return false;
    const key = comboPositionKey(item.positions || item.selectedPositions || item.source?.keyPositions);
    return !key || !used.has(key);
  });
}

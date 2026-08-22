/**
 * Helpers for showing Runtime Config items next to compiled keymap combinations.
 * Load from Keyboard must not hide a live overlay combo just because the
 * firmware keymap already has other combos.
 */

function comboPositionKey(positions) {
  return (positions || [])
    .map((position) => Number(position))
    .filter((position) => Number.isInteger(position) && position >= 0)
    .join(",");
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
    const key = comboPositionKey(item.positions || item.selectedPositions || item.source?.keyPositions);
    return !key || !used.has(key);
  });
}

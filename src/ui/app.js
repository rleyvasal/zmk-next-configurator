import {
  parseKeymap,
  applyCombos,
  applyBehaviors,
  applyMacros,
  bindingLabel,
  bindingHoldHint,
  formatKeyLabel,
  protectionFor,
  findLayerActivators,
  comboTitle,
  comboActiveOnLayer,
  layersUsingId,
  applyLayers,
  displayLayerName,
  nextLayerId,
  emptyLayerBindings,
  layerToken,
  rewriteLayerToken,
  applyLayerIndexMap,
  indexMapAfterDelete,
  indexMapAfterInsert,
  indexMapAfterReorder,
  countLayerTokenUses,
  neutralizeLayerToken,
  extractMacroTapTokens,
  findMacroKeySeats,
  prettyMacroToken,
  setLabelOs,
  mapStudioLayerIndex,
  studioLayerId,
} from "../keymap/keymap.js";
import { applyTheme } from "./theme.js";
import { PROFILE_INDEX, loadProfile, layoutBounds, normalizeProfile, profileFromDtsi } from "../layouts/layout.js";
import { pickDiscovery } from "../layouts/discover.js";
import { listGithubFiles, githubRawFile, parseGithubInput } from "../connection/github.js";
import { listLocalFiles, readLocalFile } from "../connection/local.js";
import { CATEGORIES, PALETTE, EMPTY_BINDING } from "./palette.js";
import { cloneBinding, planDrop, dropLabel, clickKeyAction } from "../core/drag.js";
import {
  loadSettings,
  saveSettings,
  holdModChoices,
  inspectModChoices,
  modifiersForOs,
} from "../core/settings.js";
import {
  classifyCombination,
  combinationSummary,
  defaultModeForBinding,
  describeHoldConflict,
  holdChoiceFromBinding,
  macroStepsFromKeys,
  modifierFromBinding,
  outputKeysFromSteps,
  resolveHoldMod,
  suggestedName,
  tapTokenFromBinding,
  uniqueSlug,
  appendOutputKey,
  asBinding,
  isBrokenComboBinding,
  formatBuilderDefinition,
  keymapStepsFromRuntimeSteps,
} from "../core/combine.js";
import {
  History,
  BindingSetCommand,
  CreateLayerCommand,
  DuplicateLayerCommand,
  RenameLayerCommand,
  DeleteLayerCommand,
  ReorderLayerCommand,
} from "../core/history.js";
import { buildKeymapSvg } from "./svg.js";
import { connectStudio, connectKnownStudioPort } from "../connection/studio.js";
import { bindingToCells, cellsToBinding, isPlaceholderBinding } from "../connection/studio-bind.js";
import { HOLD_TAP_FLAVOR, RuntimeValidationError, encodeRuntimeSnapshot } from "../connection/runtime-config.js";
import {
  RuntimeDraftError,
  RUNTIME_MODIFIERS,
  bindingTextFromAction,
  createRuntimeDraft,
  deleteRuntimeCombo,
  deleteRuntimeObject,
  findRuntimeCombo,
  findRuntimeObject,
  nextRuntimeComboId,
  nextRuntimeObjectId,
  parseRuntimeObjectId,
  replaceDraftKeymapOverrides,
  actionFromBindingText,
  bindingsMatchForOverlay,
  runtimeBindingText,
  runtimeIssuesFromDiagnostics,
  runtimeIssuesFromDraftError,
  runtimeObjectReferences,
  runtimeResourceOverLimit,
  runtimeResourceRows,
  runtimeResourceUsage,
  stockToSelectedIndex,
  stockPositionsToSelectedIndexes,
  runtimeComboActiveOnLayer,
  comboLayersFromMask,
  supportedRuntimeEditorTypes,
  upsertRuntimeCombo,
  upsertRuntimeObject,
} from "../connection/runtime-draft.js";
import { comboLinkedMacroId, formatRuntimeImportSummary, importKeymapRuntimeObjects } from "../connection/runtime-import.js";
import { extraRuntimeCombinationItems } from "../connection/runtime-display.js";
import {
  applyRuntimeDocument,
  encodeRuntimeDocument,
  isRuntimeDocument,
  parseRuntimeDocument,
  stringifyRuntimeDocument,
} from "../connection/runtime-document.js";
import {
  parseBinding,
  formatBinding,
  convertBinding,
  classifyBinding,
  isHomeRowBehavior,
  isHomeRowBinding,
  isLayerHoldBinding,
  keycodeFromBinding,
  BT_COMMANDS,
  MOUSE_PARAMS,
} from "../behaviors/inspect.js";

applyTheme();

const DRAG_CLEAR_PX = 16;

const $ = (id) => document.getElementById(id);

function runtimeObjectShortLabel(object) {
  const prefix = { holdTap: "HT", macro: "M", modMorph: "MM", tapDance: "TD" }[object?.type] || "RT";
  return object ? `${prefix}${object.id}` : "RT";
}

function prettyBindingLabel(text) {
  const object = findRuntimeObject(state.runtime?.draft, parseRuntimeObjectId(text));
  return object ? runtimeObjectShortLabel(object) : bindingLabel(text);
}

function inspectBehaviorValue(model) {
  if (model?.behavior === "rt") return `rt:${model.args?.[0] || model.key || ""}`;
  return model?.behavior;
}

const state = {
  original: "",
  profile: null,
  keymapPath: "keymap.keymap",
  layers: [],
  combos: [],
  comboInsertAt: -1,
  behaviors: [],
  behaviorInsertAt: -1,
  macros: [],
  macroInsertAt: -1,
  keys: [],
  layer: 0,
  layerMenu: null,
  layerRename: null,
  selected: new Set(),
  dirty: false,
  sync: "saved",
  drag: null,
  bgClick: null,
  history: new History(50),
  emptyBinding: EMPTY_BINDING,
  settings: loadSettings(),
  source: "file",
  sourceLabel: "",
  githubRef: null,
  importedProfile: null,
  repoDiscover: null,
  category: CATEGORIES[0].id,
  studio: null,
  runtime: null,
  liveWarned: false,
  comboDraft: null,
  behaviorDraft: null,
  macroDraft: null,
  combinationDraft: null,
  combinationFilter: "all",
  runtimeEditor: null,
  runtimeIssues: [],
  deviceLayerCount: 0,
  flashNotice: null,
  stockBindingTexts: new Map(),
  runtimeDirtyKeys: new Map(),
  loadedBindings: new Map(),
};

const liveQueue = [];
let liveBusy = false;
let runtimeIdleWatch = 0;

// Layer structure changes (add/move/remove/rename) go through the stock
// Studio Keymap RPC subsystem - a separate wire subsystem from per-key
// bindings above, so this is an independent queue/lock pair rather than
// reusing liveQueue/liveBusy.
const layerLiveQueue = [];
let layerLiveBusy = false;

function queueLiveLayerOp(job) {
  if (!state.studio) return;
  layerLiveQueue.push(job);
  pumpLayerLive();
}

async function pumpLayerLive() {
  if (layerLiveBusy || !state.studio) return;
  layerLiveBusy = true;
  while (layerLiveQueue.length && state.studio) {
    const job = layerLiveQueue.shift();
    try {
      switch (job.kind) {
        case "add": {
          if ((state.studio.availableLayers ?? 1) <= 0) {
            showFlashNeeded("layer", job.name, {
              line: "This keyboard has no free layer slot — add reserved layers in firmware for headroom.",
            });
            break;
          }
          const added = await state.studio.addLayer();
          if (!added.ok) {
            showFlashNeeded("layer", job.name, {
              line:
                added.reason === "no-space"
                  ? "This keyboard has no free layer slot — download the keymap and flash to add more."
                  : `Live add failed (${added.reason}) — download the keymap and flash.`,
            });
            break;
          }
          await state.studio.setLayerProps(added.layerId, job.name);
          await state.studio.save();
          renderLayers();
          updateFlashBanner();
          setStatus(`${job.name} added live and written to the board.`);
          break;
        }
        case "rename": {
          const result = await state.studio.setLayerProps(job.studioLayerId, job.name);
          if (!result.ok) {
            setStatus(`On-board rename failed: ${result.reason}.`);
            break;
          }
          await state.studio.save();
          setStatus(`Renamed live: ${job.name}.`);
          break;
        }
        case "move": {
          const result = await state.studio.moveLayer(job.studioFrom, job.studioTo);
          if (!result.ok) {
            setStatus(
              `On-board move failed (${result.reason}) — editor and device order now differ; download and flash to resync.`
            );
            break;
          }
          await state.studio.save();
          renderLayers();
          updateFlashBanner();
          setStatus(`Moved ${job.name} live.`);
          break;
        }
        case "remove": {
          const result = await state.studio.removeLayer(job.studioIdx);
          if (!result.ok) {
            showFlashNeeded("layer-delete", job.name, {
              line: `Live remove failed (${result.reason}) — download the keymap and flash.`,
            });
            break;
          }
          await state.studio.save();
          renderLayers();
          updateFlashBanner();
          setStatus(`${job.name} removed live and written to the board.`);
          break;
        }
      }
    } catch (err) {
      setStatus(err.message);
    }
  }
  layerLiveBusy = false;
}

function stopRuntimeIdleWatch() {
  if (runtimeIdleWatch) {
    clearInterval(runtimeIdleWatch);
    runtimeIdleWatch = 0;
  }
}

function startRuntimeIdleWatch(expectedGeneration) {
  stopRuntimeIdleWatch();
  const wanted = Number(expectedGeneration) || 0;
  if (!wanted) return;
  const started = Date.now();
  runtimeIdleWatch = setInterval(async () => {
    if (!state.studio || !state.runtime) {
      stopRuntimeIdleWatch();
      return;
    }
    if (Date.now() - started > 60000) {
      stopRuntimeIdleWatch();
      setStatus(
        "Running Configuration is saved on the keyboard. If the sidebar still says waiting for idle, lift all keys or Disconnect and Connect again."
      );
      return;
    }
    try {
      const status = await state.studio.getRuntimeConfigStatus({ timeoutMs: 2000 });
      state.runtime.status = status;
      const active = Number(status.activeGeneration || 0);
      const pending = Number(status.pendingGeneration || 0);
      if (active >= wanted && (!pending || pending === active)) {
        stopRuntimeIdleWatch();
        const live = await state.studio.getRuntimeConfig({ timeoutMs: 8000 });
        if (live?.status) state.runtime.status = live.status;
        if (live?.snapshot) {
          state.runtime.snapshot = createRuntimeDraft(live.snapshot);
          state.runtime.draft = createRuntimeDraft(live.snapshot);
        }
        setStudioLabel("Connected · Running Configuration active", "on");
        paintRuntimeOverlayOnEditor(state.runtime.snapshot);
        renderKeyboard();
        renderCombinations();
        setStatus(`Running Configuration generation ${active} is now active.`);
        return;
      }
      renderRuntimeChrome();
    } catch {
      // USB may be briefly busy; keep the saved overlay until the next poll.
    }
  }, 1500);
}

function setStatus(msg) {
  $("status").textContent = msg;
}

function fileDiffCount() {
  let n = 0;
  for (const layer of state.layers) {
    for (const b of layer.bindings || []) {
      if (b.start == null || b.end == null || b.text !== state.original.slice(b.start, b.end)) n++;
    }
  }
  return n;
}

function sourceStatusText() {
  const extra = extraEditorLayers();
  const extraNote = extra.length ? ` · ${extra.join(", ")} not on board` : "";
  if (state.source === "keyboard") {
    return `Showing: Keyboard${extraNote}`;
  }
  if (state.source === "github") {
    return `Showing: GitHub · ${state.sourceLabel || "repository"}`;
  }
  return `Showing: File · ${state.sourceLabel || state.keymapPath || "keymap"}`;
}

function updateChrome() {
  const bar = $("source-status");
  const barText = $("source-status-text");
  if (bar) bar.dataset.source = state.source || "file";
  if (barText) barText.textContent = sourceStatusText();
  const apply = $("studio-apply");
  if (apply) apply.disabled = !state.studio;
}

function setSync(next) {
  state.sync = next;
  const el = $("sync-state");
  if (el) {
    const text =
      next === "unsaved-and-live"
        ? "Unsaved changes on keyboard."
        : next === "unsaved"
          ? "Unsaved changes in editor"
          : "All changes saved";
    el.textContent = text;
    el.dataset.sync = next === "unsaved-and-live" ? "unsaved-and-live" : next;
  }
  updateChrome();
}

function setDirty(d) {
  state.dirty = d;
  if (d) setSync("unsaved");
  else setSync("saved");
  updateStudioButtons();
}

function setStudioLabel(text, kind = "") {
  const banner = $("runtime-banner");
  const conn = $("runtime-banner-conn");
  if (banner && conn) {
    banner.hidden = !state.studio;
    banner.className = `runtime-banner ${kind}`.trim();
    conn.textContent = text;
  }
}

function updateStudioButtons() {
  const on = !!state.studio;
  $("studio-apply").disabled = !on;
  const hint = $("live-hint");
  if (hint) {
    hint.innerHTML = state.runtime
      ? "<strong>Combinations</strong> still use trigger keys on the layout and an output from the palette. Advanced is for mod-morphs, tap-dances, and extra timing. Apply saves one snapshot; it activates when the keyboard is idle."
      : "<strong>Live Apply</strong> works for existing bindings only. New macros, combos, layers, behaviors, and core mouse move/scroll bindings require Download → flash.";
  }
}

function updateHistoryButtons() {
  const undo = $("undo");
  const redo = $("redo");
  if (!undo || !redo) return;
  const u = state.history.peekUndo();
  const r = state.history.peekRedo();
  undo.disabled = !u;
  redo.disabled = !r;
  undo.title = u ? `Undo ${u.description}` : "Undo";
  redo.title = r ? `Redo ${r.description}` : "Redo";
}

function currentBindings() {
  return state.layers[state.layer]?.bindings ?? [];
}

function currentProtection(index) {
  return protectionFor(index, state.layer, state.combos);
}

function currentActivators() {
  return findLayerActivators(state.layers, state.layer);
}

function confirmProtected(index, action) {
  const why = currentProtection(index);
  if (!why) return true;
  return window.confirm(`Position ${index} is a combo / recovery key (${why}).\n${action} anyway?`);
}

function selectOnly(index) {
  state.selected.clear();
  if (index != null) state.selected.add(index);
  renderKeyboard();
  renderBehaviors();
  renderMacros();
  renderCombos();
  renderInspect();
}

function selectLayer(i) {
  if (i < 0 || i >= state.layers.length) return;
  state.layer = i;
  state.layerMenu = null;
  updateLayerOfflineBanner();
  renderLayers();
  if (state.behaviorDraft) updateBehaviorView();
  renderKeyboard();
  renderBehaviors();
  renderMacros();
  renderCombos();
  renderInspect();
}

function afterLayerChange() {
  setDirty(true);
  renderLayers();
  renderPalette();
  renderKeyboard();
  renderBehaviors();
  renderMacros();
  renderCombos();
  renderInspect();
}

const layerHost = {
  insertLayer(at, layer) {
    applyLayerIndexMap(state.layers, state.combos, indexMapAfterInsert(state.layers.length, at));
    state.layers.splice(at, 0, layer);
    state.layer = at;
  },
  removeLayerAt(at) {
    applyLayerIndexMap(state.layers, state.combos, indexMapAfterDelete(state.layers.length, at));
    state.layers.splice(at, 1);
    if (state.layer >= state.layers.length) state.layer = state.layers.length - 1;
    else if (state.layer > at) state.layer -= 1;
  },
  reorderLayer(from, to) {
    applyLayerIndexMap(state.layers, state.combos, indexMapAfterReorder(from, to, state.layers.length));
    const [item] = state.layers.splice(from, 1);
    state.layers.splice(to, 0, item);
    state.layer = to;
  },
  renameLayerId(index, fromId, toId) {
    const fromTok = layerToken(fromId);
    const toTok = layerToken(toId);
    for (const l of state.layers) {
      for (const b of l.bindings) b.text = rewriteLayerToken(b.text, fromTok, toTok);
    }
    if (state.layers[index]) state.layers[index].id = toId;
  },
  neutralizeToken(token) {
    neutralizeLayerToken(state.layers, token);
  },
  restoreBindings(changes) {
    for (const c of changes || []) {
      const b = state.layers[c.layer]?.bindings[c.index];
      if (b) b.text = c.before;
    }
  },
  restoreCombos(rows) {
    for (const row of rows || []) {
      const live = state.combos.find((c) => c.id === row.id);
      if (!live) continue;
      live.layers = Array.isArray(row.layers) ? [...row.layers] : row.layers;
      live.edited = row.edited;
      live.deleted = row.deleted;
    }
  },
};

function runHistory(cmd, after) {
  state.history.execute(cmd);
  updateHistoryButtons();
  if (after) after();
  return cmd;
}

function createLayer(after = state.layers.length - 1) {
  const id = nextLayerId(state.layers);
  const at = Math.min(after + 1, state.layers.length);
  runHistory(
    new CreateLayerCommand(layerHost, {
      at,
      id,
      bindings: emptyLayerBindings(keyCount()),
      description: `Add ${displayLayerName(id)}`,
    }),
    () => {
      state.layerRename = at;
      afterLayerChange();
      if (state.studio) queueLiveLayerOp({ kind: "add", name: displayLayerName(id) });
      else showFlashNeeded("layer", displayLayerName(id));
    }
  );
}

function duplicateLayer(index) {
  const src = state.layers[index];
  if (!src) return;
  const id = nextLayerId(state.layers);
  const at = index + 1;
  runHistory(
    new DuplicateLayerCommand(layerHost, {
      from: index,
      at,
      id,
      texts: src.bindings.map((b) => b.text),
      description: `Duplicate ${displayLayerName(src.id)}`,
    }),
    () => {
      state.layerRename = at;
      afterLayerChange();
      showFlashNeeded("layer", displayLayerName(id));
    }
  );
}

function renameLayer(index, raw) {
  const layer = state.layers[index];
  if (!layer) return;
  let slug = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_|_$/g, "");
  if (!slug) {
    setStatus("Layer needs a name.");
    return;
  }
  if (!/^[a-z]/.test(slug)) slug = `layer_${slug}`;
  const id = slug.endsWith("_layer") || /^layer_\d+$/.test(slug) ? slug : `${slug}_layer`;
  if (state.layers.some((l, i) => i !== index && l.id === id)) {
    setStatus(`${id} already exists.`);
    return;
  }
  if (id === layer.id) {
    state.layerRename = null;
    renderLayers();
    return;
  }
  const fromId = layer.id;
  const studioIdx = studioLayerIndex(index);
  const studioLayerId = studioIdx != null ? state.studio.layers[studioIdx].id : null;
  runHistory(
    new RenameLayerCommand(layerHost, {
      index,
      fromId,
      toId: id,
      description: `Rename ${displayLayerName(fromId)}`,
    }),
    () => {
      state.layerRename = null;
      afterLayerChange();
      if (state.studio && studioLayerId != null) {
        queueLiveLayerOp({ kind: "rename", studioLayerId, name: displayLayerName(id) });
      } else {
        setStatus(`Renamed to ${displayLayerName(id)}.`);
      }
    }
  );
}

function deleteLayer(index) {
  if (state.layers.length <= 1) {
    setStatus("Need at least one layer.");
    return;
  }
  const layer = state.layers[index];
  const name = displayLayerName(layer.id);
  const token = layerToken(layer.id);
  const uses = countLayerTokenUses(
    state.layers.filter((_, i) => i !== index),
    token
  );
  const extra = uses ? `\n${uses} key(s) point at this layer and will become &trans.` : "";
  if (!window.confirm(`Delete layer ${name} (${index})?${extra}`)) return;
  const neutralized = [];
  state.layers.forEach((l, li) => {
    l.bindings.forEach((b, ki) => {
      const parts = String(b.text || "").trim().split(/\s+/);
      if (li === index) return;
      if ((parts[0] === "&lt" || parts[0] === "&mo" || parts[0] === "&to" || parts[0] === "&tog") && parts[1] === token) {
        neutralized.push({ layer: li, index: ki, before: b.text });
      }
    });
  });
  const saved = {
    token,
    layer: {
      id: layer.id,
      added: !!layer.added,
      start: layer.start,
      end: layer.end,
      bindings: layer.bindings.map((b) => ({ ...b })),
    },
  };
  const combos = state.combos.map((c) => ({
    id: c.id,
    layers: Array.isArray(c.layers) ? [...c.layers] : c.layers,
    edited: c.edited,
    deleted: c.deleted,
  }));
  const studioIdx = studioLayerIndex(index);
  runHistory(
    new DeleteLayerCommand(layerHost, {
      index,
      saved,
      neutralized,
      combos,
      description: `Delete ${name}`,
    }),
    () => {
      afterLayerChange();
      if (state.studio && studioIdx === 0) {
        showFlashNeeded("layer-delete", name, {
          line: "The board's default layer can't be removed live. Download the keymap and flash to remove it.",
        });
      } else if (state.studio && studioIdx != null) {
        queueLiveLayerOp({ kind: "remove", studioIdx, name });
      } else {
        showFlashNeeded("layer-delete", name);
      }
    }
  );
}

function reorderLayer(from, to) {
  if (from === to || from < 0 || to < 0 || from >= state.layers.length || to >= state.layers.length) return;
  const name = displayLayerName(state.layers[from].id);
  const studioFrom = studioLayerIndex(from);
  const studioTo = studioLayerIndex(to);
  runHistory(
    new ReorderLayerCommand(layerHost, { from, to, description: `Reorder ${name}` }),
    () => {
      afterLayerChange();
      if (state.studio && studioFrom != null && studioTo != null && studioFrom !== studioTo) {
        queueLiveLayerOp({ kind: "move", studioFrom, studioTo, name });
      } else {
        setStatus(`Moved ${name} to index ${to}.`);
      }
    }
  );
}

function renderLayers() {
  updateLayerOfflineBanner();
  const wrap = $("layers");
  wrap.replaceChildren();
  state.layers.forEach((layer, i) => {
    const tab = document.createElement("div");
    tab.className = `layer-tab${i === state.layer ? " active" : ""}`;
    tab.dataset.index = String(i);
    if (state.layerRename === i) {
      const inp = document.createElement("input");
      inp.className = "layer-rename";
      inp.value = displayLayerName(layer.id);
      inp.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          renameLayer(i, inp.value);
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          state.layerRename = null;
          renderLayers();
        }
      });
      inp.addEventListener("blur", () => {
        if (state.layerRename === i) renameLayer(i, inp.value);
      });
      tab.appendChild(inp);
      wrap.appendChild(tab);
      queueMicrotask(() => {
        inp.focus();
        inp.select();
      });
      return;
    }
    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = displayLayerName(layer.id);
    const idx = document.createElement("span");
    idx.className = "layer-idx";
    idx.textContent = String(i);
    tab.append(name, idx);
    if (state.studio && !layerOnDevice(i)) {
      const off = document.createElement("span");
      off.className = "layer-off-board";
      off.title = "Not in this firmware. Download the keymap and flash to add it.";
      off.textContent = "not on board";
      tab.appendChild(off);
    }
    if (i === state.layer) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "layer-more";
      more.textContent = "⋯";
      more.setAttribute("aria-label", "Layer menu");
      more.addEventListener("click", (ev) => {
        ev.stopPropagation();
        state.layerMenu = state.layerMenu === i ? null : i;
        renderLayers();
      });
      tab.appendChild(more);
    }
    tab.addEventListener("dblclick", (ev) => {
      ev.preventDefault();
      state.layerRename = i;
      renderLayers();
    });
    tab.addEventListener("pointerdown", (ev) => startLayerDrag(ev, i));
    wrap.appendChild(tab);
    if (state.layerMenu === i) {
      const menu = document.createElement("div");
      menu.className = "layer-menu";
      menu.addEventListener("click", (ev) => ev.stopPropagation());
      const mk = (label, fn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          state.layerMenu = null;
          fn();
        });
        return b;
      };
      menu.append(
        mk("Rename", () => {
          state.layerRename = i;
          renderLayers();
        }),
        mk("Duplicate", () => duplicateLayer(i)),
        mk("Delete", () => deleteLayer(i))
      );
      tab.appendChild(menu);
    }
  });
  const add = document.createElement("button");
  add.type = "button";
  add.className = "layer-add";
  add.textContent = "+";
  add.title = "New layer (⌘⇧N)";
  add.addEventListener("click", () => createLayer(state.layers.length - 1));
  wrap.appendChild(add);
}

function startLayerDrag(ev, index) {
  if (ev.target.closest(".layer-more, .layer-menu, .layer-rename")) return;
  if (ev.button != null && ev.button !== 0) return;
  ev.preventDefault();
  const startX = ev.clientX;
  const startY = ev.clientY;
  let dragging = false;
  const onMove = (e) => {
    if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < 6) return;
    dragging = true;
    document.querySelectorAll(".layer-tab").forEach((el) => {
      const i = Number(el.dataset.index);
      el.classList.toggle("dragging", i === index);
    });
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".layer-tab");
    document.querySelectorAll(".layer-tab").forEach((el) => el.classList.remove("drop-before", "drop-after"));
    if (over && over.dataset.index != null && Number(over.dataset.index) !== index) {
      const rect = over.getBoundingClientRect();
      over.classList.add(e.clientX < rect.left + rect.width / 2 ? "drop-before" : "drop-after");
    }
  };
  const onUp = (e) => {
    window.removeEventListener("pointermove", onMove);
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".layer-tab");
    document.querySelectorAll(".layer-tab").forEach((el) => el.classList.remove("dragging", "drop-before", "drop-after"));
    if (dragging && over?.dataset.index != null) {
      let to = Number(over.dataset.index);
      const rect = over.getBoundingClientRect();
      if (e.clientX >= rect.left + rect.width / 2 && to < index) to += 1;
      if (e.clientX < rect.left + rect.width / 2 && to > index) to -= 1;
      if (to !== index) reorderLayer(index, to);
      else selectLayer(index);
    } else if (!dragging) {
      selectLayer(index);
    }
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp, { once: true });
}

function inspectContext() {
  return {
    macros: state.macros,
    behaviors: state.behaviors,
    defaultLayer: layerNameOf(state.layer),
    homeRowBehaviors: state.profile?.homeRowBehaviors || [],
  };
}

function keyCount() {
  return state.profile?.keyCount || state.keys.length || 0;
}

function layerNameOf(index) {
  return (state.layers[index]?.id || "").replace(/_layer$/, "").toUpperCase() || "BASE";
}

function inspectBehaviorChoices() {
  const groups = [
    [
      "Key",
      [
        ["kp", "Key press"],
        ["sk", "Sticky key"],
        ["trans", "Transparent"],
        ["none", "None"],
      ],
    ],
    [
      "Layer",
      [
        ["lt", "Layer-tap"],
        ["mo", "Momentary"],
        ["to", "To layer"],
        ["tog", "Toggle layer"],
      ],
    ],
    [
      "Hold-tap",
      state.behaviors.filter((b) => !b.deleted && b.kind === "hold-tap").map((b) => [b.id, `&${b.id}`]),
    ],
    [
      "Runtime objects",
      (state.runtime?.draft?.runtimeObjects || []).map((object) => [
        `rt:${object.id}`,
        `${runtimeObjectShortLabel(object)} · &rt ${object.id}`,
      ]),
    ],
    ["Macros", state.macros.filter((m) => !m.deleted).map((m) => [m.id, `&${m.id}`])],
    [
      "Mouse",
      [
        ["mmv", "Mouse move"],
        ["msc", "Scroll"],
        ["mkp", "Click"],
      ],
    ],
    [
      "System",
      [
        ["bt", "Bluetooth"],
        ["sys_reset", "Soft reset"],
        ...state.behaviors
          .filter((b) => !b.deleted && b.kind !== "hold-tap")
          .map((b) => [b.id, `&${b.id}`]),
      ],
    ],
  ];
  return groups.filter(([, items]) => items.length);
}

function fillSelect(sel, items, value) {
  sel.replaceChildren();
  for (const [id, label] of items) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label;
    if (id === value) opt.selected = true;
    sel.appendChild(opt);
  }
  if (value && !items.some(([id]) => id === value)) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = `&${value}`;
    opt.selected = true;
    sel.appendChild(opt);
  }
}

function keycodeList() {
  const seen = new Set();
  const out = [];
  for (const item of PALETTE) {
    const code = keycodeFromBinding(item.binding);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

function renderLegend() {
  const el = $("color-legend");
  if (!el) return;
  el.classList.toggle("compact", state.selected.size > 0);
}

function renderInspect(force = false) {
  renderLegend();
  const el = $("inspect");
  if (!el) return;
  const activators = currentActivators();
  const holdNote = activators
    .map((a) => `Hold P${a.index} (${a.text}) to open this layer.`)
    .join(" ");

  if (state.selected.size === 0) {
    el.dataset.view = "";
    el.innerHTML = `
      <div class="inspect-empty">Click a key to edit it. Click it again or click empty space to deselect. Drag to <strong>move</strong>, Alt-drag to <strong>swap</strong>, ⌘/Ctrl-drag to <strong>copy</strong>. Drag off the board to clear.${state.studio ? " Connected: supported edits go to the board immediately." : ""}</div>
      ${holdNote ? `<div>${holdNote}</div>` : ""}
    `;
    return;
  }

  const idx = [...state.selected][0];
  const text = currentBindings()[idx]?.text ?? "&trans";
  const model = parseBinding(text);
  const view = `${state.layer}:${[...state.selected].join(",")}:${model.behavior}`;
  if (!force && el.dataset.view === view && el.contains(document.activeElement)) {
    const raw = $("inspect-raw");
    if (raw) raw.textContent = text;
    const pretty = $("inspect-pretty");
    if (pretty) pretty.textContent = bindingLabel(text);
    const liveValue = $("inspect-override-live");
    if (liveValue) liveValue.textContent = text;
    const editValue = $("inspect-edit-current");
    if (editValue) editValue.textContent = text;
    return;
  }
  el.dataset.view = view;

  const kind = classifyBinding(model, inspectContext());
  const prot = currentProtection(idx);
  const act = activators.find((a) => a.index === idx);
  const layerLabel = (state.layers[state.layer]?.id || "").replace(/_layer$/, "");
  const combosHere = state.combos.filter(
    (c) => !c.deleted && c.positions.includes(idx) && comboActiveOnLayer(c, state.layer)
  );

  el.replaceChildren();
  const form = document.createElement("form");
  form.id = "inspect-form";
  form.addEventListener("submit", (ev) => ev.preventDefault());

  const head = document.createElement("div");
  head.className = "inspect-head";
  const left = document.createElement("div");
  left.innerHTML = `<span class="inspect-pos">P${idx}</span><span class="inspect-layer">${layerLabel}</span><span class="inspect-pretty" id="inspect-pretty">${prettyBindingLabel(text)}</span>${state.selected.size > 1 ? ` <span class="inspect-layer">+${state.selected.size - 1}</span>` : ""}`;
  const raw = document.createElement("code");
  raw.id = "inspect-raw";
  raw.className = "inspect-raw";
  raw.textContent = text;
  head.append(left, raw);
  form.appendChild(head);

  const override = overriddenPositionsOnCurrentLayer().get(idx);
  if (override) {
    const box = document.createElement("div");
    box.className = "inspect-override";
    box.innerHTML = `
      <div class="inspect-override-row">
        <span class="inspect-override-label">Firmware</span>
        <code class="inspect-override-value">${override.firmwareText}</code>
      </div>
      <div class="inspect-override-row live">
        <span class="inspect-override-label">Running Configuration · live</span>
        <code id="inspect-override-live" class="inspect-override-value">${override.liveText}</code>
      </div>
    `;
    form.appendChild(box);
  }

  const edit = locallyEditedPositionsOnCurrentLayer().get(idx);
  if (edit) {
    const box = document.createElement("div");
    box.className = "inspect-override";
    box.innerHTML = `
      <div class="inspect-override-row">
        <span class="inspect-override-label">Loaded</span>
        <code class="inspect-override-value">${edit.loadedText}</code>
      </div>
      <div class="inspect-override-row edited">
        <span class="inspect-override-label">Current · edited</span>
        <code id="inspect-edit-current" class="inspect-override-value">${edit.currentText}</code>
      </div>
    `;
    form.appendChild(box);
  }

  const row = document.createElement("div");
  row.className = "inspect-fields";

  const behField = document.createElement("label");
  behField.className = "field field-wide";
  behField.innerHTML = "<span>Behavior</span>";
  const beh = document.createElement("select");
  beh.id = "inspect-behavior";
  for (const [group, items] of inspectBehaviorChoices()) {
    const og = document.createElement("optgroup");
    og.label = group;
    for (const [id, label] of items) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = label;
      if (id === inspectBehaviorValue(model)) opt.selected = true;
      og.appendChild(opt);
    }
    beh.appendChild(og);
  }
  if (![...beh.options].some((o) => o.value === inspectBehaviorValue(model))) {
    const opt = document.createElement("option");
    opt.value = inspectBehaviorValue(model);
    opt.textContent = `&${model.behavior}${model.behavior === "rt" ? ` ${model.args?.[0] || model.key || ""}` : ""}`;
    opt.selected = true;
    beh.appendChild(opt);
  }
  beh.addEventListener("change", onInspectBehaviorChange);
  behField.appendChild(beh);
  row.appendChild(behField);

  const showLayer = kind === "layer" || kind === "layer-tap";
  const showHold = kind === "hold-tap";
  const showBt = kind === "bt";
  const showMouse = kind === "mouse";
  const showKey = kind === "keypress" || kind === "layer-tap" || kind === "hold-tap" || kind === "sticky";
  const showMods = showKey;

  if (showLayer) {
    const f = document.createElement("label");
    f.className = "field";
    f.innerHTML = "<span>Layer</span>";
    const sel = document.createElement("select");
    sel.id = "inspect-layer";
    fillSelect(
      sel,
      state.layers.map((l, i) => [layerNameOf(i), (l.id || "").replace(/_layer$/, "")]),
      model.layer
    );
    sel.addEventListener("change", commitInspect);
    f.appendChild(sel);
    row.appendChild(f);
  }

  if (showHold) {
    const f = document.createElement("label");
    f.className = "field";
    f.innerHTML = "<span>Hold</span>";
    const sel = document.createElement("select");
    sel.id = "inspect-hold";
    fillSelect(sel, holdMods(), model.hold);
    sel.addEventListener("change", commitInspect);
    f.appendChild(sel);
    row.appendChild(f);
  }

  if (showBt) {
    const f = document.createElement("label");
    f.className = "field";
    f.innerHTML = "<span>Command</span>";
    const sel = document.createElement("select");
    sel.id = "inspect-bt-cmd";
    fillSelect(
      sel,
      BT_COMMANDS.map((c) => [c, c]),
      model.btCmd
    );
    sel.addEventListener("change", () => {
      commitInspect();
      renderInspect(true);
    });
    f.appendChild(sel);
    row.appendChild(f);
    if (model.btCmd === "BT_SEL" || model.btCmd === "BT_DISC") {
      const p = document.createElement("label");
      p.className = "field";
      p.innerHTML = "<span>Profile</span>";
      const num = document.createElement("input");
      num.id = "inspect-bt-profile";
      num.type = "number";
      num.min = "0";
      num.max = "4";
      num.value = model.btProfile || "0";
      num.addEventListener("input", commitInspect);
      p.appendChild(num);
      row.appendChild(p);
    }
  }

  if (showMouse) {
    const f = document.createElement("label");
    f.className = "field";
    f.innerHTML = "<span>Param</span>";
    const sel = document.createElement("select");
    sel.id = "inspect-key";
    const allowed = (MOUSE_PARAMS[model.behavior] || []).map((c) => [c, c]);
    fillSelect(sel, allowed, model.key);
    sel.addEventListener("change", commitInspect);
    f.appendChild(sel);
    row.appendChild(f);
  } else if (showKey) {
    const f = document.createElement("label");
    f.className = "field";
    f.innerHTML = `<span>${kind === "layer-tap" || kind === "hold-tap" ? "Tap" : "Key"}</span>`;
    if (kind === "sticky") {
      const sel = document.createElement("select");
      sel.id = "inspect-key";
      fillSelect(sel, holdMods(), model.key);
      sel.addEventListener("change", commitInspect);
      f.appendChild(sel);
    } else {
      const inp = document.createElement("input");
      inp.id = "inspect-key";
      inp.type = "text";
      inp.setAttribute("list", "inspect-codes");
      inp.autocomplete = "off";
      inp.spellcheck = false;
      inp.dataset.inspect = "key";
      inp.value = model.key;
      inp.placeholder = "Q";
      inp.addEventListener("input", commitInspect);
      const list = document.createElement("datalist");
      list.id = "inspect-codes";
      for (const code of keycodeList()) {
        const opt = document.createElement("option");
        opt.value = code;
        list.appendChild(opt);
      }
      f.append(inp, list);
    }
    row.appendChild(f);
  }

  if (kind === "raw") {
    const f = document.createElement("label");
    f.className = "field field-wide";
    f.innerHTML = "<span>Binding</span>";
    const inp = document.createElement("input");
    inp.id = "inspect-raw-edit";
    inp.type = "text";
    inp.value = text;
    inp.addEventListener("change", () => {
      for (const i of state.selected) assignBinding(i, inp.value.trim(), { quiet: true, skipInspect: true });
      renderInspect(true);
    });
    f.appendChild(inp);
    row.appendChild(f);
  }

  form.appendChild(row);

  if (showMods) {
    const mods = document.createElement("div");
    mods.id = "inspect-mods";
    mods.className = "inspect-mods";
    for (const [id, label] of inspectMods()) {
      const lab = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = id;
      box.checked = model.mods.includes(id);
      box.addEventListener("change", commitInspect);
      lab.append(box, document.createTextNode(` ${label}`));
      mods.appendChild(lab);
    }
    form.appendChild(mods);
  }

  const actions = document.createElement("div");
  actions.className = "inspect-actions";
  const macro = state.macros.find((m) => !m.deleted && m.id === model.behavior);
  const behavior = state.behaviors.find((b) => !b.deleted && b.id === model.behavior);
  if (macro) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `Edit &${macro.id}`;
    btn.addEventListener("click", () => openMacroEditor(macro));
    actions.appendChild(btn);
  }
  if (behavior) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `Edit &${behavior.id}`;
    btn.addEventListener("click", () => openBehaviorEditor(behavior));
    actions.appendChild(btn);
  }
  const runtimeId = parseRuntimeObjectId(text);
  const runtimeObject = runtimeId ? findRuntimeObject(state.runtime?.draft, runtimeId) : null;
  if (runtimeObject) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `Edit ${runtimeObjectShortLabel(runtimeObject)}`;
    btn.addEventListener("click", () => openRuntimeEditor({ type: runtimeObject.type, object: runtimeObject }));
    actions.appendChild(btn);
  }
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = "Clear";
  clear.addEventListener("click", () => {
    applyBindingSets(
      [...state.selected].map((i) => ({ index: i, text: emptyBinding() })),
      "Clear"
    );
  });
  actions.appendChild(clear);
  form.appendChild(actions);

  if (kind === "layer-tap" && model.layer) {
    const note = document.createElement("div");
    note.className = "field-hint";
    note.textContent = `Hold opens ${model.layer}; tap sends ${model.key || "—"}.`;
    form.appendChild(note);
  } else if (kind === "layer" && model.layer) {
    const note = document.createElement("div");
    note.className = "field-hint";
    const verb = model.behavior === "mo" ? "Hold for" : model.behavior === "to" ? "Switch to" : "Toggle";
    note.textContent = `${verb} ${model.layer}.`;
    form.appendChild(note);
  } else if (act) {
    const note = document.createElement("div");
    note.className = "field-hint";
    note.textContent = `On another layer this position is ${act.text}, which opens ${layerLabel}.`;
    form.appendChild(note);
  }
  if (combosHere.length) {
    const note = document.createElement("div");
    note.className = "field-hint";
    note.textContent = `Combos: ${combosHere.map((c) => `${comboTitle(c)} → ${bindingLabel(c.binding)}`).join(" · ")}`;
    form.appendChild(note);
  }
  if (prot) {
    const warn = document.createElement("div");
    warn.className = "warn";
    warn.textContent = `Combo / recovery: ${prot}. Changing this key can break that combo.`;
    form.appendChild(warn);
  }
  const runtimeKeyIssues = (state.runtimeIssues || []).filter(
    (issue) => issue.kind === "key" && (issue.selectedIndex === idx || issue.text === text)
  );
  const runtimeObjectId = parseRuntimeObjectId(text);
  const runtimeObjectIssues = runtimeObjectId
    ? (state.runtimeIssues || []).filter((issue) => issue.kind === "object" && issue.id === runtimeObjectId)
    : [];
  for (const issue of [...runtimeKeyIssues, ...runtimeObjectIssues]) {
    const warn = document.createElement("div");
    warn.className = "warn";
    warn.textContent = issue.fieldPath ? `${issue.message} (${issue.fieldPath})` : issue.message;
    form.appendChild(warn);
  }

  el.appendChild(form);
}

function onInspectBehaviorChange() {
  const idx = [...state.selected][0];
  if (idx == null) return;
  const nextBehavior = $("inspect-behavior").value;
  if (nextBehavior.startsWith("rt:")) {
    const text = runtimeBindingText(nextBehavior.slice(3));
    for (const i of state.selected) assignBinding(i, text, { quiet: true, skipInspect: true });
    renderInspect(true);
    return;
  }
  const next = convertBinding(parseBinding(currentBindings()[idx]?.text || "&trans"), nextBehavior, inspectContext());
  for (const i of state.selected) assignBinding(i, next, { quiet: true, skipInspect: true });
  renderInspect(true);
}

function readInspectForm() {
  const idx = [...state.selected][0];
  const model = parseBinding(currentBindings()[idx]?.text || "&trans");
  const beh = $("inspect-behavior")?.value;
  if (beh) model.behavior = beh;
  if ($("inspect-layer")) model.layer = $("inspect-layer").value;
  if ($("inspect-key")) model.key = $("inspect-key").value.trim();
  if ($("inspect-hold")) model.hold = $("inspect-hold").value;
  if ($("inspect-bt-cmd")) model.btCmd = $("inspect-bt-cmd").value;
  if ($("inspect-bt-profile")) model.btProfile = $("inspect-bt-profile").value;
  const boxes = document.querySelectorAll("#inspect-mods input[type=checkbox]");
  if (boxes.length) model.mods = [...boxes].filter((el) => el.checked).map((el) => el.value);
  return model;
}

function commitInspect() {
  if (!state.selected.size) return;
  const model = readInspectForm();
  const kind = classifyBinding(model, inspectContext());
  if ((kind === "keypress" || kind === "layer-tap" || kind === "hold-tap") && !model.key) return;
  const text = formatBinding(model);
  applyBindingSets(
    [...state.selected].map((i) => ({ index: i, text })),
    `P${[...state.selected][0]} → ${text}`,
    { quiet: true, skipInspect: true, silent: true, noUndo: true }
  );
  const raw = $("inspect-raw");
  if (raw) raw.textContent = text;
  const pretty = $("inspect-pretty");
  if (pretty) pretty.textContent = bindingLabel(text);
  setStatus(`P${[...state.selected][0]} → ${text}`);
}

function fillInspectKey(text) {
  const key = keycodeFromBinding(text);
  const field = $("inspect-key");
  if (!field || !key) return false;
  field.value = key;
  commitInspect();
  return true;
}

function bindBoardDeselect() {
  const wrap = document.querySelector(".kb-wrap");
  if (!wrap) return;
  wrap.addEventListener("pointerdown", (ev) => {
    if (state.comboDraft || state.behaviorDraft || state.macroDraft || state.combinationDraft || state.runtimeEditor) return;
    if (ev.button != null && ev.button !== 0) return;
    if (keyIndexFromPoint(ev.clientX, ev.clientY) != null) return;
    state.bgClick = { x: ev.clientX, y: ev.clientY };
  });
  wrap.addEventListener("pointerup", (ev) => {
    const bg = state.bgClick;
    state.bgClick = null;
    if (!bg || state.drag) return;
    if (Math.hypot(ev.clientX - bg.x, ev.clientY - bg.y) >= 6) return;
    if (keyIndexFromPoint(ev.clientX, ev.clientY) != null) return;
    clearTransientUi();
    if (state.selected.size) selectOnly(null);
  });
}

function setEditingMode() {
  const on = !!(state.comboDraft || state.behaviorDraft || state.macroDraft || state.combinationDraft || state.runtimeEditor);
  const board = document.querySelector(".board");
  board?.classList.toggle("editing", on);
  board?.classList.toggle("click-palette", paletteIsClickToAdd());
  $("session")?.classList.toggle("editing", on);
  renderPalette();
}

/**
 * Position -> letter(s) of the combo(s) it's a trigger for, so keys that
 * pair together on the board can share a badge. Scoped to combos only —
 * hold-taps, macros, and other behaviors are single-key, so there's no
 * pairing for a badge to show. A key can belong to more than one active
 * combo at once, hence an array of letters per position.
 */
function comboBadgeLettersByPosition() {
  const map = new Map();
  let next = 0;
  const nextLetter = () => {
    let n = ++next;
    let s = "";
    while (n > 0) {
      n--;
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26);
    }
    return s;
  };
  const addPositions = (positions, letter) => {
    for (const pos of positions) {
      if (!map.has(pos)) map.set(pos, []);
      map.get(pos).push(letter);
    }
  };
  for (const c of state.combos) {
    if (c.deleted || !comboActiveOnLayer(c, state.layer)) continue;
    addPositions(c.positions, nextLetter());
  }
  for (const c of state.runtime?.draft?.combos || []) {
    if (!runtimeComboActiveOnLayer(c, state.layer)) continue;
    addPositions(stockPositionsToSelectedIndexes(state.runtime.capabilities, c.keyPositions), nextLetter());
  }
  return map;
}

// Positions on the current layer where the *device's own saved snapshot* has
// a keymap_overrides entry - a plain per-key diff, not combos/macros (those
// have their own distinct markers: the badge above, and none yet for runtime
// objects). Deliberately reads the override straight from
// `state.runtime.snapshot` and decodes its own text via
// `bindingTextFromAction` (mirroring `paintRuntimeOverlayOnEditor`), instead
// of comparing against `currentBindings()` - the editor can be showing a
// file/GitHub source unrelated to the device's actual firmware while still
// connected, and comparing against *that* produced false positives (and,
// gating the whole thing on `state.source === "keyboard"` to avoid those,
// false *negatives*: real device overrides stayed invisible while viewing
// any other source, even though the banner up top was already reporting
// them). This version only asks "does the connected device have an override
// here", which doesn't depend on what's currently being viewed at all.
function overriddenPositionsOnCurrentLayer() {
  const map = new Map();
  const overrides = state.runtime?.snapshot?.keymapOverrides;
  if (!state.studio || !overrides?.length) return map;
  const studioIdx = studioLayerIndex(state.layer);
  const studioLayer = studioIdx == null ? null : state.studio.layers?.[studioIdx];
  const firmware = studioLayer ? state.stockBindingTexts?.get(studioLayer.id) : null;
  if (!firmware) return map;
  const caps = state.runtime.capabilities;
  const opts = runtimeEncodeOpts();
  for (const override of overrides) {
    if (override.layerId !== studioLayer.id) continue;
    const selected = stockToSelectedIndex(caps, override.keyPosition);
    if (selected < 0) continue;
    const firmwareText = firmware[selected];
    if (firmwareText == null) continue;
    const liveText = bindingTextFromAction(override.action, opts);
    if (liveText && !bindingsMatchForOverlay(liveText, firmwareText)) {
      map.set(selected, { firmwareText, liveText });
    }
  }
  return map;
}

// Snapshot of every layer's binding text at the moment it was last loaded
// (file, GitHub, or keyboard) - the reference point for "have I locally
// edited this key this session", independent of Running Config entirely.
// Deliberately a real snapshot rather than deriving from state.history:
// history.undoStack would miss edits made through the inspect panel's form
// fields, which pass noUndo:true specifically to avoid one undo entry per
// keystroke - this needs to catch every edit path uniformly.
function captureLoadedBindingsSnapshot() {
  const map = new Map();
  for (const layer of state.layers) {
    map.set(layer.id, layer.bindings.map((b) => b.text));
  }
  state.loadedBindings = map;
}

// Positions on the current layer whose text no longer matches what was
// loaded at the start of this session - catches any edit path (drag,
// palette, inspect form, clear, swap, copy), unlike overriddenPositionsOnCurrentLayer
// above which is specifically about the *device's* saved override set.
// A key can be flagged by neither, either, or both of these independently:
// a pre-existing device override you haven't touched this session shows
// only the override dot; a fresh local edit not yet saved anywhere shows
// only this one; editing an already-overridden key shows both.
function locallyEditedPositionsOnCurrentLayer() {
  const map = new Map();
  const layer = state.layers[state.layer];
  if (!layer) return map;
  const loaded = state.loadedBindings.get(layer.id);
  if (!loaded) return map;
  const bindings = currentBindings();
  loaded.forEach((loadedText, idx) => {
    const currentText = bindings[idx]?.text ?? "&trans";
    if (!bindingsMatchForOverlay(currentText, loadedText)) {
      map.set(idx, { loadedText, currentText });
    }
  });
  return map;
}

function bindingTint(text, index) {
  const model = parseBinding(text);
  const ctx = inspectContext();
  const kind = classifyBinding(model, ctx);
  if (kind === "macro") return "kind-macro";
  if (kind === "runtime") {
    const object = findRuntimeObject(state.runtime?.draft, parseRuntimeObjectId(text));
    if (object?.type === "macro") return "kind-macro";
    if (object?.type === "holdTap") return "kind-holdtap";
    if (object?.type === "modMorph" || object?.type === "tapDance") return "kind-other";
  }
  if (isLayerHoldBinding(model) || kind === "layer" || kind === "layer-tap") return "kind-layerhold";
  if (kind === "hold-tap" || isHomeRowBinding(model, ctx)) return "kind-holdtap";
  const custom = (state.behaviors || []).find((b) => !b.deleted && b.id === model.behavior);
  if (custom) return custom.kind === "hold-tap" ? "kind-holdtap" : "kind-other";
  if (
    state.combos.some(
      (c) => !c.deleted && c.positions.includes(index) && comboActiveOnLayer(c, state.layer)
    ) ||
    state.runtime?.draft?.combos.some(
      (combo) =>
        runtimeComboActiveOnLayer(combo, state.layer) &&
        stockPositionsToSelectedIndexes(state.runtime.capabilities, combo.keyPositions).includes(index)
    )
  ) {
    return "kind-combo";
  }
  return "";
}

function fillCategorySelect() {
  const sel = $("category");
  sel.replaceChildren();
  for (const cat of CATEGORIES) {
    const opt = document.createElement("option");
    opt.value = cat.id;
    opt.textContent = cat.label;
    if (cat.id === state.category) opt.selected = true;
    sel.appendChild(opt);
  }
}

function renderPalette() {
  const q = $("search").value.trim().toLowerCase();
  const cat = CATEGORIES.find((c) => c.id === state.category) ?? CATEGORIES[0];
  const extra =
    cat.id === "behaviors"
      ? [
          ...state.behaviors
            .filter((b) => !b.deleted && b.kind !== "other")
            .map((b) => ({
              label: b.id,
              binding: b.kind === "hold-tap" ? `&${b.id} LGUI A` : `&${b.id}`,
              category: "behaviors",
              description:
                b.kind === "hold-tap"
                  ? `Hold-tap ${b.id} (${b.flavor}, ${b.tappingTerm}ms)`
                  : `${b.kind} ${b.id}`,
            })),
          ...state.macros
            .filter((m) => !m.deleted)
            .map((m) => ({
              label: m.id,
              binding: `&${m.id}`,
              category: "behaviors",
              description: `Macro ${m.id}`,
            })),
        ]
      : cat.id === "layers"
        ? [
            { label: "▽", binding: "&trans", category: "layers", description: "Transparent / empty" },
            { label: "∅", binding: "&none", category: "layers", description: "None (no-op)" },
            ...state.layers.flatMap((l) => {
              const tok = layerToken(l.id);
              const name = displayLayerName(l.id);
              return [
                { label: `mo ${name}`, binding: `&mo ${tok}`, category: "layers", description: `Hold for ${name}` },
                { label: `lt ${name}`, binding: `&lt ${tok} SPACE`, category: "layers", description: `Layer-tap ${name}` },
                { label: `sl ${name}`, binding: `&sl ${tok}`, category: "layers", description: `Sticky layer ${name}` },
                { label: `to ${name}`, binding: `&to ${tok}`, category: "layers", description: `Switch to ${name}` },
              ];
            }),
          ]
        : [];
  const stock =
    cat.id === "layers" ? [] : cat.id === "modifiers" ? modifiersForOs(state.settings.os) : PALETTE;
  const items = [...stock, ...extra].filter((it) => {
    if (it.category !== cat.id) return false;
    if (!q) return true;
    return (
      it.label.toLowerCase().includes(q) ||
      it.binding.toLowerCase().includes(q) ||
      (it.description || "").toLowerCase().includes(q)
    );
  });
  const wrap = $("palette");
  wrap.dataset.cols = String(cat.cols);
  wrap.replaceChildren();
  for (const item of items) {
    const sw = document.createElement("div");
    const tint = bindingTint(item.binding, -1);
    sw.className = tint ? `swatch ${tint}` : "swatch";
    sw.textContent = item.label;
    sw.title = item.description ? `${item.description} — ${item.binding}` : item.binding;
    sw.dataset.binding = item.binding;
    sw.setAttribute("role", "button");
    if (paletteIsClickToAdd()) {
      sw.addEventListener("pointerup", (ev) => {
        if (ev.button != null && ev.button !== 0) return;
        ev.preventDefault();
        applyToSelected(item.binding);
      });
    } else {
      sw.addEventListener("pointerdown", (ev) => startPaletteDrag(ev, item));
      sw.addEventListener("click", (ev) => {
        ev.preventDefault();
        if (state.suppressPaletteClick) {
          state.suppressPaletteClick = false;
          return;
        }
        applyToSelected(item.binding);
      });
    }
    wrap.appendChild(sw);
  }
}

function currentMacroSeats() {
  if (!state.macroDraft) return new Map();
  return new Map(findMacroKeySeats(state.macroDraft.steps, state.layers).map((h) => [h.index, h]));
}

function renderKeyboard() {
  const svg = $("keyboard");
  const keys = state.keys;
  const bindings = currentBindings();
  const activators = new Set(currentActivators().map((a) => a.index));
  const macroSeats = currentMacroSeats();
  if (keys.length === 0) {
    svg.replaceChildren();
    return;
  }
  const box = layoutBounds(keys);
  svg.setAttribute("viewBox", `${box.minX} ${box.minY} ${box.width} ${box.height}`);
  svg.replaceChildren();
  const comboBadges = comboBadgeLettersByPosition();
  const overrides = overriddenPositionsOnCurrentLayer();
  const edits = locallyEditedPositionsOnCurrentLayer();

  keys.forEach((k, i) => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const cx = k.x + k.w / 2;
    const cy = k.y + k.h / 2;
    if (k.r) g.setAttribute("transform", `rotate(${k.r} ${k.rx || cx} ${k.ry || cy})`);

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", k.x);
    rect.setAttribute("y", k.y);
    rect.setAttribute("width", k.w);
    rect.setAttribute("height", k.h);
    rect.setAttribute("rx", "14");
    rect.setAttribute("ry", "14");
    rect.setAttribute("class", "key-hit");
    if (!state.behaviorDraft && state.selected.has(i)) rect.classList.add("selected");
    if (state.comboDraft?.positions.includes(i)) rect.classList.add("combo-member");
    if (state.combinationDraft?.triggers.some((t) => t.index === i)) rect.classList.add("combo-member");
    if (state.runtimeEditor?.type === "combo" && state.runtimeEditor.triggers.includes(i)) {
      rect.classList.add("combo-member");
    }
    if (keyHasRuntimeIssue(i)) rect.classList.add("runtime-error");
    if (state.behaviorDraft?.triggerPositions.includes(i) && isOppositeTrigger(state.behaviorDraft, i)) {
      rect.classList.add("trigger-member");
    }
    if (state.behaviorDraft?.assignments.some((a) => a.layer === state.layer && a.index === i && !a.removed)) {
      rect.classList.add("hrm-member");
      if (draftIsHomeRow()) rect.classList.add("kind-homerow");
    }
    const seat = macroSeats.get(i);
    if (seat) rect.classList.add("macro-ref");
    const tint = bindingTint(displayBindingText(bindings[i]), i);
    if (tint && !state.comboDraft && !state.behaviorDraft && !state.macroDraft) rect.classList.add(tint);
    if (activators.has(i)) rect.classList.add("activator");
    if (currentProtection(i) && !state.comboDraft && !state.behaviorDraft && !state.macroDraft) {
      rect.classList.add("protected");
    }
    rect.dataset.index = String(i);

    const formatted = formatKeyLabel(prettyBindingLabel(displayBindingText(bindings[i])));
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("class", "key-label");
    label.setAttribute("text-anchor", "middle");
    label.style.fontSize = `${formatted.font}px`;
    const lineH = formatted.font + 2;
    const startY = cy - ((formatted.lines.length - 1) * lineH) / 2 + 2;
    formatted.lines.forEach((line, li) => {
      const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      tspan.setAttribute("x", cx);
      tspan.setAttribute("y", startY + li * lineH);
      tspan.textContent = line;
      label.appendChild(tspan);
    });

    const seatLabel = seat ? prettyMacroToken(seat.token) : "";
    const hold = seatLabel
      ? ""
      : bindingHoldHint(displayBindingText(bindings[i])) || (activators.has(i) ? "HOLD" : "");
    if (seatLabel || hold) {
      const ht = document.createElementNS("http://www.w3.org/2000/svg", "text");
      ht.setAttribute("x", cx);
      ht.setAttribute("y", k.y + 20);
      ht.setAttribute("class", seatLabel ? "key-macro-ref" : "key-hold");
      const text = seatLabel || hold;
      ht.textContent = text.length > 4 ? text.slice(0, 4) : text;
      g.append(rect, ht, label);
    } else {
      g.append(rect, label);
    }

    const idx = document.createElementNS("http://www.w3.org/2000/svg", "text");
    idx.setAttribute("x", k.x + 10);
    idx.setAttribute("y", k.y + k.h - 10);
    idx.setAttribute("class", "key-idx");
    idx.textContent = String(i);
    g.append(idx);

    const badgeLetters = comboBadges.get(i);
    if (badgeLetters?.length && !state.comboDraft && !state.behaviorDraft && !state.macroDraft) {
      const wide = badgeLetters.length > 1;
      const badgeR = wide ? 17.5 : 14;
      const badgeCx = k.x + k.w - badgeR - 3;
      const badgeCy = k.y + badgeR + 3;
      const badge = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      badge.setAttribute("class", "combo-pair-badge");
      badge.setAttribute("cx", badgeCx);
      badge.setAttribute("cy", badgeCy);
      badge.setAttribute("r", String(badgeR));
      const badgeLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
      badgeLabel.setAttribute("class", "combo-pair-badge-label");
      badgeLabel.setAttribute("x", badgeCx);
      badgeLabel.setAttribute("y", badgeCy);
      if (wide) badgeLabel.style.fontSize = "12px";
      badgeLabel.textContent = badgeLetters.join(",");
      g.append(badge, badgeLabel);
    }

    if (overrides.has(i) && !state.comboDraft && !state.behaviorDraft && !state.macroDraft) {
      const dotR = 5.5;
      const dotCx = k.x + dotR + 3;
      const dotCy = k.y + dotR + 3;
      const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      ring.setAttribute("class", "override-dot-ring");
      ring.setAttribute("cx", dotCx);
      ring.setAttribute("cy", dotCy);
      ring.setAttribute("r", String(dotR + 2));
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("class", "override-dot");
      dot.setAttribute("cx", dotCx);
      dot.setAttribute("cy", dotCy);
      dot.setAttribute("r", String(dotR));
      g.append(ring, dot);
    }

    if (edits.has(i) && !state.comboDraft && !state.behaviorDraft && !state.macroDraft) {
      const dotR = 5.5;
      const dotCx = k.x + k.w - dotR - 3;
      const dotCy = k.y + k.h - dotR - 3;
      const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      ring.setAttribute("class", "edit-dot-ring");
      ring.setAttribute("cx", dotCx);
      ring.setAttribute("cy", dotCy);
      ring.setAttribute("r", String(dotR + 2));
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("class", "edit-dot");
      dot.setAttribute("cx", dotCx);
      dot.setAttribute("cy", dotCy);
      dot.setAttribute("r", String(dotR));
      g.append(ring, dot);
    }

    g.dataset.index = String(i);
    rect.addEventListener("pointerdown", (ev) => startKeyDrag(ev, i));
    svg.appendChild(g);
  });
  svg.classList.toggle("picking", !!(state.comboDraft || state.behaviorDraft || state.macroDraft || state.runtimeEditor));
}

function keyIndexFromPoint(clientX, clientY) {
  const stack = document.elementsFromPoint?.(clientX, clientY) || [document.elementFromPoint(clientX, clientY)];
  for (const el of stack) {
    if (!el) continue;
    if (el.classList?.contains("ghost")) continue;
    if (el.dataset?.index != null && (el.classList?.contains("key-hit") || el.tagName === "g")) {
      return Number(el.dataset.index);
    }
    const hit = el.closest?.(".key-hit, g[data-index]");
    if (hit?.dataset?.index != null) return Number(hit.dataset.index);
  }
  return null;
}

function paletteIsClickToAdd() {
  return !!(state.combinationDraft || state.comboDraft || state.macroDraft || state.runtimeEditor);
}

function startPaletteDrag(ev, item) {
  if (paletteIsClickToAdd()) return;
  ev.preventDefault();
  ev.currentTarget.setPointerCapture(ev.pointerId);
  state.drag = {
    kind: "palette",
    binding: item.binding,
    label: item.label,
    x: ev.clientX,
    y: ev.clientY,
    cap: ev.currentTarget,
    moved: false,
    ghost: null,
  };
  armDrag();
}

function emptyBinding() {
  return state.settings?.emptyBinding || state.emptyBinding || EMPTY_BINDING;
}

function holdMods() {
  return holdModChoices(state.settings.os);
}

function inspectMods() {
  return inspectModChoices(state.settings.os);
}

function applySettingsToUi() {
  setLabelOs(state.settings.os);
  state.emptyBinding = state.settings.emptyBinding;
  document.body.classList.toggle("hide-positions", !state.settings.showPositions);
  document.body.classList.toggle("hide-colors", !state.settings.showColors);
  document.body.classList.toggle("hide-combo-pairs", !state.settings.showComboPairs);
  if ($("color-legend")) $("color-legend").hidden = !state.settings.showColors;
  syncSettingsForm();
}

function syncSettingsForm() {
  const s = state.settings;
  if ($("set-os")) $("set-os").value = s.os;
  if ($("set-empty")) $("set-empty").value = s.emptyBinding;
  if ($("set-positions")) $("set-positions").checked = !!s.showPositions;
  if ($("set-colors")) $("set-colors").checked = !!s.showColors;
  if ($("set-combo-pairs")) $("set-combo-pairs").checked = !!s.showComboPairs;
  if ($("set-tapping")) $("set-tapping").value = String(s.tappingTerm);
  if ($("set-combo-timeout")) $("set-combo-timeout").value = String(s.comboTimeout);
  if ($("set-confirm-apply")) $("set-confirm-apply").checked = !!s.confirmApply;
}

function commitSettings(partial) {
  state.settings = saveSettings({ ...state.settings, ...partial });
  applySettingsToUi();
  fillHoldSelects();
  renderPalette();
  renderKeyboard();
  renderInspect(true);
  renderBehaviors();
  renderMacros();
  renderCombos();
}

function openSettings() {
  syncSettingsForm();
  if ($("settings")) $("settings").hidden = false;
}

function closeSettings() {
  if ($("settings")) $("settings").hidden = true;
}

function fillHoldSelects() {
  const sel = $("behavior-add-hold");
  if (!sel) return;
  const prev = sel.value;
  sel.replaceChildren();
  for (const [id, label] of holdMods()) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  else sel.value = holdMods()[0][0];
}

function startKeyDrag(ev, index) {
  ev.preventDefault();
  if (state.runtimeEditor) {
    handleRuntimeEditorKey(index);
    return;
  }
  if (state.combinationDraft) {
    toggleBuilderTrigger(index);
    return;
  }
  if (state.comboDraft) {
    toggleComboKey(index);
    return;
  }
  if (state.macroDraft) {
    placeMacroOnKey(index);
    return;
  }
  if (state.behaviorDraft) {
    toggleBehaviorKey(index);
    return;
  }
  ev.currentTarget.setPointerCapture(ev.pointerId);
  const cap = ev.currentTarget;
  const wasSelected = state.selected.has(index);
  const multiSelected = state.selected.size > 1;
  if (ev.shiftKey) {
    if (wasSelected) state.selected.delete(index);
    else state.selected.add(index);
  } else if (!wasSelected) {
    selectOnly(index);
  } else {
    renderKeyboard();
    renderInspect();
  }
  const text = currentBindings()[index]?.text ?? "";
  state.drag = {
    kind: "key",
    from: index,
    binding: cloneBinding(text),
    label: bindingLabel(text),
    x: ev.clientX,
    y: ev.clientY,
    cap,
    moved: false,
    wasSelected,
    multiSelected,
    ghost: null,
  };
  armDrag();
}

function makeGhost(label, ev) {
  const g = document.createElement("div");
  g.className = "ghost";
  g.dataset.zmkGhost = "1";
  g.textContent = label;
  g.style.left = `${ev.clientX + 8}px`;
  g.style.top = `${ev.clientY + 8}px`;
  document.body.appendChild(g);
  return g;
}

function armDrag() {
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragUp);
  window.addEventListener("pointercancel", onDragCancel);
}

function clearDragGhosts() {
  document.querySelectorAll(".ghost[data-zmk-ghost], body > .ghost").forEach((el) => el.remove());
}

function clearDropTargets() {
  document.querySelectorAll(".key-hit.drop-target, .key-hit.will-clear, .key-hit.drag-source").forEach((rect) => {
    rect.classList.remove("drop-target", "will-clear", "drag-source");
  });
}

function clearTransientUi(ev) {
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", onDragUp);
  window.removeEventListener("pointercancel", onDragCancel);
  document.body.classList.remove("assigning");
  const drag = state.drag;
  state.drag = null;
  if (drag?.cap?.releasePointerCapture && ev?.pointerId != null) {
    try {
      if (drag.cap.hasPointerCapture?.(ev.pointerId)) drag.cap.releasePointerCapture(ev.pointerId);
    } catch {
      /* already released */
    }
  }
  clearDragGhosts();
  clearDropTargets();
  return drag;
}

function dragDistance(ev, drag) {
  const dx = ev.clientX - drag.x;
  const dy = ev.clientY - drag.y;
  return Math.hypot(dx, dy);
}

function dropModifiers(ev) {
  return { ctrl: !!ev.ctrlKey, meta: !!ev.metaKey, alt: !!ev.altKey };
}

function previewDrop(ev, drag) {
  const over = keyIndexFromPoint(ev.clientX, ev.clientY);
  if (drag.kind === "palette") {
    if (over == null) return null;
    return {
      kind: "assign",
      to: over,
      sets: [{ index: over, text: cloneBinding(drag.binding) }],
    };
  }
  return planDrop({
    from: drag.from,
    to: over,
    binding: drag.binding,
    targetBinding: over == null ? "" : currentBindings()[over]?.text,
    modifiers: dropModifiers(ev),
    empty: emptyBinding(),
    clearPx: DRAG_CLEAR_PX,
    distance: dragDistance(ev, drag),
  });
}

function onDragMove(ev) {
  if (!state.drag) return;
  const drag = state.drag;
  if (!drag.moved && dragDistance(ev, drag) >= 6) {
    drag.moved = true;
    if (drag.kind === "palette") document.body.classList.add("assigning");
  }
  if (drag.moved && !drag.ghost) drag.ghost = makeGhost(drag.label, ev);
  if (!drag.ghost) return;
  drag.ghost.style.left = `${ev.clientX + 8}px`;
  drag.ghost.style.top = `${ev.clientY + 8}px`;
  const over = keyIndexFromPoint(ev.clientX, ev.clientY);
  const plan = previewDrop(ev, drag);
  const kind = plan?.kind || (drag.kind === "palette" ? "assign" : "idle");
  drag.ghost.className = `ghost ${kind}`;
  drag.ghost.dataset.zmkGhost = "1";
  if (kind === "clear") drag.ghost.textContent = "clear";
  else if (kind === "copy") drag.ghost.textContent = `copy ${drag.label}`;
  else if (kind === "swap") drag.ghost.textContent = `swap ${drag.label}`;
  else if (kind === "move") drag.ghost.textContent = `move ${drag.label}`;
  else if (kind === "assign") drag.ghost.textContent = `assign ${drag.label}`;
  else drag.ghost.textContent = drag.label;
  for (const rect of document.querySelectorAll(".key-hit")) {
    const idx = Number(rect.dataset.index);
    rect.classList.toggle("drop-target", over != null && idx === over && kind !== "idle");
    rect.classList.toggle("will-clear", (kind === "move" || kind === "clear") && idx === drag.from);
    rect.classList.toggle("drag-source", drag.from != null && idx === drag.from);
  }
}

function onDragCancel(ev) {
  clearTransientUi(ev);
}

function onDragUp(ev) {
  const drag = clearTransientUi(ev);
  if (!drag) return;
  if (drag.kind === "palette" && !drag.moved) {
    applyToSelected(drag.binding);
    return;
  }
  if (drag.kind === "palette") state.suppressPaletteClick = true;
  const over = keyIndexFromPoint(ev.clientX, ev.clientY);
  if (drag.kind === "palette" && state.comboDraft && !state.comboDraft.source?.guarded && over == null) {
    $("combo-binding").value = drag.binding;
    updateComboDialogView();
    return;
  }
  const plan = previewDrop(ev, drag);
  if (!plan) {
    const action =
      drag.kind === "key"
        ? clickKeyAction({
            wasSelected: drag.wasSelected,
            multiSelected: drag.multiSelected,
            moved: drag.moved,
            shift: ev.shiftKey,
            over,
            from: drag.from,
          })
        : over != null
          ? "select"
          : "keep";
    if (action === "clear") selectOnly(null);
    else if (action === "isolate") selectOnly(drag.from);
    else if (action === "select" && over != null) selectOnly(over);
    return;
  }
  const ok = applyBindingSets(plan.sets, dropLabel(plan.kind, drag.from, over, drag.binding));
  if (ok && over != null) selectOnly(over);
  else if (ok && plan.kind === "clear") selectOnly(drag.from);
}

function runtimeDirtyKeyId(layerIndex, index) {
  return `${layerIndex}:${index}`;
}

function noteRuntimeDirtyKey(layerIndex, index, text) {
  if (!state.runtime) return;
  const mapped = studioLayerIndex(layerIndex);
  const studioLayer = mapped == null ? null : state.studio?.layers?.[mapped];
  const stock = studioLayer ? state.stockBindingTexts.get(studioLayer.id)?.[index] : null;
  const id = runtimeDirtyKeyId(layerIndex, index);
  if (stock != null && bindingsMatchForOverlay(text, stock)) {
    state.runtimeDirtyKeys.delete(id);
    return;
  }
  state.runtimeDirtyKeys.set(id, {
    layerIndex,
    index,
    text,
    layerId: studioLayer?.id,
  });
}

function applyBindingField(layerIndex, changes, field, opts = {}) {
  const bindings = state.layers[layerIndex]?.bindings;
  const list = field === "before" ? [...changes].reverse() : changes;
  for (const c of list) {
    if (bindings?.[c.index]) bindings[c.index].text = c[field];
    queueLive(layerIndex, c.index, c[field]);
    noteRuntimeDirtyKey(layerIndex, c.index, c[field]);
  }
  state.layer = layerIndex;
  setDirty(true);
  renderKeyboard();
  renderMacros();
  renderBehaviors();
  if (!opts.skipInspect) renderInspect();
}

function applyBindingSets(sets, label, opts = {}) {
  const layer = currentBindings();
  const changes = [];
  for (const { index, text } of sets) {
    const b = layer[index];
    if (!b || b.text === text) continue;
    if (!opts.quiet && !confirmProtected(index, `${label}`)) return false;
    changes.push({ index, before: b.text, after: text });
  }
  if (!changes.length) return false;
  if (opts.noUndo) {
    applyBindingField(state.layer, changes, "after", opts);
  } else {
    state.history.execute(
      new BindingSetCommand({
        layer: state.layer,
        changes,
        description: label,
        apply: applyBindingField,
      })
    );
    updateHistoryButtons();
  }
  if (!opts.silent) setStatus(label);
  return true;
}

function assignBinding(index, text, opts = {}) {
  return applyBindingSets([{ index, text }], `P${index} → ${text}`, opts);
}

function undoBindings() {
  clearTransientUi();
  const cmd = state.history.undo();
  updateHistoryButtons();
  if (!cmd) {
    setStatus("Nothing to undo.");
    return;
  }
  afterLayerChange();
  setStatus(`Undid ${cmd.description}`);
}

function redoBindings() {
  clearTransientUi();
  const cmd = state.history.redo();
  updateHistoryButtons();
  if (!cmd) {
    setStatus("Nothing to redo.");
    return;
  }
  afterLayerChange();
  setStatus(`Redid ${cmd.description}`);
}

function typingInField(el) {
  const tag = el?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable;
}

function comboKeyCaption(index) {
  return bindingLabel(displayBindingText(currentBindings()[index])) || `P${index}`;
}

function comboChipLabel(combo) {
  return combo.positions.map(comboKeyCaption).join(" + ");
}

function homeRowChipDetail(behavior) {
  const assigns = collectAssignments(behavior.id, "hold-tap").filter(
    (a) => !a.removed && a.layer === state.layer
  );
  if (!assigns.length) return `Hold-tap ${behavior.tappingTerm || 280}ms`;
  return assigns
    .map((a) => {
      const letter = a.tap || comboKeyCaption(a.index) || `P${a.index}`;
      const hold = bindingLabel(`&kp ${a.hold}`) || a.hold;
      return hold ? `${letter} ${hold}` : letter;
    })
    .join(" · ");
}

function renderCombos() {
  renderCombinations();
}

function combinationFilterMatch(item, filter) {
  if (!filter || filter === "all") return true;
  if (filter === "hold-tap") return item.type === "hold-tap" || item.type === "holdTap";
  return item.type === filter;
}

function keymapCombinationEntries() {
  const draft = state.combinationDraft;
  const draftId = draft?.source?.item?.id;
  const items = [];
  for (const m of state.macros.filter((x) => !x.deleted && visibleOnCurrentLayer(x.id, draft?.source?.type === "macro" ? draftId : null))) {
    items.push({
      type: "macro",
      id: m.id,
      title: m.id,
      detail: bindingLabel(`&${m.id}`),
      tint: "kind-macro",
      source: m,
    });
  }
  const behDraft =
    draft?.source?.type === "hold-tap" || draft?.source?.type === "behavior" ? draftId : null;
  for (const b of state.behaviors.filter((x) => !x.deleted && visibleOnCurrentLayer(x.id, behDraft))) {
    const hold = b.kind === "hold-tap";
    items.push({
      type: hold ? "hold-tap" : "behavior",
      id: b.id,
      title: `&${b.id}`,
      detail: hold ? homeRowChipDetail(b) : b.kind || "behavior",
      tint: isHomeRowBehavior(b, inspectContext()) ? "kind-homerow" : hold ? "kind-holdtap" : "kind-other",
      source: b,
    });
  }
  for (const c of state.combos.filter((x) => !x.deleted && comboActiveOnLayer(x, state.layer))) {
    items.push({
      type: "combo",
      id: c.id,
      title: comboChipLabel(c),
      detail: bindingLabel(c.binding),
      tint: "kind-combo",
      source: c,
      guarded: c.guarded,
    });
  }
  return items;
}

function combinationEntries() {
  const keymapItems = keymapCombinationEntries();
  const runtimeItems = state.runtime ? runtimeCombinationEntries() : [];
  const extras = extraRuntimeCombinationItems(keymapItems, runtimeItems);
  const items = [...keymapItems, ...extras];
  const filter = state.combinationFilter || "all";
  return items.filter((item) => {
    if (!combinationFilterMatch(item, filter)) return false;
    if (item.runtime && item.type === "combo") {
      return runtimeComboActiveOnLayer(item.source, state.layer);
    }
    if (item.runtime && item.type === "macro") {
      const combos = (state.runtime.draft?.combos || []).filter(
        (combo) => combo.output?.runtimeObjectId === item.source?.id
      );
      if (combos.length && combos.every((combo) => !runtimeComboActiveOnLayer(combo, state.layer))) {
        return false;
      }
    }
    return true;
  });
}

function renderCombinations() {
  renderRuntimeChrome();
  const wrap = $("combinations");
  if (!wrap) return;
  wrap.replaceChildren();
  const items = combinationEntries();
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "combo-meta";
    empty.textContent = "No combinations on this layer. Click + New, then pick trigger keys on the layout and an output from the palette.";
    wrap.appendChild(empty);
    return;
  }
  const draftId = state.combinationDraft?.source?.item?.id;
  for (const item of items) {
    const chip = document.createElement("div");
    chip.className = `combo-chip ${item.tint}${item.guarded ? " guarded" : ""}${draftId === item.id ? " active" : ""}${itemHasRuntimeIssue(item) ? " runtime-error" : ""}`;
    chip.title = `${item.title} · ${item.detail}`;
    chip.innerHTML = `<span class="combo-tab"></span><span class="combo-keys">${item.title}</span><span>→</span><span class="combo-out">${item.detail}</span>`;
    if (!item.guarded) {
      const x = document.createElement("button");
      x.type = "button";
      x.className = "combo-x";
      x.setAttribute("aria-label", `Delete ${item.title}`);
      x.textContent = "×";
      x.addEventListener("click", (ev) => {
        ev.stopPropagation();
        deleteCombinationItem(item);
      });
      chip.appendChild(x);
    }
    chip.addEventListener("click", () => openCombinationItem(item));
    wrap.appendChild(chip);
  }
}

function runtimeComboForCombinationItem(item) {
  if (!item?.runtime) return null;
  if (item.type === "combo") return item.source || null;
  const objectId = item.source?.id;
  if (!objectId) return null;
  return (state.runtime?.draft?.combos || []).find((combo) => combo.output?.runtimeObjectId === objectId) || null;
}

function runtimeObjectForCombinationItem(item) {
  if (!item?.runtime) return null;
  if (item.type === "macro" || item.type === "holdTap") return item.source || null;
  const objectId = item.source?.output?.runtimeObjectId;
  return objectId ? findRuntimeObject(state.runtime?.draft, objectId) : null;
}

function openRuntimeCombinationInBuilder(item) {
  const combo = runtimeComboForCombinationItem(item);
  const object =
    runtimeObjectForCombinationItem(item) ||
    (combo?.output?.runtimeObjectId ? findRuntimeObject(state.runtime?.draft, combo.output.runtimeObjectId) : null);
  if (!combo && !object) return false;
  if (object && object.type !== "macro") return false;
  const positions = combo
    ? stockPositionsToSelectedIndexes(state.runtime.capabilities, combo.keyPositions)
    : [];
  const steps = keymapStepsFromRuntimeSteps(object?.steps || [], (action) =>
    bindingTextFromAction(action, runtimeEncodeOpts())
  );
  const reversed = outputKeysFromSteps(steps);
  const guessed = suggestedName(
    { outputs: reversed.keys, name: "" },
    { kind: object ? "macro" : "combo", needsCombo: positions.length >= 2 }
  );
  const existingCombo =
    positions.length >= 2
      ? state.combos.find((entry) => !entry.deleted && (entry.positions || []).join(",") === positions.join(","))
      : null;
  if (existingCombo) {
    openCombinationBuilder({ type: "combo", item: existingCombo });
    return true;
  }
  const existingMacro = guessed ? state.macros.find((entry) => !entry.deleted && entry.id === guessed) : null;
  const macroItem = existingMacro
    ? { ...existingMacro, steps }
    : { id: guessed || `mac_rt_${object?.id || 1}`, steps, added: true, deleted: false };
  const comboItem = {
    id: `combo_${macroItem.id}`,
    positions,
    binding: `&${macroItem.id}`,
    timeout: combo?.timeoutMs || state.settings.comboTimeout,
    layers: comboLayersFromMask(combo?.layerMask),
    added: true,
    deleted: false,
  };
  openCombinationBuilder({
    type: object ? "macro" : "combo",
    item: object ? macroItem : comboItem,
    combo: object ? comboItem : null,
  });
  return true;
}

function deleteCombinationItem(item) {
  if (item.runtime) {
    deleteRuntimeEditorItem(item);
    return;
  }
  if (item.type === "combo") deleteCombo(item.source);
  else if (item.type === "macro") deleteMacro(item.source);
  else deleteBehavior(item.source);
}

function openCombinationItem(item) {
  if (item.runtime && (item.type === "combo" || item.type === "macro")) {
    if (openRuntimeCombinationInBuilder(item)) return;
    openRuntimeEditor(item);
    return;
  }
  if (item.runtime) {
    openRuntimeEditor(item);
    return;
  }
  if (item.type === "combo") {
    openCombinationBuilder({ type: "combo", item: item.source });
    return;
  }
  if (item.type === "macro") {
    openCombinationBuilder({ type: "macro", item: item.source });
    return;
  }
  if (item.type === "hold-tap") {
    openCombinationBuilder({ type: "hold-tap", item: item.source });
    return;
  }
  openBehaviorEditor(item.source);
}

function builderLabel(item) {
  if (!item) return "";
  if (item.index != null) return comboKeyCaption(item.index);
  if (item.holdMod && !item.binding) return bindingLabel(`&kp ${item.holdMod}`);
  return bindingLabel(item.binding || "") || item.label || "";
}

function usedCombinationIds() {
  const used = new Set();
  for (const m of state.macros) if (!m.deleted) used.add(m.id);
  for (const b of state.behaviors) if (!b.deleted) used.add(b.id);
  for (const c of state.combos) if (!c.deleted) used.add(c.id);
  const keep = state.combinationDraft?.source?.item?.id;
  if (keep) used.delete(keep);
  return used;
}

function defaultHoldMod() {
  return holdMods().find(([id]) => id === "LCTRL")?.[0] || holdMods()[0]?.[0] || "LCTRL";
}

function syncBuilderSteps() {
  const draft = state.combinationDraft;
  if (!draft || draft.stepsDirty) return;
  draft.steps = macroStepsFromKeys(draft.outputs);
  draft.stepIndex = 0;
}

function closeOtherEditors() {
  if (state.runtimeEditor) closeRuntimeEditor();
  if (state.combinationDraft) closeCombinationBuilder();
  if (state.comboDraft) closeComboDialog();
  if (state.macroDraft) closeMacroEditor();
  if (state.behaviorDraft) closeBehaviorEditor();
}

function openCombinationBuilder(source = null) {
  closeOtherEditors();
  const item = source?.item || null;
  const isNew = !item;
  const draft = {
    source,
    isNew,
    name: "",
    triggers: [],
    outputs: [],
    steps: [],
    stepsDirty: false,
    stepIndex: 0,
    tappingTerm: state.settings.tappingTerm,
    quickTap: 175,
    priorIdle: 150,
    flavor: "balanced",
    timeout: state.settings.comboTimeout,
    layers: String(state.layer),
    advanced: false,
    holdChoice: null,
    hrmMode: "set",
    holdCat: "modifiers",
    setKeys: [],
    replaceOk: false,
    step: "trigger",
  };
  if (source?.type === "combo" && item) {
    draft.name = comboTitle(item);
    draft.triggers = item.positions.map((index) => ({
      index,
      mode: "tap",
      binding: currentBindings()[index]?.text || "",
      tap: tapGuess(index),
    }));
    draft.timeout = item.timeout || state.settings.comboTimeout;
    draft.layers = item.layers === "all" ? "" : (item.layers || []).join(" ");
    const macroId = String(item.binding || "")
      .trim()
      .replace(/^&/, "")
      .split(/\s+/)[0];
    const linked = state.macros.find((m) => !m.deleted && m.id === macroId);
    if (linked) {
      source = { type: "macro", item: linked, combo: item };
      draft.source = source;
      draft.name = linked.id;
      const reversed = outputKeysFromSteps(linked.steps);
      draft.outputs = reversed.keys;
      draft.steps = linked.steps.map((s) => ({ ...s }));
      draft.stepsDirty = reversed.advanced;
      draft.advanced = reversed.advanced;
    } else if (isBrokenComboBinding(item.binding)) {
      draft.outputs = [];
      draft.name = "";
      draft.advanced = true;
    } else {
      draft.outputs = item.binding ? [{ binding: item.binding, mode: defaultModeForBinding(item.binding) }] : [];
    }
  } else if (source?.type === "macro" && item) {
    draft.name = item.id;
    const seats = findMacroKeySeats(item.steps, state.layers).filter((s) => s.layer === state.layer);
    const comboSrc =
      source.combo || state.combos.find((c) => !c.deleted && c.binding === `&${item.id}`);
    if (comboSrc) {
      draft.triggers = comboSrc.positions.map((index) => ({
        index,
        mode: "tap",
        binding: currentBindings()[index]?.text || "",
        tap: tapGuess(index),
      }));
    } else if (seats.length) {
      draft.triggers = seats.map((s) => ({
        index: s.index,
        mode: defaultModeForBinding(currentBindings()[s.index]?.text),
        binding: currentBindings()[s.index]?.text || "",
        tap: tapGuess(s.index),
        holdMod: modifierFromBinding(currentBindings()[s.index]?.text) || defaultHoldMod(),
      }));
    }
    const reversed = outputKeysFromSteps(item.steps);
    draft.outputs = reversed.keys;
    draft.steps = item.steps.map((s) => ({ ...s }));
    draft.stepsDirty = reversed.advanced;
    draft.advanced = reversed.advanced;
  } else if (source?.type === "hold-tap" && item) {
    draft.name = item.id;
    draft.tappingTerm = item.tappingTerm || state.settings.tappingTerm;
    draft.quickTap = item.quickTap ?? 175;
    draft.priorIdle = item.priorIdle ?? 150;
    draft.flavor = item.flavor || "balanced";
    const assigns = collectAssignments(item.id, "hold-tap").filter((a) => !a.removed && a.layer === state.layer);
    draft.hrmMode = assigns.length > 1 ? "set" : "single";
    if (assigns[0]) {
      draft.holdChoice = { kind: "modifier", mod: assigns[0].hold, binding: `&kp ${assigns[0].hold}` };
      draft.holdCat = "modifiers";
    }
    draft.triggers = assigns.map((a) => ({
      index: a.index,
      mode: "hold",
      holdMod: a.hold || defaultHoldMod(),
      tap: a.tap || tapGuess(a.index),
      binding: currentBindings()[a.index]?.text || "",
    }));
    draft.setKeys = assigns.map((a) => ({ index: a.index, hold: a.hold, tap: a.tap }));
  }
  syncBuilderSteps();
  draft.step = initialBuilderStep(draft);
  state.combinationDraft = draft;
  state.selected = new Set(draft.triggers.map((t) => t.index));
  $("builder-title").textContent = isNew ? "New combination" : `Edit ${item.id || "combination"}`;
  $("builder-name").value = draft.name;
  $("builder-term").value = String(draft.tappingTerm);
  if ($("builder-quick")) $("builder-quick").value = String(draft.quickTap ?? 175);
  if ($("builder-idle")) $("builder-idle").value = String(draft.priorIdle ?? 150);
  if ($("builder-flavor")) $("builder-flavor").value = draft.flavor || "balanced";
  $("builder-timeout").value = String(draft.timeout);
  $("builder-layers").value = draft.layers;
  $("builder-advanced").checked = !!draft.advanced;
  $("builder-delete").hidden = isNew || !!item?.guarded;
  $("builder-save").disabled = !!item?.guarded;
  $("combo-builder").hidden = false;
  $("combo-pick-hint").hidden = false;
  setEditingMode();
  renderBuilder();
  renderKeyboard();
  renderCombinations();
}

function closeCombinationBuilder() {
  state.combinationDraft = null;
  if ($("builder-conflict")) $("builder-conflict").hidden = true;
  if ($("combo-builder")) $("combo-builder").hidden = true;
  if (!state.comboDraft && !state.behaviorDraft && !state.macroDraft && $("combo-pick-hint")) {
    $("combo-pick-hint").hidden = true;
  }
  setEditingMode();
  renderKeyboard();
  renderCombinations();
}

function syncSetKeys() {
  const draft = state.combinationDraft;
  if (!draft) return;
  const fallback = draft.holdChoice?.mod || defaultHoldMod();
  draft.setKeys = draft.triggers
    .filter((t) => t.mode === "hold")
    .map((t) => ({
      index: t.index,
      hold: t.holdMod || fallback,
      tap: t.tap || tapGuess(t.index),
    }));
}

function initialBuilderStep(draft) {
  if (!draft.triggers.length) return "trigger";
  const classified = classifyCombination(draft);
  if (
    classified.kind === "hold-tap-set" ||
    classified.kind === "hold-tap" ||
    classified.kind === "layer-hold"
  ) {
    return "trigger";
  }
  const oneHold = draft.triggers.length === 1 && draft.triggers[0].mode === "hold";
  if (oneHold && !draft.holdChoice) return "output";
  if (!oneHold && !draft.outputs.length) return "output";
  return "trigger";
}

function setBuilderStep(step) {
  const draft = state.combinationDraft;
  if (!draft || (step !== "trigger" && step !== "output")) return;
  if (draft.step === step) return;
  draft.step = step;
  renderBuilder();
}

function toggleBuilderTrigger(index) {
  const draft = state.combinationDraft;
  if (!draft || draft.source?.item?.guarded) return;
  draft.step = "trigger";
  const at = draft.triggers.findIndex((t) => t.index === index);
  const setMode = draft.hrmMode === "set" && draft.triggers[0]?.mode === "hold" && draft.holdChoice?.kind === "modifier";
  if (at >= 0) {
    draft.triggers.splice(at, 1);
    if (!draft.triggers.length) draft.holdChoice = null;
  } else {
    const binding = currentBindings()[index]?.text || "";
    const parsed = parseHoldTapBinding(binding, binding.trim().split(/\s+/)[0]?.replace(/^&/, "") || "");
    const forceHold = setMode;
    const mode = forceHold || parsed ? "hold" : defaultModeForBinding(binding);
    draft.triggers.push({
      index,
      mode,
      binding,
      tap: parsed?.tap || tapGuess(index),
      holdMod: parsed?.hold || (mode === "hold" ? draft.holdChoice?.mod || "" : ""),
    });
  }
  draft.triggers.sort((a, b) => a.index - b.index);
  state.selected = new Set(draft.triggers.map((t) => t.index));
  syncSetKeys();
  draft.replaceOk = false;
  renderBuilder();
  renderKeyboard();
}

function addBuilderOutput(text) {
  const draft = state.combinationDraft;
  if (!draft || draft.source?.item?.guarded) return;
  const binding = String(text || "").trim();
  if (!binding) return;
  draft.step = "output";
  if (draft.triggers.length === 1 && draft.triggers[0].mode === "hold") {
    applyHoldChoice(holdChoiceFromBinding(binding));
    return;
  }
  appendOutputKey(draft.outputs, binding);
  draft.stepsDirty = false;
  syncBuilderSteps();
  renderBuilder();
}

function applyHoldChoice(choice) {
  const draft = state.combinationDraft;
  if (!draft || !choice) return;
  draft.step = "output";
  draft.holdChoice = choice;
  draft.holdCat = choice.kind === "layer" ? "layers" : choice.kind === "modifier" ? "modifiers" : "keys";
  if (choice.kind === "modifier") {
    if (!draft.hrmMode) draft.hrmMode = "set";
    if (draft.triggers[0]) draft.triggers[0].holdMod = choice.mod;
    if (draft.triggers.length === 1) draft.triggers[0].mode = "hold";
  }
  syncSetKeys();
  renderBuilder();
  renderKeyboard();
}

function builderKindLabel(classified) {
  if (classified?.kind === "macro" && classified.needsCombo) return "Macro";
  if (classified?.kind === "combo" && classified.needsMacro) return "Combo + macro";
  return (
    {
      "hold-pick": "Hold",
      "layer-hold": "Layer hold",
      "hold-tap": "Home-row",
      "hold-tap-set": "Home-row set",
      remap: "Remap",
      combo: "Combo",
      macro: "Macro",
    }[classified?.kind] || classified?.kind || "Combo"
  );
}

function renderBuilder() {
  const draft = state.combinationDraft;
  if (!draft) return;
  const classified = classifyCombination(draft);
  const holdish =
    classified.kind === "hold-tap" ||
    classified.kind === "hold-tap-set" ||
    classified.kind === "hold-pick" ||
    classified.kind === "layer-hold";
  const setMode = classified.kind === "hold-tap-set";
  const oneHold = draft.triggers.length === 1 && draft.triggers[0].mode === "hold";
  const step = draft.step === "output" ? "output" : "trigger";
  if ($("builder-kind")) $("builder-kind").textContent = builderKindLabel(classified);
  if ($("builder-output-block")) $("builder-output-block").hidden = holdish;
  if ($("builder-hold-output")) $("builder-hold-output").hidden = !holdish;
  if ($("builder-hold-cats")) $("builder-hold-cats").hidden = setMode;
  if ($("builder-hold-choices")) $("builder-hold-choices").hidden = setMode;
  if ($("builder-hrm-mode")) {
    $("builder-hrm-mode").hidden = !(holdish && (setMode || draft.holdChoice?.kind === "modifier"));
  }
  if ($("builder-hrm-set-hint")) $("builder-hrm-set-hint").hidden = !setMode;
  if ($("builder-summary")) $("builder-summary").textContent = combinationSummary(draft, builderLabel);
  const triggerHint = setMode
    ? "Each key: letter on tap, modifier on hold"
    : "Click keys on the layout";
  const outputHint = holdish
    ? "Pick a layer, a modifier, or another key"
    : "Click keys in the palette";
  if ($("builder-trigger-hint")) $("builder-trigger-hint").textContent = triggerHint;
  if ($("builder-output-hint")) $("builder-output-hint").textContent = outputHint;
  if ($("combo-pick-hint")) {
    $("combo-pick-hint").textContent =
      classified.kind === "hold-tap-set"
        ? "Click more home-row keys and set a modifier for each. They share one behavior."
        : step === "output"
          ? oneHold
            ? "Pick what Hold sends: a layer, a modifier, or another key."
            : "Click keys in the palette"
          : "Click keys on the layout";
  }
  for (const el of document.querySelectorAll("[data-builder-step]")) {
    const on = el.dataset.builderStep === step && !el.hidden;
    el.classList.toggle("step-active", on);
    el.classList.toggle("step-idle", !on);
  }
  document.querySelectorAll("#builder-hold-cats [data-hold-cat]").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.holdCat === (draft.holdCat || "modifiers"));
  });
  document.querySelectorAll("input[name=hrm-mode]").forEach((el) => {
    el.checked = el.value === (draft.hrmMode || "set");
  });
  renderBuilderKeys("builder-triggers", draft.triggers, "trigger", classified);
  renderBuilderKeys("builder-outputs", draft.outputs, "output", classified);
  renderHoldChoices(draft);
  syncBuilderSteps();
  const adv = $("builder-advanced-panel");
  if (adv) adv.hidden = !$("builder-advanced")?.checked;
  const isCombo = classified.kind === "combo";
  const isMacro = classified.kind === "macro";
  const holdTiming = classified.kind === "hold-tap" || classified.kind === "hold-tap-set";
  if ($("builder-adv-hold")) $("builder-adv-hold").hidden = !holdTiming;
  if ($("builder-adv-combo")) $("builder-adv-combo").hidden = !(isCombo || (isMacro && classified.needsCombo));
  if ($("builder-binding-field")) $("builder-binding-field").hidden = !isCombo;
  if ($("builder-adv-macro")) $("builder-adv-macro").hidden = !isMacro;
  if ($("builder-term-field")) $("builder-term-field").hidden = !holdTiming;
  if ($("builder-timeout-field")) {
    $("builder-timeout-field").hidden = holdish || classified.kind === "remap" || classified.kind === "layer-hold";
  }
  if ($("builder-layers-field")) {
    $("builder-layers-field").hidden = !isCombo && !(isMacro && classified.needsCombo);
  }
  if ($("builder-binding") && document.activeElement !== $("builder-binding")) {
    const bind = classified.output || (draft.outputs[0] ? asBinding(draft.outputs[0].binding) : "");
    $("builder-binding").value = isBrokenComboBinding(bind) ? "" : bind;
  }
  if ($("builder-def")) {
    const text = formatBuilderDefinition(draft, classified);
    $("builder-def").textContent = text;
    $("builder-def").hidden = !text;
  }
  renderBuilderSteps();
}

function renderHoldChoices(draft) {
  const wrap = $("builder-hold-choices");
  if (!wrap) return;
  wrap.replaceChildren();
  const cat = draft.holdCat || "modifiers";
  if (cat === "layers") {
    for (const layer of state.layers) {
      const tok = layerToken(layer.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = displayLayerName(layer.id);
      btn.classList.toggle("on", draft.holdChoice?.kind === "layer" && draft.holdChoice.layer === tok);
      btn.addEventListener("click", () => applyHoldChoice({ kind: "layer", layer: tok, behavior: "mo", binding: `&mo ${tok}` }));
      wrap.appendChild(btn);
    }
    return;
  }
  if (cat === "modifiers") {
    for (const [id, label] of holdMods()) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.classList.toggle("on", draft.holdChoice?.kind === "modifier" && draft.holdChoice.mod === id);
      btn.addEventListener("click", () => applyHoldChoice({ kind: "modifier", mod: id, binding: `&kp ${id}` }));
      wrap.appendChild(btn);
    }
    return;
  }
  const hint = document.createElement("div");
  hint.className = "field-hint";
  hint.textContent = draft.holdChoice?.kind === "key"
    ? `Selected ${bindingLabel(draft.holdChoice.binding)}`
    : "Pick a key from the palette above.";
  wrap.appendChild(hint);
}

function renderBuilderKeys(id, keys, role, classified) {
  const wrap = $(id);
  if (!wrap) return;
  wrap.replaceChildren();
  const setMode = classified?.kind === "hold-tap-set";
  const holdTap = classified?.kind === "hold-tap";
  keys.forEach((key, i) => {
    const card = document.createElement("div");
    card.className = "builder-key";
    if (role === "trigger" && (setMode || holdTap)) card.classList.add("builder-key-hrm");
    const top = document.createElement("div");
    top.className = "bk-top";
    const lab = document.createElement("span");
    lab.className = "bk-label";
    lab.textContent = key.tap || builderLabel(key) || `P${key.index ?? i}`;
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "bk-x";
    rm.textContent = "×";
    rm.addEventListener("click", () => {
      keys.splice(i, 1);
      if (role === "trigger") {
        state.selected = new Set(keys.map((t) => t.index));
        if (!keys.length && state.combinationDraft) state.combinationDraft.holdChoice = null;
        syncSetKeys();
      }
      if (role === "output") {
        state.combinationDraft.stepsDirty = false;
        syncBuilderSteps();
      }
      renderBuilder();
      renderKeyboard();
    });
    top.append(lab, rm);
    card.append(top);
    if (!(role === "trigger" && setMode)) {
      const mode = document.createElement("select");
      mode.setAttribute("aria-label", "Tap or Hold");
      for (const [v, t] of [
        ["tap", "Tap"],
        ["hold", "Hold"],
      ]) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = t;
        if (v === key.mode) opt.selected = true;
        mode.appendChild(opt);
      }
      mode.addEventListener("change", () => {
        key.mode = mode.value;
        if (key.mode === "hold" && !key.holdMod && state.combinationDraft?.holdChoice?.mod) {
          key.holdMod = state.combinationDraft.holdChoice.mod;
        }
        if (role === "output") {
          state.combinationDraft.stepsDirty = false;
          syncBuilderSteps();
        }
        if (role === "trigger") syncSetKeys();
        renderBuilder();
      });
      card.appendChild(mode);
    }
    if (role === "trigger" && (setMode || (key.mode === "hold" && holdTap))) {
      const tapRow = document.createElement("label");
      tapRow.className = "bk-row";
      const tapName = document.createElement("span");
      tapName.className = "bk-k";
      tapName.textContent = "Tap";
      const tap = document.createElement("input");
      tap.type = "text";
      tap.className = "bk-tap";
      tap.setAttribute("aria-label", "Tap letter");
      tap.value = key.tap || "";
      tap.placeholder = "letter";
      tap.addEventListener("change", () => {
        key.tap = tap.value.trim();
        syncSetKeys();
        renderBuilder();
      });
      tapRow.append(tapName, tap);
      card.appendChild(tapRow);
      const holdRow = document.createElement("label");
      holdRow.className = "bk-row";
      const holdName = document.createElement("span");
      holdName.className = "bk-k";
      holdName.textContent = "Hold";
      const hold = document.createElement("select");
      hold.setAttribute("aria-label", "Hold modifier");
      for (const [hid, label] of holdMods()) {
        const opt = document.createElement("option");
        opt.value = hid;
        opt.textContent = label;
        if (hid === (key.holdMod || defaultHoldMod())) opt.selected = true;
        hold.appendChild(opt);
      }
      hold.addEventListener("change", () => {
        key.holdMod = hold.value;
        if (i === 0 && state.combinationDraft?.holdChoice?.kind === "modifier") {
          state.combinationDraft.holdChoice = { kind: "modifier", mod: hold.value, binding: `&kp ${hold.value}` };
        }
        syncSetKeys();
        renderBuilder();
      });
      holdRow.append(holdName, hold);
      card.appendChild(holdRow);
      const fn = document.createElement("div");
      fn.className = "bk-fn";
      fn.textContent = setMode ? "Home-row" : "Hold-tap";
      card.appendChild(fn);
    }
    wrap.appendChild(card);
  });
}

function renderBuilderSteps() {
  const wrap = $("builder-steps");
  const draft = state.combinationDraft;
  if (!wrap || !draft) return;
  wrap.replaceChildren();
  if (!draft.steps.length) {
    const empty = document.createElement("div");
    empty.className = "field-hint";
    empty.textContent = "Add output keys to generate Press / Tap / Release steps.";
    wrap.appendChild(empty);
    return;
  }
  draft.steps.forEach((step, i) => {
    const row = document.createElement("div");
    row.className = `macro-step${draft.stepIndex === i ? " active" : ""}`;
    const kind = document.createElement("select");
    for (const [k, label] of [
      ["tap", "Tap"],
      ["press", "Press"],
      ["release", "Release"],
      ["pause", "Pause for release"],
      ["wait", "Wait ms"],
    ]) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = label;
      if (k === step.kind) opt.selected = true;
      kind.appendChild(opt);
    }
    kind.addEventListener("change", () => {
      step.kind = kind.value;
      draft.stepsDirty = true;
      if (step.kind === "pause") step.keys = "";
      if (step.kind === "wait" && !/^\d+$/.test(step.keys)) step.keys = "100";
      renderBuilderSteps();
    });
    const keys = document.createElement("input");
    keys.type = "text";
    keys.value = step.keys || "";
    keys.disabled = step.kind === "pause";
    keys.addEventListener("focus", () => {
      draft.stepIndex = i;
      renderBuilderSteps();
    });
    keys.addEventListener("input", () => {
      step.keys = keys.value;
      draft.stepsDirty = true;
    });
    const rm = document.createElement("button");
    rm.type = "button";
    rm.textContent = "×";
    rm.addEventListener("click", () => {
      draft.steps.splice(i, 1);
      draft.stepsDirty = true;
      renderBuilderSteps();
    });
    row.append(kind, keys, rm);
    wrap.appendChild(row);
  });
}

function addBuilderStep(kind) {
  const draft = state.combinationDraft;
  if (!draft) return;
  draft.stepsDirty = true;
  draft.steps.push(
    kind === "pause" ? { kind: "pause", keys: "" } : kind === "wait" ? { kind: "wait", keys: "100" } : { kind, keys: "&kp A" }
  );
  draft.stepIndex = draft.steps.length - 1;
  $("builder-advanced").checked = true;
  draft.advanced = true;
  renderBuilder();
}

function dropCombinationSource(source) {
  if (!source?.item) return;
  if (source.type === "combo") source.item.deleted = true;
  else if (source.type === "macro") source.item.deleted = true;
  else if (source.type === "hold-tap" || source.type === "behavior") source.item.deleted = true;
}

function holdBehaviorIds() {
  return state.behaviors.filter((b) => !b.deleted && b.kind === "hold-tap").map((b) => b.id);
}

function builderConflicts(draft) {
  const indexes = new Set();
  for (const t of draft.triggers || []) if (t.index != null) indexes.add(t.index);
  for (const k of draft.setKeys || []) if (k.index != null) indexes.add(k.index);
  const out = [];
  const ids = holdBehaviorIds();
  const srcId = draft.source?.item?.id;
  for (const i of indexes) {
    const text = currentBindings()[i]?.text || "";
    if (srcId && text.includes(`&${srcId}`)) continue;
    const hit = describeHoldConflict(text, ids);
    if (hit) out.push({ index: i, ...hit });
  }
  return out;
}

function showConflictDialog(conflicts) {
  const el = $("builder-conflict");
  const text = $("builder-conflict-text");
  if (!el || !text) {
    const ok = window.confirm(
      `This key is already used as:\n  ${conflicts.map((c) => c.label).join("\n  ")}\n\nReplace it?`
    );
    return ok;
  }
  const lines = conflicts.map((c) => `P${c.index}  ${c.label}`).join("\n");
  text.textContent = `This key is already used as:\n  ${lines}\n\nReplace it?`;
  el.hidden = false;
  return null;
}

function findHomeRowBehavior(hand) {
  const prefer = hand === "right" ? ["hmr", "homerow_mods_right"] : ["hml", "homerow_mods_left"];
  const named = (state.profile?.homeRowBehaviors || []).filter((id) =>
    hand === "right" ? /(^hr|right)/i.test(id) : !/(^hr|right)/i.test(id)
  );
  return (
    state.behaviors.find((b) => !b.deleted && b.kind === "hold-tap" && prefer.includes(b.id)) ||
    state.behaviors.find((b) => !b.deleted && b.kind === "hold-tap" && prefer.includes(b.name)) ||
    state.behaviors.find((b) => !b.deleted && b.kind === "hold-tap" && named.includes(b.id))
  );
}

function builderHoldTiming(draft) {
  return {
    tappingTerm: Number($("builder-term")?.value) || draft.tappingTerm || state.settings.tappingTerm,
    quickTap: Number($("builder-quick")?.value) || draft.quickTap || 0,
    priorIdle: Number($("builder-idle")?.value) || draft.priorIdle || 0,
    flavor: $("builder-flavor")?.value || draft.flavor || "balanced",
  };
}

function saveHoldTapFromBuilder(draft, classified, id) {
  const timing = builderHoldTiming(draft);
  const fields = {
    id,
    name: id,
    kind: "hold-tap",
    compatible: "zmk,behavior-hold-tap",
    tappingTerm: timing.tappingTerm,
    quickTap: timing.quickTap,
    priorIdle: timing.priorIdle,
    flavor: timing.flavor,
    bindings: "<&kp>, <&kp>",
    bindingList: ["&kp", "&kp"],
    mods: [],
    keepMods: [],
    triggerPositions: [],
    holdOnRelease: true,
  };
  let behavior = draft.source?.type === "hold-tap" ? draft.source.item : null;
  if (behavior && !behavior.deleted) {
    Object.assign(behavior, fields);
    if (!behavior.added) behavior.edited = true;
  } else {
    if (draft.source && draft.source.type !== "hold-tap") dropCombinationSource(draft.source);
    behavior = { ...fields, added: true, deleted: false, edited: false };
    state.behaviors.push(behavior);
  }
  const tap = classified.tap || "A";
  const hold = classified.hold;
  applyBehaviorAssignments(id, [
    { layer: state.layer, index: classified.index, hold, tap, zero: false, removed: false },
  ]);
}

function saveComboRecord(fields, sourceCombo) {
  if (sourceCombo && !sourceCombo.deleted) {
    Object.assign(sourceCombo, fields);
    if (!sourceCombo.added) sourceCombo.edited = true;
    return sourceCombo;
  }
  const combo = { ...fields, slowRelease: false, guarded: false, added: true, deleted: false };
  state.combos.push(combo);
  return combo;
}

function saveMacroRecord(fields, sourceMacro) {
  if (sourceMacro && !sourceMacro.deleted) {
    Object.assign(sourceMacro, fields);
    if (!sourceMacro.added) sourceMacro.edited = true;
    return sourceMacro;
  }
  const macro = { ...fields, added: true, deleted: false, edited: false };
  state.macros.push(macro);
  return macro;
}

function saveHoldTapSetFromBuilder(draft, classified, used) {
  const seed = classified.index;
  const hand = keyHand(seed);
  const existing =
    (draft.source?.type === "hold-tap" && draft.source.item && !draft.source.item.deleted
      ? draft.source.item
      : null) || findHomeRowBehavior(hand);
  const prefer = existing?.id || (hand === "right" ? "hmr" : "hml");
  const id = existing && !existing.deleted ? existing.id : uniqueSlug(prefer, used);
  const timing = builderHoldTiming({
    tappingTerm: draft.tappingTerm || existing?.tappingTerm,
    quickTap: draft.quickTap ?? existing?.quickTap,
    priorIdle: draft.priorIdle ?? existing?.priorIdle,
    flavor: draft.flavor || existing?.flavor,
  });
  const fields = {
    id,
    name: existing?.name || id,
    kind: "hold-tap",
    compatible: "zmk,behavior-hold-tap",
    tappingTerm: timing.tappingTerm,
    quickTap: timing.quickTap,
    priorIdle: timing.priorIdle,
    flavor: timing.flavor,
    bindings: "<&kp>, <&kp>",
    bindingList: ["&kp", "&kp"],
    mods: [],
    keepMods: [],
    triggerPositions:
      existing?.triggerPositions?.length
        ? existing.triggerPositions
        : state.keys.map((_, i) => i).filter((i) => keyHand(i) !== hand),
    holdOnRelease: existing?.holdOnRelease ?? true,
  };
  let behavior = existing && !existing.deleted ? existing : null;
  if (behavior) {
    Object.assign(behavior, fields);
    if (!behavior.added) behavior.edited = true;
  } else {
    if (draft.source && draft.source.type !== "hold-tap") dropCombinationSource(draft.source);
    behavior = { ...fields, added: true, deleted: false, edited: false };
    state.behaviors.push(behavior);
  }
  const prev = collectAssignments(id, "hold-tap").filter((a) => a.layer === state.layer);
  const assigns = (classified.setKeys || []).map((k) => ({
    layer: state.layer,
    index: k.index,
    hold: k.hold,
    tap: k.tap || "A",
    zero: false,
    removed: false,
  }));
  for (const a of prev) {
    if (!assigns.some((x) => x.index === a.index)) assigns.push({ ...a, removed: true });
  }
  applyBehaviorAssignments(id, assigns);
  return id;
}

function pushSavedCombinationToRuntime({ macros = [], combos = [], behaviors = [] } = {}) {
  if (!state.runtime) return { ok: false };
  const hasItems = macros.length || combos.length || behaviors.length;
  if (!hasItems) return { ok: false };
  try {
    const result = importKeymapRuntimeObjects({
      snapshot: state.runtime.draft,
      capabilities: state.runtime.capabilities,
      layers: state.layers,
      macros,
      combos,
      behaviors,
      studioBehaviors: state.studio?.behaviors,
      studioLayers: studioEncodeLayers(),
    });
    state.runtime.draft = result.draft;
    renderCombinations();
    return {
      ok: result.imported.length > 0,
      imported: result.imported,
      skipped: result.skipped,
    };
  } catch (error) {
    return { ok: false, error };
  }
}

function announceSavedCombination(kind, item, { created } = {}) {
  const runtime = pushSavedCombinationToRuntime({
    macros: kind === "macro" && item ? [item] : [],
    combos: kind === "combo" && item ? [item] : [],
    behaviors: (kind === "hold-tap" || kind === "behavior") && item ? [item] : [],
  });
  if (runtime.ok) {
    setStatus(`${item.id || kind} is in the Running Configuration draft. Apply to save it on the keyboard.`);
    return true;
  }
  if (kind === "combo") showFlashNeeded("combo", item?.id, { created });
  else if (kind === "macro") showFlashNeeded("macro", item?.id, { created });
  else if (kind === "hold-tap" || kind === "behavior") showFlashNeeded("behavior", item?.id, { created });
  else showFlashNeeded("params", item?.id || kind, { created: false });
  return false;
}

function saveCombinationBuilder() {
  const draft = state.combinationDraft;
  if (!draft || draft.source?.item?.guarded) {
    closeCombinationBuilder();
    return;
  }
  const classified = classifyCombination(draft);
  if (classified.kind === "hold-pick") {
    setStatus("Pick what Hold should send: a layer, a modifier, or another key.");
    return;
  }
  if (classified.kind === "remap" && !classified.binding) {
    setStatus("Pick the remapped output from the palette.");
    return;
  }
  if (!draft.replaceOk) {
    const conflicts = builderConflicts(draft);
    if (conflicts.length) {
      const instant = showConflictDialog(conflicts);
      if (instant === false) return;
      if (instant == null) return;
      draft.replaceOk = true;
    }
  }
  const typed = $("builder-name").value.trim();
  draft.name = typed;
  const used = usedCombinationIds();
  const id = uniqueSlug(suggestedName({ ...draft, name: typed }, classified), used);
  const layers = parseLayersField($("builder-layers").value);
  if (layers == null) {
    setStatus("Layers must be blank or numbers like 0 or 0 1.");
    return;
  }
  const timeout = Number($("builder-timeout").value) || draft.timeout || state.settings.comboTimeout;
  const steps = draft.stepsDirty ? draft.steps.map((s) => ({ ...s })) : macroStepsFromKeys(draft.outputs);

  if (classified.kind === "layer-hold") {
    const target = state.layers.findIndex((l) => layerToken(l.id) === classified.layer);
    let host = state.layer;
    if (target >= 0 && host === target) host = target === 0 ? 1 : 0;
    if (host < 0 || host >= state.layers.length) host = 0;
    state.layer = host;
    assignBinding(classified.index, classified.binding);
    closeCombinationBuilder();
    selectLayer(host);
    selectOnly(classified.index);
    const hostName = displayLayerName(state.layers[host]?.id);
    setStatus(`Hold P${classified.index} on ${hostName} opens ${classified.layer}.`);
    if (!state.layers.some((l) => layerToken(l.id) === classified.layer && !l.added)) {
      showFlashNeeded("layer", classified.layer);
    }
    return;
  }

  if (classified.kind === "remap") {
    assignBinding(classified.index, classified.binding);
    closeCombinationBuilder();
    setStatus(`P${classified.index} → ${classified.binding}`);
    return;
  }

  if (classified.kind === "hold-tap-set") {
    if (!classified.setKeys?.length) {
      setStatus("Add at least one home-row key.");
      return;
    }
    const saved = saveHoldTapSetFromBuilder(draft, classified, used);
    setDirty(true);
    closeCombinationBuilder();
    renderPalette();
    const beh = state.behaviors.find((b) => !b.deleted && b.id === saved);
    announceSavedCombination("hold-tap", beh, { created: !!beh?.added });
    return;
  }

  if (classified.kind === "hold-tap") {
    if (classified.index == null || !classified.hold) {
      setStatus("Pick one layout key and what Hold should send.");
      return;
    }
    saveHoldTapFromBuilder(draft, classified, id);
    setDirty(true);
    closeCombinationBuilder();
    renderPalette();
    const beh = state.behaviors.find((b) => !b.deleted && b.id === id);
    announceSavedCombination("hold-tap", beh, { created: !!beh?.added });
    return;
  }

  if (classified.kind === "combo" && !classified.needsMacro) {
    if (classified.positions.length < 2) {
      setStatus("A combo needs at least two trigger keys.");
      return;
    }
    if (!classified.output) {
      setStatus("Pick an output key from the palette.");
      return;
    }
    if (draft.source && draft.source.type !== "combo") dropCombinationSource(draft.source);
    const linkedMacro = comboLinkedMacroId(
      { id, binding: classified.output },
      state.macros.filter((item) => !item.deleted).map((item) => item.id)
    );
    saveComboRecord(
      {
        id,
        positions: classified.positions,
        binding: linkedMacro ? `&${linkedMacro}` : classified.output,
        layers,
        timeout,
      },
      draft.source?.type === "combo" ? draft.source.item : null
    );
    setDirty(true);
    closeCombinationBuilder();
    const saved = state.combos.find((c) => !c.deleted && c.id === id);
    announceSavedCombination("combo", saved, { created: !!saved?.added });
    return;
  }

  if (!steps.length) {
    setStatus("Add output keys, or open advanced and add steps.");
    return;
  }
  const keepCombo = !!(classified.needsCombo || classified.kind === "combo");
  if (draft.source && draft.source.type !== "macro" && !(keepCombo && draft.source.type === "combo")) {
    dropCombinationSource(draft.source);
  }
  saveMacroRecord(
    { id, name: id, waitMs: null, steps },
    draft.source?.type === "macro" ? draft.source.item : null
  );
  if (keepCombo) {
    const positions = (classified.positions || (draft.triggers || []).map((t) => t.index)).filter((n) => n != null);
    if (positions.length >= 2) {
      const existing =
        draft.source?.combo ||
        (draft.source?.type === "combo" ? draft.source.item : null) ||
        state.combos.find((c) => !c.deleted && c.binding === `&${id}`);
      const comboId = existing?.id || uniqueSlug(`combo_${id}`, usedCombinationIds());
      saveComboRecord(
        { id: comboId, positions, binding: `&${id}`, layers, timeout },
        existing || null
      );
    }
  } else if (classified.bindIndex != null) {
    assignBinding(classified.bindIndex, `&${id}`, { quiet: true });
  }
  setDirty(true);
  closeCombinationBuilder();
  renderPalette();
  const mac = state.macros.find((m) => !m.deleted && m.id === id);
  const comboWrap = state.combos.find((c) => !c.deleted && c.binding === `&${id}`);
  if (state.runtime && (mac || comboWrap)) {
    const runtime = pushSavedCombinationToRuntime({
      macros: mac ? [mac] : [],
      combos: comboWrap ? [comboWrap] : [],
    });
    if (runtime.ok) {
      setStatus(`${id} is in the Running Configuration draft. Apply to save it on the keyboard.`);
      return;
    }
  }
  if (mac?.added) showFlashNeeded("macro", id);
  else if (comboWrap?.added) showFlashNeeded("combo", comboWrap.id);
  else showFlashNeeded("params", `&${id}`, { created: false });
}

function deleteCurrentCombination() {
  const source = state.combinationDraft?.source;
  if (!source?.item) {
    closeCombinationBuilder();
    return;
  }
  deleteCombinationItem({ type: source.type, source: source.item, title: source.item.id });
  closeCombinationBuilder();
}

function slugComboId(name, positions) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (slug) return slug.startsWith("combo_") ? slug : `combo_${slug}`;
  return `combo_${positions.join("_")}`;
}

function parseLayersField(raw) {
  const t = String(raw || "").trim();
  if (!t) return "all";
  const nums = t.split(/[,\s]+/).filter(Boolean).map(Number);
  if (!nums.length || nums.some((n) => Number.isNaN(n))) return null;
  return nums;
}

function updateComboDialogView() {
  const draft = state.comboDraft;
  if (!draft) return;
  const labels = draft.positions.map(comboKeyCaption);
  $("combo-keys-pill").textContent = draft.positions.length
    ? `keys: ${labels.join(" + ")}`
    : "keys: click the board";
  $("combo-output-preview").textContent = bindingLabel($("combo-binding").value || "");
}

function openComboDialog(combo) {
  openCombinationBuilder(combo ? { type: "combo", item: combo } : null);
}

function openComboDialogLegacy(combo) {
  if (state.behaviorDraft) closeBehaviorEditor();
  if (state.macroDraft) closeMacroEditor();
  const isNew = !combo;
  const positions = isNew ? [...state.selected].sort((a, b) => a - b) : [...combo.positions];
  state.comboDraft = {
    source: combo || null,
    isNew,
    positions,
  };
  $("combo-dialog-title").textContent = isNew ? "New combo" : "Edit combo";
  $("combo-name").value = isNew ? "" : comboTitle(combo);
  $("combo-binding").value = isNew ? "&kp ESC" : combo.binding;
  $("combo-timeout").value = String(isNew ? state.settings.comboTimeout : combo.timeout || state.settings.comboTimeout);
  $("combo-layers").value = isNew
    ? String(state.layer)
    : combo.layers === "all"
      ? ""
      : combo.layers.join(" ");
  $("combo-delete").hidden = isNew || !!combo.guarded;
  $("combo-save").disabled = !!combo?.guarded;
  $("combo-name").disabled = !!combo?.guarded;
  $("combo-binding").disabled = !!combo?.guarded;
  $("combo-editor").hidden = false;
  $("combo-pick-hint").hidden = false;
  $("combo-pick-hint").textContent = "Click keys on the board to add or remove them from this combo.";
  setEditingMode();
  updateComboDialogView();
  state.selected = new Set(positions);
  renderKeyboard();
  renderCombos();
}

function closeComboDialog() {
  state.comboDraft = null;
  $("combo-editor").hidden = true;
  $("combo-pick-hint").hidden = true;
  setEditingMode();
  renderKeyboard();
  renderCombos();
}

function saveComboDialog() {
  const draft = state.comboDraft;
  if (!draft || draft.source?.guarded) {
    closeComboDialog();
    return;
  }
  const positions = [...new Set(draft.positions)].sort((a, b) => a - b);
  if (positions.length < 2) {
    setStatus("A combo needs at least two keys. Click them on the board.");
    return;
  }
  const binding = $("combo-binding").value.trim();
  if (!binding.startsWith("&")) {
    setStatus("Output must be a binding, e.g. &kp ESC.");
    return;
  }
  const layers = parseLayersField($("combo-layers").value);
  if (layers == null) {
    setStatus("Layers must be blank or numbers like 0 or 0 1.");
    return;
  }
  const timeout = Number($("combo-timeout").value) || state.settings.comboTimeout;
  const name = $("combo-name").value.trim();
  if (draft.isNew) {
    state.combos.push({
      id: slugComboId(name, positions),
      positions,
      binding,
      layers,
      timeout,
      slowRelease: false,
      guarded: false,
      added: true,
      deleted: false,
    });
  } else {
    const c = draft.source;
    if (name) c.id = slugComboId(name, positions);
    c.positions = positions;
    c.binding = binding;
    c.layers = layers;
    c.timeout = timeout;
    if (!c.added) c.edited = true;
  }
  setDirty(true);
  closeComboDialog();
  showFlashNeeded("combo", slugComboId(name, positions) || "combo", { created: !!draft.isNew });
}

function deleteCombo(combo) {
  if (!combo || combo.guarded) return;
  combo.deleted = true;
  setDirty(true);
  if (state.combinationDraft?.source?.item === combo) closeCombinationBuilder();
  else if (state.comboDraft) closeComboDialog();
  else {
    renderKeyboard();
    renderCombos();
    renderInspect();
  }
  showFlashNeeded("params", comboTitle(combo), { created: false });
}

function toggleComboKey(index) {
  if (!state.comboDraft || state.comboDraft.source?.guarded) return;
  const pos = state.comboDraft.positions;
  const at = pos.indexOf(index);
  if (at >= 0) pos.splice(at, 1);
  else pos.push(index);
  pos.sort((a, b) => a - b);
  state.selected = new Set(pos);
  updateComboDialogView();
  renderKeyboard();
}

function usedOnCurrentLayer(id) {
  return layersUsingId(state.layers, id).includes(state.layer);
}

function unusedOnBoard(id) {
  return layersUsingId(state.layers, id).length === 0;
}

function visibleOnCurrentLayer(id, draftId) {
  if (draftId && draftId === id) return true;
  if (usedOnCurrentLayer(id)) return true;
  return unusedOnBoard(id);
}

function renderBehaviors() {
  renderCombinations();
}

function keyHand(index) {
  return state.keys[index]?.hand === "right" ? "right" : "left";
}

function draftIsHomeRow() {
  const draft = state.behaviorDraft;
  if (!draft) return false;
  return isHomeRowBehavior(
    {
      id: $("behavior-id")?.value || draft.source?.id || "",
      name: $("behavior-name")?.value || draft.source?.name || "",
      kind: currentBehaviorKind() || draft.source?.kind || "hold-tap",
      triggerPositions: draft.triggerPositions,
    },
    inspectContext()
  );
}

function holdAssignHint() {
  const using = draftIsHomeRow()
    ? "Indigo = keys using this home-row mod"
    : "Blue = keys using this hold-tap";
  return `Gold = opposite hand. ${using}.`;
}

function behaviorHomeHand(draft) {
  const assigns = (draft?.assignments || []).filter((a) => !a.removed);
  if (assigns.length) {
    const left = assigns.filter((a) => keyHand(a.index) === "left").length;
    return left >= assigns.length / 2 ? "left" : "right";
  }
  const id = $("behavior-id")?.value || draft?.source?.id || "";
  if (/(^hr|right)/i.test(id)) return "right";
  return "left";
}

function isOppositeTrigger(draft, index) {
  return keyHand(index) !== behaviorHomeHand(draft);
}

function behaviorClickMode() {
  return document.querySelector('input[name="behavior-mode"]:checked')?.value || "triggers";
}

function parseHoldTapBinding(text, id) {
  const parts = String(text || "").trim().split(/\s+/);
  if (parts[0] !== `&${id}` || parts.length < 3) return null;
  return { hold: parts[1], tap: parts.slice(2).join(" ") };
}

function collectAssignments(id, kind = "hold-tap") {
  const out = [];
  if (!id) return out;
  state.layers.forEach((layer, li) => {
    layer.bindings.forEach((b, i) => {
      const text = b.text.trim();
      if (kind === "hold-tap") {
        const parsed = parseHoldTapBinding(text, id);
        if (!parsed) return;
        out.push({ layer: li, index: i, hold: parsed.hold, tap: parsed.tap, removed: false });
        return;
      }
      if (text === `&${id}`) {
        out.push({ layer: li, index: i, hold: "", tap: "", zero: true, removed: false });
      }
    });
  });
  return out;
}

const MORPH_MODS = ["LSFT", "RSFT", "LCTL", "RCTL", "LALT", "RALT", "LGUI", "RGUI"];

function fillMorphMods(selected = ["LSFT"]) {
  const wrap = $("morph-mods");
  if (!wrap) return;
  wrap.replaceChildren();
  for (const name of MORPH_MODS) {
    const lab = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = name;
    box.checked = selected.includes(name);
    lab.append(box, document.createTextNode(` ${name}`));
    wrap.appendChild(lab);
  }
}

function selectedMorphMods() {
  return [...document.querySelectorAll("#morph-mods input:checked")].map((el) => el.value);
}

function currentBehaviorKind() {
  return $("behavior-type")?.value || "hold-tap";
}

function syncBehaviorTypeUI() {
  const kind = currentBehaviorKind();
  $("bh-holdtap").hidden = kind !== "hold-tap";
  $("bh-morph").hidden = kind !== "mod-morph";
  $("bh-dance").hidden = kind !== "tap-dance";
  $("behavior-mode").hidden = kind !== "hold-tap";
  $("behavior-keys-pill").hidden = kind !== "hold-tap";
  if (kind !== "hold-tap" && state.behaviorDraft) state.behaviorDraft.placing = true;
}

function tapGuess(index) {
  const text = currentBindings()[index]?.text ?? "";
  const parts = text.trim().split(/\s+/);
  if (parts[0] === "&trans" || parts[0] === "&none" || !parts[0]) return "";
  if (parts[0] === "&kp" && parts[1]) return parts[1];
  if (parts.length >= 3) return parts[parts.length - 1];
  return "";
}

function updateBehaviorView() {
  const draft = state.behaviorDraft;
  if (!draft) return;
  $("behavior-keys-pill").textContent =
    behaviorClickMode() === "mods"
      ? `homerow: ${draft.assignments.filter((a) => !a.removed && a.layer === state.layer).length} on this layer`
      : draft.triggerPositions.length
        ? `triggers: ${draft.triggerPositions.length} keys`
        : "triggers: click the board";
  renderBehaviorAssignments();
}

function renderBehaviorAssignments() {
  const wrap = $("behavior-assigns");
  const draft = state.behaviorDraft;
  if (!wrap || !draft) return;
  wrap.replaceChildren();
  const allLayers = $("behavior-all-layers")?.checked;
  const rows = draft.assignments.filter((a) => !a.removed && (allLayers || a.layer === state.layer));
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "assign-empty";
    empty.textContent = "None on this layer. Use Add below, then click the key on the board.";
    wrap.appendChild(empty);
  }
  for (const a of rows) {
    const row = document.createElement("div");
    row.className = "assign-row";
    const layerName = state.layers[a.layer]?.id.replace(/_layer$/, "") || a.layer;
    const pos = document.createElement("div");
    pos.className = "pos";
    pos.textContent = allLayers ? `${layerName} P${a.index}` : `P${a.index}`;
    const hold = document.createElement("select");
    for (const [id, label] of holdMods()) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = label;
      if (id === a.hold) opt.selected = true;
      hold.appendChild(opt);
    }
    if (!holdMods().some(([id]) => id === a.hold)) {
      const opt = document.createElement("option");
      opt.value = a.hold;
      opt.textContent = a.hold;
      opt.selected = true;
      hold.appendChild(opt);
    }
    hold.addEventListener("change", () => {
      a.hold = hold.value;
    });
    const tap = document.createElement("input");
    tap.type = "text";
    tap.value = a.tap;
    tap.addEventListener("input", () => {
      a.tap = tap.value.trim();
    });
    const rm = document.createElement("button");
    rm.type = "button";
    rm.textContent = "×";
    rm.addEventListener("click", () => {
      a.removed = true;
      updateBehaviorView();
      renderKeyboard();
    });
    row.append(pos, hold, tap, rm);
    wrap.appendChild(row);
  }
}

function openBehaviorEditor(behavior) {
  if (!behavior) {
    openCombinationBuilder(null);
    return;
  }
  if (state.comboDraft) closeComboDialog();
  if (state.macroDraft) closeMacroEditor();
  if (state.combinationDraft) closeCombinationBuilder();
  const isNew = !behavior;
  const id = isNew ? "" : behavior.id;
  state.behaviorDraft = {
    source: behavior || null,
    isNew,
    clickMode: "triggers",
    placing: false,
    triggerPositions: isNew ? [] : [...(behavior.triggerPositions || [])],
    assignments: collectAssignments(id, isNew ? "hold-tap" : behavior.kind),
  };
  state.behaviorDraft.triggerPositions = state.behaviorDraft.triggerPositions.filter((i) =>
    isOppositeTrigger(state.behaviorDraft, i)
  );
  $("behavior-title").textContent = isNew ? "New behavior" : `Edit &${behavior.id}`;
  $("behavior-type").value = isNew ? "hold-tap" : behavior.kind === "other" ? "hold-tap" : behavior.kind;
  $("behavior-type").disabled = !isNew && behavior.kind === "other";
  $("behavior-id").value = id;
  $("behavior-id").disabled = !isNew && behavior.kind === "other";
  $("behavior-name").value = isNew ? "" : behavior.name;
  $("morph-default").value = isNew ? "&kp DOT" : behavior.bindingList?.[0] || "&kp DOT";
  $("morph-held").value = isNew ? "&kp COMMA" : behavior.bindingList?.[1] || "&kp COMMA";
  $("dance-1").value = isNew ? "&kp N1" : behavior.bindingList?.[0] || "&kp N1";
  $("dance-2").value = isNew ? "&kp N2" : behavior.bindingList?.[1] || "&kp N2";
  $("dance-term").value = String(isNew ? 200 : behavior.tappingTerm || 200);
  fillMorphMods(isNew ? ["LSFT"] : behavior.mods?.length ? behavior.mods : ["LSFT"]);
  $("morph-mask").checked = isNew ? true : !(behavior.keepMods && behavior.keepMods.length);
  syncBehaviorTypeUI();
  $("behavior-flavor").value = isNew ? "balanced" : behavior.flavor || "balanced";
  $("behavior-term").value = String(isNew ? state.settings.tappingTerm : behavior.tappingTerm || state.settings.tappingTerm);
  $("behavior-quick").value = String(isNew ? 175 : behavior.quickTap ?? 175);
  $("behavior-idle").value = String(isNew ? 150 : behavior.priorIdle ?? 150);
  $("behavior-on-release").checked = isNew ? true : !!behavior.holdOnRelease;
  $("behavior-delete").hidden = isNew;
  const triggerRadio = document.querySelector('input[name="behavior-mode"][value="triggers"]');
  if (triggerRadio) triggerRadio.checked = true;
  if ($("behavior-all-layers")) $("behavior-all-layers").checked = false;
  state.behaviorDraft.placing = false;
  $("behavior-place")?.closest(".add-row")?.classList.remove("placing");
  $("behavior-editor").hidden = false;
  $("combo-pick-hint").hidden = false;
  $("combo-pick-hint").textContent = holdAssignHint();
  if ($("behavior-add-tap")) $("behavior-add-tap").value = "";
  setEditingMode();
  state.selected = new Set();
  updateBehaviorView();
  renderKeyboard();
  renderBehaviors();
}

function renderMacros() {
  renderCombinations();
}

function renderMacroSteps() {
  const wrap = $("macro-steps");
  const draft = state.macroDraft;
  if (!wrap || !draft) return;
  wrap.replaceChildren();
  $("macro-pill").textContent = `${draft.steps.length} step${draft.steps.length === 1 ? "" : "s"}`;
  draft.steps.forEach((step, i) => {
    const row = document.createElement("div");
    row.className = `macro-step${draft.stepIndex === i ? " active" : ""}`;
    const kind = document.createElement("select");
    for (const [k, label] of [
      ["tap", "Tap"],
      ["press", "Press"],
      ["release", "Release"],
      ["pause", "Pause for release"],
      ["wait", "Wait ms"],
    ]) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = label;
      if (k === step.kind) opt.selected = true;
      kind.appendChild(opt);
    }
    kind.addEventListener("change", () => {
      step.kind = kind.value;
      if (step.kind === "pause") step.keys = "";
      if (step.kind === "wait" && !/^\d+$/.test(step.keys)) step.keys = "100";
      renderMacroSteps();
    });
    const keys = document.createElement("input");
    keys.type = "text";
    keys.placeholder = step.kind === "pause" ? "—" : step.kind === "wait" ? "100" : "&kp LGUI";
    keys.value = step.keys || "";
    keys.disabled = step.kind === "pause";
    keys.addEventListener("focus", () => {
      draft.stepIndex = i;
      renderMacroSteps();
    });
    keys.addEventListener("input", () => {
      step.keys = keys.value;
      updateMacroHint();
      renderKeyboard();
    });
    const rm = document.createElement("button");
    rm.type = "button";
    rm.textContent = "×";
    rm.addEventListener("click", () => {
      draft.steps.splice(i, 1);
      if (draft.stepIndex >= draft.steps.length) draft.stepIndex = Math.max(0, draft.steps.length - 1);
      renderMacroSteps();
    });
    row.append(kind, keys, rm);
    wrap.appendChild(row);
  });
  updateMacroHint();
  renderKeyboard();
}

function updateMacroHint() {
  const hint = $("combo-pick-hint");
  if (!hint || !state.macroDraft) return;
  const tokens = extractMacroTapTokens(state.macroDraft.steps).map(prettyMacroToken);
  const mid = slugBehaviorId($("macro-id")?.value || "") || state.macroDraft.source?.id;
  const bind = mid ? `&${mid}` : "this macro";
  hint.textContent = tokens.length
    ? `Light blue = ${tokens.join(", ")} — the key this macro types. Click a key to bind ${bind} there.`
    : `Click a key on the board to bind ${bind} there. Palette fills the selected step.`;
}

function openMacroEditor(macro) {
  openCombinationBuilder(macro ? { type: "macro", item: macro } : null);
}

function closeMacroEditor() {
  state.macroDraft = null;
  $("macro-editor").hidden = true;
  if (!state.comboDraft && !state.behaviorDraft) {
    $("combo-pick-hint").hidden = true;
  }
  setEditingMode();
  renderMacros();
  renderKeyboard();
}

function addMacroStep(kind) {
  const draft = state.macroDraft;
  if (!draft) return;
  const step =
    kind === "pause"
      ? { kind: "pause", keys: "" }
      : kind === "wait"
        ? { kind: "wait", keys: "100" }
        : { kind, keys: "&kp A" };
  draft.steps.push(step);
  draft.stepIndex = draft.steps.length - 1;
  renderMacroSteps();
  renderKeyboard();
}

function saveMacroEditor() {
  const draft = state.macroDraft;
  if (!draft) return;
  const id = slugBehaviorId($("macro-id").value);
  if (!id) {
    setStatus("Macro needs a label, e.g. mac_lock.");
    return;
  }
  if (draft.isNew && state.macros.some((m) => !m.deleted && m.id === id)) {
    setStatus(`&${id} already exists.`);
    return;
  }
  const waitRaw = $("macro-wait").value.trim();
  const fields = {
    id,
    name: slugBehaviorId($("macro-name").value) || id,
    waitMs: waitRaw === "" ? null : Number(waitRaw),
    steps: draft.steps.map((s) => ({ kind: s.kind, keys: s.keys })),
  };
  if (draft.isNew) state.macros.push({ ...fields, added: true, deleted: false, edited: false });
  else {
    Object.assign(draft.source, fields);
    if (!draft.source.added) draft.source.edited = true;
  }
  setDirty(true);
  closeMacroEditor();
  renderPalette();
  showFlashNeeded("macro", id, { created: !!draft.isNew });
}

function deleteMacro(macro) {
  if (!macro) return;
  const used = state.layers.some((layer) =>
    layer.bindings.some((b) => b.text.trim() === `&${macro.id}`)
  );
  if (used && !window.confirm(`&${macro.id} is used on the keymap. Delete it anyway?`)) return;
  macro.deleted = true;
  setDirty(true);
  if (state.combinationDraft?.source?.item === macro) closeCombinationBuilder();
  else closeMacroEditor();
  renderPalette();
  showFlashNeeded("params", `&${macro.id}`, { created: false });
}

function placeMacroOnKey(index) {
  const id = slugBehaviorId($("macro-id").value) || state.macroDraft?.source?.id;
  if (!id) {
    setStatus("Set a macro label first, then click a key.");
    return;
  }
  assignBinding(index, `&${id}`);
}

function fillMacroStepFromPalette(text) {
  const draft = state.macroDraft;
  if (!draft?.steps.length) return;
  const i = Math.min(draft.stepIndex || 0, draft.steps.length - 1);
  const step = draft.steps[i];
  if (step.kind === "pause") return;
  if (step.kind === "wait") {
    step.keys = text.replace(/\D/g, "") || step.keys;
  } else {
    step.keys = step.keys ? `${step.keys} ${text}` : text;
  }
  renderMacroSteps();
  renderKeyboard();
}

function closeBehaviorEditor() {
  state.behaviorDraft = null;
  $("behavior-editor").hidden = true;
  if (!state.comboDraft && !state.macroDraft) {
    $("combo-pick-hint").hidden = true;
  }
  setEditingMode();
  renderKeyboard();
  renderBehaviors();
}

function slugBehaviorId(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^&/, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_|_$/g, "");
}

function saveBehaviorEditor() {
  const draft = state.behaviorDraft;
  if (!draft) return;
  const id = slugBehaviorId($("behavior-id").value);
  if (!id) {
    setStatus("Behavior needs a label, e.g. hml.");
    return;
  }
  if (draft.isNew && state.behaviors.some((b) => !b.deleted && b.id === id)) {
    setStatus(`&${id} already exists.`);
    return;
  }
  const kind = currentBehaviorKind();
  const mods = selectedMorphMods();
  const fields = {
    id,
    name: slugBehaviorId($("behavior-name").value) || id,
    kind,
    compatible:
      kind === "mod-morph"
        ? "zmk,behavior-mod-morph"
        : kind === "tap-dance"
          ? "zmk,behavior-tap-dance"
          : "zmk,behavior-hold-tap",
    tappingTerm: Number(kind === "tap-dance" ? $("dance-term").value : $("behavior-term").value) || (kind === "tap-dance" ? 200 : state.settings.tappingTerm),
    quickTap: Number($("behavior-quick").value) || 0,
    priorIdle: Number($("behavior-idle").value) || 0,
    flavor: $("behavior-flavor").value || "balanced",
    bindings: "<&kp>, <&kp>",
    bindingList:
      kind === "mod-morph"
        ? [$("morph-default").value.trim() || "&kp DOT", $("morph-held").value.trim() || "&kp COMMA"]
        : kind === "tap-dance"
          ? [$("dance-1").value.trim() || "&kp N1", $("dance-2").value.trim() || "&kp N2"]
          : ["&kp", "&kp"],
    mods,
    keepMods: $("morph-mask").checked ? [] : mods,
    triggerPositions: [...draft.triggerPositions].sort((a, b) => a - b),
    holdOnRelease: $("behavior-on-release").checked,
  };
  if (draft.isNew) {
    state.behaviors.push({ ...fields, added: true, deleted: false, edited: false });
  } else {
    Object.assign(draft.source, fields);
    if (!draft.source.added) draft.source.edited = true;
  }
  applyBehaviorAssignments(id, draft.assignments);
  setDirty(true);
  closeBehaviorEditor();
  renderPalette();
  showFlashNeeded("behavior", id, { created: !!draft.isNew });
}

function applyBehaviorAssignments(id, assignments) {
  for (const a of assignments) {
    const layer = state.layers[a.layer]?.bindings;
    if (!layer?.[a.index]) continue;
    if (a.removed) {
      if (a.zero) {
        if (layer[a.index].text.trim() === `&${id}`) layer[a.index].text = "&trans";
      } else {
        const cur = parseHoldTapBinding(layer[a.index].text, id);
        if (cur) layer[a.index].text = `&kp ${a.tap || cur.tap}`;
      }
      continue;
    }
    if (a.zero) {
      layer[a.index].text = `&${id}`;
      continue;
    }
    if (!a.hold || !a.tap) continue;
    layer[a.index].text = `&${id} ${a.hold} ${a.tap}`;
  }
}

function deleteBehavior(behavior) {
  if (!behavior) return;
  const used = state.layers.some((layer) =>
    layer.bindings.some((b) => b.text.trim().startsWith(`&${behavior.id} `) || b.text.trim() === `&${behavior.id}`)
  );
  if (used && !window.confirm(`&${behavior.id} is used on the keymap. Delete it anyway?`)) return;
  behavior.deleted = true;
  setDirty(true);
  if (state.combinationDraft?.source?.item === behavior) closeCombinationBuilder();
  else closeBehaviorEditor();
  renderPalette();
  showFlashNeeded("params", `&${behavior.id}`, { created: false });
}

function addAssignmentOnKey(index, hold, tap) {
  const draft = state.behaviorDraft;
  if (!draft) return;
  const existing = draft.assignments.find((a) => a.layer === state.layer && a.index === index);
  const zero = !hold && !tap;
  if (existing) {
    existing.removed = false;
    existing.hold = hold;
    existing.tap = tap;
    existing.zero = zero;
  } else {
    draft.assignments.push({ layer: state.layer, index, hold, tap, zero, removed: false });
  }
  draft.placing = false;
  $("behavior-place")?.closest(".add-row")?.classList.remove("placing");
  if ($("behavior-add-tap")) $("behavior-add-tap").value = tap;
  $("behavior-place-hint").textContent = `Added ${hold} + ${tap} on P${index}. Save behavior to keep it.`;
  updateBehaviorView();
  renderKeyboard();
}

function toggleBehaviorKey(index) {
  const draft = state.behaviorDraft;
  if (!draft) return;
  const kind = currentBehaviorKind();
  if (kind === "mod-morph" || kind === "tap-dance") {
    addAssignmentOnKey(index, "", "");
    const row = draft.assignments.find((a) => a.layer === state.layer && a.index === index);
    if (row) row.zero = true;
    return;
  }
  if (draft.placing || behaviorClickMode() === "mods") {
    if (draft.placing) {
      const hold = $("behavior-add-hold")?.value || "LGUI";
      const typed = $("behavior-add-tap")?.value.trim();
      const tap = typed || tapGuess(index);
      addAssignmentOnKey(index, hold, tap);
      return;
    }
    const existing = draft.assignments.find((a) => a.layer === state.layer && a.index === index && !a.removed);
    if (existing) existing.removed = true;
    else {
      const hold = $("behavior-add-hold")?.value || "LGUI";
      addAssignmentOnKey(index, hold, tapGuess(index));
      return;
    }
    state.selected = new Set(
      draft.assignments.filter((a) => !a.removed && a.layer === state.layer).map((a) => a.index)
    );
    updateBehaviorView();
    renderKeyboard();
    return;
  }
  if (!isOppositeTrigger(draft, index)) {
    setStatus("That key is on the same hand as the mods. Use Place on key to assign a hold, or click the opposite hand for triggers.");
    return;
  }
  const pos = draft.triggerPositions;
  const at = pos.indexOf(index);
  if (at >= 0) pos.splice(at, 1);
  else pos.push(index);
  pos.sort((a, b) => a - b);
  updateBehaviorView();
  renderKeyboard();
}

function applyToSelected(text) {
  if (state.runtimeEditor) {
    fillRuntimeEditorFromPalette(text);
    return;
  }
  if (state.combinationDraft) {
    addBuilderOutput(text);
    return;
  }
  if (state.macroDraft) {
    fillMacroStepFromPalette(text);
    return;
  }
  const focus = document.activeElement;
  if (focus?.dataset?.inspect === "key" && $("inspect")?.contains(focus)) {
    if (fillInspectKey(text)) return;
  }
  if (state.comboDraft && !state.comboDraft.source?.guarded) {
    $("combo-binding").value = text;
    updateComboDialogView();
    return;
  }
  if (state.selected.size === 0) {
    setStatus("Select a key first, or drag the binding onto one.");
    return;
  }
  applyBindingSets(
    [...state.selected].map((i) => ({ index: i, text })),
    state.selected.size === 1 ? `P${[...state.selected][0]} → ${text}` : `Assign ${text}`
  );
}

function bindingsDifferFromFile() {
  for (const layer of state.layers) {
    for (const b of layer.bindings) {
      if (b.start == null || b.end == null) return true;
      if (b.text !== state.original.slice(b.start, b.end)) return true;
    }
  }
  return false;
}

function restoreCompiledCombinationsFromKeymapFile() {
  if (!state.original || !keyCount()) return false;
  try {
    const parsed = parseKeymap(state.original, keyCount());
    state.combos = parsed.combos || [];
    state.comboInsertAt = parsed.comboInsertAt ?? state.comboInsertAt;
    state.behaviors = parsed.behaviors || [];
    state.behaviorInsertAt = parsed.behaviorInsertAt ?? state.behaviorInsertAt;
    state.macros = parsed.macros || [];
    state.macroInsertAt = parsed.macroInsertAt ?? state.macroInsertAt;
    return true;
  } catch {
    return false;
  }
}

async function refreshRuntimeFromDevice() {
  if (!state.studio) return null;
  const runtime = await probeRuntimeConfig(state.studio);
  state.runtime = runtime;
  updateStudioButtons();
  renderCombinations();
  return runtime;
}

function keyboardLoadStatus(loaded) {
  const dropped = loaded.dropped?.length ? ` Discarded editor-only: ${loaded.dropped.join(", ")}.` : "";
  if (!loaded.ok) return loaded.reason;
  const overlay = state.runtime ? ` Running Configuration: ${runtimeOverlaySummary()}.` : "";
  const combos = loaded.restoredCombinations
    ? " Combinations are the compiled keymap plus the overlay on the board."
    : "";
  if (loaded.emptyDevice) {
    return `Showing the keyboard (${loaded.layers} layers). Some cells decoded empty. ${loaded.sample || ""}${dropped}${overlay}${combos}`;
  }
  return `Showing the keyboard: ${loaded.layers} layer(s).${dropped}${overlay}${combos}`;
}

async function refreshFromKeyboard() {
  if (!state.studio) {
    setStatus("Connect the left half first.");
    return;
  }
  if (
    state.dirty &&
    !window.confirm("Load from the keyboard and discard editor changes, including any layers not on the board?")
  ) {
    return;
  }
  await state.studio.getKeymap();
  await refreshRuntimeFromDevice();
  const loaded = loadEditorFromKeyboard(state.studio, { replace: true });
  renderCombinations();
  setStatus(keyboardLoadStatus(loaded));
}

function looksLikeZeroKey(text) {
  return isPlaceholderBinding(text);
}

function fileBindingText(binding) {
  if (binding?.start != null && binding?.end != null && state.original) {
    return state.original.slice(binding.start, binding.end);
  }
  return "";
}

function displayBindingText(binding) {
  return binding?.text ?? "";
}

function decodeStudioLayerBindings(studioLayer, behaviors, named) {
  const count = keyCount();
  const bindings = emptyLayerBindings(count);
  const src = studioLayer.bindings || [];
  let skipped = 0;
  for (let i = 0; i < Math.min(count, src.length); i++) {
    const decoded = cellsToBinding(src[i], behaviors, named);
    const next = decoded.ok && !looksLikeZeroKey(decoded.text) ? decoded.text : "&none";
    if (next === "&none") skipped++;
    bindings[i].text = next;
  }
  return { bindings, skipped, slots: Math.min(count, src.length) };
}

function closeOpenEditors() {
  if (state.runtimeEditor) closeRuntimeEditor();
  if (state.combinationDraft) closeCombinationBuilder();
  if (state.comboDraft) closeComboDialog();
  if (state.behaviorDraft) closeBehaviorEditor();
  if (state.macroDraft) closeMacroEditor();
}

function loadEditorFromKeyboard(client, opts = {}) {
  const replace = opts.replace !== false;
  const studioLayers = client.layers || [];
  if (!studioLayers.length) return { ok: false, reason: "empty keymap on device" };
  rememberDeviceLayers(client);
  if (replace) state.flashNotice = null;
  const prev = state.layers;
  const named = studioLayers.map((l, i) => ({
    id: l.id,
    name: displayLayerName(studioLayerId(l, i, prev[i]?.id)),
  }));
  let skipped = 0;
  let slots = 0;
  let changed = 0;
  const decodedLayers = studioLayers.map((sl, li) => {
    const got = decodeStudioLayerBindings(sl, client.behaviors, named);
    skipped += got.skipped;
    slots += got.slots;
    return {
      id: studioLayerId(sl, li, prev[li]?.id),
      bindings: got.bindings,
      start: null,
      end: null,
    };
  });
  const sample = (studioLayers[0]?.bindings || []).slice(0, 6).map((c, i) => {
    const d = cellsToBinding(c, client.behaviors, named);
    return `P${i} id=${c?.behaviorId ?? "?"}/${c?.rawBehaviorId ?? "?"} p1=${c?.param1 ?? "?"} → ${d.text || d.reason}`;
  });

  let dropped = [];
  if (replace) {
    dropped = prev.slice(decodedLayers.length).map((l) => displayLayerName(l.id));
    closeOpenEditors();
    state.layers = decodedLayers;
    state.layer = 0;
    state.layerMenu = null;
    state.layerRename = null;
    state.selected.clear();
    state.history.clear();
    updateHistoryButtons();
    changed = decodedLayers.reduce((n, l) => n + l.bindings.length, 0);
  } else {
    const n = Math.min(prev.length, decodedLayers.length);
    for (let li = 0; li < n; li++) {
      const dest = prev[li].bindings;
      const src = decodedLayers[li].bindings;
      for (let i = 0; i < Math.min(dest.length, src.length); i++) {
        if (dest[i].text !== src[i].text) {
          dest[i].text = src[i].text;
          changed++;
        }
      }
    }
  }

  rememberStockBindings(client);
  state.runtimeDirtyKeys = new Map();
  const restoredCombinations = replace && restoreCompiledCombinationsFromKeymapFile();
  paintRuntimeOverlayOnEditor(state.runtime?.snapshot);
  captureLoadedBindingsSnapshot();
  state.source = "keyboard";
  const vsFile = bindingsDifferFromFile();
  state.dirty = replace ? false : vsFile || extraEditorLayers().length > 0;
  setSync(state.dirty ? "unsaved-and-live" : "saved");
  renderLayers();
  renderKeyboard();
  renderBehaviors();
  renderMacros();
  renderCombos();
  renderInspect();
  renderPalette();
  updateChrome();
  return {
    ok: true,
    changed,
    skipped,
    layers: decodedLayers.length,
    dropped,
    emptyDevice: !!(slots && skipped / slots > 0.4),
    sample: sample.join(" · "),
    restoredCombinations,
  };
}

function studioEncodeLayers() {
  return (state.studio?.layers || []).map((l, i) => ({
    id: l.id,
    name: l.name || state.layers[i]?.id || "",
  }));
}

function allFileBindings() {
  const out = [];
  for (let li = 0; li < state.layers.length; li++) {
    for (let i = 0; i < state.layers[li].bindings.length; i++) {
      out.push({ layer: li, index: i, text: state.layers[li].bindings[i].text });
    }
  }
  return out;
}

function rememberDeviceLayers(client) {
  const layers = client?.layers || state.studio?.layers || [];
  state.deviceLayerCount = layers.length;
}

function layerOnDevice(index) {
  return mapStudioLayerIndex(state.layers, state.studio?.layers || [], index) != null;
}

function studioLayerIndex(fileLayerIndex) {
  return mapStudioLayerIndex(state.layers, state.studio?.layers || [], fileLayerIndex);
}

function extraEditorLayers() {
  if (!state.studio?.layers?.length) return [];
  return state.layers.filter((_, i) => !layerOnDevice(i)).map((l) => displayLayerName(l.id));
}

const FLASH_COPY = {
  layer: {
    title: (n) => (n ? `Added ${n}.` : "New layer."),
    line: "Not connected — download the keymap and flash to add this layer to your board.",
    status: "New layer — download keymap and flash",
  },
  "layer-delete": {
    title: (n) => (n ? `Deleted ${n}.` : "Layer removed."),
    line: "Not connected — download the keymap and flash to remove this layer from your board.",
    status: "Layer removed — download keymap and flash",
  },
  macro: {
    title: (n) => (n ? `Saved &${String(n).replace(/^&/, "")}.` : "New macro."),
    line: "New macros cannot be applied live.",
    status: "New macro — download keymap and flash",
  },
  combo: {
    title: (n) => (n ? `Saved ${n}.` : "New combo."),
    line: "New combos cannot be applied live.",
    status: "New combo — download keymap and flash",
  },
  behavior: {
    title: (n) => (n ? `Saved &${String(n).replace(/^&/, "")}.` : "New behavior."),
    line: "New behaviors cannot be applied live.",
    status: "New behavior — download keymap and flash",
  },
  params: {
    title: (n) => (n ? `Saved ${n}.` : "This change needs a flash."),
    line: "This change cannot be applied live.",
    status: "This change needs a flash",
  },
};

const FLASH_FOOT = "Download the keymap, put it in your firmware repo, and flash.";

function showFlashNeeded(kind, name, { created = true, line = "" } = {}) {
  const key = created ? kind : "params";
  state.flashNotice = { kind: key, name, created, line };
  updateFlashBanner();
  const copy = FLASH_COPY[key] || FLASH_COPY.params;
  setStatus(`${copy.title(name)} ${copy.status}.`);
}

function isFlashRequiredReason(reason) {
  return /download.*flash|flash.*download|cannot be applied live|not live-editable|no Studio parameter metadata|not in this firmware/i.test(
    String(reason || "")
  );
}

function showFlashNeededForBinding(text, reason) {
  const name = String(text || "").trim() || "This binding";
  const line = /&mmv\b|&msc\b|mouse move|scroll|parameter metadata/i.test(`${name} ${reason || ""}`)
    ? "Mouse move/scroll bindings cannot be applied live by this firmware."
    : "This binding cannot be applied live.";
  showFlashNeeded("params", name, { created: false, line });
}

function updateLayerOfflineBanner() {
  updateFlashBanner();
}

function updateFlashBanner() {
  const el = $("layer-offline");
  const text = $("layer-offline-text");
  const titleEl = $("flash-banner-title");
  if (!el) return;
  if (state.studio && !layerOnDevice(state.layer)) {
    const name = displayLayerName(state.layers[state.layer]?.id);
    if (titleEl) titleEl.textContent = `${name} is not on this keyboard.`;
    if (text) {
      text.textContent = `You can edit ${name} here, but Apply cannot add it over USB. The board has no ${name}, so those keys still type the base/transparent letter. ${FLASH_FOOT}`;
    }
    el.hidden = false;
    return;
  }
  if (state.flashNotice) {
    const copy = FLASH_COPY[state.flashNotice.kind] || FLASH_COPY.params;
    if (titleEl) titleEl.textContent = copy.title(state.flashNotice.name);
    if (text) text.textContent = `${state.flashNotice.line || copy.line} ${FLASH_FOOT}`;
    el.hidden = false;
    return;
  }
  el.hidden = true;
}

function queueLive(layer, index, text) {
  if (!state.studio) return;
  // A Runtime Config device commits complete immutable generations. Keep
  // edits local until Apply instead of mixing legacy per-key writes into its
  // runtime overlay.
  if (state.runtime) return;
  if (studioLayerIndex(layer) == null) {
    const name = displayLayerName(state.layers[layer]?.id);
    setStatus(`${name} is not on this keyboard. Apply cannot write it — download the keymap and flash firmware.`);
    return;
  }
  liveQueue.push({ layer, index, text });
  pumpLive();
}

async function pumpLive() {
  if (liveBusy || !state.studio) return;
  liveBusy = true;
  while (liveQueue.length && state.studio) {
    const job = liveQueue.shift();
    try {
      const mapped = studioLayerIndex(job.layer);
      if (mapped == null) {
        setStatus(`${displayLayerName(state.layers[job.layer]?.id)} is not on this keyboard.`);
        continue;
      }
      const result = await state.studio.setBinding(mapped, job.index, job.text, studioEncodeLayers());
      if (!result.ok) {
        if (isFlashRequiredReason(result.reason)) showFlashNeededForBinding(job.text, result.reason);
        setStatus(`On board skipped P${job.index}: ${result.reason}`);
        continue;
      }
      await state.studio.save();
      warnLiveOnce();
      if (state.dirty) setSync("unsaved-and-live");
      setStatus(`On board: layer ${job.layer} P${job.index} → ${job.text}`);
    } catch (err) {
      setStatus(err.message);
      setStudioLabel("Studio: error", "err");
      break;
    }
  }
  liveBusy = false;
}

function warnLiveOnce() {
  if (state.liveWarned) return;
  state.liveWarned = true;
  setStudioLabel("Connected · settings written", "on");
}

async function probeRuntimeConfig(client) {
  try {
    const capabilities = await client.getRuntimeCapabilities({ timeoutMs: 1500 });
    const config = await client.getRuntimeConfig({ timeoutMs: 3000 });
    const keyCount = client.layers?.[0]?.bindings?.length || 0;
    if (
      !keyCount ||
      capabilities.selectedPositionCount !== keyCount ||
      capabilities.selectedToStockPositions?.length !== keyCount
    ) {
      // An older Runtime Config v1 build can understand the RPC but cannot
      // safely translate the editor's selected layout into stock positions.
      // Keep the established Studio path available instead of guessing.
      return null;
    }
    return {
      capabilities,
      snapshot: config.snapshot,
      status: config.status,
      draft: createRuntimeDraft(config.snapshot),
    };
  } catch {
    // Runtime Config is an optional ZMK Next subsystem. Ordinary Studio
    // firmware deliberately keeps its existing connection path untouched.
    return null;
  }
}

// Opens the Studio connection and syncs the small set of chrome that
// reflects "we're now talking to a keyboard." Returns the connected client,
// or null if the user cancelled the port picker, nothing was there to
// connect to, or the connection failed. In the ordinary (non-silent) case
// cancellation/failure is also reported via setStatus/setStudioLabel before
// returning; `silent` (used for the on-load auto-connect attempt, where
// "no keyboard plugged in yet" is a normal outcome, not an error) skips that
// reporting and the "Connecting…" label entirely.
async function establishStudioConnection({ connector = connectStudio, silent = false } = {}) {
  if (!silent) setStudioLabel("Connecting…");
  try {
    const client = await connector();
    if (!client) return null;
    state.studio = client;
    rememberDeviceLayers(client);
    rememberStockBindings(client);
    state.runtimeDirtyKeys = new Map();
    state.runtime = await probeRuntimeConfig(client);
    const deviceLabel = $("runtime-banner-device");
    if (deviceLabel) deviceLabel.textContent = client.deviceName || state.profile?.name || "Keyboard";
    setStudioLabel(state.runtime ? "Connected · Running Configuration ready" : "Connected", "on");
    $("session").classList.add("live");
    updateStudioButtons();
    renderCombinations();
    return client;
  } catch (err) {
    if (silent) return null;
    if (err?.name === "NotFoundError") {
      setStudioLabel("Not connected");
      setStatus("Connect cancelled.");
    } else {
      setStudioLabel("Connect failed", "err");
      setStatus(err.message);
    }
    return null;
  }
}

// Shared dirty-check-then-load-then-report sequence for any path that
// already has a connected client and wants to paint its keymap into the editor.
function loadKeyboardIntoEditor(client) {
  if (
    state.dirty &&
    !window.confirm("Load from the keyboard and discard editor changes, including any layers not on the board?")
  ) {
    updateChrome();
    setStatus(`Connected to ${client.deviceName}. Editor kept local changes. Apply to keyboard to push them.`);
    return;
  }
  const loaded = loadEditorFromKeyboard(client, { replace: true });
  if (!loaded.ok) {
    setStatus(`Connected, but keyboard decode failed: ${loaded.reason}`);
    return;
  }
  renderCombinations();
  setStatus(keyboardLoadStatus(loaded));
}

function runtimeEditorLayers() {
  const editorLayers = [];
  const deviceLayerIds = [];
  const skipped = [];
  for (let layerIndex = 0; layerIndex < state.layers.length; layerIndex++) {
    const mapped = studioLayerIndex(layerIndex);
    const deviceLayer = mapped == null ? null : state.studio?.layers?.[mapped];
    if (!deviceLayer) {
      skipped.push(displayLayerName(state.layers[layerIndex]?.id));
      continue;
    }
    editorLayers.push(state.layers[layerIndex]);
    deviceLayerIds.push(deviceLayer.id);
  }
  return { editorLayers, deviceLayerIds, skipped };
}

function rememberStockBindings(client = state.studio) {
  const layers = client?.layers || [];
  const named = layers.map((layer, index) => ({
    id: layer.id,
    name: displayLayerName(studioLayerId(layer, index)),
  }));
  const map = new Map();
  for (const layer of layers) {
    map.set(
      layer.id,
      decodeStudioLayerBindings(layer, client.behaviors, named).bindings.map((binding) => binding.text)
    );
  }
  state.stockBindingTexts = map;
}

function compiledBindingTextsForDeviceLayers(deviceLayerIds) {
  return deviceLayerIds.map((layerId) => state.stockBindingTexts?.get?.(layerId) || []);
}

function paintRuntimeOverlayOnEditor(snapshot) {
  const caps = state.runtime?.capabilities;
  if (!snapshot?.keymapOverrides?.length || !caps || !state.studio?.layers?.length) return 0;
  const opts = runtimeEncodeOpts();
  let painted = 0;
  for (const override of snapshot.keymapOverrides) {
    const selected = stockToSelectedIndex(caps, override.keyPosition);
    if (selected < 0) continue;
    const studioIndex = (state.studio.layers || []).findIndex((layer) => layer.id === override.layerId);
    if (studioIndex < 0) continue;
    const editorIndex = state.layers.findIndex((_, index) => studioLayerIndex(index) === studioIndex);
    if (editorIndex < 0) continue;
    const text = bindingTextFromAction(override.action, opts);
    const binding = state.layers[editorIndex]?.bindings?.[selected];
    if (!text || !binding) continue;
    binding.text = text;
    painted++;
  }
  return painted;
}

function isUnsafeLiveComboBinding(text) {
  return /host_log_dump|sys_reset|bootloader|studio_unlock|&studio\b|&rst\b|&reset\b/i.test(
    String(text || "")
  );
}

function liveComboImports() {
  const macros = state.macros.filter((item) => !item.deleted);
  const byId = new Map(macros.map((item) => [item.id, item]));
  const used = new Set();
  const combos = [];
  for (const item of state.combos) {
    if (item.deleted || item.guarded || isUnsafeLiveComboBinding(item.binding)) continue;
    const macroId = comboLinkedMacroId(item, byId.keys());
    if (macroId) {
      used.add(macroId);
      combos.push({
        ...item,
        binding: `&${macroId}`,
        timeout: Number(item.timeout) > 0 ? item.timeout : 50,
      });
      continue;
    }
    if (item.added || item.edited) {
      combos.push({
        ...item,
        timeout: Number(item.timeout) > 0 ? item.timeout : 50,
      });
    }
  }
  return {
    macros: macros.filter((item) => used.has(item.id)),
    combos,
  };
}

function overlayFromDirtyKeys(snapshot) {
  const draft = createRuntimeDraft(snapshot);
  const caps = state.runtime?.capabilities;
  const positions = caps?.selectedToStockPositions || [];
  const byKey = new Map(
    (draft.keymapOverrides || []).map((override) => [`${override.layerId}:${override.keyPosition}`, override])
  );
  for (const dirty of state.runtimeDirtyKeys.values()) {
    if (dirty.layerId == null || dirty.index == null) continue;
    const keyPosition = Number(positions[dirty.index]);
    if (!Number.isInteger(keyPosition) || keyPosition < 0) continue;
    byKey.set(`${dirty.layerId}:${keyPosition}`, {
      layerId: dirty.layerId,
      keyPosition,
      action: actionFromBindingText(dirty.text, {
        behaviors: state.studio.behaviors,
        studioLayers: studioEncodeLayers(),
        allowRuntimeObject: true,
        snapshot: draft,
      }),
    });
  }
  draft.keymapOverrides = [...byKey.values()];
  return draft;
}

async function applyRuntimeAll() {
  if (!state.studio || !state.runtime) return;
  if (!state.stockBindingTexts.size) rememberStockBindings();
  const { editorLayers, deviceLayerIds, skipped } = runtimeEditorLayers();
  if (!editorLayers.length) {
    setStatus("No editor layers are present in this firmware. Download the keymap and flash to add them.");
    return;
  }

  let draft;
  try {
    draft = overlayFromDirtyKeys(state.runtime.snapshot);
    draft.runtimeObjects = [];
    draft.combos = [];
    const live = liveComboImports();
    if (live.macros.length || live.combos.length) {
      const imported = importKeymapRuntimeObjects({
        snapshot: draft,
        capabilities: state.runtime.capabilities,
        macros: live.macros,
        combos: live.combos,
        behaviors: [],
        studioBehaviors: state.studio.behaviors,
        studioLayers: studioEncodeLayers(),
      });
      if (imported.skipped.length && !imported.imported.length) {
        throw new RuntimeDraftError(
          imported.skipped.map((item) => `${item.kind} ${item.id}: ${item.reason}`).join("; "),
          imported.skipped
        );
      }
      draft = imported.draft;
    }
    const local = state.runtime.draft;
    for (const object of local?.runtimeObjects || []) {
      if (!draft.runtimeObjects.some((item) => item.id === object.id)) {
        draft.runtimeObjects.push(object);
      }
    }
    for (const combo of local?.combos || []) {
      const objectId = combo.output?.runtimeObjectId;
      if (objectId && !findRuntimeObject(draft, objectId)) continue;
      const key = (combo.keyPositions || []).join(",");
      if (key && draft.combos.some((item) => (item.keyPositions || []).join(",") === key)) continue;
      draft.combos.push(combo);
    }
    for (const combo of draft.combos) {
      const objectId = combo.output?.runtimeObjectId;
      if (objectId && !findRuntimeObject(draft, objectId)) {
        throw new RuntimeDraftError(`Combo ${combo.id} output runtime object ${objectId} is not in this snapshot`);
      }
      if (!combo.output?.runtimeObjectId && !combo.output?.compiledBehavior) {
        throw new RuntimeDraftError(`Combo ${combo.id} has no output action`);
      }
    }
    encodeRuntimeSnapshot({ ...draft, generation: 0 });
    state.runtime.draft = createRuntimeDraft(draft);
  } catch (error) {
    if (error instanceof RuntimeDraftError) {
      const first = error.issues?.[0];
      if (first?.text && isFlashRequiredReason(first.reason)) {
        showFlashNeededForBinding(first.text, first.reason);
      }
      presentRuntimeIssues(runtimeIssuesFromDraftError(error), error.message);
      return;
    }
    throw error;
  }
  const skippedBindings = draft.skippedBindings || [];
  if (!draft.keymapOverrides.length && !draft.runtimeObjects.length && !draft.combos.length) {
    setStatus(
      state.dirty
        ? "That edit did not produce a Running Configuration overlay (it still matches the compiled keymap, or it cannot be encoded live). Change a normal key, then Apply immediately — do not Connect first."
        : "Nothing to save: every key already matches the compiled keymap. Click a key, assign a different letter from the palette, then Apply. Do not Connect until after you see generation 1."
    );
    renderCombinations();
    return;
  }

  const usage = runtimeResourceUsage(draft);
  const over = runtimeResourceOverLimit(usage, state.runtime.capabilities);
  const rows = runtimeResourceRows(usage, state.runtime.capabilities)
    .map((row) => `${row.label} ${row.used}${row.limit == null ? "" : `/${row.limit}`}`)
    .join(", ");
  const prompt =
    "Save one complete Running Configuration snapshot to the keyboard? It will persist through reboot and activate only when the keyboard is idle." +
    `\n\nResource use: ${rows}.` +
    (over ? `\n\nThis draft exceeds firmware limits: ${over}` : "") +
    (skipped.length
      ? `\n\n${skipped.join(", ")} cannot be added live and will remain editor-only. Download and flash to add ${skipped.length === 1 ? "it" : "them"}.`
      : "") +
    (skippedBindings.length
      ? `\n\n${skippedBindings.length} key${skippedBindings.length === 1 ? "" : "s"} stay firmware-compiled because Studio cannot encode them live (mouse-move/scroll, custom behaviors such as &host_log_dump, …).`
      : "");
  if ((state.settings.confirmApply || skipped.length || skippedBindings.length || over) && !window.confirm(prompt)) {
    setStatus("Apply cancelled.");
    return;
  }
  if (over) {
    presentRuntimeIssues([{ kind: "generic", message: `Running Configuration needs ${over}` }], `Cannot apply: ${over}`);
    return;
  }

  state.runtimeIssues = [];
  setStatus(`Saving Running Configuration (${draft.keymapOverrides.length} key overlay(s))…`);
  let validation;
  let commit;
  try {
    ({ validation, commit } = await state.studio.applyRuntimeSnapshot(draft, {
      expectedActiveGeneration: state.runtime.status?.activeGeneration ?? 0,
      onProgress: setStatus,
    }));
  } catch (error) {
    if (error instanceof RuntimeValidationError) {
      presentRuntimeIssues(
        runtimeIssuesFromDiagnostics(error.diagnostics, state.runtime.capabilities),
        error.message
      );
      return;
    }
    throw error;
  }
  const nextSnapshot = createRuntimeDraft({ ...draft, generation: commit.generation });
  state.runtime = {
    ...state.runtime,
    snapshot: nextSnapshot,
    draft: createRuntimeDraft(nextSnapshot),
    status: commit.status || state.studio.runtimeStatus,
  };
  try {
    const live = await state.studio.getRuntimeConfig({ timeoutMs: 8000 });
    if (live?.status) state.runtime.status = live.status;
    const liveGen = Math.max(
      Number(live?.status?.pendingGeneration) || 0,
      Number(live?.status?.activeGeneration) || 0,
      Number(live?.snapshot?.generation) || 0
    );
    if (
      live?.snapshot &&
      (live.status?.activeGeneration || 0) >= commit.generation &&
      (live.status?.activeGeneration || 0) > 0
    ) {
      state.runtime.snapshot = createRuntimeDraft(live.snapshot);
      state.runtime.draft = createRuntimeDraft(live.snapshot);
    }
    if (!liveGen) {
      setStudioLabel("Connected · Running Configuration ready", "on");
      renderCombinations();
      setStatus(
        "Apply returned, but the keyboard still reports generation 0. The overlay did not stay. Keep USB connected, change one key, and Apply once more."
      );
      return;
    }
  } catch {
    // Keep the commit result if readback fails; USB may still be writing.
  }
  state.runtimeDirtyKeys = new Map();
  const pending = state.runtime.status?.pendingGeneration === commit.generation;
  setStudioLabel(
    pending ? "Connected · config saved, waiting for idle" : "Connected · Running Configuration active",
    "on"
  );
  if (pending) startRuntimeIdleWatch(commit.generation);
  else stopRuntimeIdleWatch();
  updateStudioButtons();
  renderKeyboard();
  renderInspect();
  renderCombinations();
  const firmwareUsage = validation.resourceUsage;
  const usageNote = firmwareUsage
    ? ` ${runtimeResourceRows(
        {
          runtimeObjects: firmwareUsage.runtimeObjects?.used,
          combos: firmwareUsage.combos?.used,
          macroSteps: firmwareUsage.macroSteps?.used,
          tapDanceActions: firmwareUsage.tapDanceActions?.used,
          keymapOverrides: firmwareUsage.keymapOverrides?.used,
        },
        {
          limits: {
            maxRuntimeObjects: firmwareUsage.runtimeObjects?.limit,
            maxCombos: firmwareUsage.combos?.limit,
            maxMacroSteps: firmwareUsage.macroSteps?.limit,
            maxTapDanceActions: firmwareUsage.tapDanceActions?.limit,
            maxKeymapOverrides: firmwareUsage.keymapOverrides?.limit,
          },
        }
      )
        .map((row) => `${row.label} ${row.used}/${row.limit ?? "?"}`)
        .join(", ")}.`
    : "";
  setStatus(
    `Saved Running Configuration generation ${commit.generation}` +
      (pending ? "; waiting for keyboard idle before activation." : " and activated.") +
      usageNote
  );
}

async function restoreRuntimeStock() {
  if (!state.studio || !state.runtime) return;
  if (
    !window.confirm(
      "Restore the compiled stock configuration? This saves an empty Running Configuration generation. The previous valid generation remains available for on-device recovery."
    )
  ) {
    setStatus("Restore stock cancelled.");
    return;
  }
  setStatus("Saving stock Running Configuration generation…");
  const reset = await state.studio.resetRuntimeConfig({
    expectedActiveGeneration: state.runtime.snapshot.generation,
  });
  const empty = createRuntimeDraft(
    state.studio.runtimeSnapshot || {
      persistenceSchemaVersion: state.runtime.capabilities.persistenceSchemaVersion,
      generation: reset.generation,
      capabilityFingerprint: state.runtime.capabilities.capabilityFingerprint,
      keymapOverrides: [],
      layers: [],
      runtimeObjects: [],
      combos: [],
    }
  );
  state.runtime = {
    ...state.runtime,
    snapshot: empty,
    draft: createRuntimeDraft(empty),
    status: reset.status || state.studio.runtimeStatus,
  };
  const pending = state.runtime.status?.pendingGeneration === reset.generation;
  setStudioLabel(
    pending ? "Connected · stock saved, waiting for idle" : "Connected · stock configuration active",
    "on"
  );
  if (pending) startRuntimeIdleWatch(reset.generation);
  else stopRuntimeIdleWatch();
  updateStudioButtons();
  renderCombinations();
  setStatus(
    `Saved stock Running Configuration generation ${reset.generation}` +
      (pending ? "; waiting for keyboard idle before activation." : ".") +
      " The editor still shows your local keymap."
  );
}

function runtimeEncodeOpts() {
  return {
    behaviors: state.studio?.behaviors,
    studioLayers: studioEncodeLayers(),
  };
}

function runtimeCombinationEntries() {
  const draft = state.runtime?.draft;
  if (!draft) return [];
  const caps = state.runtime.capabilities;
  const items = [];
  for (const object of draft.runtimeObjects) {
    items.push({
      runtime: true,
      type: object.type,
      id: object.id,
      title: `&rt ${object.id}`,
      detail: runtimeObjectDetail(object),
      tint:
        object.type === "macro"
          ? "kind-macro"
          : object.type === "holdTap"
            ? "kind-holdtap"
            : object.type === "combo"
              ? "kind-combo"
              : "kind-other",
      source: object,
    });
  }
  for (const combo of draft.combos) {
    const selected = stockPositionsToSelectedIndexes(caps, combo.keyPositions);
    items.push({
      runtime: true,
      type: "combo",
      id: combo.id,
      positions: selected,
      title: selected.map((index) => comboKeyCaption(index)).join(" + ") || `Combo ${combo.id}`,
      detail: prettyBindingLabel(bindingTextFromAction(combo.output, runtimeEncodeOpts())) || `combo ${combo.id}`,
      tint: "kind-combo",
      source: combo,
    });
  }
  return items;
}

function runtimeObjectDetail(object) {
  if (object.type === "macro") return `Macro · ${object.steps?.length || 0} steps`;
  if (object.type === "holdTap") return `Hold-tap · ${object.tappingTermMs}ms`;
  if (object.type === "modMorph") return "Mod-morph";
  if (object.type === "tapDance") return `Tap-dance · ${object.actions?.length || 0} counts`;
  return object.type;
}

function runtimeGenerationStatus() {
  const status = state.runtime?.status || {};
  const snap = state.runtime?.snapshot || {};
  return {
    active: Number(status.activeGeneration ?? snap.generation ?? 0),
    pending: Number(status.pendingGeneration ?? 0),
  };
}

function runtimeOverlaySummary() {
  if (!state.runtime) return "";
  const { active, pending } = runtimeGenerationStatus();
  const snap = state.runtime.snapshot || {};
  const keys = (snap.keymapOverrides || []).length;
  const objects = (snap.runtimeObjects || []).length;
  const combos = (snap.combos || []).length;
  const parts = [];
  if (keys) parts.push(`${keys} key${keys === 1 ? "" : "s"} overwritten`);
  if (combos) parts.push(`${combos} combo${combos === 1 ? "" : "s"}`);
  if (objects) parts.push(`${objects} object${objects === 1 ? "" : "s"}`);
  const contents = parts.length ? parts.join(", ") : "stock keymap only";
  return pending && pending !== active ? `${contents} — saved, waiting for idle to activate` : contents;
}

// Generation is a persisted on-device commit counter - real, but meaningless
// to a GUI user. Kept out of headline text and surfaced only as hover detail
// (the banner's "Debug info" affordance).
function runtimeGenerationDebugText() {
  if (!state.runtime) return "";
  const { active, pending } = runtimeGenerationStatus();
  const genLine = pending && pending !== active
    ? `Debug: generation ${pending} saved, waiting for idle. Active generation ${active || "stock"}.`
    : `Debug: active generation ${active}, persisted on-device commit counter.`;
  const overrides = state.runtime.snapshot?.keymapOverrides || [];
  if (!overrides.length) return genLine;
  const opts = runtimeEncodeOpts();
  const layerIds = (state.studio?.layers || []).map((l) => l.id).join(", ");
  const rows = overrides.map(
    (o) => `  layerId=${o.layerId} keyPosition=${o.keyPosition} -> ${bindingTextFromAction(o.action, opts) || "(undecoded)"}`
  );
  return `${genLine}\nkeymapOverrides (${overrides.length}), raw:\n${rows.join("\n")}\nstudio layer ids in order: ${layerIds}`;
}

function renderRuntimeBanner() {
  const label = $("runtime-banner-label");
  const summary = $("runtime-banner-summary");
  const restore = $("runtime-banner-restore");
  const debug = $("runtime-banner-debug");
  if (!label || !summary || !restore || !debug) return;
  const on = !!state.runtime;
  label.hidden = !on;
  summary.textContent = on ? `· ${runtimeOverlaySummary()}` : "";
  restore.hidden = !on;
  restore.disabled = !state.studio;
  debug.hidden = !on;
  debug.title = runtimeGenerationDebugText();
}

function renderRuntimeChrome() {
  const title = $("combinations-title");
  const usage = $("runtime-usage");
  const filters = $("combo-filters");
  const importBtn = $("runtime-import");
  const exportBtn = $("runtime-export");
  const advancedBtn = $("runtime-advanced");
  const errors = $("runtime-errors");
  if (title) title.textContent = "Combinations";
  if (importBtn) importBtn.hidden = !state.runtime || !hasKeymapRuntimeSources();
  if (exportBtn) exportBtn.hidden = !state.runtime;
  if (advancedBtn) advancedBtn.hidden = !state.runtime;
  renderRuntimeBanner();
  if (usage) {
    usage.hidden = !state.runtime;
    usage.replaceChildren();
    if (state.runtime) {
      const gen = document.createElement("span");
      gen.className = "runtime-meter";
      gen.textContent = runtimeOverlaySummary();
      usage.appendChild(gen);
      const used = runtimeResourceUsage(
        state.source === "keyboard" ? state.runtime.snapshot : state.runtime.draft
      );
      for (const row of runtimeResourceRows(used, state.runtime.capabilities)) {
        const span = document.createElement("span");
        span.className = row.over ? "runtime-meter over" : "runtime-meter";
        span.textContent = row.limit == null ? `${row.label} ${row.used}` : `${row.label} ${row.used}/${row.limit}`;
        usage.appendChild(span);
      }
    }
  }
  if (errors) {
    const issues = state.runtimeIssues || [];
    errors.hidden = !issues.length;
    errors.replaceChildren();
    for (const issue of issues.slice(0, 6)) {
      const line = document.createElement("div");
      line.textContent = runtimeIssueLabel(issue);
      errors.appendChild(line);
    }
    if (issues.length > 6) {
      const more = document.createElement("div");
      more.textContent = `${issues.length - 6} more…`;
      errors.appendChild(more);
    }
  }
  if (!filters) return;
  const current = state.combinationFilter || "all";
  const buttons = [
    ["all", "All"],
    ["hold-tap", "Hold-taps"],
    ["combo", "Combos"],
    ["macro", "Macros"],
  ];
  if (state.runtime) {
    const extra = supportedRuntimeEditorTypes(state.runtime.capabilities);
    if (extra.includes("modMorph")) buttons.push(["modMorph", "Mod-morphs"]);
    if (extra.includes("tapDance")) buttons.push(["tapDance", "Tap-dances"]);
  }
  if ([...filters.querySelectorAll("[data-filter]")].map((btn) => btn.dataset.filter).join() !== buttons.map(([id]) => id).join()) {
    filters.replaceChildren();
    for (const [id, label] of buttons) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.filter = id;
      btn.textContent = label;
      if (id === current) btn.classList.add("on");
      filters.appendChild(btn);
    }
    if (!buttons.some(([id]) => id === current)) state.combinationFilter = "all";
  }
}

function runtimeIssueLabel(issue) {
  if (issue.kind === "object") return `Object ${issue.id}: ${issue.message}`;
  if (issue.kind === "combo") return `Combo ${issue.id}: ${issue.message}`;
  if (issue.kind === "key") {
    const where = issue.selectedIndex != null ? `P${issue.selectedIndex}` : `stock ${issue.stockPosition}`;
    return `${where}: ${issue.message}`;
  }
  return issue.message;
}

function currentDeviceLayerId() {
  const mapped = studioLayerIndex(state.layer);
  return mapped == null ? null : state.studio?.layers?.[mapped]?.id;
}

function keyHasRuntimeIssue(index) {
  const layerId = currentDeviceLayerId();
  return (state.runtimeIssues || []).some((issue) => {
    if (issue.kind !== "key") return false;
    if (issue.selectedIndex !== index) return false;
    if (issue.layerIndex != null) return issue.layerIndex === state.layer;
    if (issue.layerId != null) return issue.layerId === layerId;
    return true;
  });
}

function itemHasRuntimeIssue(item) {
  const kind = item.type === "combo" ? "combo" : "object";
  return (state.runtimeIssues || []).some((issue) => issue.kind === kind && issue.id === item.id);
}

function presentRuntimeIssues(issues, message) {
  state.runtimeIssues = issues || [];
  renderKeyboard();
  renderInspect();
  renderCombinations();
  setStatus(message);
  const firstKey = state.runtimeIssues.find((issue) => issue.kind === "key" && issue.selectedIndex != null);
  if (firstKey) {
    if (firstKey.layerIndex != null) selectLayer(firstKey.layerIndex);
    selectOnly(firstKey.selectedIndex);
  }
}

function hasKeymapRuntimeSources() {
  return (
    state.macros.some((item) => !item.deleted) ||
    state.combos.some((item) => !item.deleted) ||
    state.behaviors.some((item) => !item.deleted)
  );
}

function exportRuntimeDocumentFile() {
  if (!state.runtime?.draft) {
    setStatus("Connect a Running Configuration keyboard before exporting a snapshot.");
    return;
  }
  let snapshot = state.runtime.draft;
  try {
    const { editorLayers, deviceLayerIds } = runtimeEditorLayers();
    if (editorLayers.length) {
      snapshot = replaceDraftKeymapOverrides({
        snapshot,
        capabilities: state.runtime.capabilities,
        editorLayers,
        deviceLayerIds,
        behaviors: state.studio?.behaviors,
        studioLayers: studioEncodeLayers(),
      });
    }
  } catch (error) {
    setStatus(`${error.message} Exporting runtime objects without a complete keymap overlay.`);
  }
  const document = encodeRuntimeDocument({
    snapshot,
    capabilities: state.runtime.capabilities,
    profile: state.profile,
    behaviors: state.studio?.behaviors,
    studioLayers: studioEncodeLayers(),
  });
  const name = `${state.profile?.id || "keyboard"}-runtime.json`;
  downloadText(name, stringifyRuntimeDocument(document), "application/json");
  setStatus(`Downloaded ${name}. This is an editor document, not firmware Settings data.`);
}

function importRuntimeDocumentText(text) {
  if (!state.runtime?.snapshot) {
    throw new Error("Connect a Running Configuration keyboard before importing a runtime document.");
  }
  const document = parseRuntimeDocument(text);
  const result = applyRuntimeDocument({
    document,
    snapshot: state.runtime.snapshot,
    capabilities: state.runtime.capabilities,
    behaviors: state.studio?.behaviors,
    studioLayers: studioEncodeLayers(),
  });
  const skipped = result.skipped.map((item) => `${item.kind} ${item.id}: ${item.reason}`).join("\n");
  const prompt = [
    `Replace the local Running Configuration draft with this document (${result.imported.length} imported${result.skipped.length ? `, ${result.skipped.length} skipped` : ""})?`,
    result.warnings.join("\n"),
    skipped,
    "Nothing is written to the keyboard until Apply.",
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!window.confirm(prompt)) {
    setStatus("Runtime document import cancelled.");
    return;
  }
  state.runtime.draft = result.draft;
  state.runtimeIssues = [];
  let rewritten = 0;
  for (const entry of result.keymap) {
    const layerIndex = state.layers.findIndex((_, index) => {
      const mapped = studioLayerIndex(index);
      return mapped != null && state.studio?.layers?.[mapped]?.id === entry.layerId;
    });
    const selected = stockToSelectedIndex(state.runtime.capabilities, entry.stockPosition);
    const binding = state.layers[layerIndex]?.bindings?.[selected];
    if (binding && selected >= 0) {
      binding.text = entry.binding;
      rewritten++;
    }
  }
  setDirty(true);
  renderKeyboard();
  renderInspect();
  renderCombinations();
  setStatus(
    `Loaded runtime document into the local draft` +
      (rewritten ? `, rewrote ${rewritten} key${rewritten === 1 ? "" : "s"}.` : ".") +
      (result.skipped.length ? ` Skipped ${result.skipped.length}.` : "") +
      " Apply to save on the keyboard."
  );
}

function importKeymapToRuntimeDraft() {
  if (!state.runtime?.draft) {
    setStatus("Connect a Running Configuration keyboard before importing keymap objects.");
    return;
  }
  if (!hasKeymapRuntimeSources()) {
    setStatus("This keymap has no macros, combos, or behaviors to import.");
    return;
  }
  const preview = importKeymapRuntimeObjects({
    snapshot: state.runtime.draft,
    capabilities: state.runtime.capabilities,
    layers: state.layers,
    macros: state.macros,
    combos: state.combos,
    behaviors: state.behaviors,
    studioBehaviors: state.studio?.behaviors,
    studioLayers: studioEncodeLayers(),
  });
  const summary = formatRuntimeImportSummary(preview);
  if (!preview.imported.length) {
    window.alert(summary);
    setStatus("No keymap definitions could be imported into Running Configuration.");
    return;
  }
  if (!window.confirm(summary)) {
    setStatus("Import cancelled.");
    return;
  }
  state.runtime.draft = preview.draft;
  let rewritten = 0;
  for (const rewrite of preview.rewrites) {
    const binding = state.layers[rewrite.layerIndex]?.bindings?.[rewrite.keyIndex];
    if (binding && binding.text === rewrite.from) {
      binding.text = rewrite.to;
      rewritten++;
    }
  }
  setDirty(true);
  renderKeyboard();
  renderInspect();
  renderCombinations();
  setStatus(
    `Imported ${preview.imported.length} definition${preview.imported.length === 1 ? "" : "s"} into the local draft` +
      (rewritten ? `, rewrote ${rewritten} key${rewritten === 1 ? "" : "s"} to &rt.` : ".") +
      (preview.skipped.length ? ` Skipped ${preview.skipped.length}.` : "") +
      " Apply to save on the keyboard."
  );
}

function openRuntimeCreator() {
  const types = supportedRuntimeEditorTypes(state.runtime?.capabilities);
  if (!types.length) {
    setStatus("This firmware does not advertise any runtime object types.");
    return;
  }
  const preferred = types.includes("modMorph")
    ? "modMorph"
    : types.includes("tapDance")
      ? "tapDance"
      : types[0];
  openRuntimeEditor({ type: preferred, isNew: true });
}

function openRuntimeEditor(item = null) {
  if (!state.runtime) {
    setStatus("Connect a Running Configuration keyboard to edit live objects.");
    return;
  }
  closeOtherEditors();
  closeRuntimeEditor();
  const type = item?.type || supportedRuntimeEditorTypes(state.runtime.capabilities)[0] || "holdTap";
  const source = item?.source || item?.object || null;
  const isNew = !source;
  state.runtimeEditor = {
    type,
    isNew,
    id: source?.id || (type === "combo" ? nextRuntimeComboId(state.runtime.draft) : nextRuntimeObjectId(state.runtime.draft)),
    source,
    triggers:
      type === "combo" && source
        ? stockPositionsToSelectedIndexes(state.runtime.capabilities, source.keyPositions)
        : [],
    steps:
      type === "macro"
        ? (source?.steps || [{ type: "tap", binding: "&kp A" }]).map((step) => ({
            type: step.type,
            binding: step.binding || bindingTextFromAction(step.action, runtimeEncodeOpts()),
            ms: step.ms || 0,
          }))
        : [{ type: "tap", binding: "&kp A" }],
    danceActions:
      type === "tapDance"
        ? (source?.actions || [{ tapBinding: "&kp A", holdBinding: "&trans" }]).map((action) => ({
            tapBinding: action.tapBinding || bindingTextFromAction(action.tapAction, runtimeEncodeOpts()) || "&kp A",
            holdBinding: action.holdBinding || bindingTextFromAction(action.holdAction, runtimeEncodeOpts()) || "&trans",
          }))
        : [{ tapBinding: "&kp A", holdBinding: "&trans" }],
    focus: type === "combo" ? "output" : "tap",
  };
  const editor = $("runtime-editor");
  if (editor) editor.hidden = false;
  fillRuntimeTypeSelect(type, isNew);
  if ($("runtime-title")) {
    $("runtime-title").textContent = isNew ? "New runtime object" : `Edit ${type === "combo" ? "combo" : runtimeObjectShortLabel(source)}`;
  }
  if ($("runtime-delete")) $("runtime-delete").hidden = isNew;
  if ($("runtime-assign")) $("runtime-assign").hidden = type === "combo";
  if ($("runtime-assign-hint")) $("runtime-assign-hint").hidden = type === "combo";
  if ($("combo-pick-hint")) {
    $("combo-pick-hint").hidden = false;
    $("combo-pick-hint").textContent =
      type === "combo" ? "Click keys on the layout to add or remove combo triggers." : "Click a key to assign this object after it is saved.";
  }
  hydrateRuntimeEditorFields(source);
  renderRuntimeEditor();
  setEditingMode();
  renderKeyboard();
}

function closeRuntimeEditor() {
  state.runtimeEditor = null;
  if ($("runtime-editor")) $("runtime-editor").hidden = true;
  if ($("combo-pick-hint") && !state.comboDraft && !state.behaviorDraft && !state.macroDraft && !state.combinationDraft) {
    $("combo-pick-hint").hidden = true;
  }
  setEditingMode();
  renderKeyboard();
}

function fillRuntimeTypeSelect(selected, isNew) {
  const sel = $("runtime-type");
  if (!sel) return;
  const types = supportedRuntimeEditorTypes(state.runtime?.capabilities);
  sel.replaceChildren();
  for (const type of types) {
    const opt = document.createElement("option");
    opt.value = type;
    opt.textContent = { holdTap: "Hold-tap", macro: "Macro", combo: "Combo", modMorph: "Mod-morph", tapDance: "Tap-dance" }[type] || type;
    if (type === selected) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.disabled = !isNew;
}

function hydrateRuntimeEditorFields(source) {
  const opts = runtimeEncodeOpts();
  if ($("runtime-combo-output")) {
    $("runtime-combo-output").value = source?.output ? bindingTextFromAction(source.output, opts) : "&kp ESC";
  }
  if ($("runtime-combo-timeout")) $("runtime-combo-timeout").value = source?.timeoutMs || state.settings.comboTimeout || 50;
  if ($("runtime-combo-idle")) $("runtime-combo-idle").value = source?.requirePriorIdleMs || 0;
  if ($("runtime-combo-slow")) $("runtime-combo-slow").checked = !!source?.slowRelease;
  if ($("runtime-ht-tap")) $("runtime-ht-tap").value = source?.tapAction ? bindingTextFromAction(source.tapAction, opts) : "&kp A";
  if ($("runtime-ht-hold")) $("runtime-ht-hold").value = source?.holdAction ? bindingTextFromAction(source.holdAction, opts) : "&mo NAV";
  if ($("runtime-ht-flavor")) $("runtime-ht-flavor").value = String(source?.flavor || HOLD_TAP_FLAVOR.BALANCED);
  if ($("runtime-ht-term")) $("runtime-ht-term").value = source?.tappingTermMs || state.settings.tappingTerm || 280;
  if ($("runtime-ht-quick")) $("runtime-ht-quick").value = source?.quickTapMs ?? 175;
  if ($("runtime-ht-idle")) $("runtime-ht-idle").value = source?.requirePriorIdleMs ?? 150;
  if ($("runtime-morph-normal")) {
    $("runtime-morph-normal").value = source?.normalAction ? bindingTextFromAction(source.normalAction, opts) : "&kp DOT";
  }
  if ($("runtime-morph-held")) {
    $("runtime-morph-held").value = source?.morphedAction ? bindingTextFromAction(source.morphedAction, opts) : "&kp COMMA";
  }
  if ($("runtime-dance-term")) $("runtime-dance-term").value = source?.tappingTermMs || 200;
  fillRuntimeMorphMods(source?.modifiers || 0x02);
}

function fillRuntimeMorphMods(mask) {
  const wrap = $("runtime-morph-mods");
  if (!wrap) return;
  wrap.replaceChildren();
  for (const [id, bit, label] of RUNTIME_MODIFIERS) {
    const lab = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = String(bit);
    box.checked = !!(Number(mask) & bit);
    lab.append(box, document.createTextNode(` ${label}`));
    wrap.appendChild(lab);
  }
}

function runtimeMorphMask() {
  let mask = 0;
  for (const box of document.querySelectorAll("#runtime-morph-mods input[type=checkbox]")) {
    if (box.checked) mask |= Number(box.value);
  }
  return mask;
}

function renderRuntimeEditor() {
  const editor = state.runtimeEditor;
  if (!editor) return;
  const type = $("runtime-type")?.value || editor.type;
  editor.type = type;
  for (const [id, show] of [
    ["runtime-combo-fields", type === "combo"],
    ["runtime-macro-fields", type === "macro"],
    ["runtime-holdtap-fields", type === "holdTap"],
    ["runtime-morph-fields", type === "modMorph"],
    ["runtime-dance-fields", type === "tapDance"],
  ]) {
    if ($(id)) $(id).hidden = !show;
  }
  if ($("runtime-assign")) $("runtime-assign").hidden = type === "combo";
  if ($("runtime-pill")) {
    $("runtime-pill").textContent = type === "combo" ? `keys: ${editor.triggers.length || "—"}` : `id ${editor.id}`;
  }
  renderRuntimeTriggers();
  renderRuntimeSteps();
  renderRuntimeDanceActions();
}

function renderRuntimeTriggers() {
  const wrap = $("runtime-triggers");
  const editor = state.runtimeEditor;
  if (!wrap || !editor) return;
  wrap.replaceChildren();
  if (!editor.triggers.length) {
    const empty = document.createElement("div");
    empty.className = "field-hint";
    empty.textContent = "Click keys on the layout.";
    wrap.appendChild(empty);
    return;
  }
  for (const index of editor.triggers) {
    const chip = document.createElement("span");
    chip.className = "builder-key";
    chip.textContent = comboKeyCaption(index);
    wrap.appendChild(chip);
  }
}

function renderRuntimeSteps() {
  const wrap = $("runtime-steps");
  const editor = state.runtimeEditor;
  if (!wrap || !editor) return;
  wrap.replaceChildren();
  editor.steps.forEach((step, i) => {
    const row = document.createElement("div");
    row.className = `macro-step${editor.focus === `step:${i}` ? " active" : ""}`;
    const kind = document.createElement("select");
    for (const [value, label] of [
      ["tap", "Tap"],
      ["press", "Press"],
      ["release", "Release"],
      ["pauseUntilRelease", "Pause for release"],
      ["wait", "Wait ms"],
    ]) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      if (value === step.type) opt.selected = true;
      kind.appendChild(opt);
    }
    kind.addEventListener("change", () => {
      step.type = kind.value;
      if (step.type === "wait" && !step.ms) step.ms = 100;
      renderRuntimeSteps();
    });
    const input = document.createElement("input");
    input.type = step.type === "wait" ? "number" : "text";
    input.value = step.type === "wait" ? step.ms || 0 : step.type === "pauseUntilRelease" ? "" : step.binding || "";
    input.disabled = step.type === "pauseUntilRelease";
    input.addEventListener("focus", () => {
      editor.focus = `step:${i}`;
      renderRuntimeSteps();
    });
    input.addEventListener("input", () => {
      if (step.type === "wait") step.ms = Number(input.value) || 0;
      else step.binding = input.value;
    });
    const rm = document.createElement("button");
    rm.type = "button";
    rm.textContent = "×";
    rm.addEventListener("click", () => {
      editor.steps.splice(i, 1);
      renderRuntimeSteps();
    });
    row.append(kind, input, rm);
    wrap.appendChild(row);
  });
}

function renderRuntimeDanceActions() {
  const wrap = $("runtime-dance-actions");
  const editor = state.runtimeEditor;
  if (!wrap || !editor) return;
  wrap.replaceChildren();
  editor.danceActions.forEach((action, i) => {
    const row = document.createElement("div");
    row.className = "macro-step";
    const label = document.createElement("span");
    label.textContent = `${i + 1}×`;
    const tap = document.createElement("input");
    tap.type = "text";
    tap.value = action.tapBinding || "";
    tap.placeholder = "&kp A";
    tap.addEventListener("focus", () => {
      editor.focus = `dance:${i}:tap`;
    });
    tap.addEventListener("input", () => {
      action.tapBinding = tap.value;
    });
    const hold = document.createElement("input");
    hold.type = "text";
    hold.value = action.holdBinding || "";
    hold.placeholder = "&trans";
    hold.addEventListener("focus", () => {
      editor.focus = `dance:${i}:hold`;
    });
    hold.addEventListener("input", () => {
      action.holdBinding = hold.value;
    });
    const rm = document.createElement("button");
    rm.type = "button";
    rm.textContent = "×";
    rm.addEventListener("click", () => {
      if (editor.danceActions.length === 1) return;
      editor.danceActions.splice(i, 1);
      renderRuntimeDanceActions();
    });
    row.append(label, tap, hold, rm);
    wrap.appendChild(row);
  });
}

function handleRuntimeEditorKey(index) {
  const editor = state.runtimeEditor;
  if (!editor) return;
  if (editor.type === "combo" || $("runtime-type")?.value === "combo") {
    const at = editor.triggers.indexOf(index);
    if (at >= 0) editor.triggers.splice(at, 1);
    else editor.triggers.push(index);
    renderRuntimeEditor();
    renderKeyboard();
    return;
  }
  if (!editor.isNew && editor.id) {
    assignBinding(index, runtimeBindingText(editor.id));
    setStatus(`P${index} → ${runtimeBindingText(editor.id)}. Apply to save this snapshot.`);
  } else {
    setStatus("Save the runtime object to the draft before assigning it to a key.");
  }
}

function fillRuntimeEditorFromPalette(text) {
  const editor = state.runtimeEditor;
  if (!editor) return;
  const type = $("runtime-type")?.value || editor.type;
  const focus = editor.focus;
  if (type === "combo") $("runtime-combo-output").value = text;
  else if (type === "holdTap" && (focus === "hold" || document.activeElement === $("runtime-ht-hold"))) {
    $("runtime-ht-hold").value = text;
  } else if (type === "holdTap") $("runtime-ht-tap").value = text;
  else if (type === "modMorph" && (focus === "morphed" || document.activeElement === $("runtime-morph-held"))) {
    $("runtime-morph-held").value = text;
  } else if (type === "modMorph") $("runtime-morph-normal").value = text;
  else if (type === "macro" && /^step:/.test(focus || "")) {
    const index = Number(focus.split(":")[1]);
    if (editor.steps[index] && editor.steps[index].type !== "wait" && editor.steps[index].type !== "pauseUntilRelease") {
      editor.steps[index].binding = text;
      renderRuntimeSteps();
    }
  } else if (type === "tapDance" && /^dance:/.test(focus || "")) {
    const [, index, which] = focus.split(":");
    if (editor.danceActions[index]) {
      editor.danceActions[index][which === "hold" ? "holdBinding" : "tapBinding"] = text;
      renderRuntimeDanceActions();
    }
  } else {
    setStatus(`Palette: ${text}`);
  }
}

function readRuntimeEditorForm() {
  const editor = state.runtimeEditor;
  const type = $("runtime-type")?.value || editor.type;
  if (type === "combo") {
    return {
      id: editor.id,
      selectedPositions: editor.triggers.slice(),
      timeoutMs: Number($("runtime-combo-timeout").value),
      requirePriorIdleMs: Number($("runtime-combo-idle").value),
      slowRelease: $("runtime-combo-slow").checked,
      outputBinding: $("runtime-combo-output").value.trim(),
    };
  }
  if (type === "macro") {
    return { id: editor.id, type, steps: editor.steps.map((step) => ({ ...step })) };
  }
  if (type === "holdTap") {
    return {
      id: editor.id,
      type,
      tapBinding: $("runtime-ht-tap").value.trim(),
      holdBinding: $("runtime-ht-hold").value.trim(),
      flavor: Number($("runtime-ht-flavor").value),
      tappingTermMs: Number($("runtime-ht-term").value),
      quickTapMs: Number($("runtime-ht-quick").value),
      requirePriorIdleMs: Number($("runtime-ht-idle").value),
    };
  }
  if (type === "modMorph") {
    return {
      id: editor.id,
      type,
      modifiers: runtimeMorphMask(),
      normalBinding: $("runtime-morph-normal").value.trim(),
      morphedBinding: $("runtime-morph-held").value.trim(),
    };
  }
  return {
    id: editor.id,
    type: "tapDance",
    tappingTermMs: Number($("runtime-dance-term").value),
    actions: editor.danceActions.map((action) => ({ ...action })),
  };
}

function saveRuntimeEditor() {
  if (!state.runtime?.draft || !state.runtimeEditor) return;
  const type = $("runtime-type")?.value || state.runtimeEditor.type;
  const form = readRuntimeEditorForm();
  try {
    const next =
      type === "combo"
        ? upsertRuntimeCombo(state.runtime.draft, form, state.runtime.capabilities, runtimeEncodeOpts())
        : upsertRuntimeObject(state.runtime.draft, form, state.runtime.capabilities, runtimeEncodeOpts());
    encodeRuntimeSnapshot(next);
    state.runtime.draft = next;
    state.runtimeEditor.isNew = false;
    state.runtimeEditor.source = type === "combo" ? findRuntimeCombo(next, form.id) : findRuntimeObject(next, form.id);
    if ($("runtime-delete")) $("runtime-delete").hidden = false;
    setDirty(true);
    renderCombinations();
    renderInspect();
    setStatus(`${type === "combo" ? "Combo" : "Runtime object"} ${form.id} saved in the local draft. Apply to keyboard to persist it.`);
  } catch (error) {
    setStatus(error.message);
  }
}

function deleteRuntimeEditorItem(item) {
  if (!state.runtime?.draft) return;
  try {
    if (item.type === "combo") {
      state.runtime.draft = deleteRuntimeCombo(state.runtime.draft, item.id);
    } else {
      const refs = runtimeObjectReferences(state.runtime.draft, item.id, state.runtime.capabilities);
      if (refs.keys.length || refs.combos.length) {
        const where = [
          ...refs.keys.map((key) => `P${key.selectedIndex >= 0 ? key.selectedIndex : key.keyPosition}`),
          ...refs.combos.map((combo) => `combo ${combo.id}`),
        ].join(", ");
        if (!window.confirm(`Runtime object ${item.id} is still used by ${where}. Remove those references first, or delete anyway and fail Apply?`)) {
          setStatus("Delete cancelled.");
          return;
        }
      }
      state.runtime.draft = deleteRuntimeObject(state.runtime.draft, item.id, { force: true, capabilities: state.runtime.capabilities });
    }
    if (state.runtimeEditor?.id === item.id) closeRuntimeEditor();
    setDirty(true);
    renderCombinations();
    renderKeyboard();
    setStatus(`${item.type === "combo" ? "Combo" : "Runtime object"} ${item.id} removed from the local draft. Apply to keyboard to persist.`);
  } catch (error) {
    setStatus(error.message);
  }
}

function deleteCurrentRuntimeEditor() {
  const editor = state.runtimeEditor;
  if (!editor || editor.isNew) {
    closeRuntimeEditor();
    return;
  }
  deleteRuntimeEditorItem({ type: editor.type, id: editor.id, source: editor.source, runtime: true });
}

function assignRuntimeObjectToSelected() {
  const editor = state.runtimeEditor;
  if (!editor || editor.type === "combo") return;
  if (editor.isNew) {
    setStatus("Save the runtime object to the draft first.");
    return;
  }
  if (!state.selected.size) {
    setStatus("Select a key first.");
    return;
  }
  const text = runtimeBindingText(editor.id);
  applyBindingSets(
    [...state.selected].map((index) => ({ index, text })),
    `Assign ${text}`
  );
}

function addRuntimeMacroStep(kind) {
  const editor = state.runtimeEditor;
  if (!editor) return;
  const step =
    kind === "wait"
      ? { type: "wait", ms: 100 }
      : kind === "pause"
        ? { type: "pauseUntilRelease" }
        : { type: kind, binding: "&kp A" };
  editor.steps.push(step);
  editor.focus = `step:${editor.steps.length - 1}`;
  renderRuntimeSteps();
}

async function applyLiveAll() {
  if (!state.studio) {
    setStatus("Connect the left half first.");
    return;
  }
  if (state.runtime) {
    return applyRuntimeAll();
  }
  const extra = extraEditorLayers();
  const prompt = extra.length
    ? `Write the existing firmware layers onto the keyboard?\n\n${extra.join(", ")} cannot be sent over USB (not in this firmware). Download the keymap and flash to add ${extra.length === 1 ? "it" : "them"}.`
    : "Write the current editor bindings onto the connected keyboard?";
  if (state.settings.confirmApply || extra.length) {
    if (!window.confirm(prompt)) {
      setStatus("Apply cancelled.");
      return;
    }
  }
  const jobs = allFileBindings();
  setStatus("Applying file keymap to the board…");
  let ok = 0;
  const skipped = [];
  const flashRequired = [];
  let extraKeys = 0;
  for (const job of jobs) {
    const mapped = studioLayerIndex(job.layer);
    if (mapped == null) {
      extraKeys++;
      continue;
    }
    const layers = studioEncodeLayers();
    const preview = bindingToCells(job.text, state.studio.behaviors, layers);
    if (!preview.ok) {
      skipped.push(`${job.text} L${job.layer} P${job.index} (${preview.reason})`);
      if (isFlashRequiredReason(preview.reason)) flashRequired.push({ text: job.text, reason: preview.reason });
      continue;
    }
    const result = await state.studio.setBinding(mapped, job.index, job.text, layers);
    if (!result.ok) {
      skipped.push(`${job.text} L${job.layer} P${job.index} (${result.reason})`);
      if (isFlashRequiredReason(result.reason)) flashRequired.push({ text: job.text, reason: result.reason });
    }
    else ok++;
  }
  if (ok) {
    await state.studio.save();
    warnLiveOnce();
    await state.studio.getKeymap();
    rememberDeviceLayers(state.studio);
    updateChrome();
  }
  if (flashRequired.length) showFlashNeededForBinding(flashRequired[0].text, flashRequired[0].reason);
  const mouseSkip = skipped.filter((s) => /&mmv\b|&msc\b/.test(s));
  setStatus(
    `Wrote ${ok} keys from this file onto the board.` +
      (skipped.length ? ` Skipped ${skipped.length}: ${skipped.slice(0, 4).join("; ")}${skipped.length > 4 ? "…" : ""}` : "") +
      (mouseSkip.length
        ? " Mouse move/scroll are not live-editable by this firmware because those behaviors expose no Studio parameter metadata; Download and flash the keymap to change them."
        : "") +
      (extraKeys
        ? ` Left ${extraKeys} key(s) on ${extra.join(", ")} in the editor — Apply cannot add a new layer over USB. Download keymap and flash.`
        : "")
  );
}

function downloadText(name, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function loadPickedKeymapFile(file) {
  if (!file) return;
  const text = await file.text();
  const trimmed = text.trim();
  if (file.name.toLowerCase().endsWith(".json") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (isRuntimeDocument(parsed)) {
        importRuntimeDocumentText(parsed);
        return;
      }
    } catch (error) {
      if (file.name.toLowerCase().endsWith(".json")) throw error;
    }
  }
  await ensureLayout();
  loadKeymapText(text, file.name);
}

function saveKeymap() {
  const withKeys = applyLayers(state.original, state.layers, { rows: state.profile?.rows });
  const withCombos = applyCombos(withKeys, state.combos, state.comboInsertAt);
  const withBeh = applyBehaviors(withCombos, state.behaviors, state.behaviorInsertAt);
  const text = applyMacros(withBeh, state.macros, state.macroInsertAt);
  downloadText(state.keymapPath, text);
  setDirty(false);
  setStatus(`Downloaded ${state.keymapPath}. Replace the keymap in your firmware repo, then flash. Combos, macros, and new behaviors are not live.`);
}

function svgMarkup() {
  return buildKeymapSvg(state.keys, state.layers, {
    ...state,
    homeRowBehaviors: state.profile?.homeRowBehaviors || [],
    showColors: state.settings.showColors,
    showPositions: state.settings.showPositions,
  });
}

async function loadText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

function loadKeymapText(text, name = "keymap.keymap", origin = "file") {
  const n = keyCount();
  if (!n) throw new Error("Load a keyboard layout first.");
  const parsed = parseKeymap(text, n);
  if (parsed.layers.length === 0) {
    throw new Error(`No layer with exactly ${n} bindings found.`);
  }
  state.original = text;
  state.keymapPath = name;
  state.sourceLabel = name;
  state.layers = parsed.layers;
  captureLoadedBindingsSnapshot();
  state.combos = parsed.combos || [];
  state.comboInsertAt = parsed.comboInsertAt ?? -1;
  state.behaviors = parsed.behaviors || [];
  state.behaviorInsertAt = parsed.behaviorInsertAt ?? -1;
  state.macros = parsed.macros || [];
  state.macroInsertAt = parsed.macroInsertAt ?? -1;
  closeOpenEditors();
  state.layer = 0;
  state.layerMenu = null;
  state.layerRename = null;
  state.flashNotice = null;
  state.selected.clear();
  state.history.clear();
  updateHistoryButtons();
  state.source = origin === "github" ? "github" : "file";
  setDirty(false);
  renderLayers();
  renderKeyboard();
  renderBehaviors();
  renderMacros();
  renderCombos();
  renderInspect();
  renderPalette();
  const liveHint = state.studio
    ? " Apply live to write this file onto the keyboard."
    : "";
  setStatus(
    `Loaded ${name}: ${parsed.layers.length} layers, ${state.macros.length} macros, ${state.behaviors.length} behaviors, ${state.combos.length} combos.${liveHint}`
  );
}

function fillRepoDiscoverSelects(picked, preferredKeymap) {
  const km = $("repo-keymap");
  const ly = $("repo-layout");
  if (!km || !ly) return;
  km.replaceChildren();
  ly.replaceChildren();
  for (const item of picked.keymaps) {
    const opt = document.createElement("option");
    opt.value = item.path;
    opt.textContent = item.path;
    km.appendChild(opt);
  }
  if (preferredKeymap && [...km.options].some((o) => o.value === preferredKeymap)) km.value = preferredKeymap;
  else if (picked.keymap) km.value = picked.keymap.path;

  const seenBuiltin = new Set();
  if (picked.builtin) {
    const opt = document.createElement("option");
    opt.value = `builtin:${picked.builtin.id}`;
    opt.textContent = `${picked.builtin.name} (built-in)`;
    ly.appendChild(opt);
    seenBuiltin.add(picked.builtin.id);
  }
  for (const item of picked.layouts) {
    const json = String(item.kind || "").includes("json");
    const opt = document.createElement("option");
    opt.value = `${json ? "json" : "dtsi"}:${item.path}`;
    opt.textContent = json ? item.path : `${item.path} (parse .dtsi)`;
    ly.appendChild(opt);
  }
  for (const p of PROFILE_INDEX) {
    if (seenBuiltin.has(p.id)) continue;
    const opt = document.createElement("option");
    opt.value = `builtin:${p.id}`;
    opt.textContent = `${p.name} (built-in)`;
    ly.appendChild(opt);
    seenBuiltin.add(p.id);
  }
  if (picked.layout?.source === "builtin") ly.value = `builtin:${picked.layout.id}`;
  else if (picked.layout?.path) {
    const prefix = picked.layout.source === "json" ? "json" : "dtsi";
    const want = `${prefix}:${picked.layout.path}`;
    if ([...ly.options].some((o) => o.value === want)) ly.value = want;
  } else {
    const ask = document.createElement("option");
    ask.value = "";
    ask.textContent = "Which layout should I use?";
    ly.insertBefore(ask, ly.firstChild);
    ly.value = "";
  }
  updateRepoDiscoverSummary();
}

function updateRepoDiscoverSummary() {
  const el = $("repo-discover-summary");
  if (!el) return;
  const km = $("repo-keymap")?.value || "(none)";
  const ly = $("repo-layout");
  const layoutLabel = ly?.value ? ly.selectedOptions?.[0]?.textContent : "(none — pick a layout)";
  el.textContent = `Found:\n  Keymap:  ${km}\n  Layout:  ${layoutLabel}`;
}

function closeRepoDiscover() {
  const el = $("repo-discover");
  if (el) el.hidden = true;
  const pickers = $("repo-discover-pickers");
  if (pickers) pickers.hidden = true;
  state.repoDiscover = null;
}

function showRepoDiscoverPickers() {
  const pickers = $("repo-discover-pickers");
  if (pickers) pickers.hidden = false;
  const pick = $("repo-discover-pick");
  if (pick) pick.hidden = true;
}

function openRepoDiscover(disc, picked) {
  state.repoDiscover = { ...disc, picked };
  const title = $("repo-discover-title");
  const where = $("repo-discover-repo");
  if (title) title.textContent = "Found in repo";
  if (where) where.textContent = disc.label || "";
  fillRepoDiscoverSelects(picked, disc.preferredKeymap || "");
  const needsPick = !picked.auto || !picked.layout;
  const pickers = $("repo-discover-pickers");
  if (pickers) pickers.hidden = !needsPick;
  const pick = $("repo-discover-pick");
  if (pick) pick.hidden = needsPick;
  $("repo-discover").hidden = false;
}

function applyProfileObject(profile, opts = {}) {
  state.profile = profile;
  state.keys = profile.keys;
  if (opts.imported) state.importedProfile = profile;
  if (opts.persist !== false && PROFILE_INDEX.some((p) => p.id === profile.id)) {
    localStorage.setItem("keymap-layout", profile.id);
  }
  fillLayoutSelect();
  renderKeyboard();
}

async function readDiscoveredFile(path) {
  const disc = state.repoDiscover;
  if (!disc) throw new Error("Nothing to load.");
  if (disc.origin === "github") {
    const { owner, repo, branch } = disc.ref;
    return githubRawFile(owner, repo, branch, path);
  }
  if (disc.origin === "local") {
    return readLocalFile(disc.root, path);
  }
  const file = disc.files?.[path];
  if (!file) throw new Error(`Missing ${path}`);
  return file.text();
}

async function applyDiscoveredRepo() {
  const disc = state.repoDiscover;
  if (!disc) return;
  const kmPath = $("repo-keymap")?.value;
  const lyVal = $("repo-layout")?.value || "";
  if (!kmPath) throw new Error("Pick a keymap file.");
  if (!lyVal) throw new Error("Which layout should I use? Pick a built-in keyboard or a layout file.");
  setStatus(`Loading ${kmPath}…`);
  const [kind, ...rest] = lyVal.split(":");
  const lyPath = rest.join(":");
  if (kind === "builtin") {
    state.importedProfile = null;
    await applyProfileId(lyPath);
  } else if (kind === "json") {
    const json = JSON.parse(await readDiscoveredFile(lyPath));
    applyProfileObject(normalizeProfile(json), { imported: true, persist: false });
  } else {
    const dtsi = await readDiscoveredFile(lyPath);
    const name = `${disc.shortName || "repo"} (${lyPath.split("/").pop()})`;
    applyProfileObject(profileFromDtsi(dtsi, { id: `repo-${disc.shortName || "import"}`, name }), {
      imported: true,
      persist: false,
    });
  }
  const text = await readDiscoveredFile(kmPath);
  if (disc.origin === "github") {
    const { owner, repo, branch } = disc.ref;
    state.githubRef = { owner, repo, branch, path: kmPath };
    localStorage.setItem("keymap-github", `${owner}/${repo}`);
    loadKeymapText(text, `${owner}/${repo}/${kmPath}`, "github");
  } else {
    state.githubRef = null;
    loadKeymapText(text, kmPath, "file");
  }
  closeRepoDiscover();
}

async function loadFromLocalPath(path) {
  setStatus(`Scanning ${path}…`);
  let listed;
  try {
    listed = await listLocalFiles(path);
  } catch (err) {
    if (err.code === "local-scan-unavailable") {
      setStatus("Drop the repo folder onto this window, or paste a GitHub owner/repo. Local paths need python3 apps/web/serve.py.");
      return;
    }
    throw err;
  }
  const picked = pickDiscovery(listed.paths, {
    repoName: listed.root,
    builtins: PROFILE_INDEX,
  });
  if (!picked.keymaps.length) throw new Error(`No .keymap files found in ${listed.root}.`);
  const norm = String(path).replace(/\\/g, "/");
  const preferred =
    picked.keymaps.find((k) => norm.endsWith(`/${k.path}`) || norm.endsWith(k.path))?.path || "";
  openRepoDiscover(
    {
      origin: "local",
      root: listed.root,
      label: listed.root,
      shortName: listed.root.split("/").filter(Boolean).pop() || "local",
      preferredKeymap: preferred,
    },
    picked
  );
  setStatus(`Found ${picked.keymaps.length} keymap(s) in ${listed.root}. Confirm the files to load.`);
}

async function loadFromGitHub() {
  const saved = localStorage.getItem("keymap-github") || "rleyvasal/totem-zmk-config";
  const input = window.prompt("GitHub repo or local path", saved);
  if (!input) return;
  const ref = parseGithubInput(input);
  if (ref?.local) {
    await loadFromLocalPath(ref.local);
    return;
  }
  if (!ref) {
    setStatus("Need owner/repo (e.g. rleyvasal/totem-zmk-config) or a local folder path.");
    return;
  }
  setStatus(`Scanning ${ref.owner}/${ref.repo}…`);
  const listed = await listGithubFiles(ref.owner, ref.repo, ref.branch);
  ref.branch = listed.branch;
  const picked = pickDiscovery(listed.paths, {
    repoName: `${ref.owner}/${ref.repo}`,
    builtins: PROFILE_INDEX,
  });
  if (!picked.keymaps.length) throw new Error(`No .keymap files found in ${ref.owner}/${ref.repo}.`);
  openRepoDiscover(
    {
      origin: "github",
      ref,
      label: `${ref.owner}/${ref.repo}@${ref.branch}`,
      shortName: ref.repo,
      preferredKeymap: ref.path?.endsWith(".keymap") ? ref.path : "",
    },
    picked
  );
  setStatus(`Found ${picked.keymaps.length} keymap(s) in ${ref.owner}/${ref.repo}. Confirm the files to load.`);
}

function collectDroppedFiles(dt) {
  const items = [...(dt.items || [])];
  const entries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) {
    return Promise.resolve([...dt.files].map((file) => ({ path: file.name, file })));
  }
  const out = [];
  const walk = (entry, prefix) =>
    new Promise((resolve, reject) => {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFile) {
        entry.file((file) => {
          out.push({ path, file });
          resolve();
        }, reject);
        return;
      }
      if (!entry.isDirectory) {
        resolve();
        return;
      }
      const reader = entry.createReader();
      const batches = [];
      const readBatch = () => {
        reader.readEntries((chunk) => {
          if (!chunk.length) {
            Promise.all(batches).then(() => resolve()).catch(reject);
            return;
          }
          batches.push(Promise.all(chunk.map((child) => walk(child, path))));
          readBatch();
        }, reject);
      };
      readBatch();
    });
  return Promise.all(entries.map((entry) => walk(entry, ""))).then(() => out);
}

async function loadDroppedRepo(dt) {
  const files = await collectDroppedFiles(dt);
  if (!files.length) return;
  const paths = files.map((f) => f.path);
  const picked = pickDiscovery(paths, {
    repoName: files.map((f) => f.path).join(" "),
    builtins: PROFILE_INDEX,
  });
  const onlyKeymap = files.length === 1 && picked.keymaps.length === 1 && !picked.layouts.length;
  if (onlyKeymap) {
    await loadPickedKeymapFile(files[0].file);
    return;
  }
  if (!picked.keymaps.length) {
    await loadPickedKeymapFile(files[0].file);
    return;
  }
  const fileMap = Object.fromEntries(files.map((f) => [f.path, f.file]));
  const top = files[0].path.split("/")[0] || "dropped";
  openRepoDiscover(
    {
      origin: "drop",
      files: fileMap,
      label: `Dropped ${files.length} files`,
      shortName: top,
      preferredKeymap: picked.keymap?.path || "",
    },
    picked
  );
  setStatus(`Found ${picked.keymaps.length} keymap(s) in the dropped files. Confirm the files to load.`);
}

async function connectToKeyboard() {
  if (state.studio) {
    await refreshFromKeyboard();
    return;
  }
  const client = await establishStudioConnection();
  if (!client) return;
  loadKeyboardIntoEditor(client);
}

function sampleKeymapUrl() {
  const path = state.profile?.sampleKeymap;
  return path ? `../../${path}` : null;
}

function currentProfileId() {
  return $("layout-profile")?.value || localStorage.getItem("keymap-layout") || "totem";
}

function fillLayoutSelect() {
  const sel = $("layout-profile");
  if (!sel) return;
  const current = state.profile?.id || currentProfileId();
  sel.replaceChildren();
  if (state.importedProfile && !PROFILE_INDEX.some((p) => p.id === state.importedProfile.id)) {
    const opt = document.createElement("option");
    opt.value = state.importedProfile.id;
    opt.textContent = state.importedProfile.name;
    if (state.importedProfile.id === current) opt.selected = true;
    sel.appendChild(opt);
  }
  for (const p of PROFILE_INDEX) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === current) opt.selected = true;
    sel.appendChild(opt);
  }
}


async function applyProfileId(id) {
  if (state.importedProfile && state.importedProfile.id === id) {
    applyProfileObject(state.importedProfile, { persist: false });
    return;
  }
  const entry = PROFILE_INDEX.find((p) => p.id === id) || PROFILE_INDEX[0];
  const profile = await loadProfile(entry.url);
  applyProfileObject(profile);
}

async function ensureLayout() {
  if (state.profile && state.keys.length === keyCount()) return;
  await applyProfileId(currentProfileId());
}

async function loadSample() {
  if (!state.profile) await applyProfileId(currentProfileId());
  const url = sampleKeymapUrl();
  if (!url) throw new Error("This layout has no sample keymap.");
  loadKeymapText(await loadText(url), url.split("/").pop());
}

async function switchProfile(id) {
  if (state.dirty && !confirm("Switch layout and discard unsaved keymap edits?")) {
    fillLayoutSelect();
    return;
  }
  await applyProfileId(id);
  try {
    await loadSample();
  } catch (err) {
    setStatus(err.message);
    renderKeyboard();
  }
}

function darkReaderActive() {
  const root = document.documentElement;
  return !!(
    root.dataset.darkreaderMode ||
    root.dataset.darkreaderScheme ||
    document.querySelector("style.darkreader, style[class*='darkreader']")
  );
}

function maybeWarnDarkReader() {
  const el = $("theme-notice");
  if (!el) return;
  if (sessionStorage.getItem("hide-theme-notice")) return;
  const show = () => {
    if (darkReaderActive()) el.hidden = false;
  };
  show();
  setTimeout(show, 400);
  $("theme-notice-x")?.addEventListener("click", () => {
    el.hidden = true;
    sessionStorage.setItem("hide-theme-notice", "1");
  });
}

// Reconnects silently on page load if a port from an earlier session is
// still there to answer - getPorts()/port.open() don't need a user gesture,
// only the picker (requestPort()) does. Loads the keyboard's live keymap
// into the editor on success, same as a manual Connect; does nothing
// (leaving the manual Connect button as the fallback) if no keyboard
// answers.
async function tryAutoConnectOnLoad() {
  const client = await establishStudioConnection({ connector: connectKnownStudioPort, silent: true });
  if (client) loadKeyboardIntoEditor(client);
}

function boot() {
  try {
    maybeWarnDarkReader();
    fillCategorySelect();
    $("category").addEventListener("change", (ev) => {
      state.category = ev.target.value;
      $("search").value = "";
      renderPalette();
    });
    $("search").addEventListener("input", renderPalette);
    $("load-keyboard")?.addEventListener("click", () => {
      connectToKeyboard().catch((err) => setStatus(err.message));
    });
    $("load-github")?.addEventListener("click", () => {
      loadFromGitHub().catch((err) => setStatus(err.message));
    });
    $("repo-discover-use")?.addEventListener("click", () => {
      applyDiscoveredRepo().catch((err) => setStatus(err.message));
    });
    $("repo-discover-cancel")?.addEventListener("click", closeRepoDiscover);
    $("repo-discover-x")?.addEventListener("click", closeRepoDiscover);
    $("repo-discover-pick")?.addEventListener("click", showRepoDiscoverPickers);
    $("repo-keymap")?.addEventListener("change", updateRepoDiscoverSummary);
    $("repo-layout")?.addEventListener("change", updateRepoDiscoverSummary);
    $("repo-discover")?.addEventListener("click", (ev) => {
      if (ev.target.id === "repo-discover") closeRepoDiscover();
    });
    $("studio-apply")?.addEventListener("click", () => {
      applyLiveAll().catch((err) => setStatus(err.message));
    });
    $("runtime-banner-restore")?.addEventListener("click", () => {
      restoreRuntimeStock().catch((err) => setStatus(err.message));
    });
    $("runtime-banner-debug")?.addEventListener("click", () => {
      // Same text as the hover tooltip, also logged so it's easy to copy out
      // of devtools instead of screenshotting a native title tooltip.
      console.log(runtimeGenerationDebugText());
    });
    $("combo-new")?.addEventListener("click", () => {
      openCombinationBuilder(null);
    });
    $("runtime-advanced")?.addEventListener("click", () => {
      openRuntimeCreator();
    });
    $("runtime-import")?.addEventListener("click", () => importKeymapToRuntimeDraft());
    $("runtime-export")?.addEventListener("click", () => exportRuntimeDocumentFile());
    $("runtime-form")?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      saveRuntimeEditor();
    });
    $("runtime-cancel")?.addEventListener("click", closeRuntimeEditor);
    $("runtime-x")?.addEventListener("click", closeRuntimeEditor);
    $("runtime-delete")?.addEventListener("click", deleteCurrentRuntimeEditor);
    $("runtime-assign")?.addEventListener("click", assignRuntimeObjectToSelected);
    $("runtime-type")?.addEventListener("change", () => {
      if (!state.runtimeEditor) return;
      state.runtimeEditor.type = $("runtime-type").value;
      if (state.runtimeEditor.type === "combo") {
        state.runtimeEditor.id = nextRuntimeComboId(state.runtime.draft);
      } else if (state.runtimeEditor.isNew) {
        state.runtimeEditor.id = nextRuntimeObjectId(state.runtime.draft);
      }
      renderRuntimeEditor();
    });
    document.querySelectorAll("[data-runtime-add]").forEach((btn) => {
      btn.addEventListener("click", () => addRuntimeMacroStep(btn.dataset.runtimeAdd));
    });
    $("runtime-dance-add")?.addEventListener("click", () => {
      if (!state.runtimeEditor) return;
      state.runtimeEditor.danceActions.push({ tapBinding: "&kp A", holdBinding: "&trans" });
      renderRuntimeDanceActions();
    });
    $("runtime-ht-tap")?.addEventListener("focus", () => {
      if (state.runtimeEditor) state.runtimeEditor.focus = "tap";
    });
    $("runtime-ht-hold")?.addEventListener("focus", () => {
      if (state.runtimeEditor) state.runtimeEditor.focus = "hold";
    });
    $("runtime-morph-normal")?.addEventListener("focus", () => {
      if (state.runtimeEditor) state.runtimeEditor.focus = "normal";
    });
    $("runtime-morph-held")?.addEventListener("focus", () => {
      if (state.runtimeEditor) state.runtimeEditor.focus = "morphed";
    });
    $("runtime-combo-output")?.addEventListener("focus", () => {
      if (state.runtimeEditor) state.runtimeEditor.focus = "output";
    });
    document.querySelectorAll("[data-builder-step]").forEach((el) => {
      el.addEventListener("click", () => setBuilderStep(el.dataset.builderStep));
    });
    $("combo-filters")?.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-filter]");
      if (!btn) return;
      state.combinationFilter = btn.dataset.filter;
      $("combo-filters").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
      renderCombinations();
    });
    $("builder-form")?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      saveCombinationBuilder();
    });
    $("builder-cancel")?.addEventListener("click", closeCombinationBuilder);
    $("builder-x")?.addEventListener("click", closeCombinationBuilder);
    $("builder-delete")?.addEventListener("click", deleteCurrentCombination);
    $("builder-advanced")?.addEventListener("change", () => {
      if (state.combinationDraft) state.combinationDraft.advanced = $("builder-advanced").checked;
      renderBuilder();
    });
    $("builder-binding")?.addEventListener("input", () => {
      const draft = state.combinationDraft;
      if (!draft || draft.source?.item?.guarded) return;
      const binding = $("builder-binding").value.trim();
      if (!binding || isBrokenComboBinding(binding)) {
        draft.outputs = [];
      } else {
        draft.outputs = [{ binding: asBinding(binding), mode: defaultModeForBinding(binding) }];
      }
      draft.stepsDirty = false;
      syncBuilderSteps();
      if ($("builder-def")) $("builder-def").textContent = formatBuilderDefinition(draft);
    });
    $("builder-term")?.addEventListener("input", () => {
      if (state.combinationDraft) {
        state.combinationDraft.tappingTerm = Number($("builder-term").value) || state.combinationDraft.tappingTerm;
      }
    });
    $("builder-quick")?.addEventListener("input", () => {
      if (state.combinationDraft) state.combinationDraft.quickTap = Number($("builder-quick").value) || 0;
    });
    $("builder-idle")?.addEventListener("input", () => {
      if (state.combinationDraft) state.combinationDraft.priorIdle = Number($("builder-idle").value) || 0;
    });
    $("builder-flavor")?.addEventListener("change", () => {
      if (state.combinationDraft) state.combinationDraft.flavor = $("builder-flavor").value;
    });
    $("builder-timeout")?.addEventListener("input", () => {
      if (state.combinationDraft) state.combinationDraft.timeout = Number($("builder-timeout").value) || state.combinationDraft.timeout;
      if (state.combinationDraft && $("builder-def")) {
        $("builder-def").textContent = formatBuilderDefinition(state.combinationDraft);
      }
    });
    $("builder-layers")?.addEventListener("input", () => {
      if (state.combinationDraft) state.combinationDraft.layers = $("builder-layers").value;
      if (state.combinationDraft && $("builder-def")) {
        $("builder-def").textContent = formatBuilderDefinition(state.combinationDraft);
      }
    });
    $("builder-hold-cats")?.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-hold-cat]");
      if (!btn || !state.combinationDraft) return;
      state.combinationDraft.holdCat = btn.dataset.holdCat;
      renderBuilder();
    });
    document.querySelectorAll("input[name=hrm-mode]").forEach((el) => {
      el.addEventListener("change", () => {
        if (!state.combinationDraft) return;
        state.combinationDraft.hrmMode = el.value;
        if (el.value === "single" && state.combinationDraft.triggers.length > 1) {
          state.combinationDraft.triggers = state.combinationDraft.triggers.slice(0, 1);
          state.selected = new Set(state.combinationDraft.triggers.map((t) => t.index));
        }
        syncSetKeys();
        renderBuilder();
        renderKeyboard();
      });
    });
    $("builder-conflict-cancel")?.addEventListener("click", () => {
      if ($("builder-conflict")) $("builder-conflict").hidden = true;
    });
    $("builder-conflict-replace")?.addEventListener("click", () => {
      if ($("builder-conflict")) $("builder-conflict").hidden = true;
      if (state.combinationDraft) {
        state.combinationDraft.replaceOk = true;
        saveCombinationBuilder();
      }
    });
    document.querySelectorAll("[data-builder-add]").forEach((btn) => {
      btn.addEventListener("click", () => addBuilderStep(btn.dataset.builderAdd));
    });
    $("combo-add")?.addEventListener("click", () => openComboDialog(null));
    $("combo-form")?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      saveComboDialog();
    });
    $("combo-cancel")?.addEventListener("click", () => closeComboDialog());
    $("combo-delete")?.addEventListener("click", () => {
      if (state.comboDraft?.source) deleteCombo(state.comboDraft.source);
    });
    $("combo-binding")?.addEventListener("input", updateComboDialogView);
    $("macro-add")?.addEventListener("click", () => openMacroEditor(null));
    $("macro-form")?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      saveMacroEditor();
    });
    $("macro-cancel").addEventListener("click", () => closeMacroEditor());
    $("macro-delete").addEventListener("click", () => {
      if (state.macroDraft?.source) deleteMacro(state.macroDraft.source);
    });
    document.querySelectorAll("[data-macro-add]").forEach((btn) => {
      btn.addEventListener("click", () => addMacroStep(btn.dataset.macroAdd));
    });
    $("behavior-add")?.addEventListener("click", () => openBehaviorEditor(null));
    $("behavior-type").addEventListener("change", () => {
      syncBehaviorTypeUI();
      $("combo-pick-hint").textContent =
        currentBehaviorKind() === "hold-tap"
          ? holdAssignHint()
          : "Click a key on the board to bind this behavior there.";
    });
    $("behavior-form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      saveBehaviorEditor();
    });
    $("behavior-cancel").addEventListener("click", () => closeBehaviorEditor());
    $("behavior-delete").addEventListener("click", () => {
      if (state.behaviorDraft?.source) deleteBehavior(state.behaviorDraft.source);
    });
    $("behavior-mode").addEventListener("change", () => {
      if (!state.behaviorDraft) return;
      if (behaviorClickMode() === "mods") {
        $("combo-pick-hint").textContent = "Click a home-row key, then set Ctrl / Shift / Alt / GUI for that finger.";
        state.selected = new Set(
          state.behaviorDraft.assignments.filter((a) => !a.removed && a.layer === state.layer).map((a) => a.index)
        );
      } else {
        $("combo-pick-hint").textContent = "Click opposite-hand keys that may complete the hold.";
        state.selected = new Set(state.behaviorDraft.triggerPositions);
      }
      updateBehaviorView();
      renderKeyboard();
    });
    $("behavior-all-layers").addEventListener("change", () => updateBehaviorView());
    fillHoldSelects();
    $("behavior-place").addEventListener("click", () => {
      if (!state.behaviorDraft) return;
      state.behaviorDraft.placing = !state.behaviorDraft.placing;
      $("behavior-place").closest(".add-row")?.classList.toggle("placing", state.behaviorDraft.placing);
      const hold = $("behavior-add-hold").value;
      $("behavior-add-tap").value = "";
      $("behavior-place-hint").textContent = state.behaviorDraft.placing
        ? `Click the key on the board. Hold will be ${hold}; tap comes from that key.`
        : "Choose hold, then Place on key and click the key on the board.";
      $("combo-pick-hint").textContent = state.behaviorDraft.placing
        ? `Click the key that should hold ${hold}. The tap letter fills in from that key.`
        : holdAssignHint();
    });
    $("download").addEventListener("click", saveKeymap);
    $("layer-offline-download")?.addEventListener("click", saveKeymap);
    $("svg").addEventListener("click", () => downloadText("zmk-next-configurator.svg", svgMarkup(), "image/svg+xml"));
    $("undo").addEventListener("click", () => undoBindings());
    $("redo").addEventListener("click", () => redoBindings());
    $("reload")?.addEventListener("click", () => {
      loadSample().catch((err) => setStatus(err.message));
    });
    $("layout-profile")?.addEventListener("change", (ev) => {
      switchProfile(ev.target.value).catch((err) => setStatus(err.message));
    });
    $("open-file")?.addEventListener("change", async (ev) => {
      const file = ev.target.files?.[0];
      ev.target.value = "";
      if (!file) return;
      try {
        await loadPickedKeymapFile(file);
      } catch (err) {
        setStatus(err.message);
      }
    });
    document.querySelector(".file-btn")?.addEventListener("click", () => {
      let opened = false;
      const markOpen = () => {
        opened = true;
      };
      window.addEventListener("blur", markOpen, { once: true });
      $("open-file")?.addEventListener("cancel", markOpen, { once: true });
      window.setTimeout(() => {
        window.removeEventListener("blur", markOpen);
        if (!opened && document.hasFocus()) {
          setStatus(
            "File picker blocked by browser. Try Chrome/Firefox or check Helium settings. You can also drop a .keymap onto this window."
          );
        }
      }, 800);
    });
    window.addEventListener("dragover", (ev) => {
      if (![...ev.dataTransfer.types].includes("Files")) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
    });
    window.addEventListener("drop", async (ev) => {
      if (![...ev.dataTransfer.types].includes("Files")) return;
      ev.preventDefault();
      try {
        await loadDroppedRepo(ev.dataTransfer);
      } catch (err) {
        setStatus(err.message);
      }
    });
    const serialHint = "Web Serial. Pick the silent ZMK Studio RPC port, not printk. Close zmk.studio first.";
    if ($("load-keyboard")) $("load-keyboard").title = serialHint;
    if (!("serial" in navigator)) {
      if ($("load-keyboard")) $("load-keyboard").disabled = true;
      if ($("studio-apply")) $("studio-apply").disabled = true;
      setStatus("Web Serial not available in this browser. Connect requires Chrome, Edge, or another Web Serial browser.");
    }
    $("settings-open")?.addEventListener("click", openSettings);
    $("settings-close")?.addEventListener("click", closeSettings);
    $("settings")?.addEventListener("click", (ev) => {
      if (ev.target.id === "settings") closeSettings();
    });
    $("settings-form")?.addEventListener("change", () => {
      commitSettings({
        os: $("set-os").value,
        emptyBinding: $("set-empty").value,
        showPositions: $("set-positions").checked,
        showColors: $("set-colors").checked,
        showComboPairs: $("set-combo-pairs").checked,
        tappingTerm: $("set-tapping").value,
        comboTimeout: $("set-combo-timeout").value,
        confirmApply: $("set-confirm-apply").checked,
      });
    });
    applySettingsToUi();
    document.addEventListener("pointerdown", (ev) => {
      if (state.drag) return;
      if (!document.querySelector(".ghost")) return;
      if (ev.target.closest?.("[data-zmk-ghost]")) return;
      clearDragGhosts();
    });
    window.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") clearTransientUi();
      if (ev.key === "Escape" && $("repo-discover") && !$("repo-discover").hidden) {
        ev.preventDefault();
        closeRepoDiscover();
        return;
      }
      if (ev.key === "Escape" && $("settings") && !$("settings").hidden) {
        ev.preventDefault();
        closeSettings();
        return;
      }
      if (ev.key === "Escape" && $("builder-conflict") && !$("builder-conflict").hidden) {
        ev.preventDefault();
        $("builder-conflict").hidden = true;
        return;
      }
      if (ev.key === "Escape" && state.combinationDraft) {
        ev.preventDefault();
        closeCombinationBuilder();
        return;
      }
      if (typingInField(ev.target)) return;
      if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && ev.key.toLowerCase() === "n") {
        ev.preventDefault();
        createLayer(state.layers.length - 1);
        return;
      }
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "y" && !ev.shiftKey) {
        ev.preventDefault();
        redoBindings();
        return;
      }
      if (!(ev.metaKey || ev.ctrlKey) || ev.key.toLowerCase() !== "z") return;
      ev.preventDefault();
      if (ev.shiftKey) redoBindings();
      else undoBindings();
    });
    document.addEventListener("click", () => {
      if (state.layerMenu == null) return;
      state.layerMenu = null;
      renderLayers();
    });
    bindBoardDeselect();
    updateStudioButtons();
    updateHistoryButtons();
    fillLayoutSelect();
    renderPalette();
    renderLegend();
    applyProfileId(currentProfileId())
      .then(() => loadSample())
      .catch((err) => {
        setStatus(`${err.message} Serve from the repo root: python3 apps/web/serve.py`);
      });
    tryAutoConnectOnLoad().catch((err) => console.error(err));
  } catch (err) {
    setStatus(`Editor failed to start: ${err.message}`);
    console.error(err);
  }
}

boot();

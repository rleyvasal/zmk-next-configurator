/**
 * Command history: each user action knows how to execute and undo itself.
 * Binding edits store only the changed positions; layer ops store the
 * one layer / remap they need, not a full keymap snapshot.
 */

export class History {
  constructor(maxSize = 50) {
    this.undoStack = [];
    this.redoStack = [];
    this.maxSize = maxSize;
  }

  execute(cmd) {
    cmd.execute();
    this.undoStack.push(cmd);
    this.redoStack = [];
    if (this.undoStack.length > this.maxSize) this.undoStack.shift();
    return cmd;
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    cmd.undo();
    this.redoStack.push(cmd);
    return cmd;
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    cmd.execute();
    this.undoStack.push(cmd);
    return cmd;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  peekUndo() {
    return this.undoStack[this.undoStack.length - 1] || null;
  }

  peekRedo() {
    return this.redoStack[this.redoStack.length - 1] || null;
  }
}

/** Assign / clear / move / swap / copy: { index, before, after }[] on one layer. */
export class BindingSetCommand {
  constructor({ layer, changes, description, apply }) {
    this.layer = layer;
    this.changes = changes;
    this.description = description;
    this.apply = apply;
  }

  execute() {
    this.apply(this.layer, this.changes, "after");
  }

  undo() {
    this.apply(this.layer, this.changes, "before");
  }
}

export class CreateLayerCommand {
  constructor(host, { at, id, bindings, description }) {
    this.host = host;
    this.at = at;
    this.id = id;
    this.bindings = bindings;
    this.description = description || `Add ${id}`;
  }

  execute() {
    this.host.insertLayer(this.at, {
      id: this.id,
      bindings: this.bindings.map((b) => ({ ...b })),
      added: true,
      start: null,
      end: null,
    });
  }

  undo() {
    this.host.removeLayerAt(this.at);
  }
}

export class DuplicateLayerCommand {
  constructor(host, { from, at, id, texts, description }) {
    this.host = host;
    this.from = from;
    this.at = at;
    this.id = id;
    this.texts = texts;
    this.description = description || `Duplicate ${id}`;
  }

  execute() {
    this.host.insertLayer(this.at, {
      id: this.id,
      bindings: this.texts.map((text) => ({ text, start: null, end: null })),
      added: true,
      start: null,
      end: null,
    });
  }

  undo() {
    this.host.removeLayerAt(this.at);
  }
}

export class RenameLayerCommand {
  constructor(host, { index, fromId, toId, description }) {
    this.host = host;
    this.index = index;
    this.fromId = fromId;
    this.toId = toId;
    this.description = description || `Rename ${fromId}`;
  }

  execute() {
    this.host.renameLayerId(this.index, this.fromId, this.toId);
  }

  undo() {
    this.host.renameLayerId(this.index, this.toId, this.fromId);
  }
}

export class DeleteLayerCommand {
  constructor(host, { index, saved, neutralized, combos, description }) {
    this.host = host;
    this.index = index;
    this.saved = saved;
    this.neutralized = neutralized;
    this.combos = combos;
    this.description = description || "Delete layer";
  }

  execute() {
    this.host.neutralizeToken(this.saved.token);
    this.host.removeLayerAt(this.index);
  }

  undo() {
    this.host.insertLayer(this.index, this.saved.layer);
    this.host.restoreBindings(this.neutralized);
    this.host.restoreCombos(this.combos);
  }
}

export class ReorderLayerCommand {
  constructor(host, { from, to, description }) {
    this.host = host;
    this.from = from;
    this.to = to;
    this.description = description || "Reorder layers";
  }

  execute() {
    this.host.reorderLayer(this.from, this.to);
  }

  undo() {
    this.host.reorderLayer(this.to, this.from);
  }
}

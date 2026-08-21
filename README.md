# ZMK Next Configurator

Visual ZMK keymap editor. Geometry comes from a **layout profile**. Totem is the first keyboard, not the core.

```
zmk-next-configurator/
├── layouts/            # keyboard definitions (Totem, …)
├── examples/           # sample .keymap files
├── src/
│   ├── core/           # drag, history
│   ├── keymap/         # source-preserving parse/apply
│   ├── behaviors/      # binding inspect / classify
│   ├── connection/     # optional ZMK Studio RPC
│   ├── layouts/        # load JSON / dtsi helper
│   └── ui/             # vanilla web UI
├── apps/web/           # index.html + serve.py
└── tests/
```

## Run

From this repo:

```bash
python3 apps/web/serve.py
```

Open http://127.0.0.1:8766/apps/web/

Pick a keyboard in the session panel. **Reload sample** loads that profile’s example keymap. **Open keymap** uses the current profile’s key count.

**Load from GitHub** scans a public repo (or a local folder path / dropped directory) for both the `.keymap` and the geometry:

1. Finds `**/*.keymap` (prefers `config/*.keymap`)
2. Finds layout sources in order: `zmk-map-layout.json`, `layout.json`, `physical-layout*`, `*transform*.dtsi`, then board/shield `.dtsi`
3. Uses a built-in profile when the repo name matches (Totem, …)
4. Asks you to confirm: *Found: keymap + layout* → **Use these** or **Pick different files**

A repo can ship `zmk-map-layout.json` or `layout.json` so any keyboard loads without a built-in. Raw `.dtsi` is parsed for `key_physical_attrs` and, if needed, the `zmk,matrix-transform` map.

Live **Connect / Apply** is optional (Chrome Web Serial). Standard ZMK Studio firmware can
update only existing bindings. On ZMK Next Runtime Config firmware, the editor detects the
capability, translates the selected layout through the device-reported stock-position map,
then validates and saves a complete immutable snapshot that activates only when the keyboard
is idle. **Restore stock configuration** writes an empty runtime generation while retaining the
previous valid generation as on-device recovery fallback.

When Runtime Config is available, **Runtime objects** edits macros, combos, hold-taps,
mod-morphs, and tap-dances in a local draft. Unsupported types stay hidden. Assign an
object to many keys with `&rt <id>`. Apply still uploads one complete snapshot; firmware
rejects invalid generations without touching the active configuration. `.keymap` macros and
combos remain file-only until a later import step.

## Add a keyboard

Drop `layouts/yourboard.json` (or put `zmk-map-layout.json` in the firmware repo):

```json
{
  "id": "yourboard",
  "name": "Your Board",
  "keyCount": 42,
  "split": true,
  "rows": [12, 12, 12, 6],
  "homeRowBehaviors": ["hml", "hmr"],
  "sampleKeymap": "examples/yourboard.keymap",
  "keys": [
    { "w": 100, "h": 100, "x": 0, "y": 0, "r": 0, "rx": 0, "ry": 0, "hand": "left" }
  ]
}
```

Then add it to `PROFILE_INDEX` in `src/layouts/layout.js`. Units match ZMK `key_physical_attrs` (100 = 1u).

## Colors

Edit hex in `src/ui/theme.js` (`THEME` at the top).

## Tests

```bash
node tests/test_parse.mjs
node tests/test_studio.mjs
node tests/test_layout.mjs
node tests/test_discover.mjs
node tests/test_settings.mjs
node tests/test_combine.mjs
node tests/test_runtime_config.mjs
```

## Totem

`layouts/totem.json` + `examples/totem.keymap` are the first-class profile. The firmware repo `totem-zmk-config` still owns the production keymap; open that file here after you edit.

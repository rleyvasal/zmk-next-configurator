import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Unlike the other tests here, this one needs protoc + ~/zmk-venv + a sibling
// zmk-next-messages checkout (see scripts/sync-messages.sh). It's the tripwire
// for src/connection/fields.generated.js drifting from that repo's .proto.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(join(root, "scripts", "sync-messages.sh"), ["--check"], {
  cwd: root,
  encoding: "utf8",
});
if (result.error) throw new Error(`could not run scripts/sync-messages.sh: ${result.error.message}`);

const output = `${result.stdout || ""}${result.stderr || ""}`;
const skipped = /^SKIPPED:/m.test(output);
if (result.status !== 0 && !skipped) {
  throw new Error(`fields.generated.js is stale relative to zmk-next-messages — run scripts/sync-messages.sh\n${output}`);
}

console.log(skipped ? `fields-generated check skipped (${output.trim()})` : "fields-generated check passed");

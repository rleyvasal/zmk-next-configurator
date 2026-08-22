/**
 * Local-disk scan via the zmk-next-configurator serve.py helper (127.0.0.1 only).
 */

export async function listLocalFiles(rootPath) {
  const res = await fetch(`/api/local/scan?path=${encodeURIComponent(rootPath)}`);
  if (res.status === 404) {
    const err = new Error("local-scan-unavailable");
    err.code = "local-scan-unavailable";
    throw err;
  }
  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      detail = data.error || "";
    } catch {
      detail = await res.text();
    }
    throw new Error(detail || `Local scan failed (${res.status})`);
  }
  return res.json();
}

export async function readLocalFile(root, relPath) {
  const url = `/api/local/file?root=${encodeURIComponent(root)}&path=${encodeURIComponent(relPath)}`;
  const res = await fetch(url);
  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      detail = data.error || "";
    } catch {
      detail = await res.text();
    }
    throw new Error(detail || `Could not read ${relPath}`);
  }
  return res.text();
}

#!/usr/bin/env python3
"""Serve the zmk-next-configurator repo root so /apps/web/ can fetch /src, /layouts, /examples."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
import json
import os
import sys

ROOT = Path(__file__).resolve().parent.parent.parent
os.chdir(ROOT)

NO_STORE = ("/apps/", "/src/", "/layouts/", "/examples/", "/api/")
IGNORE_DIRS = {".git", "node_modules", ".west", "zephyr", "build", "dist", "modules"}
READ_SUFFIXES = {".keymap", ".dtsi", ".json", ".txt", ".overlay"}
MAX_SCAN = 4000


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".keymap": "text/plain",
        ".dtsi": "text/plain",
    }

    def end_headers(self):
        if any(self.path.startswith(p) for p in NO_STORE):
            self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/local/scan":
            self._local_scan(parse_qs(parsed.query))
            return
        if parsed.path == "/api/local/file":
            self._local_file(parse_qs(parsed.query))
            return
        super().do_GET()

    def _local_only(self):
        return self.client_address[0] in ("127.0.0.1", "::1")

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _expand_scan_root(self, raw):
        p = Path(os.path.expanduser(raw)).resolve()
        if not p.exists():
            raise FileNotFoundError(str(p))
        if p.is_file():
            p = p.parent
        for _ in range(5):
            if (p / ".git").exists() or (p / "config").is_dir() or (p / "boards").is_dir():
                break
            if p.parent == p:
                break
            p = p.parent
        if not p.is_dir():
            raise NotADirectoryError(str(p))
        return p

    def _local_scan(self, qs):
        if not self._local_only():
            self._send_json({"error": "Local scan is only available on 127.0.0.1."}, 403)
            return
        raw = (qs.get("path") or [""])[0]
        if not raw:
            self._send_json({"error": "Missing path."}, 400)
            return
        try:
            root = self._expand_scan_root(unquote(raw))
        except FileNotFoundError as err:
            self._send_json({"error": f"Path not found: {err}"}, 404)
            return
        except Exception as err:
            self._send_json({"error": str(err)}, 400)
            return
        paths = []
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS and not d.startswith(".")]
            rel_dir = Path(dirpath).relative_to(root).as_posix()
            if rel_dir == ".":
                rel_dir = ""
            for name in filenames:
                rel = f"{rel_dir}/{name}" if rel_dir else name
                paths.append(rel)
                if len(paths) >= MAX_SCAN:
                    self._send_json({"root": str(root), "paths": paths, "truncated": True})
                    return
        self._send_json({"root": str(root), "paths": paths, "truncated": False})

    def _local_file(self, qs):
        if not self._local_only():
            self._send_json({"error": "Local files are only available on 127.0.0.1."}, 403)
            return
        root_raw = (qs.get("root") or [""])[0]
        rel_raw = (qs.get("path") or [""])[0]
        if not root_raw or not rel_raw:
            self._send_json({"error": "Missing root or path."}, 400)
            return
        try:
            root = Path(os.path.expanduser(unquote(root_raw))).resolve()
            target = (root / unquote(rel_raw)).resolve()
        except Exception as err:
            self._send_json({"error": str(err)}, 400)
            return
        if not target.exists() or not target.is_file():
            self._send_json({"error": f"File not found: {rel_raw}"}, 404)
            return
        if root not in target.parents and target != root:
            self._send_json({"error": "Path escapes the scanned folder."}, 403)
            return
        if target.suffix.lower() not in READ_SUFFIXES:
            self._send_json({"error": f"Refusing to read {target.suffix} files."}, 403)
            return
        try:
            text = target.read_text(encoding="utf-8")
        except OSError as err:
            self._send_json({"error": str(err)}, 500)
            return
        body = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8766))
    url = f"http://127.0.0.1:{port}/apps/web/"
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)

    print()
    print("  ZMK Next Configurator is running")
    print()
    print(f"  →  {url}")
    print()
    print("  Python is only used as a local static server.")
    print("  Press Ctrl+C to stop")
    print()
    sys.stdout.flush()

    try:
        import webbrowser

        webbrowser.open(url)
    except Exception:
        pass

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.\n")


if __name__ == "__main__":
    main()

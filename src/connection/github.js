/**
 * Public GitHub helpers: parse a pasted URL, list a repo tree, fetch files.
 */

function githubContentsUrl(owner, repo, branch, path) {
  const segments = String(path || "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${segments}?ref=${encodeURIComponent(branch)}`;
}

function decodeGithubBase64(content) {
  const binary = atob(String(content).replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function isNetworkError(err) {
  const message = String(err?.message || err || "");
  return err instanceof TypeError || /networkerror|failed to fetch|load failed|fetch resource|cors/i.test(message);
}

export function parseGithubInput(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  if (/^file:\/\//i.test(s)) s = s.replace(/^file:\/\//i, "");
  if (/^([A-Za-z]:[\\/]|\/|~\/|\.\/|\.\.\/)/.test(s)) return { local: s };
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/, "");
  const blob = s.match(/^([^/]+)\/([^/]+)\/(?:blob|tree)\/([^/]+)\/(.+)$/);
  if (blob) return { owner: blob[1], repo: blob[2], branch: blob[3], path: blob[4] };
  const tree = s.match(/^([^/]+)\/([^/]+)\/tree\/([^/]+)\/?$/);
  if (tree) return { owner: tree[1], repo: tree[2], branch: tree[3], path: "" };
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return {
    owner: parts[0],
    repo: parts[1],
    branch: parts.length > 2 && !parts[2].includes(".") ? parts[2] : "main",
    path: parts.length > 2 && parts[2].includes(".") ? parts.slice(2).join("/") : parts.slice(3).join("/"),
  };
}

export async function githubRepoInfo(owner, repo) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
  if (res.status === 403) throw new Error("GitHub rate limit. Wait a minute, or paste owner/repo/path/to.keymap.");
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${owner}/${repo}`);
  return res.json();
}

export async function githubRepoTree(owner, repo, branch) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
  if (res.status === 403) throw new Error("GitHub rate limit. Wait a minute and try again.");
  if (!res.ok) throw new Error(`GitHub ${res.status}: could not list ${owner}/${repo}@${branch}`);
  const data = await res.json();
  const tree = Array.isArray(data.tree) ? data.tree : [];
  return tree.filter((n) => n.type === "blob" && n.path).map((n) => n.path);
}

export async function githubRawFile(owner, repo, branch, path) {
  const label = `${owner}/${repo}/${path}`;
  const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${String(path)
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/")}`;

  try {
    const res = await fetch(rawUrl);
    if (res.ok) return await res.text();
  } catch {
    // Some networks allow api.github.com but block raw.githubusercontent.com.
  }

  try {
    const res = await fetch(githubContentsUrl(owner, repo, branch, path));
    if (res.status === 403) throw new Error("GitHub rate limit. Wait a minute and try again.");
    if (res.status === 404) throw new Error(`GitHub 404: ${label}`);
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${label}`);
    const data = await res.json();
    if (data?.encoding !== "base64" || typeof data.content !== "string") {
      throw new Error(`GitHub returned an unsupported file format: ${label}`);
    }
    return decodeGithubBase64(data.content);
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    throw new Error(
      `Could not download ${label} from GitHub. The raw GitHub file host may be blocked by this network; try again or use Load from File.`,
    );
  }
}

export async function listGithubFiles(owner, repo, preferredBranch) {
  const branches = preferredBranch ? [preferredBranch, "main", "master"] : ["main", "master"];
  const seen = new Set();
  let lastErr = null;
  for (const branch of branches) {
    if (seen.has(branch)) continue;
    seen.add(branch);
    try {
      const paths = await githubRepoTree(owner, repo, branch);
      return { branch, paths };
    } catch (err) {
      lastErr = err;
    }
  }
  try {
    const info = await githubRepoInfo(owner, repo);
    const branch = info.default_branch;
    if (branch && !seen.has(branch)) {
      const paths = await githubRepoTree(owner, repo, branch);
      return { branch, paths };
    }
  } catch (err) {
    lastErr = err;
  }
  throw lastErr || new Error(`Could not list ${owner}/${repo}`);
}

/**
 * Publish rendered files as one commit on a GitHub branch, through the Git
 * Data API: no local checkout, no git binary, one atomic commit per issue.
 *
 * Intended for a dedicated Pages branch (`gh-pages`), so the digest never
 * writes to a branch people review.
 *
 * @module
 */

import type { Fetch } from "./registry.ts";

export interface GitHubTarget {
  repo: string; // owner/name
  branch: string;
  token: string;
  apiUrl?: string;
}

export interface PublishResult {
  commitSha: string;
  commitUrl: string;
  files: string[];
  createdBranch: boolean;
}

const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

export async function publishFiles(
  target: GitHubTarget,
  files: Record<string, string>,
  message: string,
  fetchFn: Fetch = fetch,
): Promise<PublishResult> {
  if (!REPO_RE.test(target.repo)) {
    throw new Error(`invalid GitHub repo "${target.repo}"`);
  }
  const api = (target.apiUrl ?? "https://api.github.com").replace(/\/+$/, "");
  const base = `${api}/repos/${target.repo}`;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetchFn(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${target.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    return { status: res.status, json };
  };
  const must = async (method: string, path: string, body?: unknown) => {
    const r = await call(method, path, body);
    if (r.status < 200 || r.status >= 300) {
      // GitHub error bodies carry a message and a docs URL, never the token.
      throw new Error(
        `GitHub ${method} ${path}: HTTP ${r.status} ${r.json?.message ?? ""}`
          .trim(),
      );
    }
    return r.json;
  };

  const ref = await call("GET", `/git/ref/heads/${target.branch}`);
  let parent: string | null = null;
  let baseTree: string | null = null;
  if (ref.status === 200) {
    parent = ref.json.object.sha;
    const commit = await must("GET", `/git/commits/${parent}`);
    baseTree = commit.tree.sha;
  } else if (ref.status !== 404) {
    throw new Error(
      `GitHub GET ref ${target.branch}: HTTP ${ref.status} ${
        ref.json?.message ?? ""
      }`,
    );
  }

  const tree = await must("POST", "/git/trees", {
    ...(baseTree ? { base_tree: baseTree } : {}),
    tree: Object.entries(files).map(([path, content]) => ({
      path,
      mode: "100644",
      type: "blob",
      content,
    })),
  });
  const commit = await must("POST", "/git/commits", {
    message,
    tree: tree.sha,
    parents: parent ? [parent] : [],
  });
  if (parent) {
    // Not forced: a concurrent writer makes this fail rather than be overwritten.
    await must("PATCH", `/git/refs/heads/${target.branch}`, {
      sha: commit.sha,
      force: false,
    });
  } else {
    await must("POST", "/git/refs", {
      ref: `refs/heads/${target.branch}`,
      sha: commit.sha,
    });
  }
  return {
    commitSha: commit.sha,
    commitUrl: `https://github.com/${target.repo}/commit/${commit.sha}`,
    files: Object.keys(files).sort(),
    createdBranch: parent === null,
  };
}

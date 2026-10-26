/**
 * Client for the public swamp registry API.
 *
 * Everything here is unauthenticated: the search, version-history and download
 * endpoints the `swamp extension` CLI itself uses. `swamp.club` 301s to
 * `swamp-club.com`, so the default base URL skips the redirect.
 *
 * @module
 */

export const DEFAULT_REGISTRY_URL = "https://swamp-club.com";

/** One row of `GET /api/v1/extensions/search`. */
export interface CatalogEntry {
  name: string;
  description: string;
  labels: string[];
  repository: string | null;
  repositoryVerified: boolean;
  latestVersion: string | null;
  latestBeta: string | null;
  latestRc: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One row of `GET /api/v1/extensions/<name>/versions`. */
export interface VersionRecord {
  version: string;
  publishedAt: string;
  channel: string;
  yankedAt: string | null;
  yankReason: string | null;
  releaseNotes: string | null;
  labels: string[];
  diff: { isInitialRelease?: boolean; summary?: string } | null;
  models: Array<{ type?: string; methods?: Array<string | { name?: string }> }>;
}

/** `GET /api/v1/extensions/<name>`: only the fields the digest reads. */
export interface ExtensionInfo {
  name: string;
  yankedAt: string | null;
  yankReason: string | null;
  deprecatedAt: string | null;
  deprecationReason: string | null;
  supersededBy: string | null;
}

export type Fetch = typeof fetch;

/** Extension names are `@collective/name[/sub...]` in lowercase kebab-case. */
const NAME_RE = /^@[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9._-]*)+$/;

/**
 * True for a name safe to put in a URL path, an HTML page and a Discord post
 * without escaping surprises. The registry enforces this at push time; the
 * digest checks again rather than trust a third party with markup.
 */
export function isValidName(name: string): boolean {
  return NAME_RE.test(name);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RegistryClient {
  constructor(
    private readonly baseUrl: string = DEFAULT_REGISTRY_URL,
    private readonly fetchFn: Fetch = fetch,
    private readonly timeoutMs = 30000,
    /** Base backoff; tests pass 0. */
    private readonly backoffMs = 1000,
  ) {}

  /**
   * GET with retry on 429 and 5xx. The registry rate-limits a burst of
   * version-history reads (measured: HTTP 429 at 6 in flight), and a weekly
   * digest would rather wait a minute than fail. Honours `Retry-After`.
   */
  private async fetchRetry(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0;; attempt++) {
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          ...init,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (cause) {
        if (attempt >= 4) {
          throw new Error(`registry GET ${url} failed: ${String(cause)}`);
        }
        await sleep(this.backoffMs * 2 ** attempt);
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 6) {
        await res.body?.cancel();
        const after = Number(res.headers.get("retry-after"));
        await sleep(
          Number.isFinite(after) && after > 0
            ? Math.min(after, 120) * 1000
            : this.backoffMs * 2 ** attempt,
        );
        continue;
      }
      return res;
    }
  }

  private async getJson(
    path: string,
  ): Promise<{ status: number; body: unknown }> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}${path}`;
    const res = await this.fetchRetry(url, {
      headers: { accept: "application/json" },
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(
        `registry GET ${url}: HTTP ${res.status}, body is not JSON (${
          text.slice(0, 120)
        })`,
      );
    }
    return { status: res.status, body };
  }

  /**
   * Every extension on one release channel, all pages.
   *
   * Fails rather than returning a short list: a digest built from a truncated
   * catalog would report every missing extension as removed.
   */
  async searchAll(
    channel: "stable" | "beta" | "rc",
    perPage = 100,
  ): Promise<CatalogEntry[]> {
    const out: CatalogEntry[] = [];
    let total = Infinity;
    for (let page = 1; out.length < total; page++) {
      const qs = new URLSearchParams({
        sort: "updated",
        perPage: String(perPage),
        page: String(page),
      });
      if (channel !== "stable") qs.set("channel", channel);
      const { status, body } = await this.getJson(
        `/api/v1/extensions/search?${qs}`,
      );
      const b = body as {
        extensions?: Array<Record<string, unknown>>;
        meta?: { total?: number };
      };
      if (status !== 200 || !Array.isArray(b?.extensions)) {
        throw new Error(
          `registry search (${channel}, page ${page}): HTTP ${status}, unexpected body`,
        );
      }
      if (typeof b.meta?.total !== "number") {
        throw new Error(
          `registry search (${channel}): response has no meta.total; refusing to guess the catalog size`,
        );
      }
      total = b.meta.total;
      if (b.extensions.length === 0) break;
      for (const e of b.extensions) out.push(toCatalogEntry(e));
      if (page > 1000) throw new Error("registry search: more than 1000 pages");
    }
    if (out.length < total) {
      throw new Error(
        `registry search (${channel}): got ${out.length} of ${total} extensions; catalog is incomplete`,
      );
    }
    return out;
  }

  /** Full version history, newest first. */
  async versions(name: string): Promise<VersionRecord[]> {
    const out: VersionRecord[] = [];
    let total = Infinity;
    for (let page = 1; out.length < total; page++) {
      const { status, body } = await this.getJson(
        `/api/v1/extensions/${name}/versions?perPage=100&page=${page}`,
      );
      const b = body as {
        versions?: Array<Record<string, unknown>>;
        meta?: { total?: number };
      };
      if (status !== 200 || !Array.isArray(b?.versions)) {
        throw new Error(`registry versions ${name}: HTTP ${status}`);
      }
      total = b.meta?.total ?? b.versions.length;
      if (b.versions.length === 0) break;
      for (const v of b.versions) out.push(toVersionRecord(v));
      if (page > 100) {
        throw new Error(`registry versions ${name}: too many pages`);
      }
    }
    out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    return out;
  }

  /** Extension metadata, or null when the registry no longer has it. */
  async info(name: string): Promise<ExtensionInfo | null> {
    const { status, body } = await this.getJson(`/api/v1/extensions/${name}`);
    if (status === 404) return null;
    if (status !== 200 || !body || typeof body !== "object") {
      throw new Error(`registry info ${name}: HTTP ${status}`);
    }
    const b = body as Record<string, unknown>;
    return {
      name: String(b.name ?? name),
      yankedAt: str(b.yankedAt),
      yankReason: str(b.yankReason),
      deprecatedAt: str(b.deprecatedAt),
      deprecationReason: str(b.deprecationReason),
      supersededBy: str(b.supersededBy),
    };
  }

  /**
   * Download one version's archive (`.tar.gz`).
   *
   * The API answers with a 302 to a short-lived presigned object-store URL.
   * `maxBytes` caps the compressed download; the untar step caps the
   * decompressed size separately.
   */
  async download(
    name: string,
    version: string,
    maxBytes: number,
  ): Promise<Uint8Array> {
    const url = `${
      this.baseUrl.replace(/\/+$/, "")
    }/api/v1/extensions/${name}@${version}/download`;
    const res = await this.fetchRetry(url, { redirect: "follow" });
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      throw new Error(
        `registry download ${name}@${version}: HTTP ${res.status}`,
      );
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error(
          `registry download ${name}@${version}: archive exceeds ${maxBytes} bytes`,
        );
      }
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out;
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

function toCatalogEntry(e: Record<string, unknown>): CatalogEntry {
  return {
    name: String(e.name ?? ""),
    description: typeof e.description === "string" ? e.description : "",
    labels: strArray(e.labels),
    repository: str(e.repository),
    repositoryVerified: e.repositoryVerified === true,
    latestVersion: str(e.latestVersion),
    latestBeta: str(e.latestBeta),
    latestRc: str(e.latestRc),
    createdAt: String(e.createdAt ?? ""),
    updatedAt: String(e.updatedAt ?? ""),
  };
}

function toVersionRecord(v: Record<string, unknown>): VersionRecord {
  return {
    version: String(v.version ?? ""),
    publishedAt: String(v.publishedAt ?? ""),
    channel: typeof v.channel === "string" ? v.channel : "stable",
    yankedAt: str(v.yankedAt),
    yankReason: str(v.yankReason),
    releaseNotes: str(v.releaseNotes),
    labels: strArray(v.labels),
    diff: v.diff && typeof v.diff === "object"
      ? v.diff as VersionRecord["diff"]
      : null,
    models: Array.isArray(v.models) ? v.models as VersionRecord["models"] : [],
  };
}

/** Method names declared by a version, as `type.method`. */
export function methodSet(v: VersionRecord | null): Set<string> {
  const out = new Set<string>();
  for (const m of v?.models ?? []) {
    for (const meth of m.methods ?? []) {
      const n = typeof meth === "string" ? meth : meth?.name;
      if (n) out.add(m.type ? `${m.type}.${n}` : n);
    }
  }
  return out;
}

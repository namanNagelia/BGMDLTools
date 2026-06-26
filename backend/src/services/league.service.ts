import { gunzipSync } from "node:zlib";

const MAX_FETCH_BYTES = 100 * 1024 * 1024;

export class LeagueFetchError extends Error {
  constructor(
    message: string,
    public status: number = 400,
  ) {
    super(message);
    this.name = "LeagueFetchError";
  }
}

/** Force Dropbox share links to direct-download (dl=1 + cdn host). */
export function normalizeDropboxUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new LeagueFetchError("Invalid URL");
  }
  if (url.protocol !== "https:") throw new LeagueFetchError("URL must be https");

  if (
    url.hostname === "www.dropbox.com" ||
    url.hostname === "dropbox.com" ||
    url.hostname === "dl.dropbox.com"
  ) {
    url.hostname = "dl.dropboxusercontent.com";
  }
  if (url.hostname.endsWith("dropbox.com") || url.hostname.endsWith("dropboxusercontent.com")) {
    url.searchParams.set("dl", "1");
  }
  return url.toString();
}

function isGzip(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

/** Extract current season from BBGM export (handles old array + new object gameAttributes). */
export function extractSeasonNumber(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  const ga = d.gameAttributes;
  if (ga && typeof ga === "object") {
    if (Array.isArray(ga)) {
      const found = ga.find(
        (x): x is { key: string; value: unknown } =>
          !!x && typeof x === "object" && "key" in x && (x as { key: unknown }).key === "season",
      );
      if (found && typeof found.value === "number") return found.value;
    } else {
      const s = (ga as Record<string, unknown>).season;
      if (typeof s === "number") return s;
    }
  }

  if (typeof d.startingSeason === "number") return d.startingSeason;
  return null;
}

export async function fetchLeagueJson(rawUrl: string): Promise<unknown> {
  const url = normalizeDropboxUrl(rawUrl);

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new LeagueFetchError(`Upstream returned ${res.status}`, 502);
  }

  const contentLength = Number(res.headers.get("content-length") ?? "0");
  if (contentLength > MAX_FETCH_BYTES) {
    throw new LeagueFetchError(`File too large (${contentLength} bytes, max ${MAX_FETCH_BYTES})`, 413);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new LeagueFetchError("Empty response body", 502);

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FETCH_BYTES) {
      reader.cancel();
      throw new LeagueFetchError(`File too large (>${MAX_FETCH_BYTES} bytes)`, 413);
    }
    chunks.push(value);
  }

  let buf = Buffer.concat(chunks);
  if (isGzip(buf)) {
    try {
      buf = gunzipSync(buf);
    } catch {
      throw new LeagueFetchError("Failed to decompress gzip payload", 422);
    }
  }

  const text = buf.toString("utf-8");
  try {
    return JSON.parse(text);
  } catch {
    throw new LeagueFetchError("Response is not valid JSON", 422);
  }
}

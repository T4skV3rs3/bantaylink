import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

const DEFAULT_REDACTED_QUERY_KEYS = [
  "api_key",
  "apikey",
  "access_token",
  "authorization",
  "token",
  "secret",
  "password"
];

export async function fetchResponse(url, options = {}) {
  const { headers = {}, ...requestOptions } = options;
  const response = await fetch(url, {
    redirect: "follow",
    ...requestOptions,
    headers: {
      Accept: "application/json, text/csv, application/octet-stream;q=0.9, */*;q=0.1",
      "User-Agent": "BantayLink/0.5 (+https://github.com/T4skV3rs3/bantaylink)",
      ...headers
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body.replace(/\s+/g, " ").slice(0, 300);
    throw new Error(`HTTP ${response.status} while fetching ${url}${detail ? `: ${detail}` : ""}`);
  }

  return response;
}

export function responseBodyToNodeStream(response, { gzip = false } = {}) {
  if (!response.body) throw new Error("HTTP response has no body stream.");
  const source = Readable.fromWeb(response.body);
  return gzip ? source.pipe(createGunzip()) : source;
}

export function headersToObject(headers) {
  return Object.fromEntries([...headers.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function redactUrl(url, queryKeys = DEFAULT_REDACTED_QUERY_KEYS) {
  const value = String(url);
  try {
    const parsed = new URL(value);
    for (const key of queryKeys) {
      for (const actual of [...parsed.searchParams.keys()]) {
        if (actual.toLowerCase() === key.toLowerCase()) {
          parsed.searchParams.set(actual, "[REDACTED]");
        }
      }
    }
    return parsed.toString();
  } catch {
    return value;
  }
}

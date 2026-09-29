import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

export async function fetchResponse(url, options = {}) {
  const { headers = {}, ...requestOptions } = options;
  const response = await fetch(url, {
    redirect: "follow",
    ...requestOptions,
    headers: {
      Accept: "application/json, text/csv, application/octet-stream;q=0.9, */*;q=0.1",
      "User-Agent": "BantayLink/0.3 (+https://github.com/T4skV3rs3/bantaylink)",
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

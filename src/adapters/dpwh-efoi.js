import { fetchResponse, headersToObject } from "../ingestion/http.js";

const DEFAULT_URLS = [
  "https://www.foi.gov.ph/agencies/dpwh/status-of-listed-dpwh-project/"
];

function configuredUrls() {
  const value = process.env.DPWH_EFOI_URLS;
  if (!value) return DEFAULT_URLS;
  return value.split(",").map(item => item.trim()).filter(Boolean);
}

function extractFirst(text, pattern) {
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? null;
}

export const dpwhEfoiAdapter = {
  id: "dpwh-efoi",
  name: "DPWH eFOI Evidence Documents",
  source: {
    id: "dpwh-efoi",
    sourceKey: "dpwh-efoi",
    name: "DPWH eFOI",
    sourceClass: "official_document",
    publisher: "Department of Public Works and Highways",
    canonicalUrl: "https://www.foi.gov.ph/agencies/dpwh/",
    version: "configured-document-fetch"
  },

  async *fetch() {
    for (const url of configuredUrls()) {
      const response = await fetchResponse(url, {
        headers: { Accept: "text/html,application/xhtml+xml" }
      });
      const html = await response.text();
      yield {
        payload: {
          url,
          title: extractFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
          trackingNumber: extractFirst(html, /Tracking no:\s*#?([A-Z0-9-]+)/i),
          status: extractFirst(html, /\b(SUCCESSFUL|PROCESSING|ACCEPTED|DENIED|CLOSED)\b/i),
          html
        },
        url,
        retrievalUrl: response.url,
        requestMethod: "GET",
        responseHeaders: headersToObject(response.headers),
        httpStatus: response.status,
        mimeType: response.headers.get("content-type") || "text/html",
        payloadEncoding: "utf-8",
        hashScope: "raw_content",
        rawContent: html
      };
    }
  },

  normalize(document) {
    const id = document.trackingNumber || document.url;
    const data = {
      documentType: "DPWH eFOI response",
      url: document.url,
      title: document.title,
      trackingNumber: document.trackingNumber,
      status: document.status
    };

    return {
      entities: [{
        entityType: "source",
        canonicalKey: `dpwh-efoi:${id}`,
        label: document.title || id,
        data,
        observations: [{
          recordType: "source",
          sourceRecordId: id,
          data
        }]
      }]
    };
  }
};

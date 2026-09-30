import { fetchResponse, headersToObject } from "../ingestion/http.js";

const DEFAULT_URLS = [];

function configuredUrls() {
  const value = process.env.COA_ELIBRARY_URLS;
  if (!value) return DEFAULT_URLS;
  return value.split(",").map(item => item.trim()).filter(Boolean);
}

function htmlText(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFirst(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export function normalizeCoaElibraryDocument(document) {
  const id = document.documentId || document.url;
  const data = {
    documentType: "COA eLibrary document",
    url: document.url,
    title: document.title,
    author: document.author,
    category: document.category,
    type: document.type,
    published: document.published,
    documentId: document.documentId
  };

  return {
    entities: [{
      entityType: "source",
      canonicalKey: `coa-elibrary:${id}`,
      label: document.title || id,
      data,
      observations: [{
        recordType: "official_document",
        sourceRecordId: id,
        data
      }]
    }]
  };
}

export const coaElibraryAdapter = {
  id: "coa-elibrary",
  name: "COA eLibrary Documents",

  source: {
    id: "coa-elibrary",
    sourceKey: "coa-elibrary",
    name: "COA eLibrary",
    sourceClass: "official_document",
    publisher: "Commission on Audit",
    canonicalUrl: "https://elibrary.coa.gov.ph/",
    version: "explicit-url-fetch"
  },

  async *fetch() {
    const urls = configuredUrls();
    if (!urls.length) {
      throw new Error("COA_ELIBRARY_URLS is required for coa-elibrary; provide explicit resource or search-result URLs.");
    }

    for (const url of urls) {
      const response = await fetchResponse(url, {
        headers: { Accept: "text/html,application/xhtml+xml" }
      });
      const html = await response.text();
      const title = htmlText(extractFirst(html, [/<title[^>]*>([\s\S]*?)<\/title>/i])) || url;
      const text = htmlText(html);

      yield {
        payload: {
          url,
          title,
          author: extractFirst(text, [/Author\/s\s+([^·]{1,160})/i]),
          category: extractFirst(text, [/Category\s+([^·]{1,160})/i]),
          type: extractFirst(text, [/Type\s+([^·]{1,160})/i]),
          published: extractFirst(text, [/Published\s+([^·]{1,80})/i]),
          documentId: extractFirst(url, [/\/resource\/view\/([^/?#]+)/i]),
          html
        },
        url,
        httpStatus: response.status,
        mimeType: response.headers.get("content-type") || "text/html"
      };
    }
  },

  normalize(document) {
    return normalizeCoaElibraryDocument(document);
  }
};

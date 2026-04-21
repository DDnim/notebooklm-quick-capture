(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.ClipperClipModels = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createClipDocument(input) {
    const metadata = input.metadata || {};
    const sourceUrl = normalizeUrl(input.sourceUrl || "");
    const canonicalUrl = normalizeUrl(input.canonicalUrl || sourceUrl);
    const capturedAt = input.capturedAt || new Date().toISOString();
    const content = typeof input.content === "string" ? input.content.trim() : "";
    const summary = typeof input.summary === "string" ? input.summary.trim() : "";
    const fallbackText =
      typeof input.fallbackText === "string" && input.fallbackText.trim()
        ? input.fallbackText.trim()
        : buildFallbackText({
            title: input.title,
            sourceUrl: canonicalUrl || sourceUrl,
            summary,
            content
          });

    return {
      id: input.id || createId(),
      kind: input.kind || "web",
      sourceUrl,
      canonicalUrl,
      title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : sourceUrl,
      content,
      summary,
      metadata,
      attachments: Array.isArray(input.attachments) ? input.attachments.slice() : [],
      fallbackText,
      capturedAt
    };
  }

  function createClipRequest(input) {
    return {
      targetNotebook: {
        id: input.targetNotebook.id,
        name: input.targetNotebook.name || "NotebookLM notebook",
        url: input.targetNotebook.url,
        authUser: parseOptionalAuthUser(input.targetNotebook.authUser)
      },
      mode: input.mode || "auto",
      document: input.document
    };
  }

  function buildFallbackText(input) {
    const sections = [
      input.title ? `Title: ${input.title}` : "",
      input.sourceUrl ? `Source URL: ${input.sourceUrl}` : "",
      input.summary ? `Summary: ${input.summary}` : "",
      "",
      input.content || ""
    ].filter(Boolean);

    return sections.join("\n");
  }

  function getPreferredSourceUrl(documentRef) {
    return documentRef.canonicalUrl || documentRef.sourceUrl || "";
  }

  function toHistoryEntry(request, result) {
    const historyUrl =
      getPreferredSourceUrl(request.document) ||
      request.document.metadata.pageUrl ||
      request.targetNotebook.url ||
      "";
    return {
      clipId: request.document.id,
      title: request.document.title,
      url: historyUrl,
      clipMode: request.mode,
      timestamp: new Date().toISOString(),
      result: result.historyResult || result.modeUsed || result.mode || "unknown",
      notebookUrl: request.targetNotebook.url
    };
  }

  function normalizeUrl(value) {
    if (!value) {
      return "";
    }

    try {
      const parsed = new URL(value);
      canonicalizeGoogleUrl(parsed);
      parsed.hash = "";
      return parsed.toString();
    } catch (error) {
      return String(value).trim();
    }
  }

  function canonicalizeGoogleUrl(parsed) {
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "docs.google.com") {
      parsed.pathname = parsed.pathname.replace(/\/u\/\d+\//, "/");
      parsed.searchParams.delete("authuser");
      parsed.searchParams.delete("usp");
      parsed.searchParams.delete("tab");
      parsed.searchParams.delete("ouid");
      parsed.searchParams.delete("rtpof");
      parsed.searchParams.delete("sd");
    }
  }

  function parseOptionalAuthUser(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return null;
    }

    return parsed;
  }

  function createId() {
    return `clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  return {
    createClipDocument,
    createClipRequest,
    buildFallbackText,
    getPreferredSourceUrl,
    toHistoryEntry,
    normalizeUrl
  };
});

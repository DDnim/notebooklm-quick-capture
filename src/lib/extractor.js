(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.ClipperExtractor = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MAX_CONTENT_LENGTH = 24000;

  function normalizeWhitespace(input) {
    return String(input || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function firstText(documentRef, selectors) {
    for (const selector of selectors) {
      const node = documentRef.querySelector(selector);
      if (node) {
        const value = normalizeWhitespace(node.textContent || node.getAttribute("content"));
        if (value) {
          return value;
        }
      }
    }
    return "";
  }

  function safeHref(documentRef, selector) {
    const node = documentRef.querySelector(selector);
    return node && node.href ? node.href : "";
  }

  function gatherCandidates(documentRef) {
    const selectors = [
      "article",
      "main article",
      "main",
      "[role='main']",
      ".article",
      ".post-content",
      ".entry-content",
      ".article-body",
      ".story-body"
    ];

    return selectors
      .map((selector) => documentRef.querySelector(selector))
      .filter(Boolean)
      .map((node) => normalizeWhitespace(node.innerText || node.textContent || ""))
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
  }

  function truncate(input, maxLength) {
    const value = normalizeWhitespace(input);
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength - 1).trimEnd()}…`;
  }

  function selectBestText(selectionText, candidates, bodyText) {
    const normalizedSelection = normalizeWhitespace(selectionText);
    if (normalizedSelection.length >= 120) {
      return normalizedSelection;
    }

    if (candidates.length > 0) {
      return candidates[0];
    }

    return normalizeWhitespace(bodyText);
  }

  function extractFromDocument(documentRef, options) {
    const input = options || {};
    const currentUrl =
      safeHref(documentRef, "link[rel='canonical']") ||
      (documentRef.location && documentRef.location.href) ||
      "";

    const title =
      firstText(documentRef, [
        "meta[property='og:title']",
        "meta[name='twitter:title']",
        "h1",
        "title"
      ]) || currentUrl;

    const description = firstText(documentRef, [
      "meta[name='description']",
      "meta[property='og:description']"
    ]);

    const candidates = gatherCandidates(documentRef);
    const bodyText = normalizeWhitespace(
      (documentRef.body && (documentRef.body.innerText || documentRef.body.textContent)) || ""
    );
    const forcedSelection = normalizeWhitespace(input.selectionText || "");
    const bestText =
      input.preferSelection && forcedSelection
        ? forcedSelection
        : selectBestText(input.selectionText || "", candidates, bodyText);
    const content = truncate(bestText, input.maxLength || MAX_CONTENT_LENGTH);

    return {
      title,
      url: currentUrl,
      description,
      selectionText: normalizeWhitespace(input.selectionText || ""),
      content,
      excerpt: truncate(description || bestText, 280),
      capturedAt: new Date().toISOString()
    };
  }

  function buildFallbackNote(payload) {
    const sections = [
      payload.title ? `Title: ${payload.title}` : "",
      payload.url ? `Source URL: ${payload.url}` : "",
      payload.description ? `Summary: ${payload.description}` : "",
      "",
      payload.content || ""
    ].filter(Boolean);

    return sections.join("\n");
  }

  return {
    MAX_CONTENT_LENGTH,
    normalizeWhitespace,
    extractFromDocument,
    buildFallbackNote
  };
});

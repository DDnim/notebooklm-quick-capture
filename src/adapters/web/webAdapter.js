(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.ClipperWebAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createWebAdapter(dependencies) {
    const extractor = dependencies.extractor;
    const modelsApi = dependencies.modelsApi;

    return {
      id: "web",
      matches(url) {
        return /^https?:/i.test(url);
      },
      async extract(context) {
        const raw = extractor.extractFromDocument(context.documentRef, {
          selectionText: context.selectionText,
          preferSelection: Boolean(context.preferSelection)
        });

        return modelsApi.createClipDocument({
          kind: "web",
          sourceUrl: raw.url,
          canonicalUrl: raw.url,
          title: raw.title,
          content: raw.content,
          summary: raw.description || raw.excerpt,
          metadata: {
            description: raw.description,
            excerpt: raw.excerpt,
            selectionText: raw.selectionText
          },
          attachments: [],
          fallbackText: extractor.buildFallbackNote(raw),
          capturedAt: raw.capturedAt
        });
      }
    };
  }

  return {
    createWebAdapter
  };
});

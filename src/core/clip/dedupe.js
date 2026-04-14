(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.ClipperDedupe = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createDedupeService(modelsApi) {
    return {
      findHistoryDuplicate(documentRef, historyEntries, notebookUrl) {
        const preferredUrl = modelsApi.getPreferredSourceUrl(documentRef);
        if (!preferredUrl) {
          return null;
        }

        return (
          historyEntries.find((entry) => {
            return entry.url === preferredUrl && entry.notebookUrl === notebookUrl;
          }) || null
        );
      },

      findRemoteDuplicate(documentRef, sources) {
        const preferredUrl = normalizeForCompare(modelsApi.getPreferredSourceUrl(documentRef));
        if (!preferredUrl) {
          return null;
        }

        return (
          (sources || []).find((source) => {
            return normalizeForCompare(source.normalizedUrl || source.url || "") === preferredUrl;
          }) || null
        );
      }
    };
  }

  function normalizeForCompare(value) {
    return String(value || "")
      .trim()
      .replace(/\/$/, "");
  }

  return {
    createDedupeService
  };
});

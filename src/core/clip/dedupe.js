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
        const driveFileId = extractDriveFileId(modelsApi.getPreferredSourceUrl(documentRef));

        if (driveFileId) {
          return (
            (sources || []).find((source) => {
              return source.driveFileId === driveFileId;
            }) || null
          );
        }

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

  function extractDriveFileId(value) {
    const input = String(value || "").trim();
    if (!input) {
      return "";
    }

    try {
      const parsed = new URL(input);
      const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
      const path = parsed.pathname;
      if (host !== "docs.google.com") {
        return "";
      }

      const match =
        path.match(/^\/document(?:\/u\/\d+)?\/d\/([^/]+)/) ||
        path.match(/^\/presentation(?:\/u\/\d+)?\/d\/([^/]+)/) ||
        path.match(/^\/spreadsheets(?:\/u\/\d+)?\/d\/([^/]+)/);

      return match ? match[1] : "";
    } catch (error) {
      return "";
    }
  }

  return {
    createDedupeService
  };
});

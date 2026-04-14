(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.ClipperNotebookRpcWriter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createNotebookRpcWriter(dependencies) {
    const notebookService = dependencies.notebookService;
    const verifyTimeoutMs = dependencies.verifyTimeoutMs || 15000;
    const verifyPollMs = dependencies.verifyPollMs || 1000;

    if (!notebookService) {
      throw new Error("NotebookLM data service is required for RPC writer.");
    }

    return {
      async addClip(request) {
        const clipMode = request.mode || "auto";
        const sourceUrl = request.document.canonicalUrl || request.document.sourceUrl;
        const fallbackText = request.document.fallbackText || request.document.content || "";

        if (clipMode === "url") {
          return submitWithVerification({
            notebookService,
            notebookId: request.targetNotebook.id,
            document: request.document,
            mode: "url",
            verifyTimeoutMs,
            verifyPollMs,
            submit() {
              return notebookService.addSources(request.targetNotebook.id, [sourceUrl]);
            }
          });
        }

        if (clipMode === "text") {
          return submitWithVerification({
            notebookService,
            notebookId: request.targetNotebook.id,
            document: request.document,
            mode: "text",
            verifyTimeoutMs,
            verifyPollMs,
            submit() {
              return notebookService.addTextSource(request.targetNotebook.id, fallbackText, request.document.title);
            }
          });
        }

        try {
          return await submitWithVerification({
            notebookService,
            notebookId: request.targetNotebook.id,
            document: request.document,
            mode: "url",
            verifyTimeoutMs,
            verifyPollMs,
            submit() {
              return notebookService.addSources(request.targetNotebook.id, [sourceUrl]);
            }
          });
        } catch (error) {
          return submitWithVerification({
            notebookService,
            notebookId: request.targetNotebook.id,
            document: request.document,
            mode: "text",
            verifyTimeoutMs,
            verifyPollMs,
            submit() {
              return notebookService.addTextSource(request.targetNotebook.id, fallbackText, request.document.title);
            }
          });
        }
      }
    };
  }

  async function submitWithVerification(options) {
    const baselineSources = await options.notebookService.listSources(options.notebookId, undefined, true).catch(() => []);
    await options.submit();

    const verification = await verifyClip({
      notebookService: options.notebookService,
      notebookId: options.notebookId,
      document: options.document,
      baselineSources,
      mode: options.mode,
      timeoutMs: options.verifyTimeoutMs,
      pollMs: options.verifyPollMs
    });

    if (verification.status === "missing") {
      throw new Error("NotebookLM did not show a new source after RPC submission.");
    }

    return {
      ok: true,
      writer: "notebooklm-rpc",
      modeUsed: options.mode,
      sourceId: verification.source ? verification.source.id : null,
      verified: verification.status === "verified"
    };
  }

  async function verifyClip(options) {
    const baselineIds = new Set((options.baselineSources || []).map((source) => source.id));
    const startedAt = Date.now();

    while (Date.now() - startedAt <= options.timeoutMs) {
      let currentSources;
      try {
        currentSources = await options.notebookService.listSources(options.notebookId, undefined, true);
      } catch (error) {
        return { status: "unavailable", error };
      }

      const matched = findAddedSource(
        options.document,
        options.mode,
        baselineIds,
        currentSources
      );

      if (matched) {
        return { status: "verified", source: matched };
      }

      await delay(options.pollMs);
    }

    return { status: "missing" };
  }

  function findAddedSource(documentRef, mode, baselineIds, currentSources) {
    const addedSources = (currentSources || []).filter((source) => !baselineIds.has(source.id));
    if (addedSources.length === 0) {
      return null;
    }

    const normalizedUrl = normalizeUrl(documentRef.canonicalUrl || documentRef.sourceUrl || "");
    const normalizedTitle = normalizeText(documentRef.title || "");

    if (normalizedUrl) {
      const urlMatch = addedSources.find((source) => source.normalizedUrl === normalizedUrl);
      if (urlMatch) {
        return urlMatch;
      }
    }

    if (mode === "text" || !normalizedUrl) {
      const titleMatch = addedSources.find((source) => normalizeText(source.title) === normalizedTitle);
      if (titleMatch) {
        return titleMatch;
      }
    }

    return addedSources.length === 1 ? addedSources[0] : null;
  }

  function normalizeUrl(value) {
    if (!value) {
      return "";
    }

    try {
      const parsed = new URL(value);
      parsed.hash = "";
      return parsed.toString().replace(/\/$/, "");
    } catch (error) {
      return String(value).trim().replace(/\/$/, "");
    }
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return {
    createNotebookRpcWriter,
    findAddedSource
  };
});

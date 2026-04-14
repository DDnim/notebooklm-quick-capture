(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.ClipperNotebookDomWriter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createNotebookDomWriter(dependencies) {
    const chromeLike = dependencies.chromeLike;
    const notebookService = dependencies.notebookService;
    const verifyTimeoutMs = dependencies.verifyTimeoutMs || 15000;
    const verifyPollMs = dependencies.verifyPollMs || 1000;

    return {
      async addClip(request) {
        let baselineSources = null;
        if (notebookService && request.targetNotebook.id) {
          try {
            baselineSources = await notebookService.listSources(request.targetNotebook.id, undefined, true);
          } catch (error) {
            baselineSources = null;
          }
        }

        const notebookTab = await ensureNotebookTab(chromeLike, request.targetNotebook.url);
        const response = await sendMessageToTab(chromeLike, notebookTab.id, {
          type: "WRITE_CLIP_DOCUMENT",
          payload: request
        });

        if (!response || !response.ok) {
          throw new Error(
            response && response.error ? response.error : "NotebookLM did not accept the clip."
          );
        }

        const verification = await verifyClip({
          notebookService,
          notebookId: request.targetNotebook.id,
          document: request.document,
          baselineSources,
          mode: response.result.mode,
          timeoutMs: verifyTimeoutMs,
          pollMs: verifyPollMs
        });

        if (verification.status === "missing") {
          throw new Error("NotebookLM did not show a new source after submission.");
        }

        return {
          ok: true,
          writer: "notebooklm-dom",
          modeUsed: response.result.mode,
          sourceId: (verification.source && verification.source.id) || response.result.sourceId || null,
          verified: verification.status === "verified"
        };
      }
    };
  }

  async function verifyClip(options) {
    if (!options.notebookService || !options.notebookId) {
      return { status: "unavailable" };
    }

    const baselineSources = Array.isArray(options.baselineSources) ? options.baselineSources : [];
    const baselineIds = new Set(baselineSources.map((source) => source.id));
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

  async function ensureNotebookTab(chromeLike, notebookUrl) {
    const existing = await chromeLike.tabs.query({});
    const match = existing.find((tab) => typeof tab.url === "string" && tab.url.startsWith(notebookUrl));

    if (match && match.id) {
      await waitForTab(chromeLike, match.id);
      return match;
    }

    const created = await chromeLike.tabs.create({ url: notebookUrl, active: false });
    if (!created.id) {
      throw new Error("Could not open NotebookLM.");
    }

    await waitForTab(chromeLike, created.id);
    return created;
  }

  async function waitForTab(chromeLike, tabId) {
    const tab = await chromeLike.tabs.get(tabId);
    if (tab.status === "complete") {
      await delay(500);
      return;
    }

    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        chromeLike.tabs.onUpdated.removeListener(listener);
        reject(new Error("NotebookLM took too long to load."));
      }, 20000);

      function listener(updatedTabId, changeInfo) {
        if (updatedTabId !== tabId) {
          return;
        }
        if (changeInfo.status === "complete") {
          clearTimeout(timeoutId);
          chromeLike.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }

      chromeLike.tabs.onUpdated.addListener(listener);
    });

    await delay(500);
  }

  function sendMessageToTab(chromeLike, tabId, message) {
    return new Promise((resolve, reject) => {
      chromeLike.tabs.sendMessage(tabId, message, (response) => {
        const error = chromeLike.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

  return {
    createNotebookDomWriter,
    findAddedSource
  };
});

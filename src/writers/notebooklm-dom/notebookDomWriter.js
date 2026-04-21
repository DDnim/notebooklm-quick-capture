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
    const messageBridge = dependencies.messageBridge || null;
    const verifyTimeoutMs = dependencies.verifyTimeoutMs || 15000;
    const verifyPollMs = dependencies.verifyPollMs || 1000;

    return {
      async addClip(request) {
        let baselineSources = null;
        if (notebookService && request.targetNotebook.id) {
          try {
            baselineSources = await notebookService.listSources(
              request.targetNotebook.id,
              request.targetNotebook.authUser,
              true
            );
          } catch (error) {
            baselineSources = null;
          }
        }

        const notebookTab = await ensureNotebookTab(
          chromeLike,
          request.targetNotebook.url,
          request.targetNotebook.authUser
        );
        const payload = shouldHandoffToUser(request)
          ? Object.assign({}, request, { handoffMode: "fill-only" })
          : request;
        const response = await sendNotebookMessage(messageBridge, chromeLike, notebookTab.id, {
          type: "WRITE_CLIP_DOCUMENT",
          payload
        });

        if (!response || !response.ok) {
          throw new Error(
            response && response.error ? response.error : "NotebookLM did not accept the clip."
          );
        }

        if (response.result && response.result.awaitingUserAction) {
          return {
            ok: true,
            writer: "notebooklm-dom",
            modeUsed: "url",
            sourceId: null,
            verified: false,
            awaitingUserAction: true,
            userAction: response.result.userAction || "click_insert",
            historyResult: "user_action"
          };
        }

        const verification = await verifyClip({
          notebookService,
          notebookId: request.targetNotebook.id,
          authUser: request.targetNotebook.authUser,
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
        currentSources = await options.notebookService.listSources(
          options.notebookId,
          options.authUser,
          true
        );
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
    const addedSources = (currentSources || [])
      .filter((source) => !baselineIds.has(source.id))
      .filter((source) => !isRejectedGoogleDocsSource(documentRef, source));
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

  async function ensureNotebookTab(chromeLike, notebookUrl, authUser) {
    const preferredNotebookUrl = buildNotebookTabUrl(notebookUrl, authUser);
    const existing = await chromeLike.tabs.query({});
    const match = existing.find((tab) =>
      matchesNotebookTabUrl(tab && tab.url, notebookUrl, preferredNotebookUrl)
    );

    if (match && match.id) {
      if (!match.active && chromeLike.tabs && typeof chromeLike.tabs.update === "function") {
        await chromeLike.tabs.update(match.id, { active: true });
      }
      await waitForTab(chromeLike, match.id);
      return match;
    }

    const created = await chromeLike.tabs.create({ url: preferredNotebookUrl, active: true });
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

  function sendNotebookMessage(messageBridge, chromeLike, tabId, message) {
    if (messageBridge && typeof messageBridge.sendMessageToTab === "function") {
      return messageBridge.sendMessageToTab(tabId, message);
    }

    return sendMessageToTab(chromeLike, tabId, message);
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
      canonicalizeGoogleUrl(parsed);
      parsed.hash = "";
      return parsed.toString().replace(/\/$/, "");
    } catch (error) {
      return String(value).trim().replace(/\/$/, "");
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

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isRejectedGoogleDocsSource(documentRef, source) {
    if (!isGoogleDocsUrl(documentRef && (documentRef.canonicalUrl || documentRef.sourceUrl))) {
      return false;
    }

    return /sign[\s-]?in|登录/i.test(normalizeText(source && source.title));
  }

  function isGoogleDocsUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      return parsed.hostname.replace(/^www\./i, "").toLowerCase() === "docs.google.com";
    } catch (error) {
      return false;
    }
  }

  function isGoogleWorkspaceUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
      return host === "docs.google.com" || host === "drive.google.com";
    } catch (error) {
      return false;
    }
  }

  function shouldHandoffToUser(request) {
    if (!request || request.mode !== "url") {
      return false;
    }

    return isGoogleWorkspaceUrl(
      request.document && (request.document.canonicalUrl || request.document.sourceUrl)
    );
  }

  function buildNotebookTabUrl(notebookUrl, authUser) {
    try {
      const parsed = new URL(notebookUrl);
      if (authUser !== null && authUser !== undefined && authUser !== "") {
        parsed.searchParams.set("authuser", String(authUser));
      }
      return parsed.toString();
    } catch (error) {
      return notebookUrl;
    }
  }

  function matchesNotebookTabUrl(tabUrl, notebookUrl, preferredNotebookUrl) {
    const candidates = [preferredNotebookUrl, notebookUrl].filter(Boolean);
    return candidates.some((candidate) => typeof tabUrl === "string" && tabUrl.startsWith(candidate));
  }

  return {
    createNotebookDomWriter,
    findAddedSource
  };
});

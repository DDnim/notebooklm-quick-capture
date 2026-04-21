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
        const driveSource = notebookService.parseDriveSource ? notebookService.parseDriveSource(sourceUrl) : null;
        const authUser = request.targetNotebook.authUser;

        if (clipMode === "url") {
          return submitWithVerification({
            notebookService,
            notebookId: request.targetNotebook.id,
            authUser,
            document: request.document,
            mode: "url",
            verifyTimeoutMs,
            verifyPollMs,
            submit() {
              return notebookService.addSources(request.targetNotebook.id, [sourceUrl], authUser);
            }
          });
        }

        if (clipMode === "text") {
          return submitWithVerification({
            notebookService,
            notebookId: request.targetNotebook.id,
            authUser,
            document: request.document,
            mode: "text",
            verifyTimeoutMs,
            verifyPollMs,
            submit() {
              return notebookService.addTextSource(
                request.targetNotebook.id,
                fallbackText,
                request.document.title,
                authUser
              );
            }
          });
        }

        try {
          return await submitWithVerification({
            notebookService,
            notebookId: request.targetNotebook.id,
            authUser,
            document: request.document,
            mode: "url",
            verifyTimeoutMs,
            verifyPollMs,
            submit() {
              return notebookService.addSources(request.targetNotebook.id, [sourceUrl], authUser);
            }
          });
        } catch (error) {
          if (driveSource) {
            try {
              return await submitWithVerification({
                notebookService,
                notebookId: request.targetNotebook.id,
                authUser,
                document: request.document,
                mode: "drive",
                verifyTimeoutMs,
                verifyPollMs,
                submit() {
                  return notebookService.addDriveSource(request.targetNotebook.id, driveSource, authUser);
                }
              });
            } catch (driveError) {
              // Fall through to text mode after the drive fallback fails.
            }
          }

          return submitWithVerification({
            notebookService,
            notebookId: request.targetNotebook.id,
            authUser,
            document: request.document,
            mode: "text",
            verifyTimeoutMs,
            verifyPollMs,
            submit() {
              return notebookService.addTextSource(
                request.targetNotebook.id,
                fallbackText,
                request.document.title,
                authUser
              );
            }
          });
        }
      }
    };
  }

  async function submitWithVerification(options) {
    const baselineSources = await options.notebookService
      .listSources(options.notebookId, options.authUser, true)
      .catch(() => []);
    const submitResponse = await options.submit();
    const expectedSourceId =
      options.notebookService.extractCreatedSourceId && submitResponse
        ? options.notebookService.extractCreatedSourceId(submitResponse)
        : "";

    const verification = await verifyClip({
      notebookService: options.notebookService,
      notebookId: options.notebookId,
      authUser: options.authUser,
      document: options.document,
      baselineSources,
      expectedSourceId,
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
      sourceId: verification.source ? verification.source.id : expectedSourceId || null,
      verified: verification.status === "verified"
    };
  }

  async function verifyClip(options) {
    const baselineIds = new Set((options.baselineSources || []).map((source) => source.id));
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
        currentSources,
        options.expectedSourceId
      );

      if (matched) {
        return { status: "verified", source: matched };
      }

      await delay(options.pollMs);
    }

    if (options.expectedSourceId) {
      return {
        status: "accepted",
        source: {
          id: options.expectedSourceId
        }
      };
    }

    return { status: "missing" };
  }

  function findAddedSource(documentRef, mode, baselineIds, currentSources, expectedSourceId) {
    const addedSources = (currentSources || [])
      .filter((source) => !baselineIds.has(source.id))
      .filter((source) => !isRejectedGoogleDocsSource(documentRef, source));
    if (addedSources.length === 0) {
      return null;
    }

    if (expectedSourceId) {
      const idMatch = addedSources.find((source) => source.id === expectedSourceId);
      if (idMatch) {
        return idMatch;
      }
    }

    const normalizedUrl = normalizeUrl(documentRef.canonicalUrl || documentRef.sourceUrl || "");
    const normalizedTitle = normalizeText(documentRef.title || "");
    const driveSource = parseDriveSource(documentRef.canonicalUrl || documentRef.sourceUrl || "");

    if (driveSource && mode === "drive") {
      const driveMatch = addedSources.find((source) => source.driveFileId === driveSource.fileId);
      if (driveMatch) {
        return driveMatch;
      }
    }

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

  function parseDriveSource(value) {
    const input = String(value || "").trim();
    if (!input) {
      return null;
    }

    try {
      const parsed = new URL(input);
      const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
      const path = parsed.pathname;

      if (host !== "docs.google.com") {
        return null;
      }

      const documentMatch = path.match(/^\/document(?:\/u\/\d+)?\/d\/([^/]+)/);
      if (documentMatch) {
        return { fileId: documentMatch[1], sourceType: "google_doc" };
      }

      const slidesMatch = path.match(/^\/presentation(?:\/u\/\d+)?\/d\/([^/]+)/);
      if (slidesMatch) {
        return { fileId: slidesMatch[1], sourceType: "google_slides" };
      }

      const sheetsMatch = path.match(/^\/spreadsheets(?:\/u\/\d+)?\/d\/([^/]+)/);
      if (sheetsMatch) {
        return { fileId: sheetsMatch[1], sourceType: "google_sheets" };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return {
    createNotebookRpcWriter,
    findAddedSource
  };
});

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.ClipperNotebooklmDataService = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DEFAULT_LIMITS = {
    maxNotebooks: 100,
    maxSourcesPerNotebook: 50,
    maxCharsPerSource: 500000
  };

  const SOURCE_TYPE_MAP = {
    0: "audio",
    1: "google_doc",
    2: "google_slides",
    3: "pdf",
    4: "text",
    5: "web",
    8: "markdown",
    9: "youtube",
    10: "audio",
    11: "docx",
    13: "image",
    14: "google_sheets"
  };

  const SOURCE_STATUS_MAP = {
    2: "ready",
    3: "error",
    5: "processing"
  };

  function createNotebooklmDataService(options) {
    const fetchImpl = (options && options.fetchImpl) || fetch;
    const nowFn = (options && options.nowFn) || Date.now;
    const cacheTtlMs = (options && options.cacheTtlMs) || 5 * 60 * 1000;
    const tokenCache = new Map();
    const notebookCache = new Map();
    const sourceCache = new Map();

    return {
      async listNotebooks(requestedAuthUser, forceRefresh) {
        const cacheKey = requestedAuthUser === undefined ? "default" : String(requestedAuthUser);
        const cached = notebookCache.get(cacheKey);
        if (!forceRefresh && cached && nowFn() - cached.timestamp < cacheTtlMs) {
          return cached.value;
        }

        const raw = await callRpc(fetchImpl, tokenCache, requestedAuthUser, "wXbhsf", [null, 1, null, [2]], "/");
        const notebooks = parseNotebookList(raw);
        notebookCache.set(cacheKey, { timestamp: nowFn(), value: notebooks });
        return notebooks;
      },

      async listSources(notebookId, requestedAuthUser, forceRefresh) {
        const cacheKey = `${requestedAuthUser === undefined ? "default" : String(requestedAuthUser)}:${notebookId}`;
        const cached = sourceCache.get(cacheKey);
        if (!forceRefresh && cached && nowFn() - cached.timestamp < cacheTtlMs) {
          return cached.value;
        }

        const raw = await callRpc(
          fetchImpl,
          tokenCache,
          requestedAuthUser,
          "rLM1Ne",
          [notebookId, null, [2]],
          `/notebook/${notebookId}`
        );
        const sources = parseSourceList(raw);
        sourceCache.set(cacheKey, { timestamp: nowFn(), value: sources });
        return sources;
      },

      async addSources(notebookId, urls, requestedAuthUser) {
        const payload = [urls.map(buildUrlSourcePayload), notebookId];
        await callRpc(fetchImpl, tokenCache, requestedAuthUser, "izAoDd", payload, `/notebook/${notebookId}`);
        clearSourceCache(sourceCache, notebookId, requestedAuthUser);
      },

      async addTextSource(notebookId, content, title, requestedAuthUser) {
        const payload = [
          [buildTextSourcePayload({ title, content })],
          notebookId,
          [2],
          [1, null, null, null, null, null, null, null, null, null, [1]]
        ];
        await callRpc(fetchImpl, tokenCache, requestedAuthUser, "izAoDd", payload, `/notebook/${notebookId}`);
        clearSourceCache(sourceCache, notebookId, requestedAuthUser);
      },

      async getAccountLimits(requestedAuthUser) {
        try {
          const raw = await callRpc(fetchImpl, tokenCache, requestedAuthUser, "ZwVcOc", [], "/");
          const parsed = parseRpcJson(raw);
          const payload = parsed && parsed[0] && parsed[0][2] ? JSON.parse(parsed[0][2]) : null;
          const values = payload && payload[0] && payload[0][1];
          if (!Array.isArray(values) || values.length < 4) {
            return DEFAULT_LIMITS;
          }

          return {
            maxNotebooks: values[1] || DEFAULT_LIMITS.maxNotebooks,
            maxSourcesPerNotebook: values[2] || DEFAULT_LIMITS.maxSourcesPerNotebook,
            maxCharsPerSource: values[3] || DEFAULT_LIMITS.maxCharsPerSource
          };
        } catch (error) {
          return DEFAULT_LIMITS;
        }
      },

      parseNotebookId(input) {
        return parseNotebookId(input);
      },

      buildNotebookUrl(notebookId) {
        return buildNotebookUrl(notebookId);
      },

      clearCaches() {
        notebookCache.clear();
        sourceCache.clear();
      }
    };
  }

  async function callRpc(fetchImpl, tokenCache, authUser, rpcId, payload, sourcePath) {
    const tokens = await getAuthTokens(fetchImpl, tokenCache, authUser);
    const query = new URLSearchParams();
    query.append("rpcids", rpcId);
    query.append("source-path", sourcePath || "/");
    query.append("bl", tokens.buildToken);
    query.append("_reqid", String(Math.floor(Math.random() * 900000) + 100000));
    query.append("rt", "c");
    if (authUser !== undefined) {
      query.append("authuser", String(authUser));
    }

    const url = `https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute?${query.toString()}`;
    const form = new URLSearchParams();
    form.append("f.req", JSON.stringify([[[rpcId, JSON.stringify(payload), null, "generic"]]]));
    form.append("at", tokens.authToken.includes(":") ? tokens.authToken : `${tokens.authToken}:${Date.now()}`);

    const response = await fetchImpl(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-same-domain": "1"
      },
      body: form.toString()
    });

    if (!response.ok) {
      tokenCache.delete(authUser === undefined ? "default" : String(authUser));
      throw new Error(`NotebookLM RPC failed: ${response.status} ${response.statusText}`);
    }

    return response.text();
  }

  async function getAuthTokens(fetchImpl, tokenCache, authUser) {
    const cacheKey = authUser === undefined ? "default" : String(authUser);
    const cached = tokenCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 60000) {
      return cached.tokens;
    }

    const pageUrl =
      authUser === undefined
        ? "https://notebooklm.google.com/"
        : `https://notebooklm.google.com/?authuser=${authUser}&pageId=none`;
    const response = await fetchImpl(pageUrl, {
      credentials: "include",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to load NotebookLM: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    if (
      html.includes("accounts.google.com/v3/signin") ||
      html.includes("accounts.google.com/signin") ||
      html.includes('<base href="https://accounts.google.com/')
    ) {
      throw new Error("You are not signed in to NotebookLM.");
    }

    const buildToken = extractPageToken("cfb2h", html);
    const authToken = extractPageToken("SNlM0e", html);
    if (!buildToken || !authToken) {
      throw new Error("Could not extract NotebookLM auth tokens.");
    }

    const tokens = { buildToken, authToken };
    tokenCache.set(cacheKey, { timestamp: Date.now(), tokens });
    return tokens;
  }

  function extractPageToken(tokenName, html) {
    const pattern = new RegExp(`"${tokenName}":"([^"]+)"`);
    const match = pattern.exec(html);
    return match ? match[1] : null;
  }

  function parseRpcJson(rawText, lineIndex) {
    const lines = String(rawText || "").split("\n");
    const targetLine = lines[lineIndex === undefined ? 3 : lineIndex];
    if (!targetLine) {
      throw new Error("Unexpected NotebookLM RPC response format.");
    }
    return JSON.parse(targetLine);
  }

  function parseNotebookList(rawText) {
    const parsed = parseRpcJson(rawText);
    const firstChunk = parsed && parsed[0];
    const serialized = firstChunk && firstChunk[2];
    if (!serialized) {
      return [];
    }

    const payload = JSON.parse(serialized);
    const notebooks = payload && payload[0];
    if (!Array.isArray(notebooks)) {
      return [];
    }

    return notebooks
      .filter((entry) => Array.isArray(entry) && entry.length >= 3)
      .filter((entry) => {
        const flags = Array.isArray(entry[5]) ? entry[5] : [];
        return !(Array.isArray(flags) && flags.length > 0 && flags[0] === 3);
      })
      .map((entry) => {
        const meta = Array.isArray(entry[5]) ? entry[5] : [];
        return {
          id: entry[2],
          name: entry[0] ? String(entry[0]).trim() : "Untitled notebook",
          emoji: entry[3] || "📔",
          url: buildNotebookUrl(entry[2]),
          isShared: meta[1] === true
        };
      });
  }

  function parseSourceList(rawText) {
    const parsed = parseRpcJson(rawText);
    const firstChunk = parsed && parsed[0];
    const serialized = firstChunk && firstChunk[2];
    if (!serialized) {
      return [];
    }

    const payload = JSON.parse(serialized);
    const entries = payload && payload[0] && payload[0][1];
    if (!Array.isArray(entries)) {
      return [];
    }

    return entries
      .filter((entry) => Array.isArray(entry) && entry.length > 0)
      .map((entry, index) => {
        const id = Array.isArray(entry[0]) && entry[0].length > 0 ? String(entry[0][0]) : `source_${index}`;
        const title = typeof entry[1] === "string" && entry[1].length > 0 ? entry[1] : "Untitled";
        const metadata = Array.isArray(entry[2]) ? entry[2] : [];
        const statusBits = Array.isArray(entry[3]) ? entry[3] : [];
        const typeCode = metadata[4];
        let type = SOURCE_TYPE_MAP[typeCode] || "unknown";
        if (typeCode === 14 && Array.isArray(metadata[9]) && metadata[9][2] === "application/pdf") {
          type = "pdf";
        }

        const urls = Array.isArray(metadata[5]) ? metadata[5] : [];
        const altUrls = Array.isArray(metadata[7]) ? metadata[7] : [];
        const sourceUrl =
          typeof urls[0] === "string"
            ? urls[0]
            : typeof altUrls[0] === "string"
              ? altUrls[0]
              : "";

        return {
          id,
          title,
          type,
          status: SOURCE_STATUS_MAP[statusBits[1]] || "processing",
          url: sourceUrl,
          normalizedUrl: normalizeUrl(sourceUrl)
        };
      });
  }

  function parseNotebookId(input) {
    const value = String(input || "").trim();
    if (!value) {
      return "";
    }

    try {
      const url = new URL(value);
      const match = url.pathname.match(/\/notebook\/([^/]+)/);
      return match ? match[1] : "";
    } catch (error) {
      return value;
    }
  }

  function buildNotebookUrl(notebookId) {
    return `https://notebooklm.google.com/notebook/${notebookId}`;
  }

  function buildUrlSourcePayload(url) {
    const value = String(url || "").trim();
    if (value.includes("youtube.com") || value.includes("youtu.be")) {
      return [null, null, null, null, null, null, null, [value]];
    }
    return [null, null, [value]];
  }

  function buildTextSourcePayload(input) {
    return [null, [input.title || "Pasted Text", input.content], null, 2, null, null, null, null, null, null, 1];
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

  function clearSourceCache(sourceCache, notebookId, requestedAuthUser) {
    const exactKey = `${requestedAuthUser === undefined ? "default" : String(requestedAuthUser)}:${notebookId}`;
    sourceCache.delete(exactKey);
  }

  return {
    createNotebooklmDataService,
    parseNotebookId,
    buildNotebookUrl,
    parseNotebookList,
    parseSourceList,
    buildUrlSourcePayload,
    buildTextSourcePayload
  };
});

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
  const DEFAULT_ACCOUNT_PROBE_LIMIT = 6;

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
    const accountCache = {
      timestamp: 0,
      value: []
    };

    return {
      async listAccounts(forceRefresh) {
        if (!forceRefresh && nowFn() - accountCache.timestamp < cacheTtlMs) {
          return accountCache.value;
        }

        const accounts = [];
        const seen = new Set();

        for (let authUser = 0; authUser < DEFAULT_ACCOUNT_PROBE_LIMIT; authUser += 1) {
          const account = await probeAccount(fetchImpl, authUser).catch(() => null);
          if (!account) {
            continue;
          }

          const dedupeKey = account.id || account.email || String(account.authUser);
          if (seen.has(dedupeKey)) {
            continue;
          }

          seen.add(dedupeKey);
          accounts.push(account);
        }

        accountCache.timestamp = nowFn();
        accountCache.value = accounts;
        return accounts;
      },

      async listNotebooks(requestedAuthUser, forceRefresh) {
        const authUser = normalizeAuthUser(requestedAuthUser);
        const cacheKey = authUser === undefined ? "default" : String(authUser);
        const cached = notebookCache.get(cacheKey);
        if (!forceRefresh && cached && nowFn() - cached.timestamp < cacheTtlMs) {
          return cached.value;
        }

        const raw = await callRpc(fetchImpl, tokenCache, authUser, "wXbhsf", [null, 1, null, [2]], "/");
        const notebooks = parseNotebookList(raw);
        notebookCache.set(cacheKey, { timestamp: nowFn(), value: notebooks });
        return notebooks;
      },

      async listSources(notebookId, requestedAuthUser, forceRefresh) {
        const authUser = normalizeAuthUser(requestedAuthUser);
        const cacheKey = `${authUser === undefined ? "default" : String(authUser)}:${notebookId}`;
        const cached = sourceCache.get(cacheKey);
        if (!forceRefresh && cached && nowFn() - cached.timestamp < cacheTtlMs) {
          return cached.value;
        }

        const raw = await callRpc(
          fetchImpl,
          tokenCache,
          authUser,
          "rLM1Ne",
          [notebookId, null, [2]],
          `/notebook/${notebookId}`
        );
        const sources = parseSourceList(raw);
        sourceCache.set(cacheKey, { timestamp: nowFn(), value: sources });
        return sources;
      },

      async addSources(notebookId, urls, requestedAuthUser) {
        const authUser = normalizeAuthUser(requestedAuthUser);
        const payload = [urls.map(buildUrlSourcePayload), notebookId];
        const responseText = await callRpc(fetchImpl, tokenCache, authUser, "izAoDd", payload, `/notebook/${notebookId}`);
        clearSourceCache(sourceCache, notebookId, authUser);
        return responseText;
      },

      async addDriveSource(notebookId, input, requestedAuthUser) {
        const authUser = normalizeAuthUser(requestedAuthUser);
        const payload = [ [buildDriveSourcePayload(input)], notebookId ];
        const responseText = await callRpc(fetchImpl, tokenCache, authUser, "izAoDd", payload, `/notebook/${notebookId}`);
        clearSourceCache(sourceCache, notebookId, authUser);
        return responseText;
      },

      async addTextSource(notebookId, content, title, requestedAuthUser) {
        const authUser = normalizeAuthUser(requestedAuthUser);
        const payload = [
          [buildTextSourcePayload({ title, content })],
          notebookId,
          [2],
          [1, null, null, null, null, null, null, null, null, null, [1]]
        ];
        const responseText = await callRpc(fetchImpl, tokenCache, authUser, "izAoDd", payload, `/notebook/${notebookId}`);
        clearSourceCache(sourceCache, notebookId, authUser);
        return responseText;
      },

      async getAccountLimits(requestedAuthUser) {
        const authUser = normalizeAuthUser(requestedAuthUser);
        try {
          const raw = await callRpc(fetchImpl, tokenCache, authUser, "ZwVcOc", [], "/");
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

      parseDriveSource(input) {
        return parseDriveSource(input);
      },

      extractCreatedSourceId(rawText) {
        return extractCreatedSourceId(rawText);
      },

      clearCaches() {
        notebookCache.clear();
        sourceCache.clear();
        accountCache.timestamp = 0;
        accountCache.value = [];
      }
    };
  }

  async function callRpc(fetchImpl, tokenCache, authUser, rpcId, payload, sourcePath) {
    const normalizedAuthUser = normalizeAuthUser(authUser);
    const tokens = await getAuthTokens(fetchImpl, tokenCache, normalizedAuthUser);
    const query = new URLSearchParams();
    query.append("rpcids", rpcId);
    query.append("source-path", sourcePath || "/");
    query.append("bl", tokens.buildToken);
    query.append("_reqid", String(Math.floor(Math.random() * 900000) + 100000));
    query.append("rt", "c");
    if (normalizedAuthUser !== undefined) {
      query.append("authuser", String(normalizedAuthUser));
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
      tokenCache.delete(normalizedAuthUser === undefined ? "default" : String(normalizedAuthUser));
      throw new Error(`NotebookLM RPC failed: ${response.status} ${response.statusText}`);
    }

    return response.text();
  }

  async function getAuthTokens(fetchImpl, tokenCache, authUser) {
    const normalizedAuthUser = normalizeAuthUser(authUser);
    const cacheKey = normalizedAuthUser === undefined ? "default" : String(normalizedAuthUser);
    const cached = tokenCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 60000) {
      return cached.tokens;
    }

    const html = await fetchNotebookPageHtml(fetchImpl, normalizedAuthUser);
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

  async function fetchNotebookPageHtml(fetchImpl, authUser) {
    const normalizedAuthUser = normalizeAuthUser(authUser);
    const pageUrl =
      normalizedAuthUser === undefined
        ? "https://notebooklm.google.com/"
        : `https://notebooklm.google.com/?authuser=${normalizedAuthUser}&pageId=none`;
    const response = await fetchImpl(pageUrl, {
      credentials: "include",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to load NotebookLM: ${response.status} ${response.statusText}`);
    }

    return response.text();
  }

  async function probeAccount(fetchImpl, authUser) {
    const normalizedAuthUser = normalizeAuthUser(authUser);
    if (normalizedAuthUser === undefined) {
      return null;
    }

    const html = await fetchNotebookPageHtml(fetchImpl, normalizedAuthUser);
    if (
      html.includes("accounts.google.com/v3/signin") ||
      html.includes("accounts.google.com/signin") ||
      html.includes('<base href="https://accounts.google.com/')
    ) {
      return null;
    }

    const email = extractPageToken("oPEP7c", html);
    const id = extractPageToken("S06Grb", html);
    if (!email || !id) {
      return null;
    }

    return {
      id,
      authUser: normalizedAuthUser,
      email,
      name: String(email).split("@")[0] || email,
      isDefault: normalizedAuthUser === 0,
      label: normalizedAuthUser === 0 ? `${email} (default)` : email
    };
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

        let driveFileId = "";
        const driveMeta = metadata[0];
        const altDriveMeta = metadata[9];
        if (Array.isArray(driveMeta) && typeof driveMeta[0] === "string") {
          driveFileId = driveMeta[0];
        } else if (Array.isArray(altDriveMeta) && typeof altDriveMeta[0] === "string") {
          driveFileId = altDriveMeta[0];
        }

        const urls = Array.isArray(metadata[5]) ? metadata[5] : [];
        const altUrls = Array.isArray(metadata[7]) ? metadata[7] : [];
        const sourceUrl =
          typeof urls[0] === "string"
            ? urls[0]
            : typeof altUrls[0] === "string"
              ? altUrls[0]
              : buildDriveSourceUrl(type, driveFileId);

        return {
          id,
          title,
          type,
          status: SOURCE_STATUS_MAP[statusBits[1]] || "processing",
          url: sourceUrl,
          normalizedUrl: normalizeUrl(sourceUrl),
          driveFileId
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

  function buildDriveSourcePayload(input) {
    const parsed = typeof input === "string" ? parseDriveSource(input) : input;
    if (!parsed || !parsed.fileId || !parsed.sourceTypeCode) {
      throw new Error("Could not build a Google Drive source payload from the provided URL.");
    }

    return [null, null, parsed.fileId, null, parsed.sourceTypeCode];
  }

  function buildTextSourcePayload(input) {
    return [null, [input.title || "Pasted Text", input.content], null, 2, null, null, null, null, null, null, 1];
  }

  function parseDriveSource(input) {
    const value = String(input || "").trim();
    if (!value) {
      return null;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(value);
    } catch (error) {
      return null;
    }

    const host = parsedUrl.hostname.replace(/^www\./i, "").toLowerCase();
    const path = parsedUrl.pathname;
    let match = null;
    let sourceTypeCode = 0;
    let sourceType = "";

    if (host === "docs.google.com") {
      match = path.match(/^\/document(?:\/u\/\d+)?\/d\/([^/]+)/);
      if (match) {
        sourceTypeCode = 1;
        sourceType = "google_doc";
      }

      if (!match) {
        match = path.match(/^\/presentation(?:\/u\/\d+)?\/d\/([^/]+)/);
        if (match) {
          sourceTypeCode = 2;
          sourceType = "google_slides";
        }
      }

      if (!match) {
        match = path.match(/^\/spreadsheets(?:\/u\/\d+)?\/d\/([^/]+)/);
        if (match) {
          sourceTypeCode = 14;
          sourceType = "google_sheets";
        }
      }
    }

    if (!match || !sourceTypeCode) {
      return null;
    }

    const fileId = match[1];
    return {
      fileId,
      sourceTypeCode,
      sourceType,
      normalizedUrl: buildDriveSourceUrl(sourceType, fileId)
    };
  }

  function buildDriveSourceUrl(type, fileId) {
    if (!fileId) {
      return "";
    }

    if (type === "google_doc") {
      return `https://docs.google.com/document/d/${fileId}/edit`;
    }

    if (type === "google_slides") {
      return `https://docs.google.com/presentation/d/${fileId}/edit`;
    }

    if (type === "google_sheets") {
      return `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
    }

    return "";
  }

  function extractCreatedSourceId(rawText) {
    if (!rawText) {
      return "";
    }

    try {
      const parsed = parseRpcJson(rawText);
      const firstChunk = parsed && parsed[0];
      const payload = firstChunk && firstChunk[2];
      const normalized = typeof payload === "string" ? JSON.parse(payload) : payload;
      const candidates = collectStrings(normalized);
      const id = candidates.find((value) => isLikelySourceId(value));
      if (id) {
        return id;
      }
    } catch (error) {
      // Fall through to the raw scan below.
    }

    const rawCandidates = collectStrings(String(rawText));
    return rawCandidates.find((value) => isLikelySourceId(value)) || "";
  }

  function collectStrings(input) {
    if (typeof input === "string") {
      return input.match(/[A-Za-z0-9_-]{8,}/g) || [];
    }

    if (!Array.isArray(input)) {
      return [];
    }

    const values = [];
    input.forEach((item) => {
      if (typeof item === "string") {
        values.push(item);
      } else if (Array.isArray(item)) {
        values.push.apply(values, collectStrings(item));
      }
    });
    return values;
  }

  function isLikelySourceId(value) {
    return /^[A-Za-z0-9_-]{8,}$/.test(String(value || "")) && !String(value).includes("google");
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

  function clearSourceCache(sourceCache, notebookId, requestedAuthUser) {
    const authUser = normalizeAuthUser(requestedAuthUser);
    const exactKey = `${authUser === undefined ? "default" : String(authUser)}:${notebookId}`;
    sourceCache.delete(exactKey);
  }

  function normalizeAuthUser(value) {
    if (value === null || value === undefined || value === "") {
      return undefined;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return undefined;
    }

    return parsed;
  }

  return {
    createNotebooklmDataService,
    parseNotebookId,
    buildNotebookUrl,
    parseNotebookList,
    parseSourceList,
    buildUrlSourcePayload,
    buildDriveSourcePayload,
    buildTextSourcePayload,
    parseDriveSource,
    extractCreatedSourceId,
    probeAccount,
    normalizeUrl
  };
});

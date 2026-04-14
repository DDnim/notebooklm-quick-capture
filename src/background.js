importScripts(
  "shared/clipModels.js",
  "storage/settingsRepo.js",
  "storage/historyRepo.js",
  "core/clip/dedupe.js",
  "background/notebooklmDataService.js",
  "writers/notebooklm-rpc/notebookRpcWriter.js",
  "background/jobRunner.js"
);

(function () {
  const SELECTION_CONTEXT_MENU_ID = "clip-selection-first";
  const settingsRepo = ClipperSettingsRepo.createSettingsRepo(chrome);
  const historyRepo = ClipperHistoryRepo.createHistoryRepo(chrome, { limit: 12 });
  const dedupeService = ClipperDedupe.createDedupeService(ClipperClipModels);
  const notebookService = ClipperNotebooklmDataService.createNotebooklmDataService();
  const writer = ClipperNotebookRpcWriter.createNotebookRpcWriter({
    notebookService
  });
  const jobRunner = ClipperJobRunner.createJobRunner({
    writer,
    historyRepo,
    dedupeService,
    modelsApi: ClipperClipModels,
    notebookService
  });

  chrome.runtime.onInstalled.addListener(async () => {
    await settingsRepo.initDefaults();
    await ensureSelectionContextMenu();
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
    }
  });

  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
      ensureSelectionContextMenu().catch((error) => {
        console.error("Could not restore selection context menu on startup:", error);
      });
    });
  }

  ensureSelectionContextMenu().catch(() => {});

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== SELECTION_CONTEXT_MENU_ID) {
      return;
    }

    clipCurrentSelection(info, tab)
      .then((result) => {
        const activeTabId = tab && tab.id ? tab.id : null;
        if (activeTabId) {
          showSelectionFeedback(activeTabId, buildSelectionFeedbackPayload(result)).catch(() => {});
        }
      })
      .catch((error) => {
        console.error("Selection clip failed:", error);
        const activeTabId = tab && tab.id ? tab.id : null;
        if (activeTabId) {
          showSelectionFeedback(activeTabId, {
            state: "error",
            message: error && error.message ? error.message : "Could not save selection to NotebookLM."
          }).catch(() => {});
        }
      });
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) {
      return false;
    }

    (async () => {
      try {
        if (message.type === "GET_SETTINGS") {
          sendResponse({ ok: true, settings: await settingsRepo.get() });
          return;
        }

        if (message.type === "SAVE_SETTINGS") {
          sendResponse({ ok: true, settings: await settingsRepo.save(message.settings || {}) });
          return;
        }

        if (message.type === "GET_HISTORY") {
          sendResponse({ ok: true, history: await historyRepo.list() });
          return;
        }

        if (message.type === "GET_NOTEBOOKS") {
          const notebooks = await notebookService.listNotebooks(undefined, Boolean(message.forceRefresh));
          sendResponse({ ok: true, notebooks });
          return;
        }

        if (message.type === "OPEN_SIDE_PANEL") {
          const tab = sender.tab || (await getActiveTab());
          if (!tab || !tab.windowId) {
            throw new Error("Could not find an active browser window.");
          }
          await chrome.sidePanel.open({ windowId: tab.windowId });
          sendResponse({ ok: true });
          return;
        }

        if (message.type === "START_CLIP") {
          const result = await clipCurrentPage(message.mode);
          sendResponse({ ok: true, result });
          return;
        }

        if (message.type === "START_MANUAL_TEXT") {
          const result = await clipManualText(message.title, message.content);
          sendResponse({ ok: true, result });
          return;
        }

        throw new Error(`Unknown message type: ${message.type}`);
      } catch (error) {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : "Something went wrong."
        });
      }
    })();

    return true;
  });

  async function clipCurrentPage(requestedMode) {
    const settings = await settingsRepo.get();
    const clipMode = requestedMode || settings.clipMode || "auto";
    const targetNotebook = resolveTargetNotebook(settings);

    const pageTab = await getActiveTab();
    if (!pageTab || !pageTab.id || !pageTab.url) {
      throw new Error("Could not detect the current tab.");
    }

    if (!/^https?:/i.test(pageTab.url)) {
      throw new Error("This extension only works on normal web pages.");
    }

    const documentRef = await extractClipDocument(pageTab.id);
    return runClipRequest({
      targetNotebook,
      mode: clipMode,
      document: documentRef
    });
  }

  async function clipCurrentSelection(info, tab) {
    const selectionText = typeof info.selectionText === "string" ? info.selectionText.trim() : "";
    if (!selectionText) {
      throw new Error("No selected text was provided.");
    }

    const settings = await settingsRepo.get();
    const targetNotebook = resolveTargetNotebook(settings);
    const activeTab = tab && tab.id ? tab : await getActiveTab();
    if (!activeTab || !activeTab.id || !activeTab.url) {
      throw new Error("Could not detect the selected tab.");
    }

    if (!/^https?:/i.test(activeTab.url)) {
      throw new Error("Selection clipping only works on normal web pages.");
    }

    const selectionDocument = buildSelectionDocument(
      {
        title: activeTab.title || "Current page",
        summary: ""
      },
      selectionText,
      activeTab.url
    );

    return runClipRequest({
      targetNotebook,
      mode: "text",
      document: selectionDocument
    });
  }

  async function clipManualText(title, content) {
    const cleanedContent = typeof content === "string" ? content.trim() : "";
    const cleanedTitle = typeof title === "string" ? title.trim() : "";

    if (!cleanedContent) {
      throw new Error("Type or paste some content first.");
    }

    const settings = await settingsRepo.get();
    const targetNotebook = resolveTargetNotebook(settings);
    const manualDocument = ClipperClipModels.createClipDocument({
      kind: "manual_text",
      title: cleanedTitle || "Typed text",
      content: cleanedContent,
      metadata: {
        inputMode: "manual_text"
      },
      fallbackText: ClipperClipModels.buildFallbackText({
        title: cleanedTitle || "Typed text",
        sourceUrl: "",
        summary: "",
        content: cleanedContent
      })
    });

    return runClipRequest({
      targetNotebook,
      mode: "text",
      document: manualDocument
    });
  }

  async function extractClipDocument(tabId, options) {
    const response = await sendMessageToTab(tabId, {
      type: "EXTRACT_CLIP_DOCUMENT",
      selectionText: options && options.selectionText ? options.selectionText : "",
      preferSelection: Boolean(options && options.preferSelection)
    });
    if (!response || !response.ok || !response.document) {
      throw new Error(response && response.error ? response.error : "Could not read the current page.");
    }
    return response.document;
  }

  function resolveTargetNotebook(settings) {
    const notebookId = settings.notebookId || notebookService.parseNotebookId(settings.notebookUrl);
    const notebookUrl = settings.notebookUrl || (notebookId ? notebookService.buildNotebookUrl(notebookId) : "");

    if (!notebookUrl) {
      throw new Error("Add your NotebookLM notebook URL first.");
    }

    return {
      id: notebookId || notebookUrl,
      name: settings.notebookName || "NotebookLM notebook",
      url: notebookUrl
    };
  }

  function runClipRequest(input) {
    const request = ClipperClipModels.createClipRequest(input);
    return jobRunner.runClip(request);
  }

  function buildSelectionDocument(extractedDocument, selectionText, pageUrl) {
    const baseTitle = extractedDocument.title || "Current page";
    return ClipperClipModels.createClipDocument({
      kind: "selection",
      title: `Selection from ${baseTitle}`,
      content: selectionText,
      summary: extractedDocument.summary || "",
      metadata: {
        pageTitle: baseTitle,
        pageUrl,
        selectionText
      },
      fallbackText: ClipperClipModels.buildFallbackText({
        title: `Selection from ${baseTitle}`,
        sourceUrl: pageUrl,
        summary: extractedDocument.summary || "",
        content: selectionText
      })
    });
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs[0] || null;
  }

  async function ensureSelectionContextMenu() {
    await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
    await new Promise((resolve, reject) => {
      chrome.contextMenus.create({
        id: SELECTION_CONTEXT_MENU_ID,
        title: "Save selected text to NotebookLM",
        contexts: ["selection"],
        documentUrlPatterns: ["http://*/*", "https://*/*"]
      }, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  }

  async function showSelectionFeedback(tabId, payload) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: renderFeedbackToast,
        args: [payload]
      });
    } catch (error) {
      try {
        await sendMessageToTab(tabId, {
          type: "SHOW_CLIP_FEEDBACK",
          state: payload.state,
          message: payload.message
        });
      } catch (fallbackError) {
        // Ignore page-feedback delivery failures and rely on the badge fallback.
      }
    }

    showActionBadge(payload);
  }

  function buildSelectionFeedbackPayload(result) {
    if (result && result.skipped) {
      return {
        state: "skip",
        message: "Selection already exists in this NotebookLM notebook."
      };
    }

    return {
      state: "success",
      message: "Selection saved to NotebookLM."
    };
  }

  function showActionBadge(payload) {
    if (!chrome.action || !chrome.action.setBadgeText) {
      return;
    }

    const badgeByState = {
      success: { text: "OK", color: "#0c6b58" },
      skip: { text: "SKIP", color: "#8a6a12" },
      error: { text: "ERR", color: "#a13131" }
    };
    const badge = badgeByState[payload.state] || badgeByState.success;

    chrome.action.setBadgeBackgroundColor({ color: badge.color }).catch(() => {});
    chrome.action.setBadgeText({ text: badge.text }).catch(() => {});
    chrome.action.setTitle({
      title: `NotebookLM Quick Capture\n${payload.message}`
    }).catch(() => {});

    setTimeout(() => {
      chrome.action.setBadgeText({ text: "" }).catch(() => {});
      chrome.action.setTitle({ title: "NotebookLM Quick Capture" }).catch(() => {});
    }, 4500);
  }

  function renderFeedbackToast(payload) {
    const toastId = "notebooklm-clipper-feedback";
    const existing = document.getElementById(toastId);
    if (existing) {
      existing.remove();
    }

    const toast = document.createElement("div");
    toast.id = toastId;
    toast.textContent = payload && payload.message ? payload.message : "NotebookLM clip complete.";
    toast.setAttribute("role", "status");
    toast.style.position = "fixed";
    toast.style.right = "20px";
    toast.style.bottom = "20px";
    toast.style.zIndex = "2147483647";
    toast.style.maxWidth = "320px";
    toast.style.padding = "12px 14px";
    toast.style.borderRadius = "14px";
    toast.style.boxShadow = "0 16px 40px rgba(0, 0, 0, 0.18)";
    toast.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    toast.style.fontSize = "13px";
    toast.style.lineHeight = "1.45";
    toast.style.color = "#ffffff";
    toast.style.background = getFeedbackToastBackground(payload && payload.state);
    toast.style.opacity = "0";
    toast.style.transform = "translateY(12px)";
    toast.style.transition = "opacity 140ms ease, transform 140ms ease";

    document.documentElement.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    });

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";
      setTimeout(() => toast.remove(), 180);
    }, 3200);
  }

  function getFeedbackToastBackground(state) {
    if (state === "error") {
      return "#a13131";
    }

    if (state === "skip") {
      return "#8a6a12";
    }

    return "#0c6b58";
  }

  function sendMessageToTab(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    });
  }
})();

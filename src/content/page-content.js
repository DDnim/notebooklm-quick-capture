(function () {
  const registry = ClipperAdapterRegistry.createAdapterRegistry([
    ClipperWebAdapter.createWebAdapter({
      extractor: ClipperExtractor,
      modelsApi: ClipperClipModels
    })
  ]);
  const TOAST_ID = "notebooklm-clipper-feedback";

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) {
      return false;
    }

    if (message.type === "SHOW_CLIP_FEEDBACK") {
      showToast(message.state, message.message);
      sendResponse({ ok: true });
      return false;
    }

    if (message.type !== "EXTRACT_CLIP_DOCUMENT" && message.type !== "EXTRACT_PAGE_PAYLOAD") {
      return false;
    }

    try {
      const selection = typeof window.getSelection === "function" ? String(window.getSelection()) : "";
      const documentRef = registry.extract({
        url: window.location.href,
        documentRef: document,
        selectionText: message.selectionText || selection,
        preferSelection: Boolean(message.preferSelection)
      });

      Promise.resolve(documentRef)
        .then((resolvedDocument) => {
          if (message.type === "EXTRACT_PAGE_PAYLOAD") {
            sendResponse({
              ok: true,
              payload: {
                title: resolvedDocument.title,
                url: ClipperClipModels.getPreferredSourceUrl(resolvedDocument),
                description: resolvedDocument.summary,
                content: resolvedDocument.content,
                fallbackText: resolvedDocument.fallbackText
              }
            });
            return;
          }

          sendResponse({ ok: true, document: resolvedDocument });
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error && error.message ? error.message : "Could not extract the current page."
          });
        });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : "Could not extract the current page."
      });
    }

    return true;
  });

  function showToast(state, message) {
    const existing = document.getElementById(TOAST_ID);
    if (existing) {
      existing.remove();
    }

    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.textContent = message || "NotebookLM clip complete.";
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
    toast.style.background = getToastBackground(state);
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

  function getToastBackground(state) {
    if (state === "error") {
      return "#a13131";
    }

    if (state === "skip") {
      return "#8a6a12";
    }

    return "#0c6b58";
  }
})();

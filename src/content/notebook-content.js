chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || (message.type !== "CLIP_TO_NOTEBOOK" && message.type !== "WRITE_CLIP_DOCUMENT")) {
    return false;
  }

  (async () => {
    try {
      const payload =
        message.type === "WRITE_CLIP_DOCUMENT"
          ? message.payload || {}
          : {
              mode: (message.payload && message.payload.clipMode) || "auto",
              document: ClipperClipModels.createClipDocument({
                kind: "web",
                sourceUrl: message.payload && message.payload.page ? message.payload.page.url : "",
                canonicalUrl: message.payload && message.payload.page ? message.payload.page.url : "",
                title: message.payload && message.payload.page ? message.payload.page.title : "",
                content: message.payload && message.payload.page ? message.payload.page.content : "",
                summary: message.payload && message.payload.page ? message.payload.page.description : "",
                fallbackText:
                  message.payload && message.payload.page ? message.payload.page.fallbackText : ""
              })
            };

      const result = await NotebookAutomation.clipDocument(document, payload.document, {
        mode: payload.mode || "auto"
      });
      sendResponse({ ok: true, result });
    } catch (error) {
      sendResponse({
        ok: false,
        error:
          error && error.message
            ? error.message
            : "Could not automate NotebookLM. Make sure you are signed in and the notebook is open."
      });
    }
  })();

  return true;
});

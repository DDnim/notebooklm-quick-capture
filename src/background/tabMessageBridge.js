(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.ClipperTabMessageBridge = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const RECEIVING_END_ERROR = "Receiving end does not exist";
  const DEFAULT_CONNECTION_ERROR = "Could not connect to the current page. Reload it and try again.";

  function createTabMessageBridge(chromeLike, options) {
    const contentScriptFiles = (options && options.contentScriptFiles) || [];
    const canInject =
      (options && options.canInject) || canInjectContentScript;
    const messageTimeoutMs = (options && options.messageTimeoutMs) || 20000;

    return {
      async sendMessageToTab(tabId, message) {
        try {
          return await sendRawMessage(chromeLike, tabId, message, messageTimeoutMs);
        } catch (error) {
          if (!shouldRetryAfterMissingReceiver(error)) {
            throw error;
          }

          const tab = await getTab(chromeLike, tabId).catch(() => null);
          if (!tab || !canInject(tab.url)) {
            throw new Error(DEFAULT_CONNECTION_ERROR);
          }

          try {
            await chromeLike.scripting.executeScript({
              target: { tabId },
              files: contentScriptFiles
            });
          } catch (injectionError) {
            throw new Error(DEFAULT_CONNECTION_ERROR);
          }

          try {
            return await sendRawMessage(chromeLike, tabId, message, messageTimeoutMs);
          } catch (retryError) {
            if (shouldRetryAfterMissingReceiver(retryError)) {
              throw new Error(DEFAULT_CONNECTION_ERROR);
            }
            throw retryError;
          }
        }
      }
    };
  }

  function canInjectContentScript(url) {
    if (!url) {
      return false;
    }

    try {
      const parsed = new URL(url);
      return /^https?:$/.test(parsed.protocol) && parsed.hostname !== "notebooklm.google.com";
    } catch (error) {
      return false;
    }
  }

  function shouldRetryAfterMissingReceiver(error) {
    return Boolean(error && typeof error.message === "string" && error.message.includes(RECEIVING_END_ERROR));
  }

  function getTab(chromeLike, tabId) {
    if (!chromeLike.tabs || typeof chromeLike.tabs.get !== "function") {
      return Promise.reject(new Error("Tab lookup is unavailable."));
    }
    return chromeLike.tabs.get(tabId);
  }

  function sendRawMessage(chromeLike, tabId, message, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Timed out while waiting for the page to respond."));
      }, timeoutMs);

      chromeLike.tabs.sendMessage(tabId, message, (response) => {
        clearTimeout(timeoutId);
        const error = chromeLike.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    });
  }

  return {
    DEFAULT_CONNECTION_ERROR,
    canInjectContentScript,
    createTabMessageBridge,
    shouldRetryAfterMissingReceiver
  };
});

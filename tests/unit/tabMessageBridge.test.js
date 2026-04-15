const {
  DEFAULT_CONNECTION_ERROR,
  canInjectContentScript,
  createTabMessageBridge
} = require("../../src/background/tabMessageBridge.js");

describe("tab message bridge", () => {
  test("injects content scripts and retries when the receiver is missing", async () => {
    const calls = [];
    const chromeLike = createChromeStub({
      sendMessage(tabId, message, callback, runtime) {
        calls.push({ type: "send", tabId, message });
        if (calls.filter((entry) => entry.type === "send").length === 1) {
          runtime.lastError = { message: "Could not establish connection. Receiving end does not exist." };
          callback(undefined);
          runtime.lastError = null;
          return;
        }

        runtime.lastError = null;
        callback({ ok: true, document: { title: "Story" } });
      },
      async executeScript(details) {
        calls.push({ type: "inject", details });
      },
      async get() {
        return { id: 5, url: "https://example.com/story" };
      }
    });

    const bridge = createTabMessageBridge(chromeLike, {
      contentScriptFiles: ["src/content/page-content.js"]
    });

    const response = await bridge.sendMessageToTab(5, { type: "EXTRACT_CLIP_DOCUMENT" });

    expect(response).toEqual({ ok: true, document: { title: "Story" } });
    expect(calls).toEqual([
      { type: "send", tabId: 5, message: { type: "EXTRACT_CLIP_DOCUMENT" } },
      {
        type: "inject",
        details: {
          target: { tabId: 5 },
          files: ["src/content/page-content.js"]
        }
      },
      { type: "send", tabId: 5, message: { type: "EXTRACT_CLIP_DOCUMENT" } }
    ]);
  });

  test("returns a friendly error when the page cannot host the content script", async () => {
    const chromeLike = createChromeStub({
      sendMessage(tabId, message, callback, runtime) {
        runtime.lastError = { message: "Could not establish connection. Receiving end does not exist." };
        callback(undefined);
        runtime.lastError = null;
      },
      async executeScript() {
        throw new Error("Should not be called.");
      },
      async get() {
        return { id: 5, url: "https://notebooklm.google.com/notebook/demo" };
      }
    });

    const bridge = createTabMessageBridge(chromeLike, {
      contentScriptFiles: ["src/content/page-content.js"]
    });

    await expect(
      bridge.sendMessageToTab(5, { type: "EXTRACT_CLIP_DOCUMENT" })
    ).rejects.toThrow(DEFAULT_CONNECTION_ERROR);
  });

  test("canInjectContentScript rejects NotebookLM pages", () => {
    expect(canInjectContentScript("https://example.com/story")).toBe(true);
    expect(canInjectContentScript("https://notebooklm.google.com/notebook/demo")).toBe(false);
    expect(canInjectContentScript("chrome://extensions")).toBe(false);
  });
});

function createChromeStub(handlers) {
  const runtime = { lastError: null };
  return {
    runtime,
    tabs: {
      sendMessage(tabId, message, callback) {
        return handlers.sendMessage(tabId, message, callback, runtime);
      },
      get(tabId) {
        return handlers.get(tabId);
      }
    },
    scripting: {
      executeScript(details) {
        return handlers.executeScript(details);
      }
    }
  };
}

const {
  createNotebookDomWriter,
  findAddedSource
} = require("../../src/writers/notebooklm-dom/notebookDomWriter.js");
const { createClipDocument, createClipRequest } = require("../../src/shared/clipModels.js");

describe("notebook dom writer", () => {
  test("uses the notebook message bridge when NotebookLM content scripts need injection", async () => {
    const messages = [];
    const chromeLike = {
      tabs: {
        async query() {
          return [];
        },
        async create(details) {
          messages.push({ type: "create", details });
          return { id: 42, url: details.url, status: "complete" };
        },
        async get() {
          return { status: "complete" };
        }
      },
      runtime: {
        lastError: null
      }
    };

    let calls = 0;
    const writer = createNotebookDomWriter({
      chromeLike,
      messageBridge: {
        async sendMessageToTab(tabId, message) {
          messages.push({ type: "bridge", tabId, message });
          return { ok: true, result: { mode: "url" } };
        }
      },
      verifyTimeoutMs: 5,
      verifyPollMs: 0,
      notebookService: {
        async listSources() {
          calls += 1;
          return calls === 1
            ? []
            : [{ id: "src_new", normalizedUrl: "https://docs.google.com/document/d/abc123/edit", title: "Spec Draft" }];
        }
      }
    });

    const result = await writer.addClip(
      createClipRequest({
        targetNotebook: {
          id: "demo",
          name: "Demo",
          url: "https://notebooklm.google.com/notebook/demo",
          authUser: 2
        },
        mode: "url",
        document: createClipDocument({
          kind: "web",
          sourceUrl: "https://docs.google.com/document/d/abc123/edit",
          title: "Spec Draft",
          content: "Body"
        })
      })
    );

    expect(result.ok).toBe(true);
    expect(messages).toEqual([
      {
        type: "create",
        details: {
          url: "https://notebooklm.google.com/notebook/demo?authuser=2",
          active: true
        }
      },
      {
        type: "bridge",
        tabId: 42,
        message: {
          type: "WRITE_CLIP_DOCUMENT",
          payload: expect.any(Object)
        }
      }
    ]);
  });

  test("verifies a newly added website source via NotebookLM source list", async () => {
    const chromeLike = {
      tabs: {
        async query() {
          return [{ id: 10, url: "https://notebooklm.google.com/notebook/demo", status: "complete" }];
        },
        async get() {
          return { status: "complete" };
        },
        sendMessage(tabId, message, callback) {
          callback({ ok: true, result: { mode: "url" } });
        }
      },
      runtime: {
        lastError: null
      }
    };

    let calls = 0;
    const writer = createNotebookDomWriter({
      chromeLike,
      verifyTimeoutMs: 5,
      verifyPollMs: 0,
      notebookService: {
        async listSources() {
          calls += 1;
          return calls === 1
            ? [{ id: "src_old", normalizedUrl: "https://already.example/item", title: "Old" }]
            : [
                { id: "src_old", normalizedUrl: "https://already.example/item", title: "Old" },
                { id: "src_new", normalizedUrl: "https://example.com/story", title: "Story" }
              ];
        }
      }
    });

    const result = await writer.addClip(
      createClipRequest({
        targetNotebook: {
          id: "demo",
          name: "Demo",
          url: "https://notebooklm.google.com/notebook/demo"
        },
        mode: "auto",
        document: createClipDocument({
          kind: "web",
          sourceUrl: "https://example.com/story",
          title: "Story",
          content: "Body"
        })
      })
    );

    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.sourceId).toBe("src_new");
  });

  test("prepares Google Workspace URLs for manual Insert confirmation", async () => {
    const messages = [];
    let listSourcesCalls = 0;
    const chromeLike = {
      tabs: {
        async query() {
          return [];
        },
        async create(details) {
          messages.push({ type: "create", details });
          return { id: 99, url: details.url, status: "complete" };
        },
        async get() {
          return { status: "complete" };
        }
      },
      runtime: {
        lastError: null
      }
    };

    const writer = createNotebookDomWriter({
      chromeLike,
      messageBridge: {
        async sendMessageToTab(tabId, message) {
          messages.push({ type: "bridge", tabId, message });
          return {
            ok: true,
            result: {
              mode: "url",
              awaitingUserAction: true,
              userAction: "click_insert"
            }
          };
        }
      },
      notebookService: {
        async listSources() {
          listSourcesCalls += 1;
          return [];
        }
      }
    });

    const result = await writer.addClip(
      createClipRequest({
        targetNotebook: {
          id: "demo",
          name: "Demo",
          url: "https://notebooklm.google.com/notebook/demo"
        },
        mode: "url",
        document: createClipDocument({
          kind: "web",
          sourceUrl: "https://docs.google.com/document/d/abc123/edit",
          title: "Spec Draft",
          content: "Body"
        })
      })
    );

    expect(result.awaitingUserAction).toBe(true);
    expect(result.historyResult).toBe("user_action");
    expect(listSourcesCalls).toBe(1);
    expect(messages[1]).toEqual({
      type: "bridge",
      tabId: 99,
      message: {
        type: "WRITE_CLIP_DOCUMENT",
        payload: expect.objectContaining({
          handoffMode: "fill-only"
        })
      }
    });
  });

  test("throws when NotebookLM UI accepts the action but no new source appears", async () => {
    const chromeLike = {
      tabs: {
        async query() {
          return [{ id: 10, url: "https://notebooklm.google.com/notebook/demo", status: "complete" }];
        },
        async get() {
          return { status: "complete" };
        },
        sendMessage(tabId, message, callback) {
          callback({ ok: true, result: { mode: "url" } });
        }
      },
      runtime: {
        lastError: null
      }
    };

    const writer = createNotebookDomWriter({
      chromeLike,
      verifyTimeoutMs: 5,
      verifyPollMs: 0,
      notebookService: {
        async listSources() {
          return [{ id: "src_old", normalizedUrl: "https://already.example/item", title: "Old" }];
        }
      }
    });

    await expect(
      writer.addClip(
        createClipRequest({
          targetNotebook: {
            id: "demo",
            name: "Demo",
            url: "https://notebooklm.google.com/notebook/demo"
          },
          mode: "auto",
          document: createClipDocument({
            kind: "web",
            sourceUrl: "https://example.com/story",
            title: "Story",
            content: "Body"
          })
        })
      )
    ).rejects.toThrow("NotebookLM did not show a new source after submission.");
  });

  test("findAddedSource matches text-mode clips by title", () => {
    const match = findAddedSource(
      createClipDocument({
        kind: "web",
        sourceUrl: "",
        title: "Story",
        content: "Body"
      }),
      "text",
      new Set(["src_old"]),
      [
        { id: "src_old", normalizedUrl: "", title: "Old" },
        { id: "src_new", normalizedUrl: "", title: "Story" }
      ]
    );

    expect(match.id).toBe("src_new");
  });

  test("findAddedSource ignores Google Docs sign-in placeholders", () => {
    const match = findAddedSource(
      createClipDocument({
        kind: "web",
        sourceUrl: "https://docs.google.com/document/d/abc123/edit",
        title: "Spec Draft",
        content: ""
      }),
      "url",
      new Set(),
      [{ id: "src_signin", normalizedUrl: "https://docs.google.com/document/d/abc123/edit", title: "Google Docs: Sign-in" }]
    );

    expect(match).toBeNull();
  });
});

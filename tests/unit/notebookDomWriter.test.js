const {
  createNotebookDomWriter,
  findAddedSource
} = require("../../src/writers/notebooklm-dom/notebookDomWriter.js");
const { createClipDocument, createClipRequest } = require("../../src/shared/clipModels.js");

describe("notebook dom writer", () => {
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
});

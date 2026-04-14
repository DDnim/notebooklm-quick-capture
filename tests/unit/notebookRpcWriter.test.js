const {
  createNotebookRpcWriter,
  findAddedSource
} = require("../../src/writers/notebooklm-rpc/notebookRpcWriter.js");
const { createClipDocument, createClipRequest } = require("../../src/shared/clipModels.js");

describe("notebook rpc writer", () => {
  test("writes website sources through the notebook service and verifies them", async () => {
    let calls = 0;
    const notebookService = {
      async addSources(notebookId, urls) {
        expect(notebookId).toBe("demo");
        expect(urls).toEqual(["https://example.com/story"]);
      },
      async listSources() {
        calls += 1;
        return calls === 1
          ? [{ id: "src_old", normalizedUrl: "https://already.example/item", title: "Old" }]
          : [
              { id: "src_old", normalizedUrl: "https://already.example/item", title: "Old" },
              { id: "src_new", normalizedUrl: "https://example.com/story", title: "Story" }
            ];
      }
    };

    const writer = createNotebookRpcWriter({
      notebookService,
      verifyTimeoutMs: 5,
      verifyPollMs: 0
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
          sourceUrl: "https://example.com/story",
          title: "Story",
          content: "Body"
        })
      })
    );

    expect(result.ok).toBe(true);
    expect(result.writer).toBe("notebooklm-rpc");
    expect(result.modeUsed).toBe("url");
    expect(result.sourceId).toBe("src_new");
  });

  test("falls back to text mode in auto mode when url submission fails", async () => {
    let textAdded = false;
    const notebookService = {
      async addSources() {
        throw new Error("url failed");
      },
      async addTextSource(notebookId, content, title) {
        expect(notebookId).toBe("demo");
        expect(title).toBe("Story");
        expect(content).toContain("Body");
        textAdded = true;
      },
      async listSources() {
        return textAdded
          ? [{ id: "src_new", normalizedUrl: "", title: "Story" }]
          : [];
      }
    };

    const writer = createNotebookRpcWriter({
      notebookService,
      verifyTimeoutMs: 5,
      verifyPollMs: 0
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

    expect(result.modeUsed).toBe("text");
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

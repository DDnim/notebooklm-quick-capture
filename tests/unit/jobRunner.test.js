const { createJobRunner } = require("../../src/background/jobRunner.js");
const { createClipDocument, createClipRequest } = require("../../src/shared/clipModels.js");

describe("job runner", () => {
  test("runs writer and persists history entry", async () => {
    const pushes = [];
    const runner = createJobRunner({
      writer: {
        async addClip() {
          return { ok: true, writer: "notebooklm-dom", modeUsed: "url" };
        }
      },
      historyRepo: {
        async list() {
          return [];
        },
        async push(entry) {
          pushes.push(entry);
          return pushes;
        }
      },
      dedupeService: {
        findHistoryDuplicate() {
          return null;
        }
      },
      modelsApi: require("../../src/shared/clipModels.js")
    });

    const request = createClipRequest({
      targetNotebook: {
        id: "notebook-1",
        name: "Notebook",
        url: "https://notebooklm.google.com/notebook/demo"
      },
      mode: "auto",
      document: createClipDocument({
        kind: "web",
        sourceUrl: "https://example.com/story",
        title: "Story",
        content: "Body"
      })
    });

    const result = await runner.runClip(request);

    expect(result.ok).toBe(true);
    expect(result.modeUsed).toBe("url");
    expect(pushes).toHaveLength(1);
    expect(pushes[0].title).toBe("Story");
    expect(pushes[0].url).toBe("https://example.com/story");
  });

  test("skips clip when a duplicate source already exists remotely", async () => {
    let writerCalls = 0;
    const pushes = [];
    const runner = createJobRunner({
      writer: {
        async addClip() {
          writerCalls += 1;
          return { ok: true, writer: "notebooklm-dom", modeUsed: "url" };
        }
      },
      historyRepo: {
        async list() {
          return [];
        },
        async push(entry) {
          pushes.push(entry);
          return pushes;
        }
      },
      dedupeService: {
        findHistoryDuplicate() {
          return null;
        },
        findRemoteDuplicate(documentRef, sources) {
          return sources.find((source) => source.normalizedUrl === documentRef.sourceUrl) || null;
        }
      },
      notebookService: {
        async listSources() {
          return [{ id: "src_remote_1", normalizedUrl: "https://example.com/story" }];
        }
      },
      modelsApi: require("../../src/shared/clipModels.js")
    });

    const request = createClipRequest({
      targetNotebook: {
        id: "notebook-1",
        name: "Notebook",
        url: "https://notebooklm.google.com/notebook/demo"
      },
      mode: "auto",
      document: createClipDocument({
        kind: "web",
        sourceUrl: "https://example.com/story",
        title: "Story",
        content: "Body"
      })
    });

    const result = await runner.runClip(request);

    expect(result.skipped).toBe(true);
    expect(result.duplicateDetected).toBe(true);
    expect(writerCalls).toBe(0);
    expect(pushes[0].result).toBe("duplicate");
  });
});

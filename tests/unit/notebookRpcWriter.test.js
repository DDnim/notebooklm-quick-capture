const {
  createNotebookRpcWriter,
  findAddedSource
} = require("../../src/writers/notebooklm-rpc/notebookRpcWriter.js");
const { createClipDocument, createClipRequest } = require("../../src/shared/clipModels.js");

describe("notebook rpc writer", () => {
  test("writes website sources through the notebook service with authuser-aware verification", async () => {
    const listSourceCalls = [];
    let calls = 0;
    const notebookService = {
      async addSources(notebookId, urls, authUser) {
        expect(notebookId).toBe("demo");
        expect(urls).toEqual(["https://example.com/story"]);
        expect(authUser).toBe(2);
      },
      async listSources(notebookId, authUser, forceRefresh) {
        listSourceCalls.push({ notebookId, authUser, forceRefresh });
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
          url: "https://notebooklm.google.com/notebook/demo",
          authUser: 2
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
    expect(listSourceCalls).toEqual([
      { notebookId: "demo", authUser: 2, forceRefresh: true },
      { notebookId: "demo", authUser: 2, forceRefresh: true }
    ]);
  });

  test("falls back to text mode in auto mode when url submission fails", async () => {
    let textAdded = false;
    const notebookService = {
      async addSources() {
        throw new Error("url failed");
      },
      async addTextSource(notebookId, content, title, authUser) {
        expect(notebookId).toBe("demo");
        expect(title).toBe("Story");
        expect(content).toContain("Body");
        expect(authUser).toBe(1);
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
          url: "https://notebooklm.google.com/notebook/demo",
          authUser: 1
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

  test("keeps google docs url mode on the website submission path", async () => {
    let sourceAdded = false;
    const notebookService = {
      parseDriveSource(url) {
        return {
          fileId: "drive_file_123",
          sourceTypeCode: 1,
          sourceType: "google_doc",
          normalizedUrl: "https://docs.google.com/document/d/drive_file_123/edit"
        };
      },
      async addSources(notebookId, urls, authUser) {
        expect(notebookId).toBe("demo");
        expect(urls).toEqual(["https://docs.google.com/document/d/drive_file_123/edit"]);
        expect(authUser).toBe(1);
        sourceAdded = true;
      },
      async addDriveSource() {
        throw new Error("drive path should not be used in explicit url mode");
      },
      async listSources() {
        return sourceAdded
          ? [
              {
                id: "src_new",
                normalizedUrl: "https://docs.google.com/document/d/drive_file_123/edit",
                title: "Spec Draft"
              }
            ]
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
          url: "https://notebooklm.google.com/notebook/demo",
          authUser: 1
        },
        mode: "url",
        document: createClipDocument({
          kind: "web",
          sourceUrl: "https://docs.google.com/document/u/1/d/drive_file_123/edit?usp=sharing",
          title: "Spec Draft",
          content: "Body"
        })
      })
    );

    expect(result.modeUsed).toBe("url");
    expect(result.sourceId).toBe("src_new");
  });

  test("falls back to drive mode after url submission fails for google docs in auto mode", async () => {
    let driveAdded = false;
    const notebookService = {
      parseDriveSource() {
        return {
          fileId: "drive_file_123",
          sourceTypeCode: 1,
          sourceType: "google_doc",
          normalizedUrl: "https://docs.google.com/document/d/drive_file_123/edit"
        };
      },
      async addSources() {
        throw new Error("url failed");
      },
      async addDriveSource(notebookId, driveSource, authUser) {
        expect(notebookId).toBe("demo");
        expect(driveSource.fileId).toBe("drive_file_123");
        expect(authUser).toBe(1);
        driveAdded = true;
      },
      async listSources() {
        return driveAdded
          ? [{ id: "src_new", driveFileId: "drive_file_123", normalizedUrl: "", title: "Spec Draft" }]
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
          url: "https://notebooklm.google.com/notebook/demo",
          authUser: 1
        },
        mode: "auto",
        document: createClipDocument({
          kind: "web",
          sourceUrl: "https://docs.google.com/document/d/drive_file_123/edit",
          title: "Spec Draft",
          content: "Body"
        })
      })
    );

    expect(result.modeUsed).toBe("drive");
    expect(result.sourceId).toBe("src_new");
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

  test("findAddedSource matches drive-mode clips by drive file id", () => {
    const match = findAddedSource(
      createClipDocument({
        kind: "web",
        sourceUrl: "https://docs.google.com/document/u/1/d/drive_file_123/edit?authuser=1",
        title: "Spec Draft",
        content: ""
      }),
      "drive",
      new Set(["src_old"]),
      [
        { id: "src_old", driveFileId: "drive_file_old", normalizedUrl: "", title: "Old" },
        { id: "src_new", driveFileId: "drive_file_123", normalizedUrl: "", title: "Spec Draft" }
      ]
    );

    expect(match.id).toBe("src_new");
  });

  test("findAddedSource ignores Google Docs sign-in placeholders", () => {
    const match = findAddedSource(
      createClipDocument({
        kind: "web",
        sourceUrl: "https://docs.google.com/document/d/drive_file_123/edit",
        title: "Spec Draft",
        content: ""
      }),
      "url",
      new Set(),
      [
        {
          id: "src_signin",
          normalizedUrl: "https://docs.google.com/document/d/drive_file_123/edit",
          title: "Google Docs: Sign-in"
        }
      ]
    );

    expect(match).toBeNull();
  });

  test("returns accepted when add-source response has a source id but list verification lags", async () => {
    const notebookService = {
      async addDriveSource() {
        return `)]}'\n\n\n${JSON.stringify([[null, "izAoDd", JSON.stringify(["source_accepted_123", "Spec Draft"]) ]])}`;
      },
      parseDriveSource() {
        return {
          fileId: "drive_file_123",
          sourceTypeCode: 1,
          sourceType: "google_doc",
          normalizedUrl: "https://docs.google.com/document/d/drive_file_123/edit"
        };
      },
      extractCreatedSourceId(raw) {
        return raw.includes("source_accepted_123") ? "source_accepted_123" : "";
      },
      async listSources() {
        return [];
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
          url: "https://notebooklm.google.com/notebook/demo",
          authUser: 1
        },
        mode: "auto",
        document: createClipDocument({
          kind: "web",
          sourceUrl: "https://docs.google.com/document/d/drive_file_123/edit",
          title: "Spec Draft",
          content: ""
        })
      })
    );

    expect(result.ok).toBe(true);
    expect(result.modeUsed).toBe("drive");
    expect(result.sourceId).toBe("source_accepted_123");
    expect(result.verified).toBe(false);
  });
});

const {
  parseNotebookList,
  parseSourceList,
  parseNotebookId,
  buildNotebookUrl,
  buildUrlSourcePayload,
  buildDriveSourcePayload,
  parseDriveSource,
  extractCreatedSourceId,
  buildTextSourcePayload,
  probeAccount,
  normalizeUrl
} = require("../../src/background/notebooklmDataService.js");

describe("notebooklm data service parsers", () => {
  test("parses notebook list from batchexecute payload", () => {
    const inner = JSON.stringify([
      [
        ["Research Notes", [], "nb_123", "📘", null, [1, false]],
        ["Shared Notebook", [], "nb_456", "📔", null, [2, true]]
      ]
    ]);
    const raw = `)]}'\n\n\n${JSON.stringify([[null, null, inner]])}`;

    const notebooks = parseNotebookList(raw);

    expect(notebooks).toHaveLength(2);
    expect(notebooks[0].id).toBe("nb_123");
    expect(notebooks[0].url).toBe("https://notebooklm.google.com/notebook/nb_123");
    expect(notebooks[1].isShared).toBe(true);
  });

  test("parses sources and extracts canonical urls", () => {
    const inner = JSON.stringify([
      [
        null,
        [
          [
            ["src_1"],
            "Example article",
            [null, 1234, [1710000000], null, 5, ["https://example.com/article"]],
            [null, 2]
          ]
        ]
      ]
    ]);
    const raw = `)]}'\n\n\n${JSON.stringify([[null, null, inner]])}`;

    const sources = parseSourceList(raw);

    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe("src_1");
    expect(sources[0].type).toBe("web");
    expect(sources[0].url).toBe("https://example.com/article");
    expect(sources[0].normalizedUrl).toBe("https://example.com/article");
  });

  test("parses google docs sources and extracts drive file ids", () => {
    const inner = JSON.stringify([
      [
        null,
        [
          [
            ["src_doc"],
            "Spec Draft",
            [["drive_file_123"], 400, [1710000000], null, 1],
            [null, 2]
          ]
        ]
      ]
    ]);
    const raw = `)]}'\n\n\n${JSON.stringify([[null, null, inner]])}`;

    const sources = parseSourceList(raw);

    expect(sources).toHaveLength(1);
    expect(sources[0].type).toBe("google_doc");
    expect(sources[0].driveFileId).toBe("drive_file_123");
    expect(sources[0].url).toBe("https://docs.google.com/document/d/drive_file_123/edit");
  });

  test("parses notebook ids from full urls", () => {
    expect(parseNotebookId("https://notebooklm.google.com/notebook/abc-123")).toBe("abc-123");
    expect(buildNotebookUrl("abc-123")).toBe("https://notebooklm.google.com/notebook/abc-123");
  });

  test("builds RPC payloads for url, drive, and text sources", () => {
    expect(buildUrlSourcePayload("https://example.com/article")).toEqual([null, null, ["https://example.com/article"]]);
    expect(buildUrlSourcePayload("https://www.youtube.com/watch?v=123")).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      ["https://www.youtube.com/watch?v=123"]
    ]);
    expect(parseDriveSource("https://docs.google.com/document/d/abc123/edit?usp=sharing")).toEqual({
      fileId: "abc123",
      sourceTypeCode: 1,
      sourceType: "google_doc",
      normalizedUrl: "https://docs.google.com/document/d/abc123/edit"
    });
    expect(buildDriveSourcePayload("https://docs.google.com/document/d/abc123/edit")).toEqual([
      null,
      null,
      "abc123",
      null,
      1
    ]);
    expect(buildTextSourcePayload({ title: "Story", content: "Body" })).toEqual([
      null,
      ["Story", "Body"],
      null,
      2,
      null,
      null,
      null,
      null,
      null,
      null,
      1
    ]);
  });

  test("extracts created source ids from add-source batchexecute responses", () => {
    const raw = `)]}'\n\n\n${JSON.stringify([[null, "izAoDd", JSON.stringify(["source_abc123", "Spec Draft"]) ]])}`;
    expect(extractCreatedSourceId(raw)).toBe("source_abc123");
  });

  test("canonicalizes google docs urls for source matching", () => {
    expect(
      normalizeUrl("https://docs.google.com/document/u/1/d/abc123/edit?authuser=1&usp=sharing&tab=t.0#heading=h.demo")
    ).toBe("https://docs.google.com/document/d/abc123/edit");
  });

  test("probes google accounts through NotebookLM authuser pages", async () => {
    const requests = [];
    const account = await probeAccount(async (url) => {
      requests.push(String(url));
      return {
        ok: true,
        async text() {
          return `
            <html>
              <body>
                "oPEP7c":"writer@example.com"
                "S06Grb":"account_123"
              </body>
            </html>
          `;
        }
      };
    }, 1);

    expect(requests).toEqual(["https://notebooklm.google.com/?authuser=1&pageId=none"]);
    expect(account).toEqual({
      id: "account_123",
      authUser: 1,
      email: "writer@example.com",
      name: "writer",
      isDefault: false,
      label: "writer@example.com"
    });
  });
});

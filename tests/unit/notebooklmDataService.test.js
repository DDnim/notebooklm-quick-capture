const {
  parseNotebookList,
  parseSourceList,
  parseNotebookId,
  buildNotebookUrl,
  buildUrlSourcePayload,
  buildTextSourcePayload
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

  test("parses notebook ids from full urls", () => {
    expect(parseNotebookId("https://notebooklm.google.com/notebook/abc-123")).toBe("abc-123");
    expect(buildNotebookUrl("abc-123")).toBe("https://notebooklm.google.com/notebook/abc-123");
  });

  test("builds RPC payloads for url and text sources", () => {
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
});

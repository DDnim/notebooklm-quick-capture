// @vitest-environment jsdom

const { createWebAdapter } = require("../../src/adapters/web/webAdapter.js");
const { createClipDocument, getPreferredSourceUrl } = require("../../src/shared/clipModels.js");
const extractor = require("../../src/lib/extractor.js");

describe("web adapter", () => {
  test("builds a clip document from a normal page", async () => {
    document.head.innerHTML = `
      <title>Ignored</title>
      <meta property="og:title" content="Adapter title" />
      <meta name="description" content="Adapter summary" />
      <link rel="canonical" href="https://example.com/adapter" />
    `;
    document.body.innerHTML = `
      <article id="article">
        <h1>Adapter title</h1>
        <p>Useful extracted body copy.</p>
      </article>
    `;

    const article = document.getElementById("article");
    Object.defineProperty(article, "innerText", {
      configurable: true,
      value: "Adapter title\nUseful extracted body copy."
    });
    Object.defineProperty(document.body, "innerText", {
      configurable: true,
      value: "Adapter title\nUseful extracted body copy."
    });

    const adapter = createWebAdapter({
      extractor,
      modelsApi: { createClipDocument, getPreferredSourceUrl }
    });

    const clipDocument = await adapter.extract({
      url: "https://example.com/adapter",
      documentRef: document,
      selectionText: ""
    });

    expect(clipDocument.kind).toBe("web");
    expect(clipDocument.title).toBe("Adapter title");
    expect(clipDocument.summary).toBe("Adapter summary");
    expect(getPreferredSourceUrl(clipDocument)).toBe("https://example.com/adapter");
    expect(clipDocument.fallbackText).toContain("Useful extracted body copy.");
  });
});

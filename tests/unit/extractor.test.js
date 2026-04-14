// @vitest-environment jsdom

const { extractFromDocument, buildFallbackNote, normalizeWhitespace } = require("../../src/lib/extractor.js");

describe("extractor", () => {
  test("prefers article content and canonical metadata", () => {
    document.head.innerHTML = `
      <title>Ignored title</title>
      <meta property="og:title" content="OG title" />
      <meta name="description" content="A concise summary." />
      <link rel="canonical" href="https://example.com/post" />
    `;
    document.body.innerHTML = `
      <article id="article">
        <h1>Story heading</h1>
        <p>First paragraph with useful detail.</p>
        <p>Second paragraph with more supporting context.</p>
      </article>
    `;

    const article = document.getElementById("article");
    const body = document.body;
    Object.defineProperty(article, "innerText", {
      configurable: true,
      value: "Story heading\nFirst paragraph with useful detail.\nSecond paragraph with more supporting context."
    });
    Object.defineProperty(body, "innerText", {
      configurable: true,
      value: "Story heading\nFirst paragraph with useful detail.\nSecond paragraph with more supporting context."
    });

    const result = extractFromDocument(document, {});

    expect(result.title).toBe("OG title");
    expect(result.url).toBe("https://example.com/post");
    expect(result.description).toBe("A concise summary.");
    expect(result.content).toContain("First paragraph with useful detail.");
  });

  test("prefers a long selection when one exists", () => {
    document.head.innerHTML = `<title>Selection page</title>`;
    document.body.innerHTML = `<main id="main">Body content that should be ignored when a strong selection exists.</main>`;
    const main = document.getElementById("main");
    Object.defineProperty(main, "innerText", {
      configurable: true,
      value: "Body content that should be ignored when a strong selection exists."
    });
    Object.defineProperty(document.body, "innerText", {
      configurable: true,
      value: "Body content that should be ignored when a strong selection exists."
    });

    const selectionText =
      "This highlighted selection is long enough to win over the rest of the article because it contains the exact passage the user wants to keep for later reference.";

    const result = extractFromDocument(document, { selectionText });

    expect(result.selectionText).toBe(selectionText);
    expect(result.content).toBe(selectionText);
  });

  test("forces selection content when preferSelection is enabled", () => {
    document.head.innerHTML = `<title>Selection page</title>`;
    document.body.innerHTML = `<main id="main">Body content that would normally win.</main>`;
    const main = document.getElementById("main");
    Object.defineProperty(main, "innerText", {
      configurable: true,
      value: "Body content that would normally win."
    });
    Object.defineProperty(document.body, "innerText", {
      configurable: true,
      value: "Body content that would normally win."
    });

    const result = extractFromDocument(document, {
      selectionText: "Short selected line",
      preferSelection: true
    });

    expect(result.content).toBe("Short selected line");
  });

  test("builds a readable fallback note", () => {
    const fallback = buildFallbackNote({
      title: "A title",
      url: "https://example.com",
      description: "Summary",
      content: "Body"
    });

    expect(normalizeWhitespace(fallback)).toContain("Title: A title");
    expect(fallback).toContain("Source URL: https://example.com");
    expect(fallback).toContain("Summary: Summary");
    expect(fallback).toContain("Body");
  });
});

// @vitest-environment jsdom

const { clipPage } = require("../../src/lib/notebookAutomation.js");

beforeEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value() {
      return { width: 120, height: 32, top: 0, left: 0, right: 120, bottom: 32 };
    }
  });
});

describe("notebook automation", () => {
  test("adds a page by URL when website import is available", async () => {
    document.body.innerHTML = `
      <button id="add-source">Add source</button>
      <button id="website">Website URL</button>
      <input id="url-input" type="url" placeholder="Paste URL" />
      <button id="submit">Import</button>
    `;

    let clicked = 0;
    document.getElementById("submit").addEventListener("click", () => {
      clicked += 1;
    });

    const result = await clipPage(document, {
      clipMode: "url",
      page: {
        url: "https://example.com/story",
        fallbackText: "Ignored fallback"
      }
    });

    expect(result.mode).toBe("url");
    expect(document.getElementById("url-input").value).toBe("https://example.com/story");
    expect(clicked).toBe(1);
  });

  test("waits for an enabled submit button after triggering input events", async () => {
    document.body.innerHTML = `
      <button id="add-source">Add source</button>
      <button id="website">Website URL</button>
      <input id="url-input" type="url" placeholder="Paste URL" />
      <button id="submit" disabled>Import</button>
    `;

    const urlInput = document.getElementById("url-input");
    const submit = document.getElementById("submit");
    let clicked = 0;

    urlInput.addEventListener("input", () => {
      submit.disabled = !urlInput.value;
    });
    submit.addEventListener("click", () => {
      clicked += 1;
    });

    const result = await clipPage(document, {
      clipMode: "url",
      page: {
        url: "https://example.com/controlled",
        fallbackText: "Ignored fallback"
      }
    });

    expect(result.mode).toBe("url");
    expect(urlInput.value).toBe("https://example.com/controlled");
    expect(submit.disabled).toBe(false);
    expect(clicked).toBe(1);
  });

  test("falls back to copied text when website import is not present", async () => {
    document.body.innerHTML = `
      <button id="add-source">Add source</button>
      <button id="copied-text">Copied text</button>
      <textarea id="text-input" placeholder="Paste text"></textarea>
      <button id="submit">Save</button>
    `;

    const result = await clipPage(document, {
      clipMode: "auto",
      page: {
        url: "https://example.com/story",
        fallbackText: "Title: Story\n\nCaptured text body"
      }
    });

    expect(result.mode).toBe("text");
    expect(document.getElementById("text-input").value).toContain("Captured text body");
  });
});

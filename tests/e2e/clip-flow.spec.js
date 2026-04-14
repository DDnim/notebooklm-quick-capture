const http = require("http");
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function main() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true
  });

  try {
    await testExtraction(browser, `${baseUrl}/mock-page`);
    await testNotebookAutomation(browser, `${baseUrl}/mock-notebook`);
    console.log("E2E browser flow passed.");
  } finally {
    await browser.close();
    server.close();
  }
}

async function testExtraction(browser, url) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ path: path.join(__dirname, "../../src/lib/extractor.js") });

  const result = await page.evaluate(() => {
    const selectionText =
      "This highlighted browser selection is long enough to be used as the preferred saved content for the fallback note in NotebookLM.";
    return window.ClipperExtractor.extractFromDocument(document, { selectionText });
  });

  if (!result.title.includes("Mock article")) {
    throw new Error("Extractor did not return the expected title.");
  }

  if (!result.content.includes("highlighted browser selection")) {
    throw new Error("Extractor did not prioritize the selection in browser automation.");
  }

  await page.close();
}

async function testNotebookAutomation(browser, url) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ path: path.join(__dirname, "../../src/lib/notebookAutomation.js") });

  const result = await page.evaluate(async () => {
    return window.NotebookAutomation.clipPage(document, {
      clipMode: "auto",
      page: {
        url: "https://example.com/mock-story",
        fallbackText: "Title: Mock article\n\nCaptured body"
      }
    });
  });

  if (result.mode !== "url") {
    throw new Error("Notebook automation did not use URL mode.");
  }

  const saved = await page.locator("#saved-value").innerText();
  if (saved !== "https://example.com/mock-story") {
    throw new Error("Notebook automation did not populate the website field.");
  }

  await page.close();
}

function createServer() {
  return http.createServer((request, response) => {
    if (request.url === "/mock-page") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(readFixture("mock-page.html"));
      return;
    }

    if (request.url === "/mock-notebook") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(readFixture("mock-notebook.html"));
      return;
    }

    response.statusCode = 404;
    response.end("Not found");
  });
}

function readFixture(name) {
  return fs.readFileSync(path.join(__dirname, "../fixtures", name), "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

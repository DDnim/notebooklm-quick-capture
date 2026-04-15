// @vitest-environment jsdom

const fs = require("fs");
const path = require("path");

const popupScriptPath = "../../src/ui/popup.js";
const popupHtmlPath = path.join(__dirname, "../../popup.html");

describe("popup", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="notebookSelect"></select>
      <button id="refreshNotebooks" type="button"></button>
      <button id="clipUrlFirst" type="button"></button>
      <button id="clipTextFirst" type="button"></button>
      <input id="manualTitle" />
      <textarea id="manualContent"></textarea>
      <button id="saveManualText" type="button"></button>
      <p id="status"></p>
      <p id="statusMeta"></p>
    `;
  });

  afterEach(() => {
    delete global.chrome;
    delete require.cache[require.resolve(popupScriptPath)];
  });

  test("includes the popup script entrypoint", () => {
    const html = fs.readFileSync(popupHtmlPath, "utf8");

    expect(html).toContain('<script src="src/ui/popup.js"></script>');
  });

  test("persists the selected notebook on change", async () => {
    const messages = [];
    const notebook = {
      id: "notebook-1",
      name: "Research notebook",
      url: "https://notebooklm.google.com/notebook/notebook-1"
    };
    const responses = {
      GET_SETTINGS: { ok: true, settings: { notebookId: notebook.id, notebookName: notebook.name, notebookUrl: notebook.url } },
      GET_NOTEBOOKS: { ok: true, notebooks: [notebook] },
      SAVE_SETTINGS: ({ settings }) => ({ ok: true, settings })
    };

    global.chrome = createChromeStub(messages, responses);
    require(popupScriptPath);
    await flushAsyncWork();

    const select = document.getElementById("notebookSelect");
    select.value = notebook.id;
    select.dispatchEvent(new Event("change"));
    await flushAsyncWork();

    expect(messages.at(-1)).toEqual({
      type: "SAVE_SETTINGS",
      settings: {
        notebookId: notebook.id,
        notebookName: notebook.name,
        notebookUrl: notebook.url
      }
    });
    expect(document.getElementById("status").textContent).toBe("Notebook updated.");
  });
});

function createChromeStub(messages, responses) {
  return {
    runtime: {
      sendMessage(message, callback) {
        messages.push(message);
        const handler = responses[message.type];
        const response =
          typeof handler === "function"
            ? handler(message)
            : handler || { ok: false, error: `Unhandled message: ${message.type}` };
        Promise.resolve().then(() => callback(response));
      }
    }
  };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// @vitest-environment jsdom

const fs = require("fs");
const path = require("path");

const sidepanelScriptPath = "../../src/ui/sidepanel.js";
const sidepanelHtmlPath = path.join(__dirname, "../../sidepanel.html");

describe("side panel", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <p id="sideSummary"></p>
      <select id="accountSelect"></select>
      <button id="refreshAccounts" type="button"></button>
      <select id="notebookSelect"></select>
      <button id="clipUrlFirst" type="button"></button>
      <button id="clipTextFirst" type="button"></button>
      <input id="manualTitle" />
      <textarea id="manualContent"></textarea>
      <button id="saveManualText" type="button"></button>
      <p id="sideStatus"></p>
      <p id="sideStatusMeta"></p>
      <ol id="historyList"></ol>
      <button id="refreshHistory" type="button"></button>
      <button id="refreshNotebooks" type="button"></button>
    `;
  });

  afterEach(() => {
    delete global.chrome;
    delete require.cache[require.resolve(sidepanelScriptPath)];
  });

  test("does not render a notebook URL fallback field", () => {
    const html = fs.readFileSync(sidepanelHtmlPath, "utf8");

    expect(html).not.toContain("Notebook URL fallback");
    expect(html).not.toContain('id="notebookUrl"');
  });

  test("does not render the manual notebook save button", () => {
    const html = fs.readFileSync(sidepanelHtmlPath, "utf8");

    expect(html).not.toContain("Use this notebook");
    expect(html).not.toContain('id="saveNotebook"');
  });

  test("persists the selected notebook on change without any fallback URL input", async () => {
    const messages = [];
    const accounts = [{ authUser: 1, email: "writer@example.com", label: "writer@example.com" }];
    const notebook = {
      id: "notebook-1",
      name: "Research notebook",
      url: "https://notebooklm.google.com/notebook/notebook-1"
    };
    const responses = {
      GET_SETTINGS: {
        ok: true,
        settings: {
          notebookId: notebook.id,
          notebookName: notebook.name,
          notebookUrl: notebook.url,
          selectedAuthUser: 1
        }
      },
      GET_HISTORY: { ok: true, history: [] },
      GET_ACCOUNTS: { ok: true, accounts },
      GET_NOTEBOOKS: { ok: true, notebooks: [notebook] },
      SAVE_SETTINGS: ({ settings }) => ({ ok: true, settings })
    };

    global.chrome = createChromeStub(messages, responses);
    require(sidepanelScriptPath);
    await flushAsyncWork();

    const select = document.getElementById("notebookSelect");
    select.value = notebook.id;
    select.dispatchEvent(new Event("change"));
    await flushAsyncWork();

    expect(messages.at(-1)).toEqual({
      type: "SAVE_SETTINGS",
      settings: {
        selectedAuthUser: 1,
        notebookId: notebook.id,
        notebookName: notebook.name,
        notebookUrl: notebook.url
      }
    });
    const summary = document.getElementById("sideSummary");
    const link = summary.querySelector("a");

    expect(summary.textContent).toBe("Selected notebook: ·Research notebook");
    expect(link).not.toBeNull();
    expect(link.href).toBe(notebook.url);
    expect(document.getElementById("sideStatus").textContent).toBe("Notebook updated.");
  });

  test("switches account and refreshes notebooks in the side panel", async () => {
    const messages = [];
    const responses = {
      GET_SETTINGS: {
        ok: true,
        settings: {
          notebookId: "default-notebook",
          notebookName: "Default",
          notebookUrl: "https://notebooklm.google.com/notebook/default-notebook",
          selectedAuthUser: null
        }
      },
      GET_HISTORY: { ok: true, history: [] },
      GET_ACCOUNTS: {
        ok: true,
        accounts: [
          { authUser: 0, email: "default@example.com", label: "default@example.com (default)" },
          { authUser: 3, email: "private@example.com", label: "private@example.com" }
        ]
      },
      GET_NOTEBOOKS: ({ authUser }) => ({
        ok: true,
        notebooks:
          authUser === 3
            ? [{ id: "private-notebook", name: "Private", url: "https://notebooklm.google.com/notebook/private-notebook" }]
            : [{ id: "default-notebook", name: "Default", url: "https://notebooklm.google.com/notebook/default-notebook" }]
      }),
      SAVE_SETTINGS: ({ settings }) => ({
        ok: true,
        settings: {
          notebookId: "",
          notebookName: "",
          notebookUrl: "",
          selectedAuthUser: settings.selectedAuthUser
        }
      })
    };

    global.chrome = createChromeStub(messages, responses);
    require(sidepanelScriptPath);
    await flushAsyncWork();

    const accountSelect = document.getElementById("accountSelect");
    accountSelect.value = "3";
    accountSelect.dispatchEvent(new Event("change"));
    await flushAsyncWork();

    expect(messages).toContainEqual({
      type: "SAVE_SETTINGS",
      settings: {
        selectedAuthUser: 3
      }
    });
    expect(messages).toContainEqual({
      type: "GET_NOTEBOOKS",
      authUser: 3,
      forceRefresh: true
    });
    expect(document.getElementById("sideStatus").textContent).toBe("Account updated. Choose a notebook.");
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

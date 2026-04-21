// @vitest-environment jsdom

const fs = require("fs");
const path = require("path");

const popupScriptPath = "../../src/ui/popup.js";
const popupHtmlPath = path.join(__dirname, "../../popup.html");

describe("popup", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="accountSelect"></select>
      <button id="refreshAccounts" type="button"></button>
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
      GET_ACCOUNTS: { ok: true, accounts },
      GET_NOTEBOOKS: { ok: true, notebooks: [notebook] },
      SAVE_SETTINGS: ({ settings }) => ({ ok: true, settings })
    };

    global.chrome = createChromeStub(messages, responses);
    require(popupScriptPath);
    await flushAsyncWork();

    expect(messages).toContainEqual({ type: "GET_ACCOUNTS" });
    expect(messages).toContainEqual({ type: "GET_NOTEBOOKS", authUser: 1 });

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
    expect(document.getElementById("status").textContent).toBe("Notebook updated.");
  });

  test("switches account and refreshes notebooks for that authuser", async () => {
    const messages = [];
    const notebooksByAccount = {
      default: [{ id: "default-notebook", name: "Default", url: "https://notebooklm.google.com/notebook/default-notebook" }],
      2: [{ id: "account-two", name: "Account Two", url: "https://notebooklm.google.com/notebook/account-two" }]
    };
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
      GET_ACCOUNTS: {
        ok: true,
        accounts: [
          { authUser: 0, email: "default@example.com", label: "default@example.com (default)" },
          { authUser: 2, email: "team@example.com", label: "team@example.com" }
        ]
      },
      GET_NOTEBOOKS: ({ authUser }) => ({
        ok: true,
        notebooks: notebooksByAccount[authUser === undefined ? "default" : authUser] || []
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
    require(popupScriptPath);
    await flushAsyncWork();

    const accountSelect = document.getElementById("accountSelect");
    accountSelect.value = "2";
    accountSelect.dispatchEvent(new Event("change"));
    await flushAsyncWork();

    expect(messages).toContainEqual({
      type: "SAVE_SETTINGS",
      settings: {
        selectedAuthUser: 2
      }
    });
    expect(messages).toContainEqual({
      type: "GET_NOTEBOOKS",
      authUser: 2,
      forceRefresh: true
    });
    expect(document.getElementById("status").textContent).toBe("Account updated. Choose a notebook.");
  });

  test("shows a manual Insert handoff message for Google Workspace URLs", async () => {
    const messages = [];
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
          selectedAuthUser: null
        }
      },
      GET_ACCOUNTS: { ok: true, accounts: [] },
      GET_NOTEBOOKS: { ok: true, notebooks: [notebook] },
      SAVE_SETTINGS: ({ settings }) => ({ ok: true, settings }),
      START_CLIP: {
        ok: true,
        result: {
          ok: true,
          modeUsed: "url",
          awaitingUserAction: true,
          userAction: "click_insert"
        }
      }
    };

    global.chrome = createChromeStub(messages, responses);
    require(popupScriptPath);
    await flushAsyncWork();

    document.getElementById("clipUrlFirst").click();
    await flushAsyncWork();

    expect(document.getElementById("status").textContent).toBe(
      "NotebookLM is ready. Click Insert in the opened notebook to finish adding this Google Drive URL."
    );
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

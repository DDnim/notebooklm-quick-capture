(function () {
  const summaryNode = document.getElementById("sideSummary");
  const notebookSelect = document.getElementById("notebookSelect");
  const clipUrlFirstButton = document.getElementById("clipUrlFirst");
  const clipTextFirstButton = document.getElementById("clipTextFirst");
  const manualTitleInput = document.getElementById("manualTitle");
  const manualContentInput = document.getElementById("manualContent");
  const saveManualTextButton = document.getElementById("saveManualText");
  const statusNode = document.getElementById("sideStatus");
  const statusMetaNode = document.getElementById("sideStatusMeta");
  const historyList = document.getElementById("historyList");
  const refreshButton = document.getElementById("refreshHistory");
  const refreshNotebooksButton = document.getElementById("refreshNotebooks");
  let notebooks = [];

  refreshButton.addEventListener("click", refresh);
  refreshNotebooksButton.addEventListener("click", onRefreshNotebooks);
  clipUrlFirstButton.addEventListener("click", () => onClipPage("url"));
  clipTextFirstButton.addEventListener("click", () => onClipPage("text"));
  saveManualTextButton.addEventListener("click", onSaveManualText);
  notebookSelect.addEventListener("change", onNotebookSelectChange);
  refresh().catch(() => {
    summaryNode.textContent = "Could not load history.";
  });

  async function refresh() {
    const [settingsResponse, historyResponse, notebooksResponse] = await Promise.all([
      sendMessage({ type: "GET_SETTINGS" }),
      sendMessage({ type: "GET_HISTORY" }),
      sendMessage({ type: "GET_NOTEBOOKS" })
    ]);

    if (!settingsResponse.ok || !historyResponse.ok) {
      throw new Error("Could not load side panel state.");
    }

    notebooks = notebooksResponse.ok ? notebooksResponse.notebooks || [] : [];
    populateNotebookSelect(notebooks, settingsResponse.settings);
    if (!notebooksResponse.ok && isNotebookListUnsupported(notebooksResponse)) {
      renderStatus("Notebook list is unavailable in the current background worker.", true);
    }
    renderSummary(settingsResponse.settings);

    historyList.innerHTML = "";

    const history = historyResponse.history || [];
    if (history.length === 0) {
      const empty = document.createElement("li");
      empty.className = "history-empty";
      empty.textContent = "Your recent clips will show up here.";
      historyList.appendChild(empty);
      return;
    }

    history.forEach((entry) => {
      const item = document.createElement("li");
      item.className = "history-item";
      item.innerHTML = `
        <a href="${entry.url}" target="_blank" rel="noreferrer">${escapeHtml(entry.title || entry.url)}</a>
        <p>${escapeHtml(renderHistoryResult(entry))} · ${new Date(entry.timestamp).toLocaleString()}</p>
      `;
      historyList.appendChild(item);
    });
  }

  async function onRefreshNotebooks() {
    renderStatus("Refreshing notebooks...");
    const [settingsResponse, notebooksResponse] = await Promise.all([
      sendMessage({ type: "GET_SETTINGS" }),
      sendMessage({ type: "GET_NOTEBOOKS", forceRefresh: true })
    ]);

    if (!settingsResponse.ok || !notebooksResponse.ok) {
      if (isNotebookListUnsupported(notebooksResponse)) {
        notebooks = [];
        populateNotebookSelect(notebooks, settingsResponse.ok ? settingsResponse.settings : {});
        renderStatus("Notebook list is unavailable in the current background worker.", true);
        return;
      }
      renderStatus(
        (notebooksResponse && notebooksResponse.error) || "Could not refresh notebook list.",
        true
      );
      return;
    }

    notebooks = notebooksResponse.notebooks || [];
    populateNotebookSelect(notebooks, settingsResponse.settings);
    renderStatus(notebooks.length > 0 ? "Notebook list refreshed." : "No notebooks found.");
  }

  async function onClipPage(mode) {
    setClipButtonsDisabled(true);
    renderStatus(mode === "url" ? "Saving current page as a website source..." : "Saving current page as copied text...");

    const saveResponse = await saveSelectedNotebookSettings();

    if (!saveResponse.ok) {
      renderStatus(saveResponse.error || "Could not save notebook.", true);
      setClipButtonsDisabled(false);
      return;
    }

    const response = await sendMessage({ type: "START_CLIP", mode });
    if (!response.ok) {
      renderStatus(response.error || "Clip failed.", true);
      setClipButtonsDisabled(false);
      return;
    }

    renderStatus(buildClipStatus(response.result), false, {
      notebookUrl: saveResponse.settings.notebookUrl
    });
    await refresh();
    setClipButtonsDisabled(false);
  }

  async function onSaveManualText() {
    const content = manualContentInput.value.trim();
    const title = manualTitleInput.value.trim();

    if (!content) {
      renderStatus("Type or paste some content first.", true);
      manualContentInput.focus();
      return;
    }

    setClipButtonsDisabled(true);
    saveManualTextButton.disabled = true;
    renderStatus("Saving typed text to NotebookLM...");

    const saveResponse = await saveSelectedNotebookSettings();

    if (!saveResponse.ok) {
      renderStatus(saveResponse.error || "Could not save notebook.", true);
      setClipButtonsDisabled(false);
      saveManualTextButton.disabled = false;
      return;
    }

    const response = await sendMessage({
      type: "START_MANUAL_TEXT",
      title,
      content
    });

    if (!response.ok) {
      renderStatus(response.error || "Could not save typed text.", true);
      setClipButtonsDisabled(false);
      saveManualTextButton.disabled = false;
      return;
    }

    renderStatus("Typed text added to NotebookLM as copied text.", false, {
      notebookUrl: saveResponse.settings.notebookUrl
    });
    manualTitleInput.value = "";
    manualContentInput.value = "";
    await refresh();
    setClipButtonsDisabled(false);
    saveManualTextButton.disabled = false;
  }

  async function onNotebookSelectChange() {
    renderStatusMeta("");
    if (!notebookSelect.value) {
      return;
    }

    renderStatus("Saving notebook...");
    const response = await saveSelectedNotebookSettings();
    if (!response.ok) {
      renderStatus(response.error || "Could not save notebook.", true);
      return;
    }

    renderSummary(response.settings);
    renderStatus("");
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, resolve);
    });
  }

  function populateNotebookSelect(items, settings) {
    notebookSelect.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = items.length > 0 ? "Choose a notebook" : "No notebooks available";
    notebookSelect.appendChild(placeholder);

    items.forEach((notebook) => {
      const option = document.createElement("option");
      option.value = notebook.id;
      option.textContent = notebook.name;
      notebookSelect.appendChild(option);
    });

    if (settings.notebookId) {
      notebookSelect.value = settings.notebookId;
    }
  }

  function getSelectedNotebook() {
    return notebooks.find((notebook) => notebook.id === notebookSelect.value) || null;
  }

  async function saveSelectedNotebookSettings() {
    const selected = getSelectedNotebook();
    if (!selected) {
      return {
        ok: false,
        error: "Choose a notebook first."
      };
    }

    return sendMessage({
      type: "SAVE_SETTINGS",
      settings: {
        notebookId: selected.id,
        notebookName: selected.name,
        notebookUrl: selected.url
      }
    });
  }

  function renderSummary(settings) {
    const configuredNotebook =
      notebooks.find((notebook) => notebook.id === settings.notebookId) || null;
    const notebookName =
      (configuredNotebook && configuredNotebook.name) || settings.notebookName || "";
    const notebookUrl =
      (configuredNotebook && configuredNotebook.url) || settings.notebookUrl || "";

    summaryNode.innerHTML = "";
    if (!notebookName) {
      summaryNode.textContent = "No notebook configured yet.";
      return;
    }

    summaryNode.appendChild(document.createTextNode("Selected notebook: "));
    if (!notebookUrl) {
      summaryNode.appendChild(document.createTextNode(`·${notebookName}`));
      return;
    }

    const link = document.createElement("a");
    link.href = notebookUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `·${notebookName}`;
    summaryNode.appendChild(link);
  }

  function renderStatus(message, isError, options) {
    statusNode.textContent = message || "";
    statusNode.dataset.state = isError ? "error" : "default";
    renderStatusMeta(!isError && options && options.notebookUrl ? options.notebookUrl : "");
  }

  function setClipButtonsDisabled(disabled) {
    clipUrlFirstButton.disabled = disabled;
    clipTextFirstButton.disabled = disabled;
  }

  function renderStatusMeta(notebookUrl) {
    statusMetaNode.innerHTML = "";
    if (!notebookUrl) {
      return;
    }

    const link = document.createElement("a");
    link.href = notebookUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = notebookUrl;
    statusMetaNode.appendChild(link);
  }

  function isNotebookListUnsupported(response) {
    return (
      response &&
      !response.ok &&
      typeof response.error === "string" &&
      response.error.includes("Unknown message type: GET_NOTEBOOKS")
    );
  }

  function renderHistoryResult(entry) {
    if (entry.result === "duplicate") {
      return "Skipped duplicate";
    }
    return entry.result === "url" ? "Website source" : "Copied text";
  }

  function buildClipStatus(result) {
    if (result.skipped) {
      return "This page is already saved in the selected notebook.";
    }
    if (result.verified === false) {
      return "The request was sent to NotebookLM, but the new source could not be verified yet.";
    }
    return result.modeUsed === "url"
      ? "Page added to NotebookLM as a website source."
      : "Page added to NotebookLM as copied text.";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();

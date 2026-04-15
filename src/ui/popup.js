  (function () {
    const notebookSelect = document.getElementById("notebookSelect");
    const refreshNotebooksButton = document.getElementById("refreshNotebooks");
    const clipUrlFirstButton = document.getElementById("clipUrlFirst");
    const clipTextFirstButton = document.getElementById("clipTextFirst");
    const manualTitleInput = document.getElementById("manualTitle");
    const manualContentInput = document.getElementById("manualContent");
    const saveManualTextButton = document.getElementById("saveManualText");
    const statusNode = document.getElementById("status");
    const statusMetaNode = document.getElementById("statusMeta");
    let notebooks = [];

  init().catch((error) => {
    renderStatus(error.message || "Could not load extension settings.", true);
  });

  async function init() {
    const [settingsResponse, notebooksResponse] = await Promise.all([
      sendMessage({ type: "GET_SETTINGS" }),
      sendMessage({ type: "GET_NOTEBOOKS" })
    ]);

    if (!settingsResponse.ok) {
      throw new Error(settingsResponse.error || "Could not load settings.");
    }

      notebooks = notebooksResponse.ok ? notebooksResponse.notebooks || [] : [];
      populateNotebookSelect(notebooks, settingsResponse.settings);
      if (!notebooksResponse.ok && isNotebookListUnsupported(notebooksResponse)) {
        renderStatus("Notebook list is unavailable in the current background worker.", true);
      }

      clipUrlFirstButton.addEventListener("click", () => onClipPage("url"));
      clipTextFirstButton.addEventListener("click", () => onClipPage("text"));
      saveManualTextButton.addEventListener("click", onSaveManualText);
      refreshNotebooksButton.addEventListener("click", onRefreshNotebooks);
      notebookSelect.addEventListener("change", onNotebookSelectChange);
    }

    async function onClipPage(mode) {
      setClipButtonsDisabled(true);
      renderStatus(mode === "url" ? "Saving current page as a website source..." : "Saving current page as copied text...");

    const saveResponse = await saveSettings();

    if (!saveResponse.ok) {
      renderStatus(saveResponse.error || "Could not save settings.", true);
      setClipButtonsDisabled(false);
      return;
    }

    const response = await sendMessage({
      type: "START_CLIP",
      mode
    });

    if (!response.ok) {
      renderStatus(response.error || "Clip failed.", true);
      setClipButtonsDisabled(false);
      return;
    }

    renderStatus(buildClipStatus(response.result), false, {
      notebookUrl: saveResponse.settings.notebookUrl
    });
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

      const saveResponse = await saveSettings();
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
      setClipButtonsDisabled(false);
      saveManualTextButton.disabled = false;
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
      renderStatus(notebooks.length > 0 ? "Notebook list refreshed." : "No notebooks found.", false);
    }

  function renderStatus(message, isError, options) {
    statusNode.textContent = message || "";
    statusNode.dataset.state = isError ? "error" : "default";
    renderStatusMeta(!isError && options && options.notebookUrl ? options.notebookUrl : "");
  }

    async function saveSettings() {
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

    function clearStatusMeta() {
      renderStatusMeta("");
    }

    async function onNotebookSelectChange() {
      clearStatusMeta();
      if (!notebookSelect.value) {
        return;
      }

      renderStatus("Saving notebook...");
      const saveResponse = await saveSettings();
      if (!saveResponse.ok) {
        renderStatus(saveResponse.error || "Could not save notebook.", true);
        return;
      }

      renderStatus("Notebook updated.", false, {
        notebookUrl: saveResponse.settings.notebookUrl
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

  function isNotebookListUnsupported(response) {
    return (
      response &&
      !response.ok &&
      typeof response.error === "string" &&
      response.error.includes("Unknown message type: GET_NOTEBOOKS")
    );
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, resolve);
    });
  }
})();

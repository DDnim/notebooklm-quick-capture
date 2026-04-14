(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.NotebookAutomation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const BUTTON_SELECTOR = "button, [role='button'], a, div[tabindex]";
  const FIELD_SELECTOR = "textarea, input[type='text'], input[type='url'], [contenteditable='true']";

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizedText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function getText(node) {
    return normalizedText(
      node &&
        (node.getAttribute("aria-label") ||
          node.getAttribute("title") ||
          node.textContent ||
          node.value ||
          "")
    );
  }

  function isVisible(node) {
    if (!node || typeof node.getBoundingClientRect !== "function") {
      return false;
    }
    const style = node.ownerDocument.defaultView.getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none") {
      return false;
    }
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }

  function matchesAny(text, phrases) {
    return phrases.some((phrase) => text.includes(normalizedText(phrase)));
  }

  function findClickable(documentRef, phrases, rootNode) {
    const scope = rootNode || documentRef;
    const nodes = Array.from(scope.querySelectorAll(BUTTON_SELECTOR));
    return nodes.find((node) => isVisible(node) && matchesAny(getText(node), phrases)) || null;
  }

  function findField(documentRef, phrases, rootNode) {
    const scope = rootNode || documentRef;
    const fields = Array.from(scope.querySelectorAll(FIELD_SELECTOR));
    const labelled = fields.find((field) => matchesAny(getText(field), phrases));
    if (labelled) {
      return labelled;
    }

    return (
      fields.find((field) => {
        const placeholder = normalizedText(field.getAttribute("placeholder") || "");
        return placeholder && matchesAny(placeholder, phrases);
      }) || fields[0] || null
    );
  }

  async function waitFor(documentRef, callback, timeoutMs) {
    const timeout = timeoutMs || 5000;
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeout) {
      const value = callback();
      if (value) {
        return value;
      }
      await delay(100);
    }
    throw new Error("Timed out while waiting for NotebookLM UI.");
  }

  function setFieldValue(field, value) {
    if ("value" in field) {
      field.focus();
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    if (field.getAttribute("contenteditable") === "true") {
      field.focus();
      field.textContent = value;
      field.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
    }
  }

  async function openAddSource(documentRef) {
    const button = await waitFor(documentRef, () =>
      findClickable(documentRef, ["add source", "add sources", "new source"])
    );
    button.click();
    await delay(150);
    return button;
  }

  async function openSourceType(documentRef, phrases) {
    const button = await waitFor(documentRef, () => findClickable(documentRef, phrases), 2500);
    button.click();
    await delay(150);
  }

  async function submitSource(documentRef) {
    const submit = await waitFor(documentRef, () => {
      const explicit = findClickable(documentRef, ["insert", "save", "import", "create", "done"]);
      if (explicit) {
        return explicit;
      }

      const fallback = findClickable(documentRef, ["add"]);
      if (fallback && !getText(fallback).includes("add source")) {
        return fallback;
      }

      return null;
    });
    submit.click();
    await delay(300);
  }

  async function addViaWebsite(documentRef, url) {
    await openAddSource(documentRef);
    await openSourceType(documentRef, ["website", "web url", "link", "url"]);
    const field = await waitFor(documentRef, () =>
      findField(documentRef, ["url", "link", "website", "https://"])
    );
    setFieldValue(field, url);
    await submitSource(documentRef);
    return { mode: "url" };
  }

  async function addViaText(documentRef, text) {
    await openAddSource(documentRef);
    await openSourceType(documentRef, ["copied text", "text", "paste text"]);
    const field = await waitFor(documentRef, () =>
      findField(documentRef, ["text", "paste", "notes", "content"])
    );
    setFieldValue(field, text);
    await submitSource(documentRef);
    return { mode: "text" };
  }

  async function clipDocument(documentRef, clipDocumentRef, options) {
    const clipMode = (options && options.mode) || "auto";
    const sourceUrl = clipDocumentRef.canonicalUrl || clipDocumentRef.sourceUrl;
    const fallbackText =
      clipDocumentRef.fallbackText ||
      [
        clipDocumentRef.title ? `Title: ${clipDocumentRef.title}` : "",
        sourceUrl ? `Source URL: ${sourceUrl}` : "",
        clipDocumentRef.summary ? `Summary: ${clipDocumentRef.summary}` : "",
        "",
        clipDocumentRef.content || ""
      ]
        .filter(Boolean)
        .join("\n");

    if (!sourceUrl) {
      throw new Error("Missing page payload.");
    }

    if (clipMode === "url") {
      return addViaWebsite(documentRef, sourceUrl);
    }

    if (clipMode === "text") {
      return addViaText(documentRef, fallbackText);
    }

    try {
      return await addViaWebsite(documentRef, sourceUrl);
    } catch (error) {
      await delay(250);
      return addViaText(documentRef, fallbackText || clipDocumentRef.content || sourceUrl);
    }
  }

  async function clipPage(documentRef, payload) {
    const clipMode = payload.clipMode || "auto";

    if (!payload.page || !payload.page.url) {
      throw new Error("Missing page payload.");
    }

    return clipDocument(
      documentRef,
      {
        sourceUrl: payload.page.url,
        canonicalUrl: payload.page.url,
        title: payload.page.title || payload.page.url,
        summary: payload.page.description || "",
        content: payload.page.content || "",
        fallbackText: payload.page.fallbackText || ""
      },
      { mode: clipMode }
    );
  }

  return {
    clipDocument,
    clipPage,
    addViaWebsite,
    addViaText,
    waitFor,
    findClickable,
    findField,
    setFieldValue,
    normalizedText
  };
});

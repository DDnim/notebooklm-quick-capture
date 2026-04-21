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

  function isTopmost(node) {
    if (!node || !node.ownerDocument || typeof node.getBoundingClientRect !== "function") {
      return false;
    }

    if (typeof node.ownerDocument.elementFromPoint !== "function") {
      return true;
    }

    const box = node.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const view = node.ownerDocument.defaultView;
    if (!view || x < 0 || y < 0 || x > view.innerWidth || y > view.innerHeight) {
      return false;
    }

    const hit = node.ownerDocument.elementFromPoint(x, y);
    return Boolean(hit && (hit === node || node.contains(hit) || hit.contains(node)));
  }

  function isDisabled(node) {
    if (!node) {
      return true;
    }

    if (node.disabled) {
      return true;
    }

    const ariaDisabled = String(node.getAttribute("aria-disabled") || "").toLowerCase();
    return ariaDisabled === "true";
  }

  function matchesAny(text, phrases) {
    return phrases.some((phrase) => text.includes(normalizedText(phrase)));
  }

  function findClickable(documentRef, phrases, rootNode, options) {
    const scope = rootNode || documentRef;
    const nodes = Array.from(scope.querySelectorAll(BUTTON_SELECTOR));
    const enabledOnly = Boolean(options && options.enabledOnly);
    return (
      nodes.find(
        (node) =>
          isVisible(node) &&
          isTopmost(node) &&
          (!enabledOnly || !isDisabled(node)) &&
          matchesAny(getText(node), phrases)
      ) || null
    );
  }

  function findField(documentRef, phrases, rootNode) {
    const scope = rootNode || documentRef;
    const fields = Array.from(scope.querySelectorAll(FIELD_SELECTOR)).filter(
      (field) => isVisible(field) && isTopmost(field)
    );
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
      setNativeValue(field, value);
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

  function setNativeValue(field, value) {
    const prototype = Object.getPrototypeOf(field);
    const descriptor =
      (prototype && Object.getOwnPropertyDescriptor(prototype, "value")) ||
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value") ||
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");

    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(field, value);
      return;
    }

    field.value = value;
  }

  async function openAddSource(documentRef) {
    if (hasSourcePickerOpen(documentRef) || hasWebsiteFormOpen(documentRef)) {
      return null;
    }

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
      const explicit = findClickable(
        documentRef,
        ["insert", "save", "import", "create", "done"],
        null,
        { enabledOnly: true }
      );
      if (explicit) {
        return explicit;
      }

      const fallback = findClickable(documentRef, ["add"], null, { enabledOnly: true });
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
    if (!hasWebsiteFormOpen(documentRef)) {
      await openSourceType(documentRef, ["website", "web url", "link", "url"]);
    }
    const field = await waitFor(documentRef, () =>
      findField(documentRef, ["url", "link", "website", "https://"])
    );
    setFieldValue(field, url);
    await submitSource(documentRef);
    return { mode: "url" };
  }

  async function prepareViaWebsite(documentRef, url) {
    await openAddSource(documentRef);
    if (!hasWebsiteFormOpen(documentRef)) {
      await openSourceType(documentRef, ["website", "web url", "link", "url"]);
    }
    const field = await waitFor(documentRef, () =>
      findField(documentRef, ["url", "link", "website", "https://"])
    );
    setFieldValue(field, url);
    return {
      mode: "url",
      awaitingUserAction: true,
      userAction: "click_insert"
    };
  }

  async function addViaText(documentRef, text) {
    await openAddSource(documentRef);
    if (!hasTextFormOpen(documentRef)) {
      await openSourceType(documentRef, ["copied text", "text", "paste text"]);
    }
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

    if (options && options.handoffMode === "fill-only" && clipMode === "url") {
      return prepareViaWebsite(documentRef, sourceUrl);
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
    prepareViaWebsite,
    addViaText,
    waitFor,
    findClickable,
    findField,
    setFieldValue,
    normalizedText
  };

  function hasSourcePickerOpen(documentRef) {
    return Boolean(findClickable(documentRef, ["websites", "website", "drive", "copied text"]));
  }

  function hasWebsiteFormOpen(documentRef) {
    const field = findField(documentRef, ["paste any links", "url", "link", "website", "https://"]);
    if (!field) {
      return false;
    }

    const placeholder = normalizedText(field.getAttribute("placeholder") || "");
    const isUrlField =
      field.getAttribute("type") === "url" ||
      matchesAny(placeholder, ["paste any links", "url", "link", "website", "https://"]);

    return Boolean(
      isUrlField &&
        findClickable(documentRef, ["insert", "import", "save", "done"], null, {
          enabledOnly: true
        })
    );
  }

  function hasTextFormOpen(documentRef) {
    const field = findField(documentRef, ["paste text", "text", "notes", "content"]);
    if (!field) {
      return false;
    }

    const placeholder = normalizedText(field.getAttribute("placeholder") || "");
    const isTextField =
      field.tagName === "TEXTAREA" ||
      matchesAny(placeholder, ["paste text", "text", "notes", "content"]);

    return Boolean(
      isTextField &&
        findClickable(documentRef, ["save", "insert", "done"], null, {
          enabledOnly: true
        })
    );
  }
});

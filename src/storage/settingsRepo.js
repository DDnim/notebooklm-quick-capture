(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.ClipperSettingsRepo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DEFAULT_SETTINGS = {
    notebookId: "",
    notebookName: "",
    notebookUrl: "",
    clipMode: "auto"
  };

  function createSettingsRepo(chromeLike) {
    const SETTINGS_KEY = "settings";

    return {
      async initDefaults() {
        const existing = await getStorage(chromeLike, "sync", SETTINGS_KEY);
        if (!existing) {
          await setStorage(chromeLike, "sync", SETTINGS_KEY, DEFAULT_SETTINGS);
        }
      },
      async get() {
        const stored = await getStorage(chromeLike, "sync", SETTINGS_KEY);
        return sanitizeSettings(stored || DEFAULT_SETTINGS);
      },
      async save(settings) {
        const current = await this.get();
        const sanitized = sanitizeSettings(Object.assign({}, current, settings || {}));
        await setStorage(chromeLike, "sync", SETTINGS_KEY, sanitized);
        return sanitized;
      }
    };
  }

  function sanitizeSettings(settings) {
    return {
      notebookId: typeof settings.notebookId === "string" ? settings.notebookId.trim() : "",
      notebookName: typeof settings.notebookName === "string" ? settings.notebookName.trim() : "",
      notebookUrl: typeof settings.notebookUrl === "string" ? settings.notebookUrl.trim() : "",
      clipMode: ["auto", "url", "text"].includes(settings.clipMode) ? settings.clipMode : "auto"
    };
  }

  function getStorage(chromeLike, area, key) {
    return new Promise((resolve, reject) => {
      chromeLike.storage[area].get([key], (result) => {
        const error = chromeLike.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(result[key]);
      });
    });
  }

  function setStorage(chromeLike, area, key, value) {
    return new Promise((resolve, reject) => {
      chromeLike.storage[area].set({ [key]: value }, () => {
        const error = chromeLike.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  }

  return {
    DEFAULT_SETTINGS,
    createSettingsRepo
  };
});

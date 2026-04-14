(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.ClipperHistoryRepo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createHistoryRepo(chromeLike, options) {
    const HISTORY_KEY = "history";
    const limit = (options && options.limit) || 12;

    return {
      async list() {
        return (await getStorage(chromeLike, "local", HISTORY_KEY)) || [];
      },
      async push(entry) {
        const history = await this.list();
        const next = [entry].concat(history).slice(0, limit);
        await setStorage(chromeLike, "local", HISTORY_KEY, next);
        return next;
      }
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
    createHistoryRepo
  };
});

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.ClipperAdapterRegistry = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createAdapterRegistry(adapters) {
    const registered = Array.isArray(adapters) ? adapters.slice() : [];

    return {
      register(adapter) {
        registered.push(adapter);
      },
      findForUrl(url) {
        return registered.find((adapter) => adapter.matches(url)) || null;
      },
      async extract(context) {
        const adapter = this.findForUrl(context.url);
        if (!adapter) {
          throw new Error(`No adapter registered for ${context.url}`);
        }
        return adapter.extract(context);
      }
    };
  }

  return {
    createAdapterRegistry
  };
});

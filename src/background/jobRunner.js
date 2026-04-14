(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.ClipperJobRunner = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createJobRunner(dependencies) {
    const writer = dependencies.writer;
    const historyRepo = dependencies.historyRepo;
    const dedupeService = dependencies.dedupeService;
    const modelsApi = dependencies.modelsApi;
    const notebookService = dependencies.notebookService;

    return {
      async runClip(request) {
        const history = await historyRepo.list();
        const historyDuplicate = dedupeService.findHistoryDuplicate(
          request.document,
          history,
          request.targetNotebook.url
        );

        let remoteDuplicate = null;
        if (notebookService && request.targetNotebook.id) {
          try {
            const sources = await notebookService.listSources(request.targetNotebook.id);
            remoteDuplicate = dedupeService.findRemoteDuplicate(request.document, sources);
          } catch (error) {
            remoteDuplicate = null;
          }
        }

        if (remoteDuplicate) {
          const skippedResult = {
            ok: true,
            writer: "notebooklm-dom",
            modeUsed: "duplicate",
            skipped: true,
            duplicateSourceId: remoteDuplicate.id
          };
          await historyRepo.push(
            Object.assign(modelsApi.toHistoryEntry(request, skippedResult), {
              duplicateOf: remoteDuplicate.id
            })
          );
          return Object.assign({}, skippedResult, {
            duplicateDetected: true
          });
        }

        const result = await writer.addClip(request);
        await historyRepo.push(
          Object.assign(modelsApi.toHistoryEntry(request, result), {
            duplicateOf: historyDuplicate ? historyDuplicate.clipId : null
          })
        );

        return Object.assign({}, result, {
          duplicateDetected: Boolean(historyDuplicate)
        });
      }
    };
  }

  return {
    createJobRunner
  };
});

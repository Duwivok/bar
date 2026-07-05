const { getFetcher } = require("./fetchers");

const DEFAULT_CONCURRENCY = 3;

function errorResult(input, message) {
  return {
    itemId: input.itemId || null,
    packageId: input.packageId || null,
    sourceId: input.source && input.source.id ? input.source.id : null,
    sourceType: input.source && input.source.type ? input.source.type : "unknown",
    status: "error",
    oldPrice: input.currentPricePackage ?? null,
    newPrice: null,
    currency: "RUB",
    fetchedAt: new Date().toISOString(),
    message,
  };
}

async function runLimited(items, worker, concurrency) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runOne() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, runOne);
  await Promise.all(runners);
  return results;
}

async function checkPrices(items, options = {}) {
  const concurrency = options.concurrency || DEFAULT_CONCURRENCY;
  const enabledItems = items.filter((item) => item && (!item.source || item.source.enabled !== false));

  return runLimited(enabledItems, async (item) => {
    try {
      const sourceType = item.source && item.source.type ? item.source.type : "manual";
      const fetcher = getFetcher(sourceType);
      return await fetcher.fetchPrice(item);
    } catch (error) {
      return errorResult(item, error && error.message ? error.message : "fetcher_error");
    }
  }, concurrency);
}

module.exports = { checkPrices };

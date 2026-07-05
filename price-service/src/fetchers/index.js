const { manualFetcher } = require("./manual-fetcher");
const { mockFetcher } = require("./mock-fetcher");
const { genericHtmlFetcher } = require("./generic-html-fetcher");
const { createStubFetcher } = require("./stub-fetcher");

const fetchers = {
  manual: manualFetcher,
  mock: mockFetcher,
  genericHtml: genericHtmlFetcher,
  excel: createStubFetcher("excel", "Excel import will be implemented later"),
  pyaterochka: createStubFetcher("pyaterochka", "Pyaterochka adapter is not implemented yet"),
  perekrestok: createStubFetcher("perekrestok", "Perekrestok adapter is not implemented yet"),
  ozon: {
    sourceType: "ozon",
    async fetchPrice(input) {
      if (input.source && input.source.url) return genericHtmlFetcher.fetchPrice(input);
      return createStubFetcher("ozon", "Ozon may block regular requests; add a specialized adapter later").fetchPrice(input);
    },
  },
  vkusvill: {
    sourceType: "vkusvill",
    async fetchPrice(input) {
      if (input.source && input.source.url) return genericHtmlFetcher.fetchPrice(input);
      return createStubFetcher("vkusvill", "VkusVill query adapter is not implemented yet").fetchPrice(input);
    },
  },
};

function getFetcher(sourceType) {
  return fetchers[sourceType] || createStubFetcher(sourceType || "unknown", "Unknown source type");
}

module.exports = { getFetcher };

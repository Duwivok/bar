const { comparePrice } = require("../compare");

const MOCK_PRICES = [
  { needle: "лайм", price: 399 },
  { needle: "сахар", price: 115 },
  { needle: "мята", price: 180 },
  { needle: "campari", price: 2490 },
];

const mockFetcher = {
  sourceType: "mock",
  async fetchPrice(input) {
    const text = [
      input.itemName,
      input.source && input.source.query,
      input.source && input.source.url,
      input.source && input.source.title,
    ].filter(Boolean).join(" ").toLowerCase();

    const found = MOCK_PRICES.find((entry) => text.includes(entry.needle));
    const oldPrice = input.currentPricePackage ?? null;
    const fetchedAt = new Date().toISOString();

    if (!found) {
      return {
        itemId: input.itemId,
        packageId: input.packageId || null,
        sourceId: input.source.id,
        sourceType: "mock",
        status: "not_found",
        oldPrice,
        newPrice: null,
        currency: "RUB",
        title: input.itemName,
        url: input.source.url,
        packageSize: input.currentPackageSize ?? null,
        packageUnit: input.currentPackageUnit ?? null,
        available: false,
        fetchedAt,
        message: "Mock price not found",
      };
    }

    return {
      itemId: input.itemId,
      packageId: input.packageId || null,
      sourceId: input.source.id,
      sourceType: "mock",
      ...comparePrice(oldPrice, found.price),
      oldPrice,
      newPrice: found.price,
      currency: "RUB",
      title: input.itemName,
      url: input.source.url,
      packageSize: input.currentPackageSize ?? null,
      packageUnit: input.currentPackageUnit ?? null,
      available: true,
      fetchedAt,
      message: "Mock price fetched",
    };
  },
};

module.exports = { mockFetcher };

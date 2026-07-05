const { comparePrice } = require("../compare");

const manualFetcher = {
  sourceType: "manual",
  async fetchPrice(input) {
    const fetchedAt = new Date().toISOString();
    const oldPrice = input.currentPricePackage ?? null;
    return {
      itemId: input.itemId,
      packageId: input.packageId || null,
      sourceId: input.source.id,
      sourceType: "manual",
      ...comparePrice(oldPrice, oldPrice),
      oldPrice,
      newPrice: oldPrice,
      currency: "RUB",
      title: input.itemName,
      url: input.source.url,
      packageSize: input.currentPackageSize ?? null,
      packageUnit: input.currentPackageUnit ?? null,
      available: true,
      fetchedAt,
      message: "Manual price source keeps the current price",
    };
  },
};

module.exports = { manualFetcher };

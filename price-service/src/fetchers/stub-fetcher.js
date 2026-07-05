function createStubFetcher(sourceType, message) {
  return {
    sourceType,
    async fetchPrice(input) {
      return {
        itemId: input.itemId,
        packageId: input.packageId || null,
        sourceId: input.source && input.source.id ? input.source.id : null,
        sourceType,
        status: "adapter_not_implemented",
        oldPrice: input.currentPricePackage ?? null,
        newPrice: null,
        currency: "RUB",
        title: input.itemName,
        url: input.source && input.source.url,
        packageSize: input.currentPackageSize ?? null,
        packageUnit: input.currentPackageUnit ?? null,
        available: null,
        fetchedAt: new Date().toISOString(),
        message,
      };
    },
  };
}

module.exports = { createStubFetcher };

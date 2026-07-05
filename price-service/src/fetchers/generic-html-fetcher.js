const { normalizePrice, normalizePackageSize } = require("../normalize");
const { comparePrice } = require("../compare");

const FETCH_TIMEOUT_MS = 12000;

function priceFromHtml(html) {
  const patterns = [
    /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']product:price:amount["']/i,
    /<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["']/i,
    /<[^>]+itemprop=["']price["'][^>]*>([^<]+)</i,
    /"price"\s*:\s*"?([0-9]+(?:[.,][0-9]+)?)"?/i,
    /([0-9][0-9\s.,]{1,12})\s*(?:₽|руб\.?)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    const price = normalizePrice(match[1]);
    if (price !== null) return price;
  }

  return null;
}

const genericHtmlFetcher = {
  sourceType: "genericHtml",
  async fetchPrice(input) {
    const fetchedAt = new Date().toISOString();
    const oldPrice = input.currentPricePackage ?? null;
    const url = input.source && input.source.url;

    if (!url) {
      return {
        itemId: input.itemId,
        packageId: input.packageId || null,
        sourceId: input.source.id,
        sourceType: input.source.type || "genericHtml",
        status: "not_found",
        oldPrice,
        newPrice: null,
        currency: "RUB",
        fetchedAt,
        message: "URL is required for genericHtml fetcher",
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "user-agent": "Mozilla/5.0 price-checker",
          "accept": "text/html,application/xhtml+xml",
        },
      });

      if (!response.ok) {
        return {
          itemId: input.itemId,
          packageId: input.packageId || null,
          sourceId: input.source.id,
          sourceType: input.source.type || "genericHtml",
          status: response.status === 403 || response.status === 429 ? "unavailable" : "error",
          oldPrice,
          newPrice: null,
          currency: "RUB",
          url,
          fetchedAt,
          message: `HTTP ${response.status}`,
        };
      }

      const html = await response.text();
      const newPrice = priceFromHtml(html);
      const packageInfo = normalizePackageSize(html.slice(0, 5000));

      if (newPrice === null) {
        return {
          itemId: input.itemId,
          packageId: input.packageId || null,
          sourceId: input.source.id,
          sourceType: input.source.type || "genericHtml",
          status: "not_found",
          oldPrice,
          newPrice: null,
          currency: "RUB",
          url,
          fetchedAt,
          message: "Price not found in HTML",
        };
      }

      return {
        itemId: input.itemId,
        packageId: input.packageId || null,
        sourceId: input.source.id,
        sourceType: input.source.type || "genericHtml",
        ...comparePrice(oldPrice, newPrice),
        oldPrice,
        newPrice,
        currency: "RUB",
        title: input.source.title || input.itemName,
        url,
        packageSize: packageInfo ? packageInfo.packageSize : input.currentPackageSize ?? null,
        packageUnit: packageInfo ? packageInfo.packageUnit : input.currentPackageUnit ?? null,
        available: true,
        fetchedAt,
        message: "HTML price fetched",
      };
    } catch (error) {
      return {
        itemId: input.itemId,
        packageId: input.packageId || null,
        sourceId: input.source.id,
        sourceType: input.source.type || "genericHtml",
        status: error && error.name === "AbortError" ? "unavailable" : "error",
        oldPrice,
        newPrice: null,
        currency: "RUB",
        url,
        fetchedAt,
        message: error && error.name === "AbortError" ? "Request timeout" : "Fetch failed",
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};

module.exports = { genericHtmlFetcher };

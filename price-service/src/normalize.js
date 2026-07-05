const PACKAGE_UNIT_ALIASES = new Map([
  ["мл", "ml"],
  ["ml", "ml"],
  ["л", "l"],
  ["l", "l"],
  ["г", "g"],
  ["гр", "g"],
  ["g", "g"],
  ["кг", "kg"],
  ["kg", "kg"],
  ["шт", "pcs"],
  ["pcs", "pcs"],
]);

function normalizePrice(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const cleaned = value
    .replace(/\u00a0/g, " ")
    .replace(/₽/g, "")
    .replace(/руб\.?/gi, "")
    .replace(/\s+/g, "")
    .trim();

  if (!cleaned) return null;

  let normalized = cleaned;
  const hasComma = normalized.includes(",");
  const hasDot = normalized.includes(".");

  if (hasComma && hasDot) {
    normalized = normalized.replace(/,/g, "");
  } else if (hasComma) {
    normalized = normalized.replace(",", ".");
  }

  normalized = normalized.replace(/[^\d.]/g, "");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function normalizePackageSize(text) {
  if (!text) return null;
  const match = String(text).toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(мл|ml|л|l|кг|kg|гр|г|g|шт|pcs)\b/u);
  if (!match) return null;

  const packageSize = Number(match[1].replace(",", "."));
  const packageUnit = PACKAGE_UNIT_ALIASES.get(match[2]);
  if (!Number.isFinite(packageSize) || !packageUnit) return null;
  return { packageSize, packageUnit };
}

function convertPackageToBase(packageSize, packageUnit) {
  if (!Number.isFinite(packageSize) || !packageUnit) return null;
  if (packageUnit === "l") return { size: packageSize * 1000, unit: "ml" };
  if (packageUnit === "kg") return { size: packageSize * 1000, unit: "g" };
  return { size: packageSize, unit: packageUnit };
}

module.exports = {
  normalizePrice,
  normalizePackageSize,
  convertPackageToBase,
};

function comparePrice(oldPrice, newPrice) {
  if (newPrice === null || newPrice === undefined || !Number.isFinite(Number(newPrice))) {
    return {
      status: "not_found",
      diffAbsolute: null,
      diffPercent: null,
      warning: false,
    };
  }

  const oldNum = oldPrice === null || oldPrice === undefined ? null : Number(oldPrice);
  const newNum = Number(newPrice);

  if (oldNum === null || !Number.isFinite(oldNum)) {
    return {
      status: "changed",
      diffAbsolute: null,
      diffPercent: null,
      warning: false,
    };
  }

  const diffAbsolute = Math.round((newNum - oldNum) * 100) / 100;
  const diffPercent = oldNum === 0 ? null : Math.round((diffAbsolute / oldNum) * 10000) / 100;
  const changed = Math.abs(diffAbsolute) >= 0.01;

  return {
    status: changed ? "changed" : "unchanged",
    diffAbsolute,
    diffPercent,
    warning: diffPercent !== null && Math.abs(diffPercent) > 30,
  };
}

module.exports = { comparePrice };

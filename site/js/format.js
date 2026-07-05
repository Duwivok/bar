// Общие функции форматирования чисел/сумм — переиспользуются в event.js/event-calc.js/calculator.js,
// чтобы количества и деньги везде выглядели одинаково (число + короткая единица/₽ сразу рядом).

function formatNum(n) {
    if (n === null || n === undefined || isNaN(n)) return "";
    const rounded = Math.round(n * 100) / 100;
    return String(rounded);
}

// Количество с единицей сразу после числа, напр. "120 мл", "2 шт". unit необязателен.
function formatQty(qty, unit) {
    const num = formatNum(qty);
    if (!num) return unit || "";
    return unit ? `${num} ${unit}` : num;
}

// Сумма в рублях с разрядами тысяч, напр. "1 240 ₽".
function formatMoney(value) {
    if (value === null || value === undefined || isNaN(value)) return "";
    const rounded = Math.round(value * 100) / 100;
    return rounded.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " ₽";
}

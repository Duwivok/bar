// Общий движок расчёта под мероприятие: разворачивает выбранную барную карту (event_menu_items)
// в итоговые объёмы сырья и заготовок. Использует ту же формулу масштабирования и трудоёмкости,
// что и калькулятор техкарт (js/calculator.js): coefficient = нужный объём / yield_qty,
// laborMinutes = labor_minutes * (1 + 0.2 * (coefficient - 1)).
//
// Работает поверх уже загруженных recipesById / itemsByRecipe (тот же формат, что в recipes.js/calculator.js:
// itemsByRecipe[recipeId] = [{ name, qty, unit, is_topup, topup_default_qty, isSub, targetId }]).

// menuItems: [{ recipe_id, qty_portions }] — уже отфильтрованные по included=true, qty_portions>0.
// prepStateMap: recipeId -> { buy_ready, ... } — решение "готовим сами / покупаем готовое" по этому мероприятию.
// Если заготовка помечена buy_ready — в её состав не спускаемся (не считаем её сырьё и не просим готовить),
// а добавляем её саму строкой в ingredientTotals с ценой по закупочной упаковке заготовки.
// ingredientsByName: name -> {id, base_unit, ...}, conversionsByIngredientId: ingredientId -> {from_unit -> coefficient} —
// нужны, чтобы количество из рецепта (напр. "2 веточки") пересчитать в базовую единицу ингредиента
// (напр. "г"), в которой считается закупка. См. вкладку "Конвертер" (site/converter.html).
// Возвращает { ingredientTotals: [{name, unit, qty, isTopup, isBoughtPrep, conversionMissing, recipeId, category, cost, sources: [{name, qty, unit}]}],
//              prepTotals: [{recipeId, recipe, neededQty, unit, coefficient, laborMinutes, yieldMissing, buyReady, cyclic, ownRows, sources}] }
function computeEventTotals(menuItems, recipesById, itemsByRecipe, prepStateMap, ingredientsByName, conversionsByIngredientId) {
    prepStateMap = prepStateMap || {};
    ingredientsByName = ingredientsByName || {};
    conversionsByIngredientId = conversionsByIngredientId || {};
    const ingredientAcc = new Map(); // key: name|topup[|unit если конвертация не найдена] -> entry
    const prepAcc = new Map();       // recipeId -> { totalQty, unit, sources: Map }
    const cyclicRecipeIds = new Set();

    // Переводит qty из единицы рецепта (unit) в базовую единицу ингредиента (если она известна
    // и отличается от unit), используя коэффициент из "Конвертера". Если конвертации не нашлось —
    // не подменяет молча единицу, а помечает conversionMissing, чтобы UI мог явно предупредить,
    // а не тихо сложить несопоставимые количества в одну сумму.
    function toBaseUnit(name, unit, qty) {
        const ing = ingredientsByName[name];
        const baseUnit = ing ? ing.base_unit : null;
        if (!baseUnit || !unit || unit === baseUnit) {
            return { qty: qty || 0, unit: baseUnit || unit, conversionMissing: false };
        }
        const coeff = (conversionsByIngredientId[ing.id] || {})[unit];
        if (coeff !== undefined && coeff !== null) {
            return { qty: (qty || 0) * coeff, unit: baseUnit, conversionMissing: false };
        }
        return { qty: qty || 0, unit, conversionMissing: true };
    }

    function addIngredient(name, unit, qty, isTopup, sourceName) {
        const converted = toBaseUnit(name, unit, qty);
        const key = name + "|" + (isTopup ? "t" : "e") + (converted.conversionMissing ? "|" + (converted.unit || "") : "");
        let entry = ingredientAcc.get(key);
        if (!entry) {
            entry = { name, unit: converted.unit, qty: 0, isTopup, isBoughtPrep: false, conversionMissing: converted.conversionMissing, sources: new Map() };
            ingredientAcc.set(key, entry);
        }
        entry.qty += converted.qty;
        entry.conversionMissing = entry.conversionMissing || converted.conversionMissing;
        // sources хранит ИСХОДНОЕ (не сконвертированное) количество+единицу по каждому рецепту —
        // так на экране можно проследить "Мохито — 2 веточки", а не пересчитанные граммы.
        const prev = entry.sources.get(sourceName);
        entry.sources.set(sourceName, { qty: (prev ? prev.qty : 0) + (qty || 0), unit });
    }

    function addBoughtPrep(recipe, qty, sourceName) {
        const key = "prep:" + recipe.id;
        let entry = ingredientAcc.get(key);
        if (!entry) {
            entry = {
                name: recipe.name,
                unit: recipe.yield_unit || recipe.purchase_unit || null,
                qty: 0,
                isTopup: false,
                isBoughtPrep: true,
                recipeId: recipe.id,
                sources: new Map(),
            };
            ingredientAcc.set(key, entry);
        }
        entry.qty += qty || 0;
        const prev = entry.sources.get(sourceName);
        entry.sources.set(sourceName, { qty: (prev ? prev.qty : 0) + (qty || 0), unit: entry.unit });
    }

    function addPrepDemand(recipeId, qty, unit, sourceName) {
        let entry = prepAcc.get(recipeId);
        if (!entry) {
            entry = { totalQty: 0, unit: null, sources: new Map() };
            prepAcc.set(recipeId, entry);
        }
        entry.totalQty += qty || 0;
        if (!entry.unit && unit) entry.unit = unit;
        entry.sources.set(sourceName, (entry.sources.get(sourceName) || 0) + (qty || 0));
    }

    // Разворачиваем спрос по дереву. Масштабирование линейно, поэтому каждое вхождение
    // заготовки можно разворачивать независимо и просто суммировать результаты —
    // не нужно ждать финальной суммы спроса, прежде чем идти вглубь.
    // Позиции барной карты обычно "готовые коктейли" (qty в их составе — на 1 порцию, поэтому
    // умножаем прямо на qty_portions). Но заготовка (напр. настойка), поданная гостю напрямую
    // и потому выбранная прямо в барную карту, устроена как любая другая заготовка: qty в её
    // составе — "на 1 партию" (yield_qty), а qty_portions тут означает "нужный объём на всё
    // мероприятие". Поэтому её нужно не разворачивать в лоб, а сначала завести как обычный
    // спрос на заготовку (addPrepDemand/addBoughtPrep), чтобы она попала в "Нужно приготовить"
    // и в закупку, а уже её состав разворачивать с коэффициентом neededQty/yield_qty — как для
    // любой другой заготовки, до которой дошли через sub_recipe_id.
    const worklist = [];
    menuItems.filter((mi) => mi.qty_portions > 0).forEach((mi) => {
        const recipe = recipesById[mi.recipe_id];
        const sourceName = (recipe && recipe.name) || "?";
        if (recipe && recipe.is_prep) {
            const neededQty = mi.qty_portions;
            const buyReady = !!(prepStateMap[mi.recipe_id] && prepStateMap[mi.recipe_id].buy_ready);
            if (buyReady) {
                addBoughtPrep(recipe, neededQty, "Барная карта");
            } else {
                addPrepDemand(mi.recipe_id, neededQty, recipe.yield_unit || null, "Барная карта");
                if (recipe.yield_qty) {
                    worklist.push({ recipeId: mi.recipe_id, multiplier: neededQty / recipe.yield_qty, sourceName, path: new Set() });
                }
            }
        } else {
            worklist.push({ recipeId: mi.recipe_id, multiplier: mi.qty_portions, sourceName, path: new Set() });
        }
    });

    while (worklist.length > 0) {
        const { recipeId, multiplier, sourceName, path } = worklist.shift();
        if (path.has(recipeId)) { cyclicRecipeIds.add(recipeId); continue; }
        const items = itemsByRecipe[recipeId] || [];
        const nextPath = new Set(path);
        nextPath.add(recipeId);

        items.forEach((it) => {
            if (it.isSub) {
                const qty = (it.qty !== null && it.qty !== undefined) ? it.qty * multiplier : 0;
                addPrepDemand(it.targetId, qty, it.unit, sourceName);
                const subRecipe = recipesById[it.targetId];
                const buyReady = !!(prepStateMap[it.targetId] && prepStateMap[it.targetId].buy_ready);
                if (buyReady && subRecipe) {
                    // Покупаем готовое — не считаем её сырьё и не спускаемся вглубь состава.
                    addBoughtPrep(subRecipe, qty, sourceName);
                } else if (subRecipe && subRecipe.yield_qty) {
                    // Внутри заготовки qty у собственных строк состава — это количество "на один выход партии"
                    // (yield_qty), поэтому спускаться в её состав нужно с коэффициентом qty/yield_qty, а не с qty напрямую.
                    const subCoefficient = qty / subRecipe.yield_qty;
                    worklist.push({ recipeId: it.targetId, multiplier: subCoefficient, sourceName, path: nextPath });
                }
            } else if (it.is_topup) {
                const qty = (it.topup_default_qty !== null && it.topup_default_qty !== undefined) ? it.topup_default_qty * multiplier : 0;
                addIngredient(it.name, null, qty, true, sourceName);
            } else {
                const qty = (it.qty !== null && it.qty !== undefined) ? it.qty * multiplier : 0;
                addIngredient(it.name, it.unit, qty, false, sourceName);
            }
        });
    }

    const ingredientTotals = [...ingredientAcc.values()]
        .map((e) => {
            const sources = [...e.sources.entries()].map(([name, s]) => ({ name, qty: s.qty, unit: s.unit }));
            if (e.isBoughtPrep) {
                const recipe = recipesById[e.recipeId];
                let cost = null;
                if (recipe && recipe.purchase_package_size && recipe.purchase_package_price) {
                    cost = (e.qty / recipe.purchase_package_size) * recipe.purchase_package_price;
                }
                return { ...e, sources, cost, category: recipe ? (recipe.purchase_category || null) : null };
            }
            return { ...e, sources };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));

    const prepTotals = [...prepAcc.entries()].map(([recipeId, acc]) => {
        const recipe = recipesById[recipeId];
        const sources = [...acc.sources.entries()].map(([name, qty]) => ({ name, qty }));
        const unit = (recipe && recipe.yield_unit) || acc.unit || null;
        const buyReady = !!(prepStateMap[recipeId] && prepStateMap[recipeId].buy_ready);

        if (!recipe) return { recipeId, recipe: null, neededQty: acc.totalQty, unit, sources, yieldMissing: true, buyReady };
        if (buyReady) {
            return { recipeId, recipe, neededQty: acc.totalQty, unit, sources, yieldMissing: false, buyReady: true, cyclic: cyclicRecipeIds.has(recipeId) };
        }
        if (!recipe.yield_qty) return { recipeId, recipe, neededQty: acc.totalQty, unit, sources, yieldMissing: true, buyReady: false };

        const coefficient = acc.totalQty / recipe.yield_qty;
        const laborMinutes = (recipe.labor_minutes !== null && recipe.labor_minutes !== undefined)
            ? recipe.labor_minutes * (1 + 0.2 * (coefficient - 1))
            : null;

        const ownRows = (itemsByRecipe[recipeId] || []).map((it) => {
            if (it.isSub) {
                const qty = (it.qty !== null && it.qty !== undefined) ? it.qty * coefficient : null;
                return { type: "sub", name: it.name, qty, unit: it.unit, targetId: it.targetId };
            }
            if (it.is_topup) {
                const qty = (it.topup_default_qty !== null && it.topup_default_qty !== undefined) ? it.topup_default_qty * coefficient : null;
                return { type: "ing", name: it.name, qty, unit: null, isTopup: true };
            }
            const qty = (it.qty !== null && it.qty !== undefined) ? it.qty * coefficient : null;
            return { type: "ing", name: it.name, qty, unit: it.unit, isTopup: false };
        });

        return {
            recipeId,
            recipe,
            neededQty: acc.totalQty,
            unit,
            coefficient,
            laborMinutes,
            yieldMissing: false,
            buyReady: false,
            cyclic: cyclicRecipeIds.has(recipeId),
            ownRows,
            sources,
        };
    }).sort((a, b) => ((a.recipe && a.recipe.name) || "").localeCompare((b.recipe && b.recipe.name) || "", "ru"));

    return { ingredientTotals, prepTotals };
}

// Подбирает набор закупочных упаковок, полностью покрывающий requiredQty, минимизируя суммарную стоимость
// (аналог "разменять монетами хотя бы N"). packages: [{package_size, package_price, purchase_unit, purchase_link}].
// Размеры упаковок могут быть дробными (0.5 / 0.7 / 1.0) — переводим всё в целую сетку по числу знаков
// после запятой во входных данных (до 3 знаков), чтобы не терять точность округлением до целого.
// Возвращает { combo: [{package_size, package_price, purchase_unit, count}], totalQty, totalCost } или null,
// если считать не из чего (нет упаковок с размером и ценой).
function decimalScaleFor(numbers) {
    let maxDecimals = 0;
    numbers.forEach((n) => {
        if (n === null || n === undefined || !isFinite(n)) return;
        const s = String(n);
        const dot = s.indexOf(".");
        if (dot !== -1) maxDecimals = Math.max(maxDecimals, s.length - dot - 1);
    });
    return Math.pow(10, Math.min(maxDecimals, 3));
}

function bestPackageCombo(requiredQty, packages) {
    const usable = (packages || []).filter((p) => p.package_size > 0 && p.package_price != null);
    if (!requiredQty || requiredQty <= 0 || usable.length === 0) return null;

    const scale = decimalScaleFor([requiredQty, ...usable.map((p) => p.package_size)]);
    const target = Math.ceil(requiredQty * scale);
    const sizesScaled = usable.map((p) => Math.round(p.package_size * scale));
    const maxSize = Math.max(...sizesScaled);
    const limit = target + maxSize;

    const cost = new Array(limit + 1).fill(Infinity);
    const choice = new Array(limit + 1).fill(-1);
    cost[0] = 0;
    for (let t = 1; t <= limit; t++) {
        for (let i = 0; i < usable.length; i++) {
            const size = sizesScaled[i];
            if (size <= 0) continue;
            const prevT = Math.max(0, t - size);
            const candidate = cost[prevT] + usable[i].package_price;
            if (candidate < cost[t]) {
                cost[t] = candidate;
                choice[t] = i;
            }
        }
    }

    let bestT = -1;
    let bestCost = Infinity;
    for (let t = target; t <= limit; t++) {
        if (cost[t] < bestCost) { bestCost = cost[t]; bestT = t; }
    }
    if (bestT === -1 || !isFinite(bestCost)) return null;

    const counts = new Array(usable.length).fill(0);
    let t = bestT;
    while (t > 0 && choice[t] !== -1) {
        const i = choice[t];
        counts[i]++;
        t = Math.max(0, t - sizesScaled[i]);
    }

    const combo = usable
        .map((p, i) => ({ ...p, count: counts[i] }))
        .filter((c) => c.count > 0)
        .sort((a, b) => b.package_size - a.package_size);
    const totalQty = combo.reduce((sum, c) => sum + c.count * c.package_size, 0);
    const totalCost = combo.reduce((sum, c) => sum + c.count * c.package_price, 0);
    return { combo, totalQty, totalCost };
}

// ingredientsByName: name -> { id, category }
// packagesByIngredientId: ingredientId -> [{package_size, package_price, purchase_unit, purchase_link}]
// Возвращает { totalCost, lines: [{name, unit, qty, isTopup, isBoughtPrep, cost, category, packageCombo}] } —
// cost/packageCombo = null там, где не получилось посчитать (нет ни одной упаковки с размером и ценой).
function computeBudget(ingredientTotals, ingredientsByName, packagesByIngredientId) {
    packagesByIngredientId = packagesByIngredientId || {};
    let totalCost = 0;
    const lines = ingredientTotals.map((entry) => {
        if (entry.isBoughtPrep) {
            if (entry.cost !== null && entry.cost !== undefined) totalCost += entry.cost;
            return entry;
        }
        const ing = ingredientsByName[entry.name];
        const packages = ing ? packagesByIngredientId[ing.id] : null;
        // При conversionMissing entry.qty остаётся в единице рецепта (не в базовой), а упаковки
        // размечены в базовой единице ингредиента — считать по ним нельзя, пока не задан коэффициент.
        const combo = (packages && !entry.conversionMissing) ? bestPackageCombo(entry.qty, packages) : null;
        const cost = combo ? combo.totalCost : null;
        if (cost !== null) totalCost += cost;
        return { ...entry, cost, category: ing ? ing.category : null, packageCombo: combo };
    });
    return { totalCost, lines };
}

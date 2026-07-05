// Расчётный движок мероприятия (v2) — форк js/event-calc.js (тот остаётся неизменным для
// старой event.html). Отличия от v1:
//  1) Поддержка ручного переопределения нужного количества заготовки (event_prep_state.manual_qty) —
//     когда задано, состав самой заготовки разворачивается с коэффициентом от этого значения,
//     а не от расчётного спроса; поэтому раскрытие состава сделано в ДВА прохода (см. ниже).
//  2) "sources" у ингредиента/заготовки указывают на её НЕПОСРЕДСТВЕННОГО родителя (рецепт,
//     который её напрямую использует), а не "протаскиваются" до самого верхнего коктейля барной
//     карты — так информативнее отвечает на вопрос "где используется" для сырья внутри заготовок.
//
// Работает поверх recipesById / itemsByRecipe (тот же формат, что в recipes.js/calculator.js).
// menuItems: [{ recipe_id, qty_portions }] — уже отфильтрованные по included=true, qty_portions>0.
// prepStateMap: recipeId -> { buy_ready, manual_qty, ... }.
// Возвращает { ingredientTotals: [{name, unit, qty, isTopup, isBoughtPrep, isManualOverride, conversionMissing, recipeId, category, cost, sources: [{name, qty, unit}]}],
//              prepTotals: [{recipeId, recipe, neededQty, naturalQty, isManualOverride, unit, coefficient, laborMinutes, yieldMissing, buyReady, cyclic, sources}] }
function computeEventTotals(menuItems, recipesById, itemsByRecipe, prepStateMap, ingredientsByName, conversionsByIngredientId) {
    prepStateMap = prepStateMap || {};
    ingredientsByName = ingredientsByName || {};
    conversionsByIngredientId = conversionsByIngredientId || {};
    const ingredientAcc = new Map(); // key: name|topup[|unit если конвертация не найдена] -> entry
    const prepDemand = new Map();    // recipeId -> { totalQty, unit, sources: Map, manualSources: Set }
    const cyclicRecipeIds = new Set();

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

    function addIngredient(name, unit, qty, isTopup, sourceName, isManualOverride) {
        const converted = toBaseUnit(name, unit, qty);
        const key = name + "|" + (isTopup ? "t" : "e") + (converted.conversionMissing ? "|" + (converted.unit || "") : "");
        let entry = ingredientAcc.get(key);
        if (!entry) {
            entry = { name, unit: converted.unit, qty: 0, isTopup, isBoughtPrep: false, isManualOverride: false, conversionMissing: converted.conversionMissing, sources: new Map() };
            ingredientAcc.set(key, entry);
        }
        entry.qty += converted.qty;
        entry.conversionMissing = entry.conversionMissing || converted.conversionMissing;
        entry.isManualOverride = entry.isManualOverride || !!isManualOverride;
        const prev = entry.sources.get(sourceName);
        entry.sources.set(sourceName, { qty: (prev ? prev.qty : 0) + (qty || 0), unit });
    }

    function addBoughtPrep(recipe, qty, sourcesMap, isManualOverride) {
        const key = "prep:" + recipe.id;
        const entry = {
            name: recipe.name,
            unit: recipe.yield_unit || recipe.purchase_unit || null,
            qty: qty || 0,
            isTopup: false,
            isBoughtPrep: true,
            isManualOverride: !!isManualOverride,
            recipeId: recipe.id,
            sources: new Map(sourcesMap),
        };
        ingredientAcc.set(key, entry);
    }

    function addPrepDemand(recipeId, qty, unit, sourceName) {
        let entry = prepDemand.get(recipeId);
        if (!entry) {
            entry = { totalQty: 0, unit: null, sources: new Map() };
            prepDemand.set(recipeId, entry);
        }
        entry.totalQty += qty || 0;
        if (!entry.unit && unit) entry.unit = unit;
        entry.sources.set(sourceName, (entry.sources.get(sourceName) || 0) + (qty || 0));
    }

    // ---- Проход 1: раскрываем барную карту до сырья/спроса на заготовки. ----
    // Заготовку, до которой дошли (напрямую из барной карты или как вложенную ссылку),
    // НЕ разворачиваем тут же — только фиксируем спрос (addPrepDemand). Её собственный
    // состав раскроется в проходе 2, когда будет известен её итоговый спрос — а если
    // пользователь его переопределил вручную, то с учётом этого переопределения.
    const worklist = [];
    menuItems.filter((mi) => mi.qty_portions > 0).forEach((mi) => {
        const recipe = recipesById[mi.recipe_id];
        const sourceName = (recipe && recipe.name) || "?";
        if (recipe && recipe.is_prep) {
            addPrepDemand(mi.recipe_id, mi.qty_portions, recipe.yield_unit || null, "Барная карта");
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
            } else if (it.is_topup) {
                const qty = (it.topup_default_qty !== null && it.topup_default_qty !== undefined) ? it.topup_default_qty * multiplier : 0;
                addIngredient(it.name, null, qty, true, sourceName, false);
            } else {
                const qty = (it.qty !== null && it.qty !== undefined) ? it.qty * multiplier : 0;
                addIngredient(it.name, it.unit, qty, false, sourceName, false);
            }
        });
    }

    // ---- Проход 2: раскрываем состав каждой встретившейся заготовки РОВНО ОДИН РАЗ, ----
    // используя её итоговый спрос (или ручное переопределение, если оно задано).
    const prepResults = new Map(); // recipeId -> итоговая карточка для prepTotals
    const prepWorklist = [...prepDemand.keys()].map((recipeId) => ({ recipeId, path: new Set() }));
    const processedPreps = new Set();

    while (prepWorklist.length > 0) {
        const { recipeId, path } = prepWorklist.shift();
        if (processedPreps.has(recipeId)) continue;
        if (path.has(recipeId)) { cyclicRecipeIds.add(recipeId); continue; }
        processedPreps.add(recipeId);

        const recipe = recipesById[recipeId];
        const demand = prepDemand.get(recipeId) || { totalQty: 0, unit: null, sources: new Map() };
        const state = prepStateMap[recipeId];
        const buyReady = !!(state && state.buy_ready);
        const hasManual = !!(state && state.manual_qty !== null && state.manual_qty !== undefined);
        const naturalQty = demand.totalQty;
        const effectiveQty = hasManual ? Number(state.manual_qty) : naturalQty;
        const unit = (recipe && recipe.yield_unit) || demand.unit || null;
        const sources = [...demand.sources.entries()].map(([name, qty]) => ({ name, qty }));

        if (!recipe) {
            prepResults.set(recipeId, { recipeId, recipe: null, neededQty: effectiveQty, naturalQty, isManualOverride: hasManual, unit, sources, yieldMissing: true, buyReady });
            continue;
        }

        if (buyReady) {
            addBoughtPrep(recipe, effectiveQty, demand.sources, hasManual);
            prepResults.set(recipeId, { recipeId, recipe, neededQty: effectiveQty, naturalQty, isManualOverride: hasManual, unit, sources, yieldMissing: false, buyReady: true, cyclic: cyclicRecipeIds.has(recipeId) });
            continue;
        }

        if (!recipe.yield_qty) {
            prepResults.set(recipeId, { recipeId, recipe, neededQty: effectiveQty, naturalQty, isManualOverride: hasManual, unit, sources, yieldMissing: true, buyReady: false });
            continue;
        }

        const coefficient = effectiveQty / recipe.yield_qty;
        const laborMinutes = (recipe.labor_minutes !== null && recipe.labor_minutes !== undefined)
            ? recipe.labor_minutes * (1 + 0.2 * (coefficient - 1))
            : null;

        const nextPath = new Set(path);
        nextPath.add(recipeId);
        (itemsByRecipe[recipeId] || []).forEach((it) => {
            if (it.isSub) {
                const qty = (it.qty !== null && it.qty !== undefined) ? it.qty * coefficient : 0;
                addPrepDemand(it.targetId, qty, it.unit, recipe.name);
                prepWorklist.push({ recipeId: it.targetId, path: nextPath });
            } else if (it.is_topup) {
                const qty = (it.topup_default_qty !== null && it.topup_default_qty !== undefined) ? it.topup_default_qty * coefficient : 0;
                addIngredient(it.name, null, qty, true, recipe.name, hasManual);
            } else {
                const qty = (it.qty !== null && it.qty !== undefined) ? it.qty * coefficient : 0;
                addIngredient(it.name, it.unit, qty, false, recipe.name, hasManual);
            }
        });

        prepResults.set(recipeId, {
            recipeId,
            recipe,
            neededQty: effectiveQty,
            naturalQty,
            isManualOverride: hasManual,
            unit,
            coefficient,
            laborMinutes,
            yieldMissing: false,
            buyReady: false,
            cyclic: cyclicRecipeIds.has(recipeId),
            sources,
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

    const prepTotals = [...prepResults.values()]
        .sort((a, b) => ((a.recipe && a.recipe.name) || "").localeCompare((b.recipe && b.recipe.name) || "", "ru"));

    return { ingredientTotals, prepTotals };
}

// Подбирает набор закупочных упаковок, полностью покрывающий requiredQty, минимизируя суммарную
// стоимость (аналог "разменять монетами хотя бы N"). Идентично js/event-calc.js — чистая логика,
// от переопределения количества не зависит, дублируется только чтобы event-v2.html не тянул
// сразу оба файла (в js/event-calc.js эти же функции имя-в-имя, был бы конфликт объявлений).
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
        const combo = (packages && !entry.conversionMissing) ? bestPackageCombo(entry.qty, packages) : null;
        const cost = combo ? combo.totalCost : null;
        if (cost !== null) totalCost += cost;
        return { ...entry, cost, category: ing ? ing.category : null, packageCombo: combo };
    });
    return { totalCost, lines };
}

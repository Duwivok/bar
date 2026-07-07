const state = {
    recipes: [],
    recipesById: {},
    itemsByRecipe: {},
    ingredientsByName: {},
    ingredientById: {},
    packagesByIngredientId: {},
    conversionsByIngredientId: {},
    selectedId: null,
    recipeSearch: "",
    recipeFilter: "all",
    recipeSpirit: "all",
    recipeSort: "name",
    excludeComplexPrep: false,
    expandedPreps: new Set(),
    targetValue: 1,
    targetUnit: "portion",
    rows: [],
    prepRows: [],
    missingPrices: 0,
    totalCost: 0,
};

const els = {
    status: document.getElementById("status"),
    recipePicker: document.getElementById("recipePicker"),
    recipePickerBtn: document.getElementById("recipePickerBtn"),
    recipePickerPopup: document.getElementById("recipePickerPopup"),
    recipeSearchInput: document.getElementById("recipeSearchInput"),
    recipeSearchClearBtn: document.getElementById("recipeSearchClearBtn"),
    recipePickerCloseBtn: document.getElementById("recipePickerCloseBtn"),
    recipePickerSpirit: document.getElementById("recipePickerSpirit"),
    recipePickerFilters: document.getElementById("recipePickerFilters"),
    recipePickerSorts: document.getElementById("recipePickerSorts"),
    recipePickerComplexToggle: document.getElementById("recipePickerComplexToggle"),
    recipePickerList: document.getElementById("recipePickerList"),
    targetInput: document.getElementById("targetInput"),
    targetUnitLabel: document.getElementById("targetUnitLabel"),
    presetBar: document.getElementById("presetBar"),
    rows: document.getElementById("calcRows"),
    expandAllBtn: document.getElementById("expandAllPrepsBtn"),
    collapseAllBtn: document.getElementById("collapseAllPrepsBtn"),
    summary: document.getElementById("summaryRows"),
    prepSummary: document.getElementById("prepSummary"),
    editLink: document.getElementById("editRecipeLink"),
    copyBtn: document.getElementById("copyShoppingBtn"),
    sticky: document.getElementById("calcSticky"),
    workspace: document.querySelector(".bc-calc-workspace"),
};

function setStatus(message) {
    els.status.textContent = message || "";
    els.status.classList.toggle("show", !!message);
}

// Кастомный выпадающий список поверх обычного <select> — только для десктопа.
// На мобильном (iPhone и т.п.) select остаётся нативным, чтобы открывалась
// системная колёсная прокрутка ОС, а не самодельный попап.
function enhanceCalcSelect(selectEl) {
    const wrap = document.createElement("div");
    wrap.className = "bc-custom-select";
    selectEl.parentNode.insertBefore(wrap, selectEl);
    wrap.appendChild(selectEl);

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "bc-custom-select-trigger";
    wrap.appendChild(trigger);

    const popup = document.createElement("div");
    popup.className = "bc-custom-select-popup hidden";
    wrap.appendChild(popup);

    function renderTrigger() {
        const opt = selectEl.options[selectEl.selectedIndex];
        trigger.textContent = opt ? opt.textContent : "";
    }

    function close() {
        popup.classList.add("hidden");
    }

    function renderPopup() {
        popup.innerHTML = "";
        [...selectEl.options].forEach((opt) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = opt.textContent;
            btn.className = opt.value === selectEl.value ? "active" : "";
            btn.onclick = () => {
                selectEl.value = opt.value;
                selectEl.dispatchEvent(new Event("change"));
                renderTrigger();
                close();
            };
            popup.appendChild(btn);
        });
    }

    trigger.onclick = () => {
        document.querySelectorAll(".bc-custom-select-popup").forEach((p) => {
            if (p !== popup) p.classList.add("hidden");
        });
        renderPopup();
        popup.classList.toggle("hidden");
    };

    document.addEventListener("click", (event) => {
        if (!wrap.contains(event.target)) close();
    });

    selectEl.addEventListener("change", renderTrigger);
    renderTrigger();
    return { refresh: renderTrigger };
}

const spiritSelectUI = enhanceCalcSelect(els.recipePickerSpirit);
const filterSelectUI = enhanceCalcSelect(els.recipePickerFilters);

function normalized(value) {
    return String(value || "").trim().toLowerCase();
}

function num(value) {
    const n = Number(String(value || "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
}

function displayQty(qty, unit) {
    if (qty === null || qty === undefined || Number.isNaN(Number(qty))) return "-";
    return formatQty(qty, unit || "");
}

function recipeKind(recipe) {
    const subtype = normalized(recipe.subtype);
    const name = normalized(recipe.name);
    if (subtype.includes("настой") || name.includes("настой")) return "настойка";
    if (subtype.includes("кастом") || subtype.includes("custom")) return "кастомный алкоголь";
    if (recipe.is_prep) return "заготовка";
    return subtype === "шот" ? "шот" : "коктейль";
}

function recipeBucket(recipe) {
    const kind = recipeKind(recipe);
    if (kind === "настойка") return "infusion";
    if (kind === "кастомный алкоголь") return "custom";
    if (kind === "шот") return "shot";
    if (recipe.is_prep) return "prep";
    return "cocktail";
}

// "Сложная" заготовка — своя трудоёмкость (labor_minutes) выше порога. Используется
// фильтром "искл. сложные заготовки": скрывает рецепты, где такая заготовка нужна
// напрямую или где-то в цепочке вложенных заготовок — чтобы быстро найти, что
// реально приготовить на месте прямо сейчас, без долгой предварительной работы.
const COMPLEX_PREP_MINUTES = 15;

function recipeUsesComplexPrep(recipe, seen = new Set()) {
    if (!recipe || seen.has(recipe.id)) return false;
    seen.add(recipe.id);
    if (recipe.is_prep && Number(recipe.labor_minutes || 0) >= COMPLEX_PREP_MINUTES) return true;
    return (state.itemsByRecipe[recipe.id] || []).some((item) => {
        if (!item.isSub || !item.targetId) return false;
        return recipeUsesComplexPrep(state.recipesById[item.targetId], seen);
    });
}

function unitToSelect(unit) {
    const value = normalized(unit);
    if (value === "мл") return "ml";
    if (value === "л") return "l";
    if (value === "г") return "g";
    if (value === "кг") return "kg";
    return value || "ml";
}

function selectToUnit(unit) {
    if (unit === "ml") return "мл";
    if (unit === "l") return "л";
    if (unit === "g") return "г";
    if (unit === "kg") return "кг";
    if (unit === "portion") return "порций";
    return unit;
}

function defaultTargetUnit(recipe) {
    if (!recipe || !recipe.is_prep) return "portion";
    const unit = normalized(recipe.yield_unit);
    if (unit === "г" || unit === "кг") return "g";
    if (unit === "мл" || unit === "л" || !unit) return "ml";
    return unitToSelect(recipe.yield_unit);
}

function defaultTargetValue(recipe) {
    if (!recipe || !recipe.is_prep) return 1;
    return 1000;
}

function rowBaseKey(row) {
    return normalized(row.name) + "|" + normalized(row.unit);
}

async function loadAll() {
    if (!isDbConfigured()) {
        setStatus("База данных не подключена.");
        return;
    }

    const [recRes, itemsRes, ingRes, pkgRes, convRes] = await Promise.all([
        db.from("recipes").select("*"),
        db.from("recipe_items").select("recipe_id, qty, unit, is_topup, topup_default_qty, ingredient_id, sub_recipe_id, ingredient:ingredients(name), sub_recipe:recipes!sub_recipe_id(name)"),
        db.from("ingredients").select("*"),
        db.from("ingredient_packages").select("*"),
        db.from("unit_conversions").select("*"),
    ]);

    for (const res of [recRes, itemsRes, ingRes, pkgRes, convRes]) {
        if (res.error) {
            setStatus("Ошибка загрузки: " + res.error.message);
            return;
        }
    }

    state.recipes = (recRes.data || [])
        .filter((recipe) => !recipe.is_yield_helper)
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));
    state.recipesById = {};
    state.recipes.forEach((recipe) => { state.recipesById[recipe.id] = recipe; });

    state.itemsByRecipe = {};
    (itemsRes.data || []).forEach((row) => {
        const isSub = !!row.sub_recipe_id;
        const item = {
            name: isSub ? (row.sub_recipe ? row.sub_recipe.name : "") : (row.ingredient ? row.ingredient.name : ""),
            qty: row.qty,
            unit: row.unit,
            is_topup: row.is_topup,
            topup_default_qty: row.topup_default_qty,
            isSub,
            targetId: isSub ? row.sub_recipe_id : null,
            ingredientId: row.ingredient_id || null,
        };
        (state.itemsByRecipe[row.recipe_id] ||= []).push(item);
    });

    state.ingredientsByName = {};
    state.ingredientById = {};
    (ingRes.data || []).forEach((ingredient) => {
        state.ingredientsByName[normalized(ingredient.name)] = ingredient;
        state.ingredientById[ingredient.id] = ingredient;
    });

    state.packagesByIngredientId = {};
    (pkgRes.data || []).forEach((pkg) => {
        (state.packagesByIngredientId[pkg.ingredient_id] ||= []).push(pkg);
    });

    state.conversionsByIngredientId = {};
    (convRes.data || []).forEach((conv) => {
        (state.conversionsByIngredientId[conv.ingredient_id] ||= {})[normalized(conv.from_unit)] = conv.coefficient;
    });

    renderRecipePicker();
    const requestedId = new URLSearchParams(location.search).get("recipe");
    selectRecipe(requestedId && state.recipesById[requestedId] ? requestedId : (state.recipes[0] && state.recipes[0].id));
}

function recipeSearchText(recipe) {
    return [recipe.name, recipe.subtype, recipeKind(recipe)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
}

function renderRecipePicker() {
    const needle = normalized(state.recipeSearch);
    const selected = state.recipesById[state.selectedId];
    els.recipePickerBtn.querySelector("span").textContent = selected ? selected.name : "выберите рецепт";
    renderRecipePickerControls();
    els.recipePickerList.innerHTML = "";

    const visible = state.recipes
        .filter((recipe) => !needle || recipeSearchText(recipe).includes(needle))
        .filter((recipe) => state.recipeFilter === "all" || recipeBucket(recipe) === state.recipeFilter)
        .filter((recipe) => state.recipeSpirit === "all" || normalized(recipe.main_spirit) === state.recipeSpirit)
        .filter((recipe) => !state.excludeComplexPrep || !recipeUsesComplexPrep(recipe))
        .sort((a, b) => {
            if (state.recipeSort === "kind") {
                const kindCompare = recipeKind(a).localeCompare(recipeKind(b), "ru");
                if (kindCompare) return kindCompare;
            }
            if (state.recipeSort === "yield") {
                const prepCompare = Number(b.is_prep) - Number(a.is_prep);
                if (prepCompare) return prepCompare;
            }
            return a.name.localeCompare(b.name, "ru");
        })
        .slice(0, 80);

    if (visible.length === 0) {
        const empty = document.createElement("div");
        empty.className = "bc-calc-picker-empty";
        empty.textContent = "ничего не найдено";
        els.recipePickerList.appendChild(empty);
        return;
    }

    visible.forEach((recipe) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "bc-calc-picker-option" + (recipe.id === state.selectedId ? " active" : "");
        btn.setAttribute("role", "option");
        btn.setAttribute("aria-selected", recipe.id === state.selectedId ? "true" : "false");
        const name = document.createElement("span");
        const kind = document.createElement("small");
        name.textContent = recipe.name;
        kind.textContent = recipeKind(recipe);
        btn.appendChild(name);
        btn.appendChild(kind);
        btn.onclick = () => {
            closeRecipePicker();
            selectRecipe(recipe.id);
        };
        els.recipePickerList.appendChild(btn);
    });
}

function renderRecipePickerControls() {
    const sorts = [
        ["name", "а-я"],
        ["kind", "по типу"],
        ["yield", "заготовки выше"],
    ];

    const selectedSpirit = els.recipePickerSpirit.value || state.recipeSpirit;
    const spirits = [...new Set(state.recipes.map((recipe) => recipe.main_spirit).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "ru"));
    els.recipePickerSpirit.innerHTML = "";
    const allSpirit = document.createElement("option");
    allSpirit.value = "all";
    allSpirit.textContent = "любой алкоголь";
    els.recipePickerSpirit.appendChild(allSpirit);
    spirits.forEach((spirit) => {
        const option = document.createElement("option");
        option.value = normalized(spirit);
        option.textContent = spirit;
        els.recipePickerSpirit.appendChild(option);
    });
    els.recipePickerSpirit.value = [...els.recipePickerSpirit.options].some((option) => option.value === selectedSpirit)
        ? selectedSpirit
        : "all";
    spiritSelectUI.refresh();

    els.recipePickerFilters.value = state.recipeFilter;
    filterSelectUI.refresh();

    els.recipePickerSorts.innerHTML = "";
    sorts.forEach(([value, label]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.className = state.recipeSort === value ? "active" : "";
        btn.onclick = () => {
            state.recipeSort = value;
            renderRecipePicker();
        };
        els.recipePickerSorts.appendChild(btn);
    });
}

function openRecipePicker() {
    els.recipePickerPopup.classList.remove("hidden");
    els.recipePickerBtn.setAttribute("aria-expanded", "true");
    els.recipeSearchInput.focus();
    els.recipeSearchInput.select();
}

function closeRecipePicker() {
    els.recipePickerPopup.classList.add("hidden");
    els.recipePickerBtn.setAttribute("aria-expanded", "false");
}

function setRecipeTarget(recipe, value, unit) {
    state.selectedId = recipe.id;
    state.expandedPreps.clear();
    state.targetUnit = unit || defaultTargetUnit(recipe);
    state.targetValue = Number(value) > 0 ? Number(value) : defaultTargetValue(recipe);
    els.targetInput.value = formatNum(state.targetValue);
    els.targetUnitLabel.textContent = selectToUnit(state.targetUnit);
    renderRecipePicker();
    renderPresets();
    calculate();
}

function selectRecipe(id) {
    if (!id) return;
    const recipe = state.recipesById[id];
    if (!recipe) return;
    setRecipeTarget(recipe);
}

function renderPresets() {
    const recipe = state.recipesById[state.selectedId];
    els.presetBar.innerHTML = "";
    const presets = recipe && recipe.is_prep
        ? [100, 300, 500, 1000].map((value) => ({ label: `${value} ${selectToUnit(state.targetUnit)}`, value, unit: state.targetUnit }))
        : [1, 2, 3, 4, 5, 10].map((value) => ({ label: String(value), value, unit: "portion" }));

    presets.forEach((preset) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = preset.label;
        btn.className = state.targetValue === preset.value && state.targetUnit === preset.unit ? "active" : "";
        btn.onclick = () => {
            state.targetValue = preset.value;
            state.targetUnit = preset.unit;
            els.targetInput.value = formatNum(preset.value);
            els.targetUnitLabel.textContent = selectToUnit(preset.unit);
            renderPresets();
            calculate();
        };
        els.presetBar.appendChild(btn);
    });
}

function targetInRecipeUnit(recipe) {
    if (!recipe.is_prep) return state.targetValue;
    const unit = normalized(selectToUnit(state.targetUnit));
    if ((unit === "l" || unit === "л") && normalized(recipe.yield_unit) === "мл") return state.targetValue * 1000;
    if ((unit === "ml" || unit === "мл") && normalized(recipe.yield_unit) === "л") return state.targetValue / 1000;
    if ((unit === "kg" || unit === "кг") && normalized(recipe.yield_unit) === "г") return state.targetValue * 1000;
    if ((unit === "g" || unit === "г") && normalized(recipe.yield_unit) === "кг") return state.targetValue / 1000;
    return state.targetValue;
}

function amountInRecipeYieldUnit(value, unit, recipe) {
    const from = normalized(unit);
    const to = normalized(recipe.yield_unit);
    const amount = Number(value || 0);
    if ((from === "л" || from === "l") && to === "мл") return amount * 1000;
    if ((from === "мл" || from === "ml") && to === "л") return amount / 1000;
    if ((from === "кг" || from === "kg") && to === "г") return amount * 1000;
    if ((from === "г" || from === "g") && to === "кг") return amount / 1000;
    return amount;
}

function prepRequiredMap() {
    const prepMap = new Map();
    state.prepRows.forEach((row) => {
        const key = row.recipeId + "|" + normalized(row.unit);
        const existing = prepMap.get(key);
        if (existing) existing.qty += Number(row.qty || 0);
        else prepMap.set(key, { ...row, qty: Number(row.qty || 0) });
    });
    return [...prepMap.values()];
}

function itemToCalcRow(item, multiplier, sourceKey) {
    const isSub = item.isSub && item.targetId;
    const subRecipe = isSub ? state.recipesById[item.targetId] : null;
    const qty = item.is_topup
        ? Number(item.topup_default_qty || 0) * multiplier
        : Number(item.qty || 0) * multiplier;
    const unit = item.is_topup ? "" : (item.unit || (subRecipe && subRecipe.yield_unit) || "");
    return {
        type: isSub ? "sub" : "ingredient",
        name: item.name,
        perOne: item.is_topup ? item.topup_default_qty : item.qty,
        qty,
        unit,
        isTopup: item.is_topup,
        recipeId: isSub ? item.targetId : null,
        ingredientId: item.ingredientId || null,
        key: sourceKey,
    };
}

function recipeMultiplier(recipe) {
    if (!recipe) return 0;
    if (!recipe.is_prep) return state.targetValue;
    if (!recipe.yield_qty) return 0;
    return targetInRecipeUnit(recipe) / Number(recipe.yield_qty);
}

function pushIngredient(acc, source) {
    const key = rowBaseKey(source);
    const existing = acc.get(key);
    if (existing) {
        existing.qty += source.qty || 0;
        existing.sources.push(...source.sources);
    } else {
        acc.set(key, { ...source, sources: [...source.sources] });
    }
}

function expandRecipe(recipeId, multiplier, path = new Set(), sourceName = null) {
    const rows = [];
    const recipe = state.recipesById[recipeId];
    if (!recipe || path.has(recipeId)) return rows;

    const nextPath = new Set(path);
    nextPath.add(recipeId);

    (state.itemsByRecipe[recipeId] || []).forEach((item) => {
        const qty = item.is_topup
            ? Number(item.topup_default_qty || 0) * multiplier
            : Number(item.qty || 0) * multiplier;

        if (item.isSub && item.targetId) {
            const subRecipe = state.recipesById[item.targetId];
            const unit = item.unit || (subRecipe && subRecipe.yield_unit) || "";
            rows.push({
                type: "sub",
                name: item.name,
                perOne: item.is_topup ? item.topup_default_qty : item.qty,
                qty,
                unit,
                recipeId: item.targetId,
                sources: [sourceName || recipe.name],
            });

            if (subRecipe && subRecipe.yield_qty) {
                const qtyInSubYieldUnit = amountInRecipeYieldUnit(qty, unit, subRecipe);
                rows.push(...expandRecipe(item.targetId, qtyInSubYieldUnit / Number(subRecipe.yield_qty), nextPath, item.name));
            }
        } else {
            rows.push({
                type: "ingredient",
                name: item.name,
                perOne: item.is_topup ? item.topup_default_qty : item.qty,
                qty,
                unit: item.is_topup ? "" : item.unit,
                isTopup: item.is_topup,
                ingredientId: item.ingredientId,
                sources: [sourceName || recipe.name],
            });
        }
    });

    return rows;
}

function baseQtyForCost(row) {
    const ingredient = row.ingredientId
        ? Object.values(state.ingredientsByName).find((item) => item.id === row.ingredientId)
        : state.ingredientsByName[normalized(row.name)];
    if (!ingredient) return { ingredient: null, qty: row.qty, unit: row.unit, conversionMissing: true };

    const rowUnit = normalized(row.unit);
    const baseUnit = normalized(ingredient.base_unit);
    if (!rowUnit || rowUnit === baseUnit) {
        return { ingredient, qty: row.qty, unit: ingredient.base_unit, conversionMissing: false };
    }

    const coeff = (state.conversionsByIngredientId[ingredient.id] || {})[rowUnit];
    if (coeff) return { ingredient, qty: row.qty * Number(coeff), unit: ingredient.base_unit, conversionMissing: false };

    return { ingredient, qty: row.qty, unit: row.unit, conversionMissing: true };
}

function rowCost(row) {
    const base = baseQtyForCost(row);
    if (!base.ingredient || base.conversionMissing || !base.qty) return { cost: null, missing: true };
    const packages = (state.packagesByIngredientId[base.ingredient.id] || [])
        .filter((pkg) => Number(pkg.package_size) > 0 && pkg.package_price !== null && pkg.package_price !== undefined);
    if (packages.length === 0) return { cost: null, missing: true };
    const cheapest = packages
        .map((pkg) => ({ ...pkg, unitCost: Number(pkg.package_price) / Number(pkg.package_size) }))
        .sort((a, b) => a.unitCost - b.unitCost)[0];
    return { cost: base.qty * cheapest.unitCost, missing: false };
}

function calculate() {
    const recipe = state.recipesById[state.selectedId];
    if (!recipe) return;

    const raw = num(els.targetInput.value);
    state.targetValue = raw > 0 ? raw : 0;
    els.targetUnitLabel.textContent = selectToUnit(state.targetUnit);
    const multiplier = recipeMultiplier(recipe);

    const sourceRows = multiplier > 0 ? expandRecipe(recipe.id, multiplier) : [];
    state.prepRows = sourceRows.filter((row) => row.type === "sub" && row.recipeId);
    const acc = new Map();
    sourceRows.forEach((row) => {
        if (row.type === "ingredient") pushIngredient(acc, row);
        else pushIngredient(acc, row);
    });

    state.rows = [...acc.values()].sort((a, b) => {
        if (a.type !== b.type) return a.type === "ingredient" ? -1 : 1;
        return a.name.localeCompare(b.name, "ru");
    });

    let totalCost = 0;
    let missingPrices = 0;
    state.rows.forEach((row) => {
        const costInfo = row.type === "ingredient" ? rowCost(row) : { cost: null, missing: true };
        row.cost = costInfo.cost;
        if (costInfo.cost !== null) totalCost += costInfo.cost;
        else missingPrices += 1;
    });

    state.totalCost = totalCost;
    state.missingPrices = missingPrices;

    renderRows();
    renderSummary(recipe, multiplier);
    renderPrepSummary();
    renderPresets();
}

// Для шкалы "доля" грамм приравнивается к миллилитру (плотность большинства баров
// ингредиентов близка к воде, а точная плотность нам всё равно не известна) — так
// объёмные и весовые позиции сравнимы на одной шкале. Штучные единицы (шт, шт/веточка
// и т.п.) сравнивать напрямую нельзя — для них берём перевод конкретного ингредиента
// из конвертера (unit_conversions); если перевода нет, шкала показывает "недоступно"
// со ссылкой на конвертер вместо обманчивого предположения.
function shareBasis(row) {
    if (row.isTopup) return { kind: "topup" };
    const unit = normalized(row.unit);
    if (unit === "мл" || unit === "ml") return { kind: "ml", qty: Number(row.qty || 0) };
    if (unit === "л" || unit === "l") return { kind: "ml", qty: Number(row.qty || 0) * 1000 };
    if (unit === "г" || unit === "g") return { kind: "g", qty: Number(row.qty || 0) };
    if (unit === "кг" || unit === "kg") return { kind: "g", qty: Number(row.qty || 0) * 1000 };

    const ingredient = row.ingredientId ? state.ingredientById[row.ingredientId] : null;
    if (ingredient) {
        const baseUnit = normalized(ingredient.base_unit);
        const coeff = (state.conversionsByIngredientId[ingredient.id] || {})[unit];
        if (coeff && (baseUnit === "г" || baseUnit === "мл" || baseUnit === "кг" || baseUnit === "л")) {
            let qty = Number(row.qty || 0) * Number(coeff);
            if (baseUnit === "кг" || baseUnit === "л") qty *= 1000;
            return { kind: (baseUnit === "г" || baseUnit === "кг") ? "g" : "ml", qty };
        }
    }
    return { kind: "unknown" };
}

// "Доля" — это буквально доля от суммы состава (сколько процентов от общего объёма
// занимает конкретный ингредиент), а не "насколько он велик по сравнению с самым
// большим" — поэтому 100%-й отметкой служит СУММА группы, а не максимум в ней.
// Считается отдельно по группам scaleGroup (см. collectTreeEntries) — иначе
// непересчитанный (без объёма выхода) "сырой" объём партии заготовки исказил бы
// общую сумму для всех остальных позиций.
function computeGroupTotals(rowEntries) {
    const map = new Map();
    rowEntries.forEach(({ row, scaleGroup }) => {
        const basis = shareBasis(row);
        if (basis.kind === "ml" || basis.kind === "g") {
            map.set(scaleGroup, (map.get(scaleGroup) || 0) + basis.qty);
        }
    });
    return map;
}

// Строит строки состава конкретной заготовки (без DOM) — переиспользуется и при
// сборе списка "что сейчас видно" (для общего максимума шкалы), и при самой отрисовке,
// чтобы не дублировать логику пересчёта количества дважды с риском разъехаться.
function buildTreeRows(recipeId, requiredQty, requiredUnit) {
    const recipe = state.recipesById[recipeId];
    if (!recipe) return { rows: [], hasYield: true, recipe: null };
    const items = state.itemsByRecipe[recipeId] || [];
    const hasYield = !!recipe.yield_qty;
    const factor = hasYield
        ? amountInRecipeYieldUnit(requiredQty, requiredUnit || recipe.yield_unit, recipe) / Number(recipe.yield_qty)
        : 1;
    const rows = items.map((item) => {
        const isSub = item.isSub && item.targetId;
        const subRecipe = isSub ? state.recipesById[item.targetId] : null;
        const unit = item.is_topup ? "" : (item.unit || (subRecipe && subRecipe.yield_unit) || "");
        const qty = item.is_topup
            ? Number(item.topup_default_qty || 0)
            : Number(item.qty || 0) * factor;
        return {
            type: isSub ? "sub" : "ingredient",
            name: item.name,
            perOne: item.is_topup ? item.topup_default_qty : item.qty,
            qty,
            unit,
            isTopup: item.is_topup,
            recipeId: isSub ? item.targetId : null,
            ingredientId: item.ingredientId || null,
        };
    });
    return { rows, hasYield, recipe };
}

// Плоский список всех сейчас видимых строк — корень плюс раскрытые вложенные заготовки
// (рекурсивно). Считается заранее и один раз, чтобы посчитать ОДИН общий максимум для
// шкалы "доля": если считать максимум отдельно на каждом уровне вложенности, маленькая
// заготовка внутри рецепта выглядела бы такой же "полной", как самый большой ингредиент
// коктейля, хотя по факту её объём в составе значительно меньше.
function collectVisibleEntries() {
    const entries = [];
    const recipe = state.recipesById[state.selectedId];
    if (!recipe) return entries;
    const multiplier = recipeMultiplier(recipe);
    const directItems = state.itemsByRecipe[recipe.id] || [];
    const directRows = directItems.map((item, index) => itemToCalcRow(
        item,
        multiplier,
        `root:${index}:${item.targetId || item.name}:${normalized(item.unit)}`
    ));
    directRows.forEach((row) => {
        entries.push({ kind: "row", row, level: 0, key: row.key, scaleGroup: "global" });
        if (row.type === "sub" && row.recipeId && state.expandedPreps.has(row.key)) {
            collectTreeEntries(row.recipeId, row.qty, row.unit, 1, row.key, entries, "global");
        }
    });
    return entries;
}

function collectTreeEntries(recipeId, requiredQty, requiredUnit, level, path, entries, scaleGroup) {
    if (level > 12) return;
    const { rows, hasYield, recipe } = buildTreeRows(recipeId, requiredQty, requiredUnit);
    if (rows.length === 0) return;
    // Как только заготовка без объёма выхода встретилась один раз, весь её состав
    // (и всё, что вложено глубже) сравниваем только друг с другом — их количества
    // посчитаны "как в рецепте на партию", а не в масштабе текущего блюда, и мешать
    // их с остальной, правильно пересчитанной, шкалой нельзя.
    const childScaleGroup = hasYield ? scaleGroup : "unscaled:" + path;
    if (!hasYield) entries.push({ kind: "note", level, recipeId, recipeName: recipe.name });
    rows.forEach((row, index) => {
        const key = `${path}>${index}:${row.recipeId || row.name}:${normalized(row.unit)}`;
        entries.push({ kind: "row", row, level, key, scaleGroup: childScaleGroup });
        if (row.type === "sub" && state.expandedPreps.has(key)) {
            collectTreeEntries(row.recipeId, row.qty, row.unit, level + 1, key, entries, childScaleGroup);
        }
    });
}

function renderTreeNote({ level, recipeId, recipeName }) {
    const note = document.createElement("div");
    note.className = "bc-calc-tree-note";
    note.style.setProperty("--level", String(level));
    note.append("в рецепте «" + recipeName + "» не указан ");
    const link = document.createElement("a");
    link.className = "bc-calc-tree-note-link";
    link.href = "recipes-v2.html?edit=" + encodeURIComponent(recipeId);
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "объём выхода";
    note.appendChild(link);
    note.append(" — состав показан без пересчёта под нужное количество");
    els.rows.appendChild(note);
}

function renderRows() {
    els.rows.innerHTML = "";
    const entries = collectVisibleEntries();
    const rowEntries = entries.filter((entry) => entry.kind === "row");

    if (rowEntries.length === 0) {
        const empty = document.createElement("div");
        empty.className = "bc-calc-empty";
        empty.textContent = "Нет состава для расчета.";
        els.rows.appendChild(empty);
        return;
    }

    const totalsByGroup = computeGroupTotals(rowEntries);
    entries.forEach((entry) => {
        if (entry.kind === "note") {
            renderTreeNote(entry);
        } else {
            const groupTotal = totalsByGroup.get(entry.scaleGroup) || 1;
            renderCalcRow(entry.row, { groupTotal, level: entry.level, key: entry.key });
        }
    });
}

// Есть ли где-то во вложенном составе заготовка без объёма выхода — проверяем заранее,
// не дожидаясь раскрытия строки, иначе на телефоне (где предупреждение видно только
// внутри развёрнутого дерева) пользователь мог вообще не узнать о проблеме.
function subtreeHasMissingYield(recipeId, seen = new Set()) {
    if (!recipeId || seen.has(recipeId)) return false;
    seen.add(recipeId);
    const recipe = state.recipesById[recipeId];
    if (!recipe) return false;
    if (!recipe.yield_qty) return true;
    return (state.itemsByRecipe[recipeId] || []).some((item) => item.isSub && item.targetId && subtreeHasMissingYield(item.targetId, seen));
}

function renderCalcRow(row, options) {
    const item = document.createElement("div");
    item.className = "bc-calc-row" + (row.type === "sub" ? " is-sub" : "");
    if (row.isTopup) item.classList.add("is-topup");
    if (options.level > 0) item.classList.add("is-tree");
    item.style.setProperty("--level", String(options.level || 0));

    const canExpand = row.type === "sub" && row.recipeId && (state.itemsByRecipe[row.recipeId] || []).length > 0;
    const name = canExpand ? document.createElement("button") : document.createElement("span");
    name.className = "bc-calc-row-name";
    if (canExpand) {
        name.type = "button";
        name.classList.add("has-tree");
        name.textContent = `${state.expandedPreps.has(options.key) ? "−" : "+"} ${row.name}`;
        if (subtreeHasMissingYield(row.recipeId)) {
            const warn = document.createElement("span");
            warn.className = "bc-calc-yield-warn";
            warn.title = "в составе есть заготовка без указанного объёма выхода — раскройте, чтобы посмотреть";
            warn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3.5 22 20.5H2Z" stroke-linejoin="round"/><path d="M12 9.5v5.2M12 17.8v.2"/></svg>';
            name.appendChild(warn);
        }
        name.onclick = () => {
            if (state.expandedPreps.has(options.key)) state.expandedPreps.delete(options.key);
            else state.expandedPreps.add(options.key);
            renderRows();
        };
    } else {
        name.textContent = row.name;
    }

    const perOne = document.createElement("span");
    perOne.className = "bc-calc-row-base";
    perOne.textContent = row.perOne ? displayQty(row.perOne, row.unit) : "-";

    const target = document.createElement("span");
    target.className = "bc-calc-row-target";
    target.textContent = row.isTopup ? "топом" : displayQty(row.qty, row.unit);

    const shareCell = document.createElement("div");
    shareCell.className = "bc-calc-share-cell";
    const basis = shareBasis(row);
    const share = document.createElement("span");
    share.className = "bc-calc-share kind-" + basis.kind;
    const bar = document.createElement("i");
    if (basis.kind === "topup") {
        bar.style.width = "28%";
    } else if (basis.kind === "unknown") {
        bar.style.width = "100%";
    } else {
        const groupTotal = options.groupTotal || 1;
        bar.style.width = Math.max(5, Math.min(100, (basis.qty / groupTotal) * 100)) + "%";
    }
    share.appendChild(bar);
    shareCell.appendChild(share);

    if (basis.kind === "unknown") {
        const link = document.createElement("a");
        link.className = "bc-calc-share-link";
        link.href = "converter-v2.html?ingredient=" + encodeURIComponent(row.name) + "&unit=" + encodeURIComponent(row.unit || "");
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "нет перевода в мл/г — задать →";
        shareCell.appendChild(link);
    }

    item.appendChild(name);
    item.appendChild(perOne);
    item.appendChild(target);
    item.appendChild(shareCell);
    els.rows.appendChild(item);
}

function collectTreeKeys(recipeId, requiredQty, requiredUnit, level, path, targetSet) {
    if (level > 12) return;
    const recipe = state.recipesById[recipeId];
    if (!recipe) return;
    const factor = recipe.yield_qty
        ? amountInRecipeYieldUnit(requiredQty, requiredUnit || recipe.yield_unit, recipe) / Number(recipe.yield_qty)
        : 1;

    (state.itemsByRecipe[recipeId] || []).forEach((item, index) => {
        if (!item.isSub || !item.targetId) return;
        const subRecipe = state.recipesById[item.targetId];
        const unit = item.unit || (subRecipe && subRecipe.yield_unit) || "";
        const qty = Number(item.qty || 0) * factor;
        const key = `${path}>${index}:${item.targetId}:${normalized(unit)}`;
        targetSet.add(key);
        collectTreeKeys(item.targetId, qty, unit, level + 1, key, targetSet);
    });
}

function expandAllPreps() {
    const recipe = state.recipesById[state.selectedId];
    if (!recipe) return;
    const multiplier = recipeMultiplier(recipe);
    const next = new Set();
    (state.itemsByRecipe[recipe.id] || []).forEach((item, index) => {
        if (!item.isSub || !item.targetId) return;
        const subRecipe = state.recipesById[item.targetId];
        const unit = item.unit || (subRecipe && subRecipe.yield_unit) || "";
        const qty = Number(item.qty || 0) * multiplier;
        const key = `root:${index}:${item.targetId}:${normalized(item.unit)}`;
        next.add(key);
        collectTreeKeys(item.targetId, qty, unit, 1, key, next);
    });
    state.expandedPreps = next;
    renderRows();
}

function collapseAllPreps() {
    state.expandedPreps.clear();
    renderRows();
}

function renderPrepSummary() {
    els.prepSummary.innerHTML = "";
    const preps = prepRequiredMap();
    if (preps.length === 0) {
        els.prepSummary.classList.add("hidden");
        return;
    }

    els.prepSummary.classList.remove("hidden");
    const title = document.createElement("div");
    title.className = "bc-calc-prep-summary-title";
    title.textContent = "Заготовки";
    els.prepSummary.appendChild(title);

    preps.forEach((prep) => {
        const recipe = state.recipesById[prep.recipeId];
        if (!recipe) return;
        const row = document.createElement("button");
        row.type = "button";
        row.className = "bc-calc-prep-summary-row";
        row.onclick = () => {
            expandAllPreps();
        };
        const name = document.createElement("span");
        const qty = document.createElement("b");
        name.textContent = recipe.name;
        qty.textContent = displayQty(prep.qty, prep.unit || recipe.yield_unit);
        row.appendChild(name);
        row.appendChild(qty);
        els.prepSummary.appendChild(row);
    });
}

function summaryRow(label, value, strong = false, href = null) {
    const row = document.createElement("div");
    if (strong) row.className = "is-strong";
    const left = document.createElement("span");
    const right = href ? document.createElement("a") : document.createElement("b");
    left.textContent = label;
    right.textContent = value;
    if (href) right.href = href;
    row.appendChild(left);
    row.appendChild(right);
    els.summary.appendChild(row);
}

function renderSummary(recipe, multiplier) {
    els.summary.innerHTML = "";
    const targetLabel = recipe.is_prep
        ? displayQty(targetInRecipeUnit(recipe), recipe.yield_unit || state.targetUnit)
        : `${formatNum(state.targetValue)} порций`;
    const perUnit = state.totalCost && state.targetValue ? state.totalCost / state.targetValue : null;

    summaryRow("Выход", targetLabel);
    summaryRow(recipe.is_prep ? "Коэффициент" : "Порций", recipe.is_prep ? formatNum(multiplier) : formatNum(state.targetValue));
    summaryRow("Себестоимость", state.totalCost ? formatMoney(state.totalCost) : "нет цен", true);
    summaryRow(recipe.is_prep ? "Себестоимость / ед." : "Себестоимость / порцию", perUnit ? formatMoney(perUnit) : "-");
    summaryRow("Позиций без цены", state.missingPrices ? `${state.missingPrices} →` : "0", false, "ingredients-v2.html");
    if (recipe.is_prep && recipe.labor_minutes) {
        summaryRow("Время", `≈ ${formatNum(recipe.labor_minutes * (1 + 0.2 * (multiplier - 1)))} мин`);
    }

    els.editLink.href = "recipes-v2.html?edit=" + encodeURIComponent(recipe.id);
}

els.recipePickerBtn.onclick = () => {
    if (els.recipePickerPopup.classList.contains("hidden")) openRecipePicker();
    else closeRecipePicker();
};
els.recipePickerPopup.onclick = (event) => {
    event.stopPropagation();
};
function updateSearchClearVisibility() {
    els.recipeSearchClearBtn.classList.toggle("hidden", !els.recipeSearchInput.value);
}
els.recipeSearchInput.oninput = () => {
    state.recipeSearch = els.recipeSearchInput.value;
    updateSearchClearVisibility();
    renderRecipePicker();
};
els.recipeSearchClearBtn.onclick = () => {
    els.recipeSearchInput.value = "";
    state.recipeSearch = "";
    updateSearchClearVisibility();
    renderRecipePicker();
    els.recipeSearchInput.focus();
};
els.recipePickerSpirit.onchange = () => {
    state.recipeSpirit = els.recipePickerSpirit.value;
    renderRecipePicker();
};
els.recipePickerFilters.onchange = () => {
    state.recipeFilter = els.recipePickerFilters.value;
    renderRecipePicker();
};
// Элемент может отсутствовать, если у клиента закэширован старый HTML этой страницы
// без этого чекбокса (см. sw.js) — без этой проверки вся инициализация страницы ниже
// обрывалась бы на TypeError, и рецепты вообще переставали загружаться.
if (els.recipePickerComplexToggle) {
    els.recipePickerComplexToggle.onchange = () => {
        state.excludeComplexPrep = els.recipePickerComplexToggle.checked;
        renderRecipePicker();
    };
}
document.addEventListener("click", (event) => {
    if (!els.recipePicker.contains(event.target)) closeRecipePicker();
    document.querySelectorAll(".bc-picker-filter.open").forEach((el) => {
        if (!el.contains(event.target)) el.classList.remove("open");
    });
});
els.recipePickerCloseBtn.onclick = closeRecipePicker;
els.recipeSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeRecipePicker();
        els.recipePickerBtn.focus();
    }
});
els.targetInput.oninput = calculate;
els.expandAllBtn.onclick = expandAllPreps;
els.collapseAllBtn.onclick = collapseAllPreps;
els.copyBtn.onclick = async () => {
    const text = state.rows.map((row) => `${row.name}\t${displayQty(row.qty, row.unit)}`).join("\n");
    try {
        await navigator.clipboard.writeText(text);
        setStatus("Список скопирован в буфер.");
    } catch {
        setStatus("Не удалось скопировать список.");
    }
};

// Панель выбора рецепта/цели сжимается при прокрутке списка ингредиентов, чтобы не
// занимать весь экран на телефоне, но остаётся доступной (sticky), а не пропадает.
// Тап или наведение курсором временно возвращают её в полный размер.
if (els.sticky && els.workspace) {
    // rAF-throttling + гистерезис (разные пороги входа/выхода) убирают дёрганье
    // от частых scroll-событий и переключения класса туда-обратно на границе.
    let compactRaf = null;
    let isCompact = false;
    const updateCompact = () => {
        compactRaf = null;
        const scrolled = Math.max(els.workspace.scrollTop, window.scrollY || document.documentElement.scrollTop || 0);
        els.sticky.classList.remove("expanded");
        if (!isCompact && scrolled > 40) isCompact = true;
        else if (isCompact && scrolled < 16) isCompact = false;
        els.sticky.classList.toggle("compact", isCompact);
    };
    const scheduleUpdateCompact = () => {
        if (compactRaf === null) compactRaf = requestAnimationFrame(updateCompact);
    };
    els.workspace.addEventListener("scroll", scheduleUpdateCompact, { passive: true });
    window.addEventListener("scroll", scheduleUpdateCompact, { passive: true });

    // Пока панель сжата, первый тап по ней (в т.ч. по кнопке выбора рецепта) только
    // разворачивает её обратно, не выполняя само действие — иначе с телефона было бы
    // невозможно просто увеличить панель, не открыв при этом список рецептов.
    els.sticky.addEventListener("click", (event) => {
        if (!els.sticky.classList.contains("compact") || els.sticky.classList.contains("expanded")) return;
        event.preventDefault();
        event.stopPropagation();
        els.sticky.classList.add("expanded");
    }, true);
}

loadAll();

const statusEl = document.getElementById("status");
const recipeGrid = document.getElementById("recipeGrid");
const searchInput = document.getElementById("searchInput");
const typeSegmented = document.getElementById("typeSegmented");
const filtersRow = document.getElementById("filtersRow");

const calcPanel = document.getElementById("calcPanel");
const calcRecipeName = document.getElementById("calcRecipeName");
const calcRecipeMeta = document.getElementById("calcRecipeMeta");
const calcInputLabel = document.getElementById("calcInputLabel");
const calcInputValue = document.getElementById("calcInputValue");
const calcExpandToggle = document.getElementById("calcExpandToggle");
const calcResult = document.getElementById("calcResult");

// ---- Кэши данных (тот же паттерн загрузки, что в recipes.js) ----
let recipesById = {};        // id -> запись рецепта
let itemsByRecipe = {};      // recipeId -> [{name, qty, unit, is_topup, topup_default_qty, isSub, targetId}]
let tagsByRecipe = {};
let tagMap = {};

let mode = "all";
let searchQuery = "";
let ingredientsFilter, typeFilter, tagsFilter;
let selectedRecipeId = null;

async function loadAll() {
    const [recRes, itemsRes, tagsRes, recipeTagsRes] = await Promise.all([
        db.from("recipes").select("*"),
        db.from("recipe_items").select("recipe_id, qty, unit, is_topup, topup_default_qty, ingredient_id, sub_recipe_id, ingredient:ingredients(name), sub_recipe:recipes!sub_recipe_id(name)"),
        db.from("tags").select("id,name"),
        db.from("recipe_tags").select("recipe_id, tag:tags(name)"),
    ]);

    for (const res of [recRes, itemsRes, tagsRes, recipeTagsRes]) {
        if (res.error) {
            showStatus(statusEl, "Ошибка загрузки: " + res.error.message, "error");
            return;
        }
    }

    recipesById = {};
    recRes.data.forEach((r) => { recipesById[r.id] = r; });

    itemsByRecipe = {};
    itemsRes.data.forEach((row) => {
        const isSub = !!row.sub_recipe_id;
        const entry = {
            name: isSub ? (row.sub_recipe ? row.sub_recipe.name : "") : (row.ingredient ? row.ingredient.name : ""),
            qty: row.qty,
            unit: row.unit,
            is_topup: row.is_topup,
            topup_default_qty: row.topup_default_qty,
            isSub,
            targetId: isSub ? row.sub_recipe_id : null,
        };
        (itemsByRecipe[row.recipe_id] ||= []).push(entry);
    });

    tagMap = {};
    tagsRes.data.forEach((t) => { tagMap[t.name] = t.id; });

    tagsByRecipe = {};
    recipeTagsRes.data.forEach((row) => {
        if (!row.tag) return;
        (tagsByRecipe[row.recipe_id] ||= []).push(row.tag.name);
    });

    refreshFilterOptions();
    applyFilters();
}

// ---- Фильтры / поиск (тот же паттерн, что в recipes.js) ----

function setupFilters() {
    ingredientsFilter = createMultiselect({ label: "Ингредиенты", onChange: applyFilters });
    typeFilter = createMultiselect({ label: "Тип", onChange: applyFilters });
    tagsFilter = createMultiselect({ label: "Тэги", onChange: applyFilters });
    filtersRow.appendChild(ingredientsFilter.el);
    filtersRow.appendChild(typeFilter.el);
    filtersRow.appendChild(tagsFilter.el);
}

function refreshFilterOptions() {
    const ingredientNames = new Set();
    Object.values(itemsByRecipe).forEach((items) => items.forEach((it) => { if (it.name) ingredientNames.add(it.name); }));
    ingredientsFilter.setOptions([...ingredientNames]);

    let typeOptions;
    if (mode === "cocktail") typeOptions = COCKTAIL_SUBTYPES;
    else if (mode === "prep") typeOptions = PREP_SUBTYPES;
    else typeOptions = [...COCKTAIL_SUBTYPES, ...PREP_SUBTYPES];
    typeFilter.setOptions(typeOptions);

    tagsFilter.setOptions(Object.keys(tagMap));
}

function applyFilters() {
    const ingSel = ingredientsFilter.getSelected();
    const typeSel = typeFilter.getSelected();
    const tagSel = tagsFilter.getSelected();

    const list = Object.values(recipesById).filter((r) => {
        // Заготовки-конвертеры (см. Конвертер -> "Выход продукта из сырья") сюда не выводим —
        // управляются на своей вкладке, здесь только рецепты для пересчёта техкарты.
        if (r.is_yield_helper) return false;
        if (mode === "cocktail" && r.is_prep) return false;
        if (mode === "prep" && !r.is_prep) return false;
        if (searchQuery && !r.name.toLowerCase().includes(searchQuery)) return false;
        if (typeSel.length > 0 && !typeSel.includes(r.subtype)) return false;
        if (tagSel.length > 0) {
            const rTags = tagsByRecipe[r.id] || [];
            if (!tagSel.some((t) => rTags.includes(t))) return false;
        }
        if (ingSel.length > 0) {
            const rItems = (itemsByRecipe[r.id] || []).map((it) => it.name);
            if (!ingSel.some((n) => rItems.includes(n))) return false;
        }
        return true;
    });

    list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    renderGrid(list);
}

function iconFor(r) {
    if (r.subtype && SUBTYPE_ICONS[r.subtype]) return SUBTYPE_ICONS[r.subtype];
    return r.is_prep ? "🧪" : "🍸";
}

function renderGrid(list) {
    recipeGrid.innerHTML = "";
    if (list.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "Ничего не найдено — попробуйте изменить фильтры.";
        recipeGrid.appendChild(empty);
        return;
    }
    list.forEach((r) => {
        const card = document.createElement("div");
        card.className = "recipe-card";
        if (r.id === selectedRecipeId) card.classList.add("selected");
        card.onclick = () => selectRecipe(r.id);

        const icon = document.createElement("div");
        icon.className = "icon";
        icon.textContent = iconFor(r);
        card.appendChild(icon);

        const name = document.createElement("div");
        name.className = "name";
        name.textContent = r.name;
        card.appendChild(name);

        if (r.main_spirit) {
            const spirit = document.createElement("div");
            spirit.className = "spirit";
            spirit.textContent = r.main_spirit;
            card.appendChild(spirit);
        }

        recipeGrid.appendChild(card);
    });
}

searchInput.oninput = () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    applyFilters();
};

typeSegmented.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
        mode = btn.dataset.mode;
        typeSegmented.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
        refreshFilterOptions();
        applyFilters();
    };
});

// ---- Выбор рецепта в калькулятор ----

function selectRecipe(id) {
    selectedRecipeId = id;
    const r = recipesById[id];
    if (!r) return;

    document.querySelectorAll(".recipe-card").forEach((c) => c.classList.remove("selected"));
    applyFilters();

    calcPanel.classList.remove("hidden");
    calcRecipeName.textContent = r.name;
    calcRecipeMeta.textContent = [r.subtype || (r.is_prep ? "Заготовка" : "Рецепт"), r.main_spirit].filter(Boolean).join(" · ");

    if (r.is_prep) {
        const yieldInfo = r.yield_qty ? ` (рецепт рассчитан на ${formatQty(r.yield_qty, r.yield_unit)})` : " (в рецепте не указан выход партии — пересчёт объёма недоступен)";
        calcInputLabel.textContent = "Целевой объём" + yieldInfo;
    } else {
        calcInputLabel.textContent = "Количество порций";
    }
    calcInputValue.value = r.is_prep ? "" : "1";
    calcResult.innerHTML = "";
}

function closeCalcPanel() {
    selectedRecipeId = null;
    calcPanel.classList.add("hidden");
    applyFilters();
}

document.getElementById("calcCloseBtn").onclick = closeCalcPanel;
calcPanel.addEventListener("click", (e) => { if (e.target === calcPanel) closeCalcPanel(); });

// ---- Расчёт ----

// Раскрывает одну строку-заготовку рекурсивно. neededQty/neededUnit — сколько этой заготовки нужно в данной ветке.
function expandSubRecipe(recipeId, neededQty, visitedIds) {
    const r = recipesById[recipeId];
    if (!r) return { yieldMissing: true, children: [] };
    if (visitedIds.has(recipeId)) return { yieldMissing: true, children: [], cyclic: true };

    if (!r.yield_qty) return { yieldMissing: true, children: [] };

    const k = neededQty / r.yield_qty;
    const laborMinutes = (r.labor_minutes !== null && r.labor_minutes !== undefined)
        ? r.labor_minutes * (1 + 0.2 * (k - 1))
        : null;

    const items = itemsByRecipe[recipeId] || [];
    const nextVisited = new Set(visitedIds);
    nextVisited.add(recipeId);

    const children = items.map((it) => buildRow(it, k, nextVisited, true));

    return { yieldMissing: false, coefficient: k, laborMinutes, children };
}

function buildRow(item, multiplier, visitedIds, expand) {
    if (item.isSub) {
        const scaledQty = item.qty !== null && item.qty !== undefined ? item.qty * multiplier : null;
        const row = { type: "sub", name: item.name, qty: scaledQty, unit: item.unit, targetId: item.targetId };
        if (expand) {
            Object.assign(row, { expanded: expandSubRecipe(item.targetId, scaledQty, visitedIds) });
        }
        return row;
    }
    if (item.is_topup) {
        const est = item.topup_default_qty !== null && item.topup_default_qty !== undefined ? item.topup_default_qty * multiplier : null;
        return { type: "ing", name: item.name, qty: est, unit: null, isTopup: true };
    }
    const scaledQty = item.qty !== null && item.qty !== undefined ? item.qty * multiplier : null;
    return { type: "ing", name: item.name, qty: scaledQty, unit: item.unit, isTopup: false };
}

function collectFlatIngredients(rows, acc) {
    rows.forEach((row) => {
        if (row.type === "ing") {
            const key = row.name + "|" + (row.unit || "");
            const prev = acc.get(key);
            if (prev) {
                prev.qty = (prev.qty || 0) + (row.qty || 0);
            } else {
                acc.set(key, { name: row.name, unit: row.unit, qty: row.qty || 0, isTopup: row.isTopup });
            }
        } else if (row.type === "sub" && row.expanded && !row.expanded.yieldMissing) {
            collectFlatIngredients(row.expanded.children, acc);
        }
    });
}

function renderRows(rows, container) {
    const ul = document.createElement("ul");
    ul.className = "composition-list calc-tree";
    rows.forEach((row) => {
        const li = document.createElement("li");
        li.classList.add("calc-row");
        const left = document.createElement("span");
        left.textContent = row.name;
        const right = document.createElement("span");
        if (row.type === "ing") {
            right.textContent = row.isTopup
                ? `≈ ${formatQty(row.qty)} (топом, оценка)`
                : formatQty(row.qty, row.unit);
        } else {
            right.textContent = formatQty(row.qty, row.unit);
        }
        li.appendChild(left);
        li.appendChild(right);
        ul.appendChild(li);

        if (row.type === "sub" && row.expanded) {
            if (row.expanded.yieldMissing) {
                const warn = document.createElement("div");
                warn.className = "calc-warning";
                warn.textContent = row.expanded.cyclic
                    ? "Обнаружена циклическая ссылка на заготовку — раскрытие остановлено."
                    : "У этой заготовки не указан выход партии — раскрыть состав нельзя.";
                ul.appendChild(warn);
            } else {
                if (row.expanded.laborMinutes !== null) {
                    const time = document.createElement("div");
                    time.className = "calc-time";
                    time.textContent = `≈ ${formatNum(row.expanded.laborMinutes)} мин на приготовление`;
                    ul.appendChild(time);
                }
                const nested = document.createElement("div");
                nested.className = "calc-nested";
                renderRows(row.expanded.children, nested);
                ul.appendChild(nested);
            }
        }
    });
    container.appendChild(ul);
}

function renderFlatTable(flatMap, container) {
    const title = document.createElement("h4");
    title.textContent = "Итого по сырью";
    container.appendChild(title);

    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    const table = document.createElement("table");
    table.innerHTML = "<thead><tr><th>Ингредиент</th><th>Кол-во</th><th>Ед.</th></tr></thead>";
    const tbody = document.createElement("tbody");

    [...flatMap.values()]
        .sort((a, b) => a.name.localeCompare(b.name, "ru"))
        .forEach((entry) => {
            const tr = document.createElement("tr");
            const tdName = document.createElement("td");
            tdName.textContent = entry.name;
            const tdQty = document.createElement("td");
            tdQty.textContent = entry.isTopup ? `≈ ${formatNum(entry.qty)}` : formatNum(entry.qty);
            const tdUnit = document.createElement("td");
            tdUnit.textContent = entry.isTopup ? "(топом, оценка)" : (entry.unit || "");
            tr.appendChild(tdName);
            tr.appendChild(tdQty);
            tr.appendChild(tdUnit);
            tbody.appendChild(tr);
        });

    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
}

document.getElementById("calcRunBtn").onclick = () => {
    const r = recipesById[selectedRecipeId];
    if (!r) return;

    const rawValue = Number(String(calcInputValue.value).replace(",", "."));
    if (!rawValue || rawValue <= 0) {
        calcResult.innerHTML = "";
        const warn = document.createElement("div");
        warn.className = "status error";
        warn.textContent = r.is_prep ? "Введите целевой объём больше нуля." : "Введите количество порций больше нуля.";
        calcResult.appendChild(warn);
        return;
    }

    const expand = calcExpandToggle.checked;
    let multiplier, topLaborMinutes = null, topWarning = null;

    if (r.is_prep) {
        if (!r.yield_qty) {
            topWarning = "У этой заготовки не указан выход партии — расчёт невозможен. Заполните «Выход партии» в карточке рецепта.";
        } else {
            multiplier = rawValue / r.yield_qty;
            if (r.labor_minutes !== null && r.labor_minutes !== undefined) {
                topLaborMinutes = r.labor_minutes * (1 + 0.2 * (multiplier - 1));
            }
        }
    } else {
        multiplier = rawValue;
    }

    calcResult.innerHTML = "";

    if (topWarning) {
        const warn = document.createElement("div");
        warn.className = "status error";
        warn.textContent = topWarning;
        calcResult.appendChild(warn);
        return;
    }

    if (topLaborMinutes !== null) {
        const time = document.createElement("div");
        time.className = "calc-time calc-time-top";
        time.textContent = `≈ ${formatNum(topLaborMinutes)} мин на приготовление`;
        calcResult.appendChild(time);
    }

    const visited = new Set([r.id]);
    const rows = (itemsByRecipe[r.id] || []).map((it) => buildRow(it, multiplier, visited, expand));

    if (rows.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "У этого рецепта пока не указан состав.";
        calcResult.appendChild(empty);
        return;
    }

    renderRows(rows, calcResult);

    if (expand) {
        const flatMap = new Map();
        collectFlatIngredients(rows, flatMap);
        renderFlatTable(flatMap, calcResult);
    }
};

// ---- Инициализация ----

async function init() {
    if (!isDbConfigured()) {
        showStatus(statusEl, "База данных не подключена", "error");
        return;
    }
    setupFilters();
    await loadAll();
    const recipeId = new URLSearchParams(window.location.search).get("recipe");
    if (recipeId && recipesById[recipeId]) selectRecipe(recipeId);
}

init();

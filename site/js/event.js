const statusEl = document.getElementById("status");

const eventId = new URLSearchParams(window.location.search).get("id");

let eventRow = null;
let recipesById = {};       // id -> запись рецепта
let itemsByRecipe = {};     // recipeId -> [{name, qty, unit, is_topup, topup_default_qty, isSub, targetId}]
let ingredientsByName = {}; // name -> { id, category, base_unit }
let packagesByIngredientId = {}; // ingredientId -> [{package_size, package_price, purchase_unit, purchase_link}]
let conversionsByIngredientId = {}; // ingredientId -> { from_unit -> coefficient }
let menuItems = [];         // [{recipe_id, qty_portions}]
let ingredientStateMap = {}; // ingredient_id -> is_checked
let prepStateMap = {};       // recipe_id -> { container_size, is_checked, expand_nested }
let tagsByRecipe = {};       // recipeId -> [tagName]
let tagMap = {};             // name -> id
let manualItems = [];        // [{id, name, qty, unit, category, cost, is_checked}] — ручные позиции списка покупок

let cocktailSearchQuery = "";
let pickerIngredientsFilter, pickerTypeFilter, pickerTagsFilter;

const recipeDetail = createRecipeDetailOverlay({
    getRecipe: (id) => recipesById[id],
    getItems: (id) => itemsByRecipe[id] || [],
    getTags: (id) => tagsByRecipe[id] || [],
});

function formatDate(d) {
    if (!d) return "без даты";
    const [y, m, day] = d.split("-");
    return `${day}.${m}.${y}`;
}

// ---- Загрузка ----

async function loadAll() {
    const [evRes, recRes, itemsRes, ingRes, pkgRes, convRes, menuRes, ingStateRes, prepStateRes, tagsRes, recipeTagsRes, manualRes] = await Promise.all([
        db.from("events").select("*").eq("id", eventId).single(),
        db.from("recipes").select("*"),
        db.from("recipe_items").select("recipe_id, qty, unit, is_topup, topup_default_qty, ingredient_id, sub_recipe_id, ingredient:ingredients(name), sub_recipe:recipes!sub_recipe_id(name)"),
        db.from("ingredients").select("id,name,category,base_unit"),
        db.from("ingredient_packages").select("ingredient_id,package_size,package_price,purchase_unit,purchase_source,purchase_link"),
        db.from("unit_conversions").select("ingredient_id,from_unit,coefficient"),
        db.from("event_menu_items").select("recipe_id, qty_portions").eq("event_id", eventId).eq("included", true),
        db.from("event_ingredient_state").select("ingredient_id, is_checked").eq("event_id", eventId),
        db.from("event_prep_state").select("recipe_id, container_size, is_checked, expand_nested, buy_ready").eq("event_id", eventId),
        db.from("tags").select("id,name"),
        db.from("recipe_tags").select("recipe_id, tag:tags(name)"),
        db.from("event_manual_items").select("*").eq("event_id", eventId),
    ]);

    for (const res of [evRes, recRes, itemsRes, ingRes, pkgRes, convRes, menuRes, ingStateRes, prepStateRes, tagsRes, recipeTagsRes]) {
        if (res.error) {
            showStatus(statusEl, "Ошибка загрузки: " + res.error.message, "error");
            return false;
        }
    }
    // Таблица ручных позиций может быть ещё не создана (новая, накатывается отдельной
    // миграцией) — не блокируем весь расчёт мероприятия из-за этого, просто считаем список пустым.
    manualItems = manualRes.error ? [] : manualRes.data;

    eventRow = evRes.data;

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

    ingredientsByName = {};
    ingRes.data.forEach((i) => { ingredientsByName[i.name] = i; });

    packagesByIngredientId = {};
    pkgRes.data.forEach((p) => { (packagesByIngredientId[p.ingredient_id] ||= []).push(p); });

    conversionsByIngredientId = {};
    convRes.data.forEach((c) => { (conversionsByIngredientId[c.ingredient_id] ||= {})[c.from_unit] = c.coefficient; });

    menuItems = menuRes.data;

    ingredientStateMap = {};
    ingStateRes.data.forEach((s) => { ingredientStateMap[s.ingredient_id] = s.is_checked; });

    prepStateMap = {};
    prepStateRes.data.forEach((s) => { prepStateMap[s.recipe_id] = s; });

    tagMap = {};
    tagsRes.data.forEach((t) => { tagMap[t.name] = t.id; });

    tagsByRecipe = {};
    recipeTagsRes.data.forEach((row) => {
        if (!row.tag) return;
        (tagsByRecipe[row.recipe_id] ||= []).push(row.tag.name);
    });

    return true;
}

function renderHeader() {
    document.getElementById("eventName").textContent = eventRow.name;
    const parts = [formatDate(eventRow.event_date)];
    if (eventRow.guests_count) parts.push(`${eventRow.guests_count} гостей`);
    if (eventRow.plan_budget) parts.push(`бюджет ${formatMoney(eventRow.plan_budget)}`);
    if (eventRow.comment) parts.push(eventRow.comment);
    document.getElementById("eventMeta").textContent = parts.join(" · ");
}

// ---- Вкладки ----

document.getElementById("tabSegmented").querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
        document.getElementById("tabSegmented").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
        document.querySelectorAll(".event-tabpanel").forEach((s) => s.classList.add("hidden"));
        const map = { calc: "tabCalc", issues: "tabIssues", shopping: "tabShopping", preps: "tabPreps", menu: "tabMenu" };
        document.getElementById(map[btn.dataset.tab]).classList.remove("hidden");
        if (btn.dataset.tab === "calc") renderCalcSummary();
        if (btn.dataset.tab === "issues") renderIssues();
        if (btn.dataset.tab === "shopping") renderShopping();
        if (btn.dataset.tab === "preps") renderPreps();
    };
});

// ---- Вкладка "Калькулятор мероприятия": выбор барной карты ----

const cocktailResults = document.getElementById("cocktailResults");
const menuItemsList = document.getElementById("menuItemsList");

function setupPickerFilters() {
    pickerIngredientsFilter = createMultiselect({ label: "Ингредиенты", onChange: renderCocktailResults });
    pickerTypeFilter = createMultiselect({ label: "Тип", onChange: renderCocktailResults });
    pickerTagsFilter = createMultiselect({ label: "Тэги", onChange: renderCocktailResults });
    const filtersRow = document.getElementById("filtersRow");
    filtersRow.appendChild(pickerIngredientsFilter.el);
    filtersRow.appendChild(pickerTypeFilter.el);
    filtersRow.appendChild(pickerTagsFilter.el);
}

function refreshPickerFilterOptions() {
    const ingredientNames = new Set();
    Object.values(itemsByRecipe).forEach((items) => items.forEach((it) => { if (it.name) ingredientNames.add(it.name); }));
    pickerIngredientsFilter.setOptions([...ingredientNames]);
    pickerTypeFilter.setOptions([...COCKTAIL_SUBTYPES, ...GUEST_SERVABLE_PREP_SUBTYPES]);
    pickerTagsFilter.setOptions(Object.keys(tagMap));
}

function renderCocktailResults() {
    cocktailResults.innerHTML = "";
    const chosenIds = new Set(menuItems.map((m) => m.recipe_id));
    const ingSel = pickerIngredientsFilter.getSelected();
    const typeSel = pickerTypeFilter.getSelected();
    const tagSel = pickerTagsFilter.getSelected();

    const matches = Object.values(recipesById)
        .filter((r) => {
            if (chosenIds.has(r.id)) return false;
            if (r.is_prep && !GUEST_SERVABLE_PREP_SUBTYPES.includes(r.subtype)) return false;
            if (cocktailSearchQuery && !r.name.toLowerCase().includes(cocktailSearchQuery)) return false;
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
        })
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));

    matches.forEach((r) => {
        const row = document.createElement("div");
        row.className = "picker-row-item";
        row.onclick = () => addMenuItem(r.id);

        const name = document.createElement("span");
        name.textContent = r.name;
        row.appendChild(name);

        const hint = document.createElement("span");
        hint.className = "add-hint";
        hint.textContent = "+ добавить";
        row.appendChild(hint);

        cocktailResults.appendChild(row);
    });

    if (matches.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = cocktailSearchQuery ? "Ничего не найдено." : "Все коктейли уже в барной карте.";
        cocktailResults.appendChild(empty);
    }
}

document.getElementById("cocktailSearch").oninput = (e) => {
    cocktailSearchQuery = e.target.value.trim().toLowerCase();
    renderCocktailResults();
};

async function addMenuItem(recipeId) {
    const recipe = recipesById[recipeId];
    const defaultQty = (recipe && recipe.is_prep && recipe.yield_qty) ? recipe.yield_qty : 1;
    const { error } = await db.from("event_menu_items").insert({ event_id: eventId, recipe_id: recipeId, included: true, qty_portions: defaultQty });
    if (error) { showStatus(statusEl, "Не получилось добавить: " + error.message, "error"); return; }
    menuItems.push({ recipe_id: recipeId, qty_portions: defaultQty });
    document.getElementById("cocktailSearch").value = "";
    cocktailSearchQuery = "";
    renderCocktailResults();
    renderMenuItems();
    renderCalcSummary();
}

async function removeMenuItem(recipeId) {
    await db.from("event_menu_items").delete().eq("event_id", eventId).eq("recipe_id", recipeId);
    menuItems = menuItems.filter((m) => m.recipe_id !== recipeId);
    renderCocktailResults();
    renderMenuItems();
    renderCalcSummary();
}

async function updateMenuItemQty(recipeId, qty) {
    await db.from("event_menu_items").update({ qty_portions: qty }).eq("event_id", eventId).eq("recipe_id", recipeId);
    const m = menuItems.find((mi) => mi.recipe_id === recipeId);
    if (m) m.qty_portions = qty;
    renderCalcSummary();
}

function renderMenuItems() {
    document.getElementById("menuItemsCount").textContent = menuItems.length;
    menuItemsList.innerHTML = "";
    if (menuItems.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "Пока ни один коктейль не выбран.";
        menuItemsList.appendChild(empty);
        return;
    }
    menuItems
        .slice()
        .sort((a, b) => (recipesById[a.recipe_id]?.name || "").localeCompare(recipesById[b.recipe_id]?.name || "", "ru"))
        .forEach((m) => {
            const r = recipesById[m.recipe_id];
            if (!r) return;
            const row = document.createElement("div");
            row.className = "menu-item-row";

            const name = document.createElement("div");
            name.className = "mi-name";
            name.textContent = r.name;
            name.style.cursor = "pointer";
            name.title = "Открыть карточку рецепта";
            name.onclick = () => recipeDetail.open(r.id);
            row.appendChild(name);

            const label = document.createElement("span");
            label.className = "field-hint mi-qty-label";
            if (r.is_prep) {
                label.title = "Не пересчитывается автоматически от количества гостей — впишите итоговый нужный объём на всё мероприятие.";
                label.textContent = `нужно (${r.yield_unit || "ед."}) всего:`;
            } else {
                label.title = "Не пересчитывается автоматически от количества гостей — впишите итоговое число порций на всё мероприятие.";
                label.textContent = "порций всего:";
            }
            row.appendChild(label);

            const qtyInput = document.createElement("input");
            qtyInput.type = "text";
            qtyInput.inputMode = "decimal";
            qtyInput.value = m.qty_portions;
            qtyInput.onchange = () => {
                const v = Number(String(qtyInput.value).replace(",", "."));
                if (!v || v <= 0) { qtyInput.value = m.qty_portions; return; }
                updateMenuItemQty(m.recipe_id, v);
            };
            row.appendChild(qtyInput);

            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.className = "danger";
            delBtn.textContent = "Убрать";
            delBtn.onclick = () => removeMenuItem(m.recipe_id);
            row.appendChild(delBtn);

            menuItemsList.appendChild(row);
        });
}

// ---- Сводный расчёт (вкладка "Калькулятор мероприятия") ----

function getEventTotals() {
    return computeEventTotals(menuItems, recipesById, itemsByRecipe, prepStateMap, ingredientsByName, conversionsByIngredientId);
}

// Строка "нет коэффициента для этой единицы рецепта" со ссылкой в Конвертер, где уже
// подставлены ингредиент и единица — тот же паттерн, что и для yieldMissing у заготовок.
function conversionWarning(entry) {
    const div = document.createElement("div");
    div.className = "package-line-warn";
    div.style.fontSize = "12px";
    div.style.fontWeight = "normal";
    const text = document.createElement("span");
    text.textContent = `Нет коэффициента для «${entry.unit}» — `;
    div.appendChild(text);
    const link = document.createElement("a");
    link.href = "converter.html?ingredient=" + encodeURIComponent(entry.name) + "&unit=" + encodeURIComponent(entry.unit || "");
    link.target = "_blank";
    link.textContent = "задать в Конвертере";
    div.appendChild(link);
    return div;
}

// ---- Вкладка "Ошибки": всё, что мешает точно посчитать закупку/приготовление, в одном месте ----
// Раньше эти же проблемы были разбросаны как мелкие предупреждения внутри разных вкладок
// (сводный расчёт / список покупок / список заготовок) — их легко было пропустить.

function computeIssues() {
    if (menuItems.length === 0) return [];
    const { ingredientTotals, prepTotals } = getEventTotals();
    const { lines } = computeBudget(ingredientTotals, ingredientsByName, packagesByIngredientId);
    const issues = [];

    lines.forEach((entry) => {
        if (entry.isTopup) return;
        if (entry.conversionMissing) {
            issues.push({
                text: `«${entry.name}»: нет коэффициента конвертации для единицы «${entry.unit}»`,
                fixHref: "converter.html?ingredient=" + encodeURIComponent(entry.name) + "&unit=" + encodeURIComponent(entry.unit || ""),
                fixLabel: "Задать в Конвертере",
            });
            return;
        }
        if (entry.isBoughtPrep) {
            if (entry.cost === null || entry.cost === undefined) {
                issues.push({
                    text: `«${entry.name}» (покупное): не указана закупочная упаковка или цена`,
                    fixHref: "recipes.html?edit=" + encodeURIComponent(entry.recipeId),
                    fixLabel: "Заполнить в Рецептах",
                });
            }
            return;
        }
        const ing = ingredientsByName[entry.name];
        if (!ing) {
            issues.push({ text: `«${entry.name}»: используется в рецепте, но отсутствует в Номенклатуре`, fixHref: "ingredients.html", fixLabel: "Открыть Номенклатуру" });
            return;
        }
        if (!entry.packageCombo && entry.qty > 0) {
            issues.push({ text: `«${entry.name}»: нет вариантов упаковки для закупки`, fixHref: "ingredients.html", fixLabel: "Открыть Номенклатуру" });
        }
    });

    prepTotals.forEach((p) => {
        const name = (p.recipe && p.recipe.name) || "?";
        if (!p.buyReady && p.yieldMissing) {
            issues.push({
                text: `«${name}»: не указан выход партии`,
                fixHref: p.recipeId ? "recipes.html?edit=" + encodeURIComponent(p.recipeId) : null,
                fixLabel: "Заполнить в Рецептах",
            });
        }
        if (p.cyclic) {
            issues.push({
                text: `«${name}»: обнаружена циклическая ссылка на заготовку — расчёт может быть неполным`,
                fixHref: p.recipeId ? "recipes.html?edit=" + encodeURIComponent(p.recipeId) : null,
                fixLabel: "Открыть в Рецептах",
            });
        }
    });

    return issues;
}

function renderIssues() {
    const el = document.getElementById("issuesList");
    el.innerHTML = "";
    const issues = computeIssues();
    if (issues.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = menuItems.length === 0 ? "Сначала соберите барную карту на вкладке «Калькулятор мероприятия»." : "Проблем не найдено — данные для расчёта заполнены полностью.";
        el.appendChild(empty);
        return;
    }
    issues.forEach((issue) => {
        const row = document.createElement("div");
        row.className = "issue-row";
        const text = document.createElement("span");
        text.textContent = issue.text;
        row.appendChild(text);
        if (issue.fixHref) {
            const link = document.createElement("a");
            link.href = issue.fixHref;
            link.target = "_blank";
            link.textContent = issue.fixLabel || "Исправить";
            row.appendChild(link);
        }
        el.appendChild(row);
    });
}

function updateIssuesBadge() {
    const badge = document.getElementById("issuesBadge");
    const count = computeIssues().length;
    badge.textContent = count;
    badge.classList.toggle("hidden", count === 0);
}

// "Сводный расчёт" — таблица для планирования: сколько сырья нужно всего и на какие
// коктейли оно раскладывается (аудит расчёта), сгруппировано по категориям, как и список покупок,
// чтобы обе вкладки читались одинаково.
function renderCalcSummary() {
    updateIssuesBadge();
    const summaryEl = document.getElementById("calcSummary");
    summaryEl.innerHTML = "";

    if (menuItems.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "Добавьте коктейли в барную карту, чтобы увидеть расчёт.";
        summaryEl.appendChild(empty);
        return;
    }

    const { ingredientTotals, prepTotals } = getEventTotals();
    const { totalCost, lines } = computeBudget(ingredientTotals, ingredientsByName, packagesByIngredientId);

    const ingTitle = document.createElement("h4");
    ingTitle.textContent = "Нужное сырьё";
    summaryEl.appendChild(ingTitle);

    const byCategory = new Map();
    lines.forEach((entry) => {
        const cat = entry.category || "Без категории";
        (byCategory.get(cat) || byCategory.set(cat, []).get(cat)).push(entry);
    });

    [...byCategory.keys()].sort((a, b) => a.localeCompare(b, "ru")).forEach((cat) => {
        const items = byCategory.get(cat).slice().sort((a, b) => a.name.localeCompare(b.name, "ru"));
        const catCost = items.reduce((sum, e) => sum + (e.cost || 0), 0);

        const group = document.createElement("div");
        group.className = "category-group";
        const h = document.createElement("h4");
        h.textContent = catCost > 0 ? `${cat} — ${formatMoney(catCost)}` : cat;
        group.appendChild(h);

        items.forEach((entry) => {
            const row = document.createElement("div");
            row.className = "check-row";

            const name = document.createElement("span");
            name.className = "check-name";
            name.textContent = entry.name + (entry.isBoughtPrep ? " (готовое)" : "");
            row.appendChild(name);

            const qty = document.createElement("span");
            qty.className = "check-qty";
            qty.textContent = entry.isTopup ? `≈ ${formatQty(entry.qty, entry.unit)} (топом)` : formatQty(entry.qty, entry.unit);
            row.appendChild(qty);

            const cost = document.createElement("span");
            cost.className = "check-cost";
            cost.textContent = entry.cost !== null && entry.cost !== undefined ? formatMoney(entry.cost) : "нет цены";
            row.appendChild(cost);

            group.appendChild(row);

            if (entry.conversionMissing) {
                const warnLine = document.createElement("div");
                warnLine.className = "package-line package-line-warn";
                warnLine.appendChild(conversionWarning(entry));
                group.appendChild(warnLine);
            }

            if (entry.sources.length > 0) {
                const toggleBtn = document.createElement("button");
                toggleBtn.type = "button";
                toggleBtn.className = "sources-toggle";
                toggleBtn.textContent = `где используется (${entry.sources.length})`;
                const sourcesList = document.createElement("div");
                sourcesList.className = "sources-list hidden";
                sourcesList.textContent = entry.sources.map((s) => `${s.name} — ${formatQty(s.qty, s.unit)}`).join(", ");
                toggleBtn.onclick = () => sourcesList.classList.toggle("hidden");
                group.appendChild(toggleBtn);
                group.appendChild(sourcesList);
            }
        });

        summaryEl.appendChild(group);
    });

    const toPrepare = prepTotals.filter((p) => !p.buyReady);
    if (toPrepare.length > 0) {
        const prepTitle = document.createElement("h4");
        prepTitle.textContent = "Нужно приготовить заготовок";
        summaryEl.appendChild(prepTitle);
        const prepList = document.createElement("ul");
        prepList.className = "composition-list";
        toPrepare.forEach((p) => {
            const li = document.createElement("li");
            const left = document.createElement("span");
            left.textContent = (p.recipe && p.recipe.name) || "?";
            const right = document.createElement("span");
            if (p.yieldMissing) {
                right.innerHTML = "";
                right.classList.add("package-line-warn");
                const warnText = document.createElement("span");
                warnText.textContent = `нужно ${formatQty(p.neededQty, p.unit)} — не указан выход партии, `;
                const fixLink = document.createElement("a");
                fixLink.href = "recipes.html?edit=" + encodeURIComponent(p.recipeId);
                fixLink.target = "_blank";
                fixLink.textContent = "заполнить в карточке рецепта";
                right.appendChild(warnText);
                right.appendChild(fixLink);
            } else {
                right.textContent = `нужно ${formatQty(p.neededQty, p.unit)} (×${formatNum(p.coefficient)})`;
            }
            li.appendChild(left);
            li.appendChild(right);
            prepList.appendChild(li);
        });
        summaryEl.appendChild(prepList);
    }

    const budget = document.createElement("div");
    budget.className = "budget-total" + (eventRow.plan_budget && totalCost > eventRow.plan_budget ? " over" : "");
    budget.textContent = `Предварительная смета: ${formatMoney(totalCost)}` + (eventRow.plan_budget ? ` из бюджета ${formatMoney(eventRow.plan_budget)}` : "");
    summaryEl.appendChild(budget);
}

// ---- Вкладка "Список покупок" ----

async function toggleIngredientChecked(ingredientId, checked) {
    ingredientStateMap[ingredientId] = checked;
    await db.from("event_ingredient_state").upsert({ event_id: eventId, ingredient_id: ingredientId, is_checked: checked }, { onConflict: "event_id,ingredient_id" });
}

async function toggleManualItemChecked(id, checked) {
    const item = manualItems.find((m) => m.id === id);
    if (item) item.is_checked = checked;
    await db.from("event_manual_items").update({ is_checked: checked }).eq("id", id);
}

async function deleteManualItem(id) {
    manualItems = manualItems.filter((m) => m.id !== id);
    const { error } = await db.from("event_manual_items").delete().eq("id", id);
    if (error) showToast("Не удалилось: " + error.message, "error");
}

function populateManualItemDatalists() {
    const unitDl = document.getElementById("unitOptionsList");
    unitDl.innerHTML = "";
    UNIT_OPTIONS.forEach((u) => { const opt = document.createElement("option"); opt.value = u; unitDl.appendChild(opt); });
    const catDl = document.getElementById("categoryOptionsList");
    catDl.innerHTML = "";
    CATEGORY_SEED.forEach((c) => { const opt = document.createElement("option"); opt.value = c; catDl.appendChild(opt); });
}

document.getElementById("addManualItemBtn").onclick = async () => {
    const nameInput = document.getElementById("manualItemName");
    const qtyInput = document.getElementById("manualItemQty");
    const unitInput = document.getElementById("manualItemUnit");
    const categoryInput = document.getElementById("manualItemCategory");
    const costInput = document.getElementById("manualItemCost");

    const name = nameInput.value.trim();
    if (!name) {
        showToast("Заполните название позиции", "error");
        return;
    }
    const qty = qtyInput.value.trim() ? Number(qtyInput.value.trim().replace(",", ".")) : null;
    const cost = costInput.value.trim() ? Number(costInput.value.trim().replace(",", ".")) : null;

    const { data, error } = await db
        .from("event_manual_items")
        .insert({ event_id: eventId, name, qty, unit: unitInput.value.trim() || null, category: categoryInput.value.trim() || null, cost, is_checked: false })
        .select("*")
        .single();
    if (error) {
        showToast("Не сохранилось: " + error.message, "error");
        return;
    }
    manualItems.push(data);
    nameInput.value = "";
    qtyInput.value = "";
    unitInput.value = "";
    categoryInput.value = "";
    costInput.value = "";
    renderShopping();
};

function renderShopping() {
    const listEl = document.getElementById("shoppingList");
    listEl.innerHTML = "";

    const { ingredientTotals } = menuItems.length > 0 ? getEventTotals() : { ingredientTotals: [] };
    const { totalCost: computedCost, lines } = computeBudget(ingredientTotals, ingredientsByName, packagesByIngredientId);

    // Ручные позиции (напр. лёд, салфетки) приводим к тому же виду, что и посчитанные строки,
    // чтобы дальше группировать/сортировать/выводить их одним и тем же кодом.
    const manualLines = manualItems.map((m) => ({
        isManual: true,
        manualId: m.id,
        name: m.name,
        qty: m.qty,
        unit: m.unit,
        category: m.category,
        cost: m.cost,
        is_checked: m.is_checked,
    }));
    const allLines = [...lines, ...manualLines];

    if (allLines.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "Сначала соберите барную карту на вкладке «Калькулятор мероприятия» или добавьте позицию вручную выше.";
        listEl.appendChild(empty);
        document.getElementById("budgetTotal").textContent = "";
        return;
    }

    const totalCost = computedCost + manualLines.reduce((sum, m) => sum + (m.cost || 0), 0);

    const byCategory = new Map();
    allLines.forEach((entry) => {
        const cat = entry.category || "Без категории";
        (byCategory.get(cat) || byCategory.set(cat, []).get(cat)).push(entry);
    });

    [...byCategory.keys()].sort((a, b) => a.localeCompare(b, "ru")).forEach((cat) => {
        const catItems = byCategory.get(cat);
        const catCost = catItems.reduce((sum, e) => sum + (e.cost || 0), 0);

        const group = document.createElement("div");
        group.className = "category-group";
        const h = document.createElement("h4");
        h.textContent = catCost > 0 ? `${cat} — ${formatMoney(catCost)}` : cat;
        group.appendChild(h);

        const items = catItems.slice().sort((a, b) => {
            const checkedA = isShoppingEntryChecked(a);
            const checkedB = isShoppingEntryChecked(b);
            if (checkedA !== checkedB) return checkedA ? 1 : -1;
            return a.name.localeCompare(b.name, "ru");
        });

        items.forEach((entry) => {
            if (entry.isManual) {
                const checked = !!entry.is_checked;
                const row = document.createElement("div");
                row.className = "check-row" + (checked ? " checked" : "");

                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.checked = checked;
                cb.onchange = async () => { await toggleManualItemChecked(entry.manualId, cb.checked); renderShopping(); };
                row.appendChild(cb);

                const name = document.createElement("span");
                name.className = "check-name";
                name.textContent = entry.name + " (вручную)";
                row.appendChild(name);

                const qty = document.createElement("span");
                qty.className = "check-qty";
                qty.textContent = formatQty(entry.qty, entry.unit);
                row.appendChild(qty);

                const cost = document.createElement("span");
                cost.className = "check-cost";
                cost.textContent = entry.cost !== null && entry.cost !== undefined ? formatMoney(entry.cost) : "нет цены";
                row.appendChild(cost);

                const delBtn = document.createElement("button");
                delBtn.type = "button";
                delBtn.className = "danger";
                delBtn.textContent = "Удалить";
                delBtn.onclick = async () => { await deleteManualItem(entry.manualId); renderShopping(); };
                row.appendChild(delBtn);

                group.appendChild(row);
                return;
            }

            const ing = entry.isBoughtPrep ? null : ingredientsByName[entry.name];
            const checked = isShoppingEntryChecked(entry);
            const canCheck = entry.isBoughtPrep || !!ing;

            const row = document.createElement("div");
            row.className = "check-row" + (checked ? " checked" : "");

            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = checked;
            cb.disabled = !canCheck;
            cb.onchange = async () => {
                if (!canCheck) return;
                if (entry.isBoughtPrep) {
                    await updatePrepState(entry.recipeId, { is_checked: cb.checked });
                } else {
                    await toggleIngredientChecked(ing.id, cb.checked);
                }
                renderShopping();
            };
            row.appendChild(cb);

            const name = document.createElement("span");
            name.className = "check-name";
            name.textContent = entry.name + (entry.isBoughtPrep ? " (готовое)" : "");
            if (entry.isBoughtPrep) {
                name.style.cursor = "pointer";
                name.title = "Открыть карточку рецепта";
                name.onclick = () => recipeDetail.open(entry.recipeId);
            }
            row.appendChild(name);

            const qty = document.createElement("span");
            qty.className = "check-qty";
            qty.textContent = entry.isTopup ? `≈ ${formatQty(entry.qty, entry.unit)} (топом)` : formatQty(entry.qty, entry.unit);
            row.appendChild(qty);

            const cost = document.createElement("span");
            cost.className = "check-cost";
            cost.textContent = entry.cost !== null && entry.cost !== undefined ? formatMoney(entry.cost) : "нет цены";
            row.appendChild(cost);

            group.appendChild(row);

            if (!entry.isBoughtPrep) {
                const packLine = document.createElement("div");
                packLine.className = "package-line";
                if (entry.conversionMissing) {
                    packLine.classList.add("package-line-warn");
                    packLine.appendChild(conversionWarning(entry));
                } else if (entry.packageCombo) {
                    packLine.textContent = "Купить: " + formatPackageCombo(entry.packageCombo);
                } else if (ing) {
                    packLine.textContent = "Нет вариантов упаковки — добавьте в Номенклатуре";
                    packLine.classList.add("package-line-warn");
                }
                if (packLine.textContent || packLine.childElementCount > 0) group.appendChild(packLine);
            }
        });

        listEl.appendChild(group);
    });

    const budget = document.getElementById("budgetTotal");
    budget.className = "budget-total" + (eventRow.plan_budget && totalCost > eventRow.plan_budget ? " over" : "");
    budget.textContent = `Итого по закупке: ${formatMoney(totalCost)}` + (eventRow.plan_budget ? ` из бюджета ${formatMoney(eventRow.plan_budget)}` : "");
}

function formatPackageCombo(combo) {
    return combo.combo.map((c) => {
        const sourceLabel = c.purchase_source ? ` (${c.purchase_source})` : "";
        return `${c.count}× ${formatQty(c.package_size, c.purchase_unit)}${sourceLabel}`;
    }).join(", ");
}

function buildShoppingMarkdown() {
    const { ingredientTotals } = menuItems.length > 0 ? getEventTotals() : { ingredientTotals: [] };
    const { totalCost: computedCost, lines } = computeBudget(ingredientTotals, ingredientsByName, packagesByIngredientId);
    const manualLines = manualItems.map((m) => ({
        isManual: true, name: m.name, qty: m.qty, unit: m.unit, category: m.category, cost: m.cost, is_checked: m.is_checked,
    }));
    const totalCost = computedCost + manualLines.reduce((sum, m) => sum + (m.cost || 0), 0);

    const byCategory = new Map();
    [...lines, ...manualLines].forEach((entry) => {
        const cat = entry.category || "Без категории";
        (byCategory.get(cat) || byCategory.set(cat, []).get(cat)).push(entry);
    });

    const md = [`# Список покупок — ${eventRow.name}`, ""];
    [...byCategory.keys()].sort((a, b) => a.localeCompare(b, "ru")).forEach((cat) => {
        md.push(`## ${cat}`, "");
        byCategory.get(cat)
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name, "ru"))
            .forEach((entry) => {
                const checked = isShoppingEntryChecked(entry) ? "x" : " ";
                const qtyText = entry.isTopup ? `≈ ${formatQty(entry.qty, entry.unit)} (топом)` : formatQty(entry.qty, entry.unit);
                const packText = !entry.isBoughtPrep && entry.packageCombo ? ` — ${formatPackageCombo(entry.packageCombo)}` : "";
                const warnText = entry.conversionMissing ? ` — ⚠ нет коэффициента для «${entry.unit}», задайте в Конвертере` : "";
                const costText = entry.cost !== null && entry.cost !== undefined ? ` — ${formatMoney(entry.cost)}` : "";
                const nameText = entry.name + (entry.isBoughtPrep ? " (готовое)" : "") + (entry.isManual ? " (вручную)" : "");
                md.push(`- [${checked}] ${nameText} — ${qtyText}${packText}${warnText}${costText}`);
            });
        md.push("");
    });

    md.push(`**Итого: ${formatMoney(totalCost)}**`);
    return md.join("\n");
}

document.getElementById("copyShoppingListBtn").onclick = async () => {
    const text = buildShoppingMarkdown();
    try {
        await navigator.clipboard.writeText(text);
        showToast("Список скопирован", "info");
    } catch (e) {
        showToast("Не получилось скопировать: " + e.message, "error");
    }
};

function isShoppingEntryChecked(entry) {
    if (entry.isManual) return !!entry.is_checked;
    if (entry.isBoughtPrep) {
        const state = prepStateMap[entry.recipeId];
        return state ? !!state.is_checked : false;
    }
    const ing = ingredientsByName[entry.name];
    return ing ? !!ingredientStateMap[ing.id] : false;
}

// ---- Вкладка "Список заготовок" ----

async function updatePrepState(recipeId, patch) {
    const current = prepStateMap[recipeId] || { container_size: null, is_checked: false, expand_nested: false, buy_ready: false };
    const next = { ...current, ...patch };
    prepStateMap[recipeId] = next;
    await db.from("event_prep_state").upsert({ event_id: eventId, recipe_id: recipeId, ...next }, { onConflict: "event_id,recipe_id" });
}

function renderPreps() {
    const listEl = document.getElementById("prepsList");
    listEl.innerHTML = "";

    if (menuItems.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "Сначала соберите барную карту на вкладке «Калькулятор мероприятия».";
        listEl.appendChild(empty);
        return;
    }

    const { prepTotals } = getEventTotals();

    if (prepTotals.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "В выбранных коктейлях нет заготовок — готовить ничего не нужно.";
        listEl.appendChild(empty);
        return;
    }

    const sorted = prepTotals.slice().sort((a, b) => {
        const stateA = prepStateMap[a.recipeId];
        const stateB = prepStateMap[b.recipeId];
        const checkedA = stateA ? !!stateA.is_checked : false;
        const checkedB = stateB ? !!stateB.is_checked : false;
        if (checkedA !== checkedB) return checkedA ? 1 : -1;
        return ((a.recipe && a.recipe.name) || "").localeCompare((b.recipe && b.recipe.name) || "", "ru");
    });

    sorted.forEach((p) => {
        const state = prepStateMap[p.recipeId] || { container_size: null, is_checked: false, expand_nested: false, buy_ready: false };
        const card = document.createElement("div");
        card.className = "prep-card" + (state.is_checked ? " checked" : "");

        const head = document.createElement("div");
        head.className = "prep-card-head";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!state.is_checked;
        cb.title = p.buyReady ? "Отметить как купленное" : "Отметить как приготовленное";
        cb.onchange = async () => { await updatePrepState(p.recipeId, { is_checked: cb.checked }); renderPreps(); };
        head.appendChild(cb);

        const title = document.createElement("div");
        title.className = "prep-card-title" + (state.is_checked ? " checked" : "");
        title.textContent = ((p.recipe && p.recipe.name) || "?") + (p.buyReady ? " (покупаем готовое)" : "");
        head.appendChild(title);

        const qty = document.createElement("div");
        qty.className = "prep-card-qty";
        if (p.buyReady) {
            qty.textContent = `нужно ${formatQty(p.neededQty, p.unit)}`;
        } else if (p.yieldMissing) {
            qty.classList.add("package-line-warn");
            qty.textContent = `нужно ${formatQty(p.neededQty, p.unit)} — нет выхода партии — `;
            const fixLink = document.createElement("a");
            fixLink.href = "recipes.html?edit=" + encodeURIComponent(p.recipeId);
            fixLink.target = "_blank";
            fixLink.textContent = "заполнить";
            qty.appendChild(fixLink);
        } else {
            qty.textContent = `нужно ${formatQty(p.neededQty, p.unit)} (×${formatNum(p.coefficient)})`;
        }
        head.appendChild(qty);

        card.appendChild(head);

        if (!state.is_checked) {
            const buyRow = document.createElement("label");
            buyRow.className = "switch-row";
            buyRow.style.marginBottom = "8px";
            const buySwitch = document.createElement("span");
            buySwitch.className = "switch";
            const buyCb = document.createElement("input");
            buyCb.type = "checkbox";
            buyCb.checked = !!state.buy_ready;
            buyCb.onchange = async () => { await updatePrepState(p.recipeId, { buy_ready: buyCb.checked }); renderPreps(); renderShopping(); renderCalcSummary(); };
            const buySlider = document.createElement("span");
            buySlider.className = "switch-slider";
            buySwitch.appendChild(buyCb);
            buySwitch.appendChild(buySlider);
            buyRow.appendChild(buySwitch);
            buyRow.appendChild(document.createTextNode("Купить готовое вместо приготовления"));
            card.appendChild(buyRow);

            if (p.buyReady && p.recipe && !(p.recipe.purchase_package_size && p.recipe.purchase_package_price)) {
                const hint = document.createElement("div");
                hint.className = "field-hint";
                hint.style.marginBottom = "8px";
                hint.innerHTML = "Цена не посчитана — заполните закупочную упаковку и цену в карточке рецепта, ";
                const fixLink = document.createElement("a");
                fixLink.href = "recipes.html?edit=" + encodeURIComponent(p.recipeId);
                fixLink.target = "_blank";
                fixLink.textContent = "открыть карточку";
                hint.appendChild(fixLink);
                card.appendChild(hint);
            }
        }

        if (!state.is_checked && !p.buyReady) {
            const body = document.createElement("div");
            body.className = "prep-card-body";

            if (p.laborMinutes !== null && p.laborMinutes !== undefined) {
                const time = document.createElement("div");
                time.className = "tara-result";
                time.textContent = `≈ ${formatNum(p.laborMinutes)} мин на приготовление`;
                body.appendChild(time);
            }

            if (!p.yieldMissing) {
                const taraField = document.createElement("div");
                taraField.className = "tara-field";
                const taraLabel = document.createElement("label");
                taraLabel.textContent = "Объём тары, мл";
                taraField.appendChild(taraLabel);
                const taraInput = document.createElement("input");
                taraInput.type = "text";
                taraInput.inputMode = "decimal";
                taraInput.value = state.container_size ?? "";
                taraInput.placeholder = "напр. 500";
                taraInput.onchange = async () => {
                    const v = Number(String(taraInput.value).replace(",", "."));
                    await updatePrepState(p.recipeId, { container_size: v > 0 ? v : null });
                    renderPreps();
                };
                taraField.appendChild(taraInput);
                body.appendChild(taraField);

                if (state.container_size) {
                    const count = Math.ceil(p.neededQty / state.container_size);
                    const taraResult = document.createElement("div");
                    taraResult.className = "tara-result";
                    taraResult.textContent = `нужно тары: ${count} шт.`;
                    body.appendChild(taraResult);
                }
            }

            const expandBtn = document.createElement("button");
            expandBtn.type = "button";
            expandBtn.className = "row-expand-toggle-labeled";
            const expandArrow = document.createElement("span");
            expandArrow.className = "row-expand-toggle";
            expandArrow.textContent = state.expand_nested ? "▾" : "▸";
            expandBtn.appendChild(expandArrow);
            expandBtn.appendChild(document.createTextNode("Раскрыть вложенные заготовки"));
            expandBtn.onclick = async () => { await updatePrepState(p.recipeId, { expand_nested: !state.expand_nested }); renderPreps(); };
            body.appendChild(expandBtn);

            card.appendChild(body);

            if (state.expand_nested && p.ownRows) {
                const ul = document.createElement("ul");
                ul.className = "composition-list";
                ul.style.marginTop = "10px";
                p.ownRows.forEach((row) => {
                    const li = document.createElement("li");
                    const left = document.createElement("span");
                    left.textContent = row.name;
                    const right = document.createElement("span");
                    right.textContent = row.isTopup ? `≈ ${formatQty(row.qty, row.unit)} (топом)` : formatQty(row.qty, row.unit);
                    li.appendChild(left);
                    li.appendChild(right);
                    ul.appendChild(li);
                });
                card.appendChild(ul);
            }

            if (p.cyclic) {
                const warn = document.createElement("div");
                warn.className = "calc-warning";
                warn.textContent = "Обнаружена циклическая ссылка на заготовку — расчёт может быть неполным.";
                card.appendChild(warn);
            }
        }

        listEl.appendChild(card);
    });
}

// ---- Инициализация ----

async function init() {
    if (!isDbConfigured()) {
        showStatus(statusEl, "База данных не подключена", "error");
        return;
    }
    if (!eventId) {
        showStatus(statusEl, "Не указано мероприятие", "error");
        return;
    }
    setupPickerFilters();
    populateManualItemDatalists();
    const ok = await loadAll();
    if (!ok) return;
    renderHeader();
    refreshPickerFilterOptions();
    renderCocktailResults();
    renderMenuItems();
    renderCalcSummary();

    document.querySelectorAll(".section-header").forEach((header) => {
        header.onclick = () => {
            const target = document.getElementById(header.dataset.target);
            target.classList.toggle("collapsed");
            header.querySelector(".section-toggle").textContent = target.classList.contains("collapsed") ? "▸" : "▾";
        };
    });
}

init();

// Сырьё v2 — master-detail поверх той же схемы БД, что и в js/ingredients.js
// (ingredients / ingredient_packages / unit_conversions). Список слева — панель деталей
// справа только читает данные; редактирование/создание идёт через отдельную форму-drawer
// (ingredientFormDrawer), по тому же принципу, что и recipeFormDrawer у «Рецептов».

const OPTIONAL_PACKAGE_FIELD_KEYS = ["purchase_source", "price_source_type", "price_source_query", "price_source_enabled"];

const statusEl = document.getElementById("status");
const priceCheckPanel = document.getElementById("priceCheckPanel");

const NEW_DAYS = 7;

let allRows = [];
let packagesByIngredient = {};
let conversionsByIngredient = {};
let prepNameSet = new Set();
let eventsList = [];
let recipeItemsByRecipe = {};
let eventMenuItemsByEvent = {};

let selectedId = null;
let statusFilter = "all";
let searchQuery = "";
let sortMode = "name_asc";
let categoryFilter;
let eventFilter;
let eventFilterValue = null;
let eventFilterIngredientIds = null;

let priceCheckResults = [];
let priceCheckState = "idle";
let packagePriceChecks = {}; // packageId -> { state, result }

function normalized(value) {
    return (value || "").toString().trim().toLowerCase();
}

// ---- Вычисления по позиции ----

function cheapestPackage(ingredientId) {
    const pkgs = (packagesByIngredient[ingredientId] || []).filter((p) => p.package_price != null);
    if (pkgs.length === 0) return null;
    return pkgs.reduce((a, b) => (b.package_price < a.package_price ? b : a));
}

function packageSummary(ingredientId) {
    const pkgs = packagesByIngredient[ingredientId] || [];
    if (pkgs.length === 0) return null;
    const cheapest = cheapestPackage(ingredientId);
    if (!cheapest) return `${pkgs.length} вар. без цены`;
    const unit = findRecord(ingredientId)?.base_unit || "";
    const sizeLabel = cheapest.package_size != null ? ` / ${cheapest.package_size}${unit ? " " + unit : ""}` : "";
    return pkgs.length > 1 ? `от ${cheapest.package_price} ₽${sizeLabel} · ${pkgs.length} вар.` : `${cheapest.package_price} ₽${sizeLabel}`;
}

function conversionSummary(ingredientId) {
    return (conversionsByIngredient[ingredientId] || []).length;
}

function packageAlreadyExists(ingredientId, size, price) {
    return (packagesByIngredient[ingredientId] || []).some((p) => p.package_size === size && p.package_price === price);
}

function classify(record) {
    const hasPackage = (packagesByIngredient[record.id] || []).some((p) => p.package_size != null && p.package_price != null);
    return record.category && record.base_unit && hasPackage ? "ok" : "incomplete";
}

function isNew(record) {
    if (!record.created_at) return false;
    return Date.now() - new Date(record.created_at).getTime() < NEW_DAYS * 24 * 60 * 60 * 1000;
}

function findRecord(id) {
    return allRows.find((r) => r.id === id) || null;
}

// ---- Фильтр по событиям: сырьё, используемое в меню выбранного события ----
// (event_menu_items -> recipe_items, рекурсивно через sub_recipe_id — заготовки внутри заготовок)

function ingredientIdsForEvent(eventId) {
    const menuItems = (eventMenuItemsByEvent[eventId] || []).filter((mi) => mi.included !== false);
    const result = new Set();
    const visited = new Set();
    function walk(recipeId) {
        if (visited.has(recipeId)) return;
        visited.add(recipeId);
        (recipeItemsByRecipe[recipeId] || []).forEach((item) => {
            if (item.ingredient_id) result.add(item.ingredient_id);
            else if (item.sub_recipe_id) walk(item.sub_recipe_id);
        });
    }
    menuItems.forEach((mi) => walk(mi.recipe_id));
    return result;
}

function recomputeEventFilterIngredientIds() {
    eventFilterIngredientIds = eventFilterValue ? ingredientIdsForEvent(eventFilterValue) : null;
}

// ---- Список слева ----

function statusLabel(kind, record) {
    if (kind === "ok") return "заполнено";
    if (!record.category || !record.base_unit) return "нет категории/ед.";
    return "нет цены";
}

function matchesFilters(record) {
    if (statusFilter === "new") { if (!isNew(record)) return false; }
    else if (statusFilter !== "all" && statusFilter !== classify(record)) return false;
    if (searchQuery && !record.name.toLowerCase().includes(searchQuery)) return false;
    const catSel = categoryFilter ? categoryFilter.getSelected() : [];
    if (catSel.length > 0 && !catSel.includes(record.category || "")) return false;
    if (eventFilterIngredientIds && !eventFilterIngredientIds.has(record.id)) return false;
    return true;
}

const sortFns = {
    name_asc: (a, b) => (a.name || "").localeCompare(b.name || "", "ru"),
    name_desc: (a, b) => (b.name || "").localeCompare(a.name || "", "ru"),
    category: (a, b) => (a.category || "").localeCompare(b.category || "", "ru") || (a.name || "").localeCompare(b.name || "", "ru"),
    price_asc: (a, b) => (cheapestPackage(a.id)?.package_price ?? Infinity) - (cheapestPackage(b.id)?.package_price ?? Infinity),
    price_desc: (a, b) => (cheapestPackage(b.id)?.package_price ?? -Infinity) - (cheapestPackage(a.id)?.package_price ?? -Infinity),
};

function visibleRows() {
    return allRows.filter(matchesFilters).sort(sortFns[sortMode]);
}

function buildIngredientRow(record, index) {
    const kind = classify(record);

    const row = document.createElement("button");
    row.type = "button";
    row.className = "bc-recipe-row" + (record.id === selectedId ? " selected" : "");

    const top = document.createElement("span");
    top.className = "bc-row-top";

    const indexEl = document.createElement("span");
    indexEl.className = "bc-index";
    indexEl.textContent = String(index + 1).padStart(2, "0");
    top.appendChild(indexEl);

    const title = document.createElement("span");
    title.className = "bc-row-title";
    const strong = document.createElement("strong");
    strong.textContent = record.name;
    const sub = document.createElement("span");
    sub.textContent = `${record.category || "без категории"} · ${record.base_unit || "без ед."}`;
    title.appendChild(strong);
    title.appendChild(sub);
    top.appendChild(title);
    row.appendChild(top);

    const badges = document.createElement("span");
    badges.className = "bc-row-badges";
    const primary = document.createElement("span");
    primary.className = "bc-badge-volume";
    primary.textContent = kind === "ok" ? (packageSummary(record.id) || "—") : statusLabel(kind, record);
    badges.appendChild(primary);
    if (isNew(record)) {
        const newBadge = document.createElement("span");
        newBadge.textContent = "новая";
        badges.appendChild(newBadge);
    }
    row.appendChild(badges);

    if (conversionSummary(record.id) > 0) {
        const convBadge = document.createElement("span");
        convBadge.className = "ing-conv-badge";
        convBadge.textContent = "⇄";
        convBadge.title = "Есть конвертация единиц";
        row.appendChild(convBadge);
    }

    row.onclick = () => selectIngredient(record.id);
    return row;
}

function renderList() {
    document.getElementById("ingredientCount").textContent = allRows.length;
    const list = document.getElementById("ingredientList");
    const rows = visibleRows();
    list.innerHTML = "";
    if (rows.length === 0) {
        const empty = document.createElement("div");
        empty.className = "bc-empty";
        empty.textContent = "Ничего не найдено";
        list.appendChild(empty);
        return;
    }
    rows.forEach((record, index) => list.appendChild(buildIngredientRow(record, index)));
}

function selectIngredient(id) {
    selectedId = id;
    renderList();
    renderDetail();
    if (window.matchMedia("(max-width: 1080px)").matches) openDrawer();
}

// ---- Панель деталей (только чтение — редактирование через ingredientFormDrawer) ----

function addMetaLine(container, label, value) {
    if (!value) return;
    const line = document.createElement("div");
    const span = document.createElement("span");
    span.textContent = label;
    const b = document.createElement("b");
    b.textContent = value;
    line.appendChild(span);
    line.appendChild(b);
    container.appendChild(line);
}

function buildReadDetail(record, opts = {}) {
    const { titleActions = true } = opts;
    const root = document.createElement("div");

    const top = document.createElement("div");
    top.className = "bc-detail-top";
    const titleWrap = document.createElement("div");

    const titleRow = document.createElement("div");
    titleRow.className = "ing-title-row";
    const h2 = document.createElement("h2");
    h2.textContent = record.name;
    titleRow.appendChild(h2);

    // На мобильном (drawer) карандаш/корзина живут в шапке рядом с крестиком закрытия
    // (см. updateDrawerActions) — тут их дублировать не нужно, только на десктопной панели.
    if (titleActions) {
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "bc-icon-btn";
        editBtn.title = "Изменить";
        editBtn.setAttribute("aria-label", "Изменить");
        editBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4Z"/><path d="M14 5l3 3"/></svg>';
        editBtn.onclick = () => openIngredientFormEdit(record.id);
        titleRow.appendChild(editBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "bc-icon-btn ing-danger";
        deleteBtn.title = "Удалить позицию";
        deleteBtn.setAttribute("aria-label", "Удалить позицию");
        deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 7h14M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-9 0 1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>';
        deleteBtn.onclick = () => deleteIngredient(record);
        titleRow.appendChild(deleteBtn);
    }

    const recipesBtn = document.createElement("button");
    recipesBtn.type = "button";
    recipesBtn.className = "bc-icon-btn";
    recipesBtn.title = "Рецепты с этим сырьём";
    recipesBtn.setAttribute("aria-label", "Рецепты с этим сырьём");
    recipesBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 6.5c-1.8-1.3-4.3-1.7-6.5-1V18c2.2-.7 4.7-.3 6.5 1"/><path d="M12 6.5c1.8-1.3 4.3-1.7 6.5-1V18c-2.2-.7-4.7-.3-6.5 1V6.5Z"/></svg>';
    recipesBtn.onclick = () => openRecipeUsageDrawer(record);
    titleRow.appendChild(recipesBtn);

    titleWrap.appendChild(titleRow);

    const kicker = document.createElement("div");
    kicker.className = "bc-kicker";
    kicker.textContent = `${record.category || "без категории"} · ${record.base_unit || "без ед."}`;
    titleWrap.appendChild(kicker);

    top.appendChild(titleWrap);
    root.appendChild(top);

    const meta = document.createElement("div");
    meta.className = "bc-meta";
    addMetaLine(meta, "Цена", packageSummary(record.id) || "нет вариантов упаковки");
    const convN = conversionSummary(record.id);
    addMetaLine(meta, "Конвертация", convN > 0 ? `${convN} ед.` : "");
    addMetaLine(meta, "Комментарий", record.comment || "");
    root.appendChild(meta);

    const pkgTitle = document.createElement("div");
    pkgTitle.className = "bc-section-title";
    pkgTitle.textContent = "Варианты упаковки";
    root.appendChild(pkgTitle);

    const items = document.createElement("div");
    items.className = "bc-items";
    const pkgs = packagesByIngredient[record.id] || [];
    if (pkgs.length === 0) {
        const empty = document.createElement("div");
        empty.className = "bc-item";
        empty.textContent = "Вариантов ещё нет";
        items.appendChild(empty);
    } else {
        pkgs.forEach((pkg, index) => {
            const row = document.createElement("div");
            row.className = "ing-pkg-item";

            const header = document.createElement("div");
            header.className = "ing-pkg-header";
            const indexEl = document.createElement("span");
            indexEl.className = "bc-index";
            indexEl.textContent = String(index + 1).padStart(2, "0");
            header.appendChild(indexEl);

            const main = document.createElement("span");
            main.className = "ing-pkg-main";
            const sizeLabel = pkg.package_size != null ? `${pkg.package_size} ${record.base_unit || ""}`.trim() : "размер?";
            const priceLabel = pkg.package_price != null ? moneyLabel(pkg.package_price) : "без цены";
            main.textContent = [sizeLabel, priceLabel].join(" · ");
            header.appendChild(main);

            const checkBtn = document.createElement("button");
            checkBtn.type = "button";
            checkBtn.className = "bc-icon-btn ing-pkg-check";
            checkBtn.title = "Проверить цену";
            checkBtn.setAttribute("aria-label", "Проверить цену");
            checkBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3v18M8.5 7.5h4.75a2.75 2.75 0 1 1 0 5.5h-3.5a2.75 2.75 0 1 0 0 5.5H15"/></svg>';
            checkBtn.onclick = () => checkPackagePrice(record.id, pkg, pkg.id);
            header.appendChild(checkBtn);

            row.appendChild(header);

            if (pkg.purchase_unit) {
                const unitRow = document.createElement("div");
                unitRow.className = "ing-pkg-row";
                const key = document.createElement("span");
                key.textContent = "закупочная ед.";
                const val = document.createElement("b");
                val.textContent = pkg.purchase_unit;
                unitRow.appendChild(key);
                unitRow.appendChild(val);
                row.appendChild(unitRow);
            }

            if (pkg.purchase_source) {
                const sourceRow = document.createElement("div");
                sourceRow.className = "ing-pkg-row";
                const key = document.createElement("span");
                key.textContent = "источник";
                const val = document.createElement("b");
                val.textContent = pkg.purchase_source;
                sourceRow.appendChild(key);
                sourceRow.appendChild(val);
                row.appendChild(sourceRow);
            }

            items.appendChild(row);
            const check = buildPackagePriceCheck(pkg.id);
            if (check) items.appendChild(check);
        });
    }
    root.appendChild(items);

    const actionsWrap = document.createElement("div");
    actionsWrap.className = "bc-detail-actions";

    if (convN > 0) {
        const convLink = document.createElement("a");
        convLink.className = "bc-button-link";
        convLink.href = "converter-v2.html?ingredient=" + encodeURIComponent(record.name || "");
        convLink.target = "_blank";
        convLink.textContent = `конвертация (${convN}) →`;
        actionsWrap.appendChild(convLink);
    }

    if (pkgs.length > 0) {
        const checkBtn = document.createElement("button");
        checkBtn.type = "button";
        checkBtn.textContent = "проверить цены этой позиции";
        checkBtn.onclick = () => checkIngredientPrices(record.id);
        actionsWrap.appendChild(checkBtn);
    }

    root.appendChild(actionsWrap);

    return root;
}

function buildIngredientsSummary() {
    const root = document.createElement("div");
    root.className = "ing-summary";

    const total = allRows.length;
    const newCount = allRows.filter(isNew).length;
    const incompleteCount = allRows.filter((r) => classify(r) === "incomplete").length;
    const okCount = total - incompleteCount;
    const convCount = allRows.filter((r) => (conversionsByIngredient[r.id] || []).length > 0).length;

    const title = document.createElement("h2");
    title.textContent = "Сырьё — сводка";
    root.appendChild(title);

    const stats = document.createElement("div");
    stats.className = "ing-summary-stats";
    [
        ["всего позиций", total],
        ["новые", newCount],
        ["неполные", incompleteCount],
        ["готовы (ок)", okCount],
    ].forEach(([label, value]) => {
        const cell = document.createElement("div");
        cell.className = "ing-summary-stat";
        const num = document.createElement("b");
        num.textContent = value;
        const lbl = document.createElement("span");
        lbl.textContent = label;
        cell.append(num, lbl);
        stats.appendChild(cell);
    });
    root.appendChild(stats);

    if (incompleteCount > 0) {
        const hint = document.createElement("p");
        hint.className = "ing-summary-hint";
        hint.textContent = `${incompleteCount} позиций без категории, базовой ед. или цены упаковки — загляните во вкладку «неполные».`;
        root.appendChild(hint);
    }

    const categoryCounts = new Map();
    allRows.forEach((r) => {
        const key = r.category || "без категории";
        categoryCounts.set(key, (categoryCounts.get(key) || 0) + 1);
    });
    const topCategories = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (topCategories.length > 0) {
        const catTitle = document.createElement("div");
        catTitle.className = "ing-summary-subtitle";
        catTitle.textContent = "по категориям";
        root.appendChild(catTitle);

        const chips = document.createElement("div");
        chips.className = "ing-summary-chips";
        topCategories.forEach(([name, count]) => {
            const chip = document.createElement("span");
            chip.className = "ing-summary-chip";
            chip.textContent = `${name} · ${count}`;
            chips.appendChild(chip);
        });
        root.appendChild(chips);
    }

    if (convCount > 0) {
        const convLine = document.createElement("p");
        convLine.className = "ing-summary-hint";
        convLine.textContent = `${convCount} позиций имеют настроенную конвертацию единиц.`;
        root.appendChild(convLine);
    }

    return root;
}

function renderDetail() {
    const record = findRecord(selectedId);
    const pane = document.getElementById("detailPane");
    pane.innerHTML = "";
    if (!record) {
        pane.appendChild(buildIngredientsSummary());
    } else {
        pane.appendChild(buildReadDetail(record));
    }

    const drawer = document.getElementById("detailDrawer");
    if (!drawer.classList.contains("hidden")) {
        if (!record) { closeDrawer(); return; }
        const drawerContent = document.getElementById("drawerContent");
        drawerContent.innerHTML = "";
        drawerContent.appendChild(buildReadDetail(record, { titleActions: false }));
        updateDrawerActions(record);
    }
}

function updateDrawerActions(record) {
    document.getElementById("drawerEditBtn").onclick = () => openIngredientFormEdit(record.id);
    document.getElementById("drawerDeleteBtn").onclick = () => deleteIngredient(record);
}

function openDrawer() {
    const record = findRecord(selectedId);
    if (!record) return;
    const drawerContent = document.getElementById("drawerContent");
    drawerContent.innerHTML = "";
    drawerContent.appendChild(buildReadDetail(record, { titleActions: false }));
    updateDrawerActions(record);
    document.getElementById("detailDrawer").classList.remove("hidden");
    document.documentElement.classList.add("drawer-open");
}

function closeDrawer() {
    document.getElementById("detailDrawer").classList.add("hidden");
    document.documentElement.classList.remove("drawer-open");
}

// ---- Рецепты, использующие это сырьё ----
// Отдельный drawer (десктоп: справа, мобильный: во весь экран) — открывается кнопкой-книгой
// в карточке позиции. Может открываться поверх уже открытого detailDrawer на мобильном,
// поэтому при закрытии снимаем html.drawer-open только если других drawer'ов не осталось.

function anyOtherDrawerOpen(exceptId) {
    return [...document.querySelectorAll(".bc-drawer")].some((el) => el.id !== exceptId && !el.classList.contains("hidden"));
}

async function openRecipeUsageDrawer(record) {
    const drawer = document.getElementById("recipeUsageDrawer");
    const content = document.getElementById("recipeUsageContent");
    content.innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "bc-empty";
    loading.textContent = "загрузка...";
    content.appendChild(loading);
    drawer.classList.remove("hidden");
    document.documentElement.classList.add("drawer-open");

    const { data, error } = await db
        .from("recipe_items")
        .select("qty,unit,recipe:recipes!recipe_id(id,name,is_prep,subtype)")
        .eq("ingredient_id", record.id);

    content.innerHTML = "";
    if (error) {
        const err = document.createElement("div");
        err.className = "bc-empty";
        err.textContent = "Не удалось загрузить: " + error.message;
        content.appendChild(err);
        return;
    }

    const rows = (data || []).filter((r) => r.recipe);
    if (rows.length === 0) {
        const empty = document.createElement("div");
        empty.className = "bc-empty";
        empty.textContent = "Это сырьё пока не используется ни в одном рецепте.";
        content.appendChild(empty);
        return;
    }

    rows
        .sort((a, b) => (a.recipe.name || "").localeCompare(b.recipe.name || "", "ru"))
        .forEach((row) => {
            const item = document.createElement("a");
            item.className = "bc-recipe-row ing-usage-row";
            item.href = "recipes-v2.html?id=" + encodeURIComponent(row.recipe.id);
            item.target = "_blank";

            const title = document.createElement("div");
            title.className = "ing-usage-name";
            title.textContent = row.recipe.name || "без названия";
            item.appendChild(title);

            const meta = document.createElement("div");
            meta.className = "ing-usage-meta";
            const kind = row.recipe.is_prep ? "заготовка" : (row.recipe.subtype || "рецепт");
            const qtyLabel = row.qty != null ? `${row.qty} ${row.unit || ""}`.trim() : "";
            meta.textContent = qtyLabel ? `${kind} · ${qtyLabel}` : kind;
            item.appendChild(meta);

            content.appendChild(item);
        });
}

function closeRecipeUsageDrawer() {
    document.getElementById("recipeUsageDrawer").classList.add("hidden");
    if (!anyOtherDrawerOpen("recipeUsageDrawer")) {
        document.documentElement.classList.remove("drawer-open");
    }
}

function render() {
    renderList();
    renderDetail();
}

// ---- Удаление позиции ----

function confirmPrepNameCollision(name) {
    if (!prepNameSet.has(name)) return true;
    return confirm(`«${name}» уже существует как заготовка в Рецептах. Если это сырьё для той же цели — используйте заготовку, а не заводите одноимённое сырьё, иначе они будут путаться. Всё равно создать сырьё с таким же именем?`);
}

async function deleteIngredient(record) {
    const { data: usages, error: usageError } = await db
        .from("recipe_items")
        .select("recipe:recipes!recipe_id(name)")
        .eq("ingredient_id", record.id);
    if (usageError) { showToast("Не удалось проверить использование: " + usageError.message, "error"); return; }
    if (usages.length > 0) {
        const recipeNames = [...new Set(usages.map((u) => u.recipe?.name).filter(Boolean))];
        alert(`Нельзя удалить «${record.name}» — она используется в составе рецептов:\n\n${recipeNames.join("\n")}\n\nСначала уберите её оттуда, потом удаляйте.`);
        return;
    }
    if (!confirm("Удалить эту позицию из номенклатуры?")) return;
    const { error } = await db.from("ingredients").delete().eq("id", record.id);
    if (error) { showToast("Не удалилось: " + error.message, "error"); return; }
    if (selectedId === record.id) selectedId = null;
    showToast("Удалено", "info");
    await loadIngredients();
}

// ---- Проверка цен ----

function moneyLabel(value) {
    if (value == null || isNaN(value)) return "—";
    return Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " ₽";
}

function withoutOptionalPackageFields(values) {
    return Object.fromEntries(Object.entries(values).filter(([key]) => !OPTIONAL_PACKAGE_FIELD_KEYS.includes(key)));
}

function isOptionalPackageSchemaError(error) {
    const msg = (error && error.message ? error.message : "").toLowerCase();
    return OPTIONAL_PACKAGE_FIELD_KEYS.some((key) => msg.includes(key)) || msg.includes("schema cache");
}

function buildPriceItem(ingredientId, pkg) {
    const ingredient = findRecord(ingredientId);
    if (!ingredient || !pkg || !pkg.id) return null;
    const sourceType = pkg.price_source_type || "manual";
    return {
        itemId: ingredient.id,
        itemName: ingredient.name,
        packageId: pkg.id,
        currentPricePackage: pkg.package_price ?? null,
        currentPackageSize: pkg.package_size ?? null,
        currentPackageUnit: ingredient.base_unit || null,
        source: {
            id: pkg.id, type: sourceType, title: pkg.purchase_source || sourceType,
            url: pkg.purchase_link || undefined, query: pkg.price_source_query || ingredient.name,
            enabled: pkg.price_source_enabled !== false,
        },
    };
}

function collectPriceItems() {
    const items = [];
    allRows.forEach((ingredient) => {
        (packagesByIngredient[ingredient.id] || []).forEach((pkg) => {
            if (!pkg.id || pkg.price_source_enabled === false) return;
            const item = buildPriceItem(ingredient.id, pkg);
            if (item) items.push(item);
        });
    });
    return items;
}

async function requestPriceCheck(items) {
    const baseUrl = PRICE_SERVICE_URL.replace(/\/$/, "");
    const response = await fetch(baseUrl + "/check-prices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) throw new Error(payload.error || "Сервис цен недоступен");
    return payload.results || [];
}

async function checkPackagePrice(ingredientId, pkg, packageKey) {
    const item = buildPriceItem(ingredientId, pkg);
    if (!item) return;
    packagePriceChecks[packageKey] = { state: "loading", result: null };
    renderDetail();
    showToast("Проверяю цену...", "info");
    try {
        const results = await requestPriceCheck([item]);
        packagePriceChecks[packageKey] = { state: "results", result: results[0] || null };
    } catch (error) {
        packagePriceChecks[packageKey] = { state: "error", result: { message: error.message || "Не удалось проверить цену", status: "error", packageId: packageKey } };
    }
    renderDetail();
}

function collectIngredientPriceItems(ingredientId) {
    return (packagesByIngredient[ingredientId] || [])
        .filter((pkg) => pkg.id && pkg.price_source_enabled !== false)
        .map((pkg) => buildPriceItem(ingredientId, pkg))
        .filter(Boolean);
}

async function checkIngredientPrices(ingredientId) {
    const items = collectIngredientPriceItems(ingredientId);
    if (items.length === 0) { showToast("Нет сохранённых вариантов упаковки с включённой автоценой", "error"); return; }
    items.forEach((item) => { packagePriceChecks[item.packageId] = { state: "loading", result: null }; });
    renderDetail();
    showToast("Проверяю цены...", "info");
    try {
        const results = await requestPriceCheck(items);
        results.forEach((result) => { packagePriceChecks[result.packageId] = { state: "results", result }; });
    } catch (error) {
        items.forEach((item) => { packagePriceChecks[item.packageId] = { state: "error", result: { message: error.message || "Не удалось проверить цену", status: "error", packageId: item.packageId } }; });
    }
    renderDetail();
}

async function checkAllPrices() {
    const items = collectPriceItems();
    if (items.length === 0) { showToast("Нет сохранённых включённых источников цен", "error"); return; }
    priceCheckState = "loading";
    priceCheckResults = [];
    renderPriceCheckPanel();
    showToast("Проверяю цены...", "info");
    try {
        priceCheckResults = await requestPriceCheck(items);
        priceCheckState = "results";
    } catch (error) {
        priceCheckState = "error";
        priceCheckResults = [{ message: error.message || "Не удалось проверить цены", status: "error" }];
    }
    renderPriceCheckPanel();
}

async function applyPriceResult(result) {
    if (!result.packageId || result.newPrice == null) return;
    const values = {
        package_price: result.newPrice,
        price_last_checked_at: result.fetchedAt || new Date().toISOString(),
        price_last_status: result.status,
        price_last_error: result.status === "changed" || result.status === "unchanged" ? null : (result.message || null),
    };
    const { error } = await db.from("ingredient_packages").update(values).eq("id", result.packageId);
    if (error) { showToast("Не удалось принять цену: " + error.message, "error"); return; }
    priceCheckResults = priceCheckResults.map((r) => (r.packageId === result.packageId ? { ...r, applied: true, oldPrice: result.newPrice } : r));
    Object.keys(packagePriceChecks).forEach((key) => {
        const state = packagePriceChecks[key];
        if (state?.result?.packageId === result.packageId) packagePriceChecks[key] = { ...state, result: { ...state.result, applied: true, oldPrice: result.newPrice } };
    });
    showToast("Цена принята", "info");
    await loadIngredients();
    renderPriceCheckPanel();
}

function dismissPriceResult(result) {
    priceCheckResults = priceCheckResults.filter((r) => r !== result);
    if (priceCheckResults.length === 0) priceCheckState = "idle";
    renderPriceCheckPanel();
}

function dismissPackagePriceResult(packageKey) {
    delete packagePriceChecks[packageKey];
    renderDetail();
}

function buildPackagePriceCheck(packageKey) {
    const state = packagePriceChecks[packageKey];
    if (!state) return null;
    const wrap = document.createElement("div");
    wrap.className = "package-price-check";
    if (state.state === "loading") { wrap.textContent = "Проверяю цену..."; return wrap; }
    if (!state.result) { wrap.textContent = "Сервис не вернул результат."; return wrap; }
    wrap.appendChild(buildPriceResultCard(state.result, () => dismissPackagePriceResult(packageKey)));
    return wrap;
}

function buildPriceResultCard(result, onDismiss) {
    const card = document.createElement("div");
    card.className = "price-result-card";
    if (result.warning) card.classList.add("warning");

    const name = document.createElement("div");
    name.className = "price-result-title";
    name.textContent = result.title || result.itemName || result.itemId || "Позиция";
    card.appendChild(name);

    const metaPrice = document.createElement("div");
    metaPrice.className = "price-result-meta";
    metaPrice.textContent = [
        `Было: ${moneyLabel(result.oldPrice)}`,
        `Стало: ${result.newPrice == null ? "ошибка" : moneyLabel(result.newPrice)}`,
    ].join(" · ");
    card.appendChild(metaPrice);

    const metaSource = [
        `Статус: ${result.status}`,
        result.sourceType ? `Источник: ${result.sourceType}` : "",
    ].filter(Boolean).join(" · ");
    if (metaSource) {
        const metaSourceEl = document.createElement("div");
        metaSourceEl.className = "price-result-meta";
        metaSourceEl.textContent = metaSource;
        card.appendChild(metaSourceEl);
    }

    if (result.message || result.warning) {
        const msg = document.createElement("div");
        msg.className = "field-hint";
        msg.textContent = result.warning ? `Проверьте руками: изменение ${result.diffPercent}%` : result.message;
        card.appendChild(msg);
    }

    const actions = document.createElement("div");
    actions.className = "bc-detail-actions";
    if (result.url) {
        const link = document.createElement("a");
        link.href = result.url;
        link.target = "_blank";
        link.textContent = "открыть источник";
        actions.appendChild(link);
    }
    if (result.status === "changed" && !result.applied) {
        const acceptBtn = document.createElement("button");
        acceptBtn.type = "button";
        acceptBtn.className = "primary";
        acceptBtn.textContent = "принять";
        acceptBtn.onclick = () => applyPriceResult(result);
        actions.appendChild(acceptBtn);
    }
    const keepBtn = document.createElement("button");
    keepBtn.type = "button";
    keepBtn.textContent = result.applied ? "готово" : "оставить старую";
    keepBtn.onclick = onDismiss;
    actions.appendChild(keepBtn);
    card.appendChild(actions);
    return card;
}

function renderPriceCheckPanel() {
    if (!priceCheckPanel) return;
    priceCheckPanel.innerHTML = "";
    priceCheckPanel.classList.toggle("hidden", priceCheckState === "idle");
    if (priceCheckState === "loading") { priceCheckPanel.textContent = "Проверяю цены..."; return; }

    const header = document.createElement("div");
    header.className = "price-check-header";
    const title = document.createElement("strong");
    title.textContent = priceCheckState === "error" ? "Проверка не удалась" : "Найденные изменения";
    header.appendChild(title);
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "закрыть";
    closeBtn.onclick = () => { priceCheckState = "idle"; priceCheckResults = []; renderPriceCheckPanel(); };
    header.appendChild(closeBtn);
    priceCheckPanel.appendChild(header);

    if (priceCheckResults.length === 0) {
        const empty = document.createElement("div");
        empty.className = "field-hint";
        empty.textContent = "Сервис не вернул результатов.";
        priceCheckPanel.appendChild(empty);
        return;
    }
    priceCheckResults.forEach((result) => priceCheckPanel.appendChild(buildPriceResultCard(result, () => dismissPriceResult(result))));
}

// ---- Фильтры в стиле «Рецептов» (bc-filter) ----

const filterOverlay = document.createElement("div");
filterOverlay.className = "bc-filter-overlay hidden";
document.body.appendChild(filterOverlay);
filterOverlay.addEventListener("click", (event) => {
    event.stopPropagation();
    document.querySelectorAll(".bc-filter-popup").forEach((popup) => popup.classList.add("hidden"));
    document.querySelectorAll(".bc-filter.open").forEach((el) => el.classList.remove("open"));
    filterOverlay.classList.add("hidden");
});

function closeOtherFilterPopups(popup) {
    document.querySelectorAll(".bc-filter-popup").forEach((el) => {
        if (el !== popup) { el.classList.add("hidden"); el.closest(".bc-filter")?.classList.remove("open"); }
    });
}

function createFilterTrigger(root, iconSvg) {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "bc-filter-trigger";
    let labelEl = null;
    if (iconSvg) {
        const icon = document.createElement("span");
        icon.className = "bc-filter-icon";
        icon.innerHTML = iconSvg;
        trigger.appendChild(icon);
        labelEl = document.createElement("span");
        labelEl.className = "bc-filter-label";
        trigger.appendChild(labelEl);
    }
    root.appendChild(trigger);
    return { trigger, labelEl };
}

function createMultiFilter(root, label, onChange, iconSvg, shortLabel) {
    const pillLabel = shortLabel || label;
    const filter = { value: [], options: [], search: "" };
    root.className = "bc-filter";
    root.innerHTML = "";

    const { trigger, labelEl } = createFilterTrigger(root, iconSvg);

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "bc-filter-clear hidden";
    clearBtn.textContent = "×";
    clearBtn.setAttribute("aria-label", "Сбросить фильтр «" + label + "»");
    root.appendChild(clearBtn);

    const popup = document.createElement("div");
    popup.className = "bc-filter-popup hidden";
    root.appendChild(popup);

    const search = document.createElement("input");
    search.type = "search";
    search.className = "bc-filter-search";
    search.placeholder = "поиск";
    popup.appendChild(search);

    const list = document.createElement("div");
    list.className = "bc-filter-list";
    popup.appendChild(list);

    function close() {
        popup.classList.add("hidden");
        root.classList.remove("open");
        filterOverlay.classList.add("hidden");
    }

    function triggerLabel() {
        if (filter.value.length === 0) return pillLabel;
        if (filter.value.length === 1) return filter.value[0];
        return `${pillLabel} · ${filter.value.length}`;
    }

    function renderOptions() {
        if (labelEl) labelEl.textContent = triggerLabel(); else trigger.textContent = triggerLabel();
        trigger.classList.toggle("active", filter.value.length > 0);
        clearBtn.classList.toggle("hidden", filter.value.length === 0);
        list.innerHTML = "";

        const resetBtn = document.createElement("button");
        resetBtn.type = "button";
        resetBtn.textContent = "сбросить";
        resetBtn.className = filter.value.length === 0 ? "active" : "";
        resetBtn.onclick = () => { filter.value = []; close(); renderOptions(); onChange(filter.value); };
        list.appendChild(resetBtn);

        const q = normalized(filter.search);
        filter.options
            .filter((item) => !q || normalized(item).includes(q))
            .forEach((item) => {
                const checked = filter.value.includes(item);
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "bc-filter-option" + (checked ? " active" : "");
                const box = document.createElement("span");
                box.className = "bc-filter-checkbox";
                btn.appendChild(box);
                btn.appendChild(document.createTextNode(item));
                btn.onclick = () => {
                    filter.value = checked ? filter.value.filter((v) => v !== item) : [...filter.value, item];
                    renderOptions();
                    onChange(filter.value);
                };
                list.appendChild(btn);
            });
    }

    trigger.onclick = () => {
        closeOtherFilterPopups(popup);
        popup.classList.toggle("hidden");
        const isOpen = !popup.classList.contains("hidden");
        root.classList.toggle("open", isOpen);
        filterOverlay.classList.toggle("hidden", !isOpen);
        filter.search = "";
        search.value = "";
        renderOptions();
        if (isOpen) { positionFilterPopup(trigger, popup); search.focus(); }
    };

    clearBtn.onclick = (event) => { event.stopPropagation(); filter.value = []; close(); renderOptions(); onChange(filter.value); };
    search.oninput = () => { filter.search = search.value; renderOptions(); };

    filter.setOptions = (options) => {
        filter.options = options;
        const kept = filter.value.filter((v) => options.includes(v));
        if (kept.length !== filter.value.length) { filter.value = kept; onChange(filter.value); }
        renderOptions();
    };
    filter.getSelected = () => filter.value;

    renderOptions();
    return filter;
}

function createSortFilter(root, label, options, initialValue, onChange, iconSvg) {
    const filter = { value: initialValue };
    root.className = "bc-filter";
    root.innerHTML = "";

    const { trigger, labelEl } = createFilterTrigger(root, iconSvg);

    const popup = document.createElement("div");
    popup.className = "bc-filter-popup hidden";
    root.appendChild(popup);

    const list = document.createElement("div");
    list.className = "bc-filter-list";
    popup.appendChild(list);

    function close() {
        popup.classList.add("hidden");
        root.classList.remove("open");
        filterOverlay.classList.add("hidden");
    }

    function renderOptions() {
        const current = options.find((o) => o.value === filter.value);
        const text = current ? (current.short || current.text) : "";
        if (labelEl) labelEl.textContent = text; else trigger.textContent = label + ": " + text;
        trigger.classList.add("active");
        list.innerHTML = "";
        options.forEach((opt) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "bc-filter-option" + (opt.value === filter.value ? " active" : "");
            const box = document.createElement("span");
            box.className = "bc-filter-checkbox";
            btn.appendChild(box);
            btn.appendChild(document.createTextNode(opt.text));
            btn.onclick = () => { filter.value = opt.value; close(); renderOptions(); onChange(filter.value); };
            list.appendChild(btn);
        });
    }

    trigger.onclick = () => {
        closeOtherFilterPopups(popup);
        popup.classList.toggle("hidden");
        const isOpen = !popup.classList.contains("hidden");
        root.classList.toggle("open", isOpen);
        filterOverlay.classList.toggle("hidden", !isOpen);
        renderOptions();
        if (isOpen) positionFilterPopup(trigger, popup);
    };

    renderOptions();
    return filter;
}

function createEventFilter(root, label, onChange, iconSvg) {
    const filter = { value: null, options: [] };
    root.className = "bc-filter";
    root.innerHTML = "";

    const { trigger, labelEl } = createFilterTrigger(root, iconSvg);

    const popup = document.createElement("div");
    popup.className = "bc-filter-popup hidden";
    root.appendChild(popup);

    const list = document.createElement("div");
    list.className = "bc-filter-list";
    popup.appendChild(list);

    function close() {
        popup.classList.add("hidden");
        root.classList.remove("open");
        filterOverlay.classList.add("hidden");
    }

    function renderOptions() {
        const current = filter.options.find((o) => o.value === filter.value);
        const text = current ? current.text : label;
        if (labelEl) labelEl.textContent = text; else trigger.textContent = text;
        trigger.classList.toggle("active", !!filter.value);
        list.innerHTML = "";

        const resetBtn = document.createElement("button");
        resetBtn.type = "button";
        resetBtn.textContent = "все события";
        resetBtn.className = filter.value ? "" : "active";
        resetBtn.onclick = () => { filter.value = null; close(); renderOptions(); onChange(filter.value); };
        list.appendChild(resetBtn);

        if (filter.options.length === 0) {
            const empty = document.createElement("div");
            empty.className = "field-hint";
            empty.style.padding = "10px";
            empty.textContent = "Событий пока нет";
            list.appendChild(empty);
        }

        filter.options.forEach((opt) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "bc-filter-option" + (opt.value === filter.value ? " active" : "");
            const box = document.createElement("span");
            box.className = "bc-filter-checkbox";
            btn.appendChild(box);
            btn.appendChild(document.createTextNode(opt.text));
            btn.onclick = () => { filter.value = opt.value; close(); renderOptions(); onChange(filter.value); };
            list.appendChild(btn);
        });
    }

    trigger.onclick = () => {
        closeOtherFilterPopups(popup);
        popup.classList.toggle("hidden");
        const isOpen = !popup.classList.contains("hidden");
        root.classList.toggle("open", isOpen);
        filterOverlay.classList.toggle("hidden", !isOpen);
        renderOptions();
        if (isOpen) positionFilterPopup(trigger, popup);
    };

    filter.setOptions = (options) => {
        filter.options = options;
        if (filter.value && !options.some((o) => o.value === filter.value)) {
            filter.value = null;
            onChange(filter.value);
        }
        renderOptions();
    };

    renderOptions();
    return filter;
}

document.addEventListener("click", (event) => {
    const insideFilter = event.composedPath().some((el) => el.classList && el.classList.contains("bc-filter"));
    if (!insideFilter) {
        document.querySelectorAll(".bc-filter-popup").forEach((popup) => popup.classList.add("hidden"));
        document.querySelectorAll(".bc-filter.open").forEach((el) => el.classList.remove("open"));
    }
});

// ---- Загрузка из БД ----

function refreshCategoryOptions() {
    const used = new Set(allRows.map((r) => r.category).filter(Boolean));
    const dl = document.getElementById("categoryOptionsList");
    dl.innerHTML = "";
    [...new Set([...CATEGORY_SEED, ...used])].sort((a, b) => a.localeCompare(b, "ru")).forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c;
        dl.appendChild(opt);
    });
    categoryFilter.setOptions([...used]);
}

function populateBaseUnitDatalist() {
    const dl = document.getElementById("baseUnitOptionsList");
    dl.innerHTML = "";
    UNIT_OPTIONS.forEach((u) => {
        const opt = document.createElement("option");
        opt.value = u;
        dl.appendChild(opt);
    });
}

async function loadIngredients() {
    const [ingRes, pkgRes, convRes, prepRes, eventsRes, recipeItemsRes, eventMenuRes] = await Promise.all([
        db.from("ingredients").select("*").order("name"),
        db.from("ingredient_packages").select("*"),
        db.from("unit_conversions").select("*"),
        db.from("recipes").select("name").eq("is_prep", true),
        db.from("events").select("id,name,event_date").order("event_date", { ascending: false }),
        db.from("recipe_items").select("recipe_id,ingredient_id,sub_recipe_id"),
        db.from("event_menu_items").select("event_id,recipe_id,included"),
    ]);
    if (ingRes.error) { showStatus(statusEl, "Ошибка загрузки: " + ingRes.error.message, "error"); return; }
    if (pkgRes.error) { showStatus(statusEl, "Ошибка загрузки упаковок: " + pkgRes.error.message, "error"); return; }
    if (convRes.error) { showStatus(statusEl, "Ошибка загрузки конвертаций: " + convRes.error.message, "error"); return; }

    allRows = ingRes.data;
    packagesByIngredient = {};
    pkgRes.data.forEach((p) => { (packagesByIngredient[p.ingredient_id] ||= []).push(p); });
    conversionsByIngredient = {};
    convRes.data.forEach((c) => { (conversionsByIngredient[c.ingredient_id] ||= []).push(c); });
    prepNameSet = new Set((prepRes.data || []).map((r) => r.name));

    // Фильтр по событиям — не критичен для основной страницы, поэтому при ошибке просто
    // остаётся пустым (без сырья, использованного в событиях), а не валит всю загрузку.
    eventsList = eventsRes.error ? [] : (eventsRes.data || []);
    recipeItemsByRecipe = {};
    (recipeItemsRes.data || []).forEach((it) => { (recipeItemsByRecipe[it.recipe_id] ||= []).push(it); });
    eventMenuItemsByEvent = {};
    (eventMenuRes.data || []).forEach((mi) => { (eventMenuItemsByEvent[mi.event_id] ||= []).push(mi); });
    recomputeEventFilterIngredientIds();
    if (eventFilter) eventFilter.setOptions(eventsList.map((e) => ({ value: e.id, text: e.name || "без названия" })));

    if (selectedId != null && !findRecord(selectedId)) selectedId = null;
    refreshCategoryOptions();
    render();
}

// ---- Форма позиции (аналог recipeFormDrawer / recipe-form-v2.js) ----

const ifEls = {
    drawer: document.getElementById("ingredientFormDrawer"),
    title: document.getElementById("ingredientFormTitle"),
    status: document.getElementById("ingredientFormStatus"),
    closeBtn: document.getElementById("ingredientFormCloseBtn"),
    name: document.getElementById("ifName"),
    category: document.getElementById("ifCategory"),
    baseUnit: document.getElementById("ifBaseUnit"),
    comment: document.getElementById("ifComment"),
    packages: document.getElementById("ifPackages"),
    addPackageBtn: document.getElementById("ifAddPackageBtn"),
    saveBtn: document.getElementById("ifSaveBtn"),
};

let ingFormEditingId = null;

function setIngredientFormStatus(message, kind) {
    ifEls.status.textContent = message || "";
    ifEls.status.className = "bc-status" + (message ? " show" : "");
    if (message) ifEls.status.style.borderColor = kind === "error" ? "rgba(255,59,48,.55)" : "rgba(255,103,43,.55)";
}

function buildPackageFormField(container, labelText, inputEl) {
    const wrap = document.createElement("div");
    wrap.className = "bc-field";
    const label = document.createElement("label");
    label.textContent = labelText;
    wrap.appendChild(label);
    wrap.appendChild(inputEl);
    container.appendChild(wrap);
    return inputEl;
}

function buildPackageFormRow(pkg) {
    pkg = pkg || {};
    const row = document.createElement("div");
    row.className = "ing-package-form-row";

    const grid = document.createElement("div");
    grid.className = "bc-field-row";

    const sizeInput = document.createElement("input");
    sizeInput.type = "text";
    sizeInput.inputMode = "decimal";
    sizeInput.placeholder = "500";
    buildPackageFormField(grid, "Размер", sizeInput);

    const priceInput = document.createElement("input");
    priceInput.type = "text";
    priceInput.inputMode = "decimal";
    priceInput.placeholder = "890";
    buildPackageFormField(grid, "Цена", priceInput);

    const purchaseUnitInput = document.createElement("input");
    purchaseUnitInput.type = "text";
    purchaseUnitInput.placeholder = "бутылка";
    buildPackageFormField(grid, "Закупочная ед.", purchaseUnitInput);

    const sourceSelect = document.createElement("select");
    sourceSelect.innerHTML = '<option value="">—</option>' + PURCHASE_SOURCE_OPTIONS.map((o) => `<option value="${o}">${o}</option>`).join("");
    buildPackageFormField(grid, "Источник", sourceSelect);

    const linkInput = document.createElement("input");
    linkInput.type = "text";
    linkInput.placeholder = "https://...";
    buildPackageFormField(grid, "Ссылка", linkInput);

    const parserSelect = document.createElement("select");
    parserSelect.innerHTML = PRICE_SOURCE_TYPE_OPTIONS.map((o) => `<option value="${o}">${o}</option>`).join("");
    buildPackageFormField(grid, "Парсер цены", parserSelect);

    const queryInput = document.createElement("input");
    queryInput.type = "text";
    queryInput.placeholder = "запрос для поиска цены";
    buildPackageFormField(grid, "Запрос", queryInput);

    const enabledWrap = document.createElement("label");
    enabledWrap.className = "bc-field ing-toggle-field";
    const enabledLabel = document.createElement("span");
    enabledLabel.textContent = "Автоцена";
    const enabledInput = document.createElement("input");
    enabledInput.type = "checkbox";
    enabledInput.checked = true;
    enabledWrap.appendChild(enabledInput);
    enabledWrap.appendChild(enabledLabel);
    grid.appendChild(enabledWrap);

    row.appendChild(grid);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "bc-form-item-remove ing-package-form-remove";
    removeBtn.textContent = "×";
    removeBtn.title = "Удалить вариант";
    removeBtn.onclick = () => row.remove();
    row.appendChild(removeBtn);

    sizeInput.value = pkg.package_size ?? "";
    priceInput.value = pkg.package_price ?? "";
    purchaseUnitInput.value = pkg.purchase_unit ?? "";
    sourceSelect.value = pkg.purchase_source ?? "";
    linkInput.value = pkg.purchase_link ?? "";
    parserSelect.value = pkg.price_source_type || "manual";
    queryInput.value = pkg.price_source_query ?? "";
    enabledInput.checked = pkg.price_source_enabled !== false;

    row._inputs = { sizeInput, priceInput, purchaseUnitInput, sourceSelect, linkInput, parserSelect, queryInput, enabledInput };
    enhanceSelect(sourceSelect);
    enhanceSelect(parserSelect);
    return row;
}

// Кастомный выпадающий список поверх обычного <select> — только для десктопа (см. media
// query в styles-v2.css вокруг .bc-custom-select), на мобильном остаётся нативный пикер.
// Скопировано из js/recipe-form-v2.js для визуальной консистентности с формой рецепта.
function enhanceSelect(selectEl) {
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
    new MutationObserver(renderTrigger).observe(selectEl, { childList: true });
}

ifEls.addPackageBtn.onclick = () => {
    ifEls.packages.appendChild(buildPackageFormRow());
};

function resetIngredientForm() {
    ingFormEditingId = null;
    setIngredientFormStatus("");
    ifEls.name.value = "";
    ifEls.category.value = "";
    ifEls.baseUnit.value = "";
    ifEls.comment.value = "";
    ifEls.packages.innerHTML = "";
    ifEls.packages.appendChild(buildPackageFormRow());
    ifEls.title.textContent = "Новая позиция";
    ifEls.saveBtn.textContent = "Сохранить позицию";
}

function openIngredientFormNew() {
    resetIngredientForm();
    showIngredientFormDrawer();
}

function openIngredientFormEdit(id) {
    const record = findRecord(id);
    if (!record) return;
    resetIngredientForm();
    ingFormEditingId = id;
    ifEls.title.textContent = "Редактировать позицию";
    ifEls.saveBtn.textContent = "Сохранить изменения";
    ifEls.name.value = record.name || "";
    ifEls.category.value = record.category || "";
    ifEls.baseUnit.value = record.base_unit || "";
    ifEls.comment.value = record.comment || "";

    const pkgs = packagesByIngredient[id] || [];
    ifEls.packages.innerHTML = "";
    if (pkgs.length === 0) {
        ifEls.packages.appendChild(buildPackageFormRow());
    } else {
        pkgs.forEach((pkg) => ifEls.packages.appendChild(buildPackageFormRow(pkg)));
    }
    showIngredientFormDrawer();
}

function showIngredientFormDrawer() {
    ifEls.drawer.classList.remove("hidden");
    document.documentElement.classList.add("drawer-open");
}

function closeIngredientFormDrawer() {
    ifEls.drawer.classList.add("hidden");
    document.documentElement.classList.remove("drawer-open");
}

ifEls.closeBtn.onclick = closeIngredientFormDrawer;
ifEls.drawer.addEventListener("click", (event) => {
    if (event.target === ifEls.drawer) closeIngredientFormDrawer();
});

function readPackageFormRow(row) {
    const { sizeInput, priceInput, purchaseUnitInput, sourceSelect, linkInput, parserSelect, queryInput, enabledInput } = row._inputs;
    const size = sizeInput.value.trim();
    const price = priceInput.value.trim();
    const purchaseUnit = purchaseUnitInput.value.trim();
    const link = linkInput.value.trim();
    const query = queryInput.value.trim();
    if (!size && !price && !purchaseUnit && !link && !query) return null; // пустая строка — не сохраняем как вариант
    return {
        package_size: size ? Number(size.replace(",", ".")) : null,
        package_price: price ? Number(price.replace(",", ".")) : null,
        purchase_unit: purchaseUnit || null,
        purchase_source: sourceSelect.value || null,
        purchase_link: link || null,
        price_source_type: parserSelect.value || "manual",
        price_source_query: query || null,
        price_source_enabled: enabledInput.checked,
    };
}

async function insertPackagesForIngredient(ingredientId, packageValues) {
    if (packageValues.length === 0) return;
    const rows = packageValues.map((v) => ({ ...v, ingredient_id: ingredientId }));
    let { error } = await db.from("ingredient_packages").insert(rows);
    if (error && isOptionalPackageSchemaError(error)) {
        const legacyRows = rows.map((v) => ({ ...withoutOptionalPackageFields(v), ingredient_id: ingredientId }));
        ({ error } = await db.from("ingredient_packages").insert(legacyRows));
        if (!error) showToast("Упаковки сохранены частично: нужно накатить schema_purchase_source.sql и schema_price_sources.sql", "error");
    }
    if (error) showToast("Позиция сохранена, но упаковки — нет: " + error.message, "error");
}

ifEls.saveBtn.onclick = async () => {
    const name = ifEls.name.value.trim();
    if (!name) { setIngredientFormStatus("Заполните название.", "error"); return; }
    const existing = allRows.find((r) => normalized(r.name) === normalized(name));
    if (existing && existing.id !== ingFormEditingId) {
        setIngredientFormStatus(`Позиция с названием «${name}» уже есть в номенклатуре.`, "error");
        return;
    }
    if (!confirmPrepNameCollision(name)) return;

    setIngredientFormStatus("Сохраняем…");
    const values = {
        name,
        category: ifEls.category.value.trim() || null,
        base_unit: ifEls.baseUnit.value.trim() || null,
        comment: ifEls.comment.value.trim() || null,
    };

    const packageValues = [...ifEls.packages.children].map(readPackageFormRow).filter(Boolean);

    let ingredientId = ingFormEditingId;
    if (ingredientId) {
        const { error } = await db.from("ingredients").update(values).eq("id", ingredientId);
        if (error) { setIngredientFormStatus("Не сохранилось: " + error.message, "error"); return; }
        await db.from("ingredient_packages").delete().eq("ingredient_id", ingredientId);
    } else {
        const { data, error } = await db.from("ingredients").insert(values).select("id").single();
        if (error) { setIngredientFormStatus("Не сохранилось: " + error.message, "error"); return; }
        ingredientId = data.id;
    }

    await insertPackagesForIngredient(ingredientId, packageValues);

    closeIngredientFormDrawer();
    selectedId = ingredientId;
    showToast(ingFormEditingId ? `«${name}» обновлена` : `«${name}» сохранена`, "info");
    await loadIngredients();
};

// ---- Быстрый ввод пачкой ----

const BULK_FIELDS = [
    { key: "name" }, { key: "category" }, { key: "base_unit" }, { key: "purchase_unit" },
    { key: "package_size" }, { key: "package_price" }, { key: "purchase_link" }, { key: "comment" },
];

async function bulkImport() {
    const text = document.getElementById("bulkInput").value.trim();
    if (!text) return;
    const rows = text.split("\n").map((line) => line.split("\t")).filter((cols) => cols.some((c) => c.trim()));
    if (rows.length === 0) return;

    const groups = new Map();
    rows.forEach((cols) => {
        const record = {};
        BULK_FIELDS.forEach((field, i) => {
            const raw = (cols[i] || "").trim();
            record[field.key] = raw === "" ? null : raw;
        });
        if (!record.name) return;
        if (!groups.has(record.name)) groups.set(record.name, { meta: {}, variants: [] });
        const g = groups.get(record.name);
        if (!g.meta.category && record.category) g.meta.category = record.category;
        if (!g.meta.base_unit && record.base_unit) g.meta.base_unit = record.base_unit;
        if (!g.meta.comment && record.comment) g.meta.comment = record.comment;
        if (record.package_size != null || record.package_price != null || record.purchase_unit != null || record.purchase_link != null) {
            g.variants.push({
                package_size: record.package_size != null ? Number(String(record.package_size).replace(",", ".")) : null,
                package_price: record.package_price != null ? Number(String(record.package_price).replace(",", ".")) : null,
                purchase_unit: record.purchase_unit, purchase_link: record.purchase_link,
            });
        }
    });

    if (groups.size === 0) { showToast("Не нашёл ни одной строки с названием", "error"); return; }

    const collisions = [...groups.keys()].filter((name) => prepNameSet.has(name));
    if (collisions.length > 0) {
        const proceed = confirm(`Уже существуют как заготовки в Рецептах: ${collisions.map((n) => `«${n}»`).join(", ")}. Всё равно продолжить импорт?`);
        if (!proceed) return;
    }

    const ingredientRecords = [...groups.entries()].map(([name, g]) => ({
        name, category: g.meta.category || null, base_unit: g.meta.base_unit || null, comment: g.meta.comment || null,
    }));
    const { data: inserted, error } = await db.from("ingredients").insert(ingredientRecords).select("id,name");
    if (error) { showToast("Ошибка импорта: " + error.message, "error"); return; }

    const byName = new Map(inserted.map((i) => [i.name, i.id]));
    const packagesToInsert = [];
    for (const [name, g] of groups) {
        const id = byName.get(name);
        if (!id) continue;
        g.variants.forEach((v) => packagesToInsert.push({ ingredient_id: id, ...v }));
    }
    if (packagesToInsert.length > 0) await db.from("ingredient_packages").insert(packagesToInsert);

    document.getElementById("bulkInput").value = "";
    showToast(`Позиций: ${inserted.length}, вариантов упаковки: ${packagesToInsert.length}`, "info");
    await loadIngredients();
}

// ---- Экспорт / импорт Excel ----

const EXCEL_HEADER_MAP = {
    "ID": "id", "ID упаковки": "package_id", "Название": "name", "Категория": "category",
    "Базовая ед.": "base_unit", "Закупочная ед.": "purchase_unit", "Источник": "purchase_source",
    "Размер упаковки": "package_size", "Цена упаковки": "package_price", "Ссылка": "purchase_link",
    "Парсер цены": "price_source_type", "Запрос цены": "price_source_query",
    "Автоцена включена": "price_source_enabled", "Комментарий": "comment",
};

function exportExcel() {
    const rows = [];
    allRows.forEach((r) => {
        const pkgs = packagesByIngredient[r.id] || [];
        if (pkgs.length === 0) {
            rows.push({
                ID: r.id, "ID упаковки": "", Название: r.name, Категория: r.category, "Базовая ед.": r.base_unit,
                "Закупочная ед.": null, Источник: null, "Размер упаковки": null, "Цена упаковки": null, Ссылка: null,
                "Парсер цены": null, "Запрос цены": null, "Автоцена включена": null, Комментарий: r.comment,
            });
        } else {
            pkgs.forEach((p) => {
                rows.push({
                    ID: r.id, "ID упаковки": p.id, Название: r.name, Категория: r.category, "Базовая ед.": r.base_unit,
                    "Закупочная ед.": p.purchase_unit, "Размер упаковки": p.package_size, "Цена упаковки": p.package_price,
                    Источник: p.purchase_source, Ссылка: p.purchase_link, "Парсер цены": p.price_source_type,
                    "Запрос цены": p.price_source_query, "Автоцена включена": p.price_source_enabled, Комментарий: r.comment,
                });
            });
        }
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Номенклатура");
    XLSX.writeFile(wb, "nomenklatura.xlsx");
}

async function importExcelFile(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const sheetRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    const existingById = new Map(allRows.map((r) => [r.id, r]));
    const existingByName = new Map(allRows.map((r) => [r.name, r]));
    const parsed = [];
    const errors = [];

    sheetRows.forEach((row, idx) => {
        const rec = {};
        Object.entries(EXCEL_HEADER_MAP).forEach(([header, key]) => {
            let val = row[header];
            if (val === "" || val === undefined) val = null;
            rec[key] = val;
        });
        if (!rec.name) { errors.push(`Строка ${idx + 2}: пустое название — пропущена`); return; }
        if (rec.package_size !== null) rec.package_size = Number(rec.package_size);
        if (rec.package_price !== null) rec.package_price = Number(rec.package_price);
        if (rec.price_source_enabled !== null) {
            const enabledText = String(rec.price_source_enabled).trim().toLowerCase();
            rec.price_source_enabled = !["false", "0", "нет", "no", "выкл"].includes(enabledText);
        }
        parsed.push(rec);
    });

    const newCollisions = [...new Set(parsed.filter((rec) => !existingByName.has(rec.name) && prepNameSet.has(rec.name)).map((rec) => rec.name))];
    if (newCollisions.length > 0) {
        const proceed = confirm(`Уже существуют как заготовки в Рецептах: ${newCollisions.map((n) => `«${n}»`).join(", ")}. Всё равно продолжить импорт?`);
        if (!proceed) return;
    }

    let updated = 0, inserted = 0, packagesAdded = 0, packagesUpdated = 0;
    const resolvedIngredientId = new Map();

    for (const rec of parsed) {
        let ingredientId = resolvedIngredientId.get(rec.name);
        if (!ingredientId) {
            let targetId = null;
            if (rec.id && existingById.has(rec.id)) targetId = rec.id;
            else if (existingByName.has(rec.name)) targetId = existingByName.get(rec.name).id;

            const ingredientValues = { name: rec.name, category: rec.category, base_unit: rec.base_unit, comment: rec.comment };
            if (targetId) {
                const { error } = await db.from("ingredients").update(ingredientValues).eq("id", targetId);
                if (error) { errors.push(`«${rec.name}»: ${error.message}`); continue; }
                ingredientId = targetId; updated++;
            } else {
                const { data, error } = await db.from("ingredients").insert(ingredientValues).select("id").single();
                if (error) { errors.push(`«${rec.name}»: ${error.message}`); continue; }
                ingredientId = data.id; inserted++;
            }
            resolvedIngredientId.set(rec.name, ingredientId);
        }

        if (rec.package_size == null && rec.package_price == null) continue;
        const values = {
            package_size: rec.package_size, package_price: rec.package_price,
            purchase_unit: rec.purchase_unit, purchase_source: rec.purchase_source, purchase_link: rec.purchase_link,
            price_source_type: rec.price_source_type || "manual", price_source_query: rec.price_source_query,
            price_source_enabled: rec.price_source_enabled !== false,
        };
        const existingPkg = rec.package_id && (packagesByIngredient[ingredientId] || []).find((p) => p.id === rec.package_id);
        if (existingPkg) {
            const { error } = await db.from("ingredient_packages").update(values).eq("id", rec.package_id);
            if (error) errors.push(`«${rec.name}» (упаковка): ${error.message}`); else packagesUpdated++;
        } else if (!packageAlreadyExists(ingredientId, rec.package_size, rec.package_price)) {
            const { error } = await db.from("ingredient_packages").insert({ ingredient_id: ingredientId, ...values });
            if (error) errors.push(`«${rec.name}» (упаковка): ${error.message}`); else packagesAdded++;
        }
    }

    showToast(
        `Позиций: обновлено ${updated}, добавлено ${inserted}. Упаковок: обновлено ${packagesUpdated}, добавлено ${packagesAdded}` + (errors.length ? `, ошибок: ${errors.length}` : ""),
        errors.length ? "error" : "info"
    );
    if (errors.length) alert("Не всё получилось:\n\n" + errors.join("\n"));
    await loadIngredients();
}

// ---- Обвязка UI ----

const statusTabsEl = document.getElementById("statusTabs");
const statusButtons = [...statusTabsEl.querySelectorAll("button")];
const statusThumb = statusTabsEl.querySelector(".bc-segmented-thumb");
let activeStatusButton = statusButtons[0];

function setStatusThumb(btn) {
    if (btn) activeStatusButton = btn;
    if (!statusThumb || !activeStatusButton) return;
    statusThumb.style.transform = "none";
    statusThumb.style.left = activeStatusButton.offsetLeft + "px";
    statusThumb.style.width = activeStatusButton.offsetWidth + "px";
}

window.addEventListener("resize", () => setStatusThumb());

statusButtons.forEach((btn) => {
    btn.onclick = () => {
        statusFilter = btn.dataset.status;
        statusButtons.forEach((b) => b.classList.toggle("active", b === btn));
        setStatusThumb(btn);
        renderList();
    };
});

setStatusThumb(statusButtons[0]);
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => setStatusThumb());
}

// На мобильном/при скролле панель фильтров сжимается в компактные круглые кнопки
// (см. .bc-recipes-sticky.compact в CSS) — та же логика, что и во вкладке «Рецепты».
const ingredientsStickyEl = document.getElementById("ingredientsSticky");
if (ingredientsStickyEl) {
    // rAF-throttling + гистерезис (разные пороги входа/выхода) убирают дёрганье,
    // которое возникало от частых scroll-событий и переключения класса туда-обратно
    // на границе одного порога.
    let compactRaf = null;
    let isCompact = false;
    const updateCompact = () => {
        compactRaf = null;
        const scrolled = window.scrollY || document.documentElement.scrollTop || 0;
        const wasCompact = isCompact;
        if (!isCompact && scrolled > 40) isCompact = true;
        else if (isCompact && scrolled < 16) isCompact = false;
        ingredientsStickyEl.classList.toggle("compact", isCompact);
        // Компакт-режим меняет раскладку сегментов (grid -> inline-flex) — без
        // пересчёта скользящий "thumb" остаётся на координатах старой раскладки.
        if (isCompact !== wasCompact) setStatusThumb();
    };
    window.addEventListener("scroll", () => {
        if (compactRaf === null) compactRaf = requestAnimationFrame(updateCompact);
    }, { passive: true });
}

document.getElementById("addRowBtn").onclick = openIngredientFormNew;

// Быстрое добавление с главной (index-v2.html?new=1 -> ingredients-v2.html?new=1) —
// сразу открывает форму новой позиции, не требуя лишнего клика.
if (new URLSearchParams(location.search).get("new") === "1") openIngredientFormNew();
document.getElementById("searchInput").oninput = (e) => { searchQuery = e.target.value.trim().toLowerCase(); renderList(); };

document.getElementById("closeDrawerBtn").onclick = closeDrawer;
document.getElementById("detailDrawer").onclick = (e) => { if (e.target.id === "detailDrawer") closeDrawer(); };

document.getElementById("closeRecipeUsageBtn").onclick = closeRecipeUsageDrawer;
document.getElementById("recipeUsageDrawer").onclick = (e) => { if (e.target.id === "recipeUsageDrawer") closeRecipeUsageDrawer(); };

document.getElementById("toolsBtn").onclick = () => {
    document.getElementById("toolsOverlay").classList.remove("hidden");
    document.documentElement.classList.add("drawer-open");
};
document.getElementById("closeToolsBtn").onclick = () => {
    document.getElementById("toolsOverlay").classList.add("hidden");
    document.documentElement.classList.remove("drawer-open");
};
document.getElementById("toolsOverlay").onclick = (e) => { if (e.target.id === "toolsOverlay") document.getElementById("closeToolsBtn").click(); };

document.getElementById("checkAllPricesBtn").onclick = checkAllPrices;
document.getElementById("bulkImportBtn").onclick = bulkImport;
document.getElementById("exportExcelBtn").onclick = exportExcel;
document.getElementById("importExcelBtn").onclick = () => document.getElementById("excelFileInput").click();
document.getElementById("excelFileInput").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await importExcelFile(file);
    e.target.value = "";
};

if (!isDbConfigured()) {
    showStatus(statusEl, "База данных ещё не подключена — впишите SUPABASE_URL и SUPABASE_ANON_KEY в js/supabase-client.js", "error");
} else {
    populateBaseUnitDatalist();
    const ICON_CATEGORY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
    const ICON_SORT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 5v14M8 5 5 8M8 5l3 3M16 19V5M16 19l-3-3M16 19l3-3"/></svg>';
    const ICON_EVENT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3"/></svg>';
    categoryFilter = createMultiFilter(document.getElementById("categoryFilter"), "категория", renderList, ICON_CATEGORY, "катег.");
    createSortFilter(document.getElementById("sortFilter"), "сортировка", [
        { value: "name_asc", text: "по алфавиту А→Я", short: "А→Я" },
        { value: "name_desc", text: "по алфавиту Я→А", short: "Я→А" },
        { value: "category", text: "по категории", short: "катег." },
        { value: "price_asc", text: "по цене: дешевле→дороже", short: "цена ↑" },
        { value: "price_desc", text: "по цене: дороже→дешевле", short: "цена ↓" },
    ], sortMode, (value) => { sortMode = value; renderList(); }, ICON_SORT);
    eventFilter = createEventFilter(document.getElementById("eventFilter"), "событ.", (value) => {
        eventFilterValue = value;
        recomputeEventFilterIngredientIds();
        renderList();
    }, ICON_EVENT);
    loadIngredients();
}

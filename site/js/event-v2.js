// Страница одного мероприятия (v2). Полностью независимый контроллер (по образцу
// recipes-v2.js/calculator-v2.js — не переиспользует js/event.js), но использует без изменений
// чистый расчётный движок js/event-calc.js (computeEventTotals/computeBudget/bestPackageCombo),
// а также js/constants.js, js/format.js и js/recipe-detail.js.

const statusEl = document.getElementById("status");
const eventId = new URLSearchParams(window.location.search).get("id");

let eventRow = null;
let recipesById = {};       // id -> запись рецепта
let recipeIdByName = {};    // normalized(name) -> id, для клика по вложенной заготовке в составе
let itemsByRecipe = {};     // recipeId -> [{name, qty, unit, is_topup, topup_default_qty, isSub, targetId}]
let ingredientsByName = {}; // name -> { id, category, base_unit }
let packagesByIngredientId = {}; // ingredientId -> [{package_size, package_price, purchase_unit, purchase_link}]
let conversionsByIngredientId = {}; // ingredientId -> { from_unit -> coefficient }
let menuItems = [];         // [{recipe_id, qty_portions}]
let ingredientStateMap = {}; // ingredient_id -> is_checked
let prepStateMap = {};       // recipe_id -> { container_size, is_checked, expand_nested, buy_ready }
let manualItems = [];        // [{id, name, qty, unit, category, cost, is_checked}]

let activeTab = "menu";
let pickerSearch = "";
let pickerFilter = "all";
let pickerSort = "name";
let pickerSpirit = "all";

const els = {
    recipePickerBtn: document.getElementById("recipePickerBtn"),
    recipePickerPopup: document.getElementById("recipePickerPopup"),
    recipeSearchInput: document.getElementById("recipeSearchInput"),
    recipePickerSpirit: document.getElementById("recipePickerSpirit"),
    recipePickerFilters: document.getElementById("recipePickerFilters"),
    recipePickerSorts: document.getElementById("recipePickerSorts"),
    recipePickerList: document.getElementById("recipePickerList"),
};

// Кастомная "галочка" вместо нативного чекбокса — единый визуальный язык с остальным сайтом.
function createCheckButton(checked, disabled, onToggle) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ev-check" + (checked ? " checked" : "") + (disabled ? " disabled" : "");
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17 19 7"/></svg>';
    if (!disabled) btn.onclick = () => onToggle(!checked);
    return btn;
}

// Кастомный тумблер (переиспользует .ev-switch/.ev-switch-slider из event-v2.css).
function createSwitch(checked, onToggle) {
    const label = document.createElement("span");
    label.className = "ev-switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.onchange = () => onToggle(input.checked);
    const slider = document.createElement("span");
    slider.className = "ev-switch-slider";
    label.appendChild(input);
    label.appendChild(slider);
    return label;
}

function formatDate(d) {
    if (!d) return "без даты";
    const [y, m, day] = d.split("-");
    return `${day}.${m}.${y}`;
}

function normalized(value) {
    return String(value || "").trim().toLowerCase();
}

// Склонение существительного по числу: pluralize(3, ["порция","порции","порций"]) -> "порции".
function pluralize(n, forms) {
    const mod100 = Math.abs(Math.round(n)) % 100;
    const mod10 = mod100 % 10;
    if (mod100 > 10 && mod100 < 20) return forms[2];
    if (mod10 > 1 && mod10 < 5) return forms[1];
    if (mod10 === 1) return forms[0];
    return forms[2];
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

// ---- Карточка рецепта (bc-drawer) — порт renderDrawer/openDrawer из recipes-v2.js,
// чтобы клик по рецепту открывал ТУ ЖЕ карточку, что и на странице "Рецепты", а не
// старую v1-панель (js/recipe-detail.js). ----

function editUrl(id) {
    return "recipes.html?edit=" + encodeURIComponent(id);
}

function addText(parent, tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text;
    parent.appendChild(el);
    return el;
}

function addMeta(container, key, value) {
    if (!value) return;
    const row = document.createElement("div");
    addText(row, "span", "", key);
    addText(row, "b", "", value);
    container.appendChild(row);
}

function itemTargetId(item) {
    if (item.targetId) return item.targetId;
    return recipeIdByName[normalized(item.name)] || null;
}

function qtyText(item) {
    if (item.is_topup) return "топом";
    const qty = Number(item.qty || 0);
    const value = qty ? formatNum(qty) : item.qty;
    return [value, item.unit].filter((v) => v !== null && v !== undefined && v !== "").join(" ") || "-";
}

function recipeVolumeText(recipe) {
    if (recipe.is_prep && recipe.yield_qty) return formatQty(recipe.yield_qty, recipe.yield_unit || "");
    const items = itemsByRecipe[recipe.id] || [];
    let ml = 0;
    let hasMl = false;
    const other = [];
    items.forEach((item) => {
        const unit = normalized(item.unit);
        if (item.is_topup) {
            const estimate = Number(item.topup_default_qty || 0);
            if (estimate > 0) { ml += estimate; hasMl = true; }
            return;
        }
        const qty = Number(item.qty || 0);
        if (!qty) return;
        if (unit === "мл" || unit === "ml") { ml += qty; hasMl = true; }
        else if (unit) other.push(formatQty(qty, item.unit));
    });
    const parts = [];
    if (hasMl) parts.push(formatQty(ml, "мл"));
    if (other.length > 0) parts.push(other.slice(0, 2).join(" + "));
    return parts.join(" + ");
}

function purchaseSummary(recipe) {
    const parts = [];
    if (recipe.purchase_package_size) parts.push(formatQty(recipe.purchase_package_size, recipe.purchase_unit || ""));
    if (recipe.purchase_package_price) parts.push(formatMoney(recipe.purchase_package_price));
    if (recipe.purchase_category) parts.push(recipe.purchase_category);
    return parts.join(" / ");
}

function renderDrawerItems(container, recipeId) {
    const items = itemsByRecipe[recipeId] || [];
    if (items.length === 0) {
        addText(container, "div", "drawer-row", "Состав пока не указан");
        return;
    }
    items.forEach((item) => {
        const targetId = itemTargetId(item);
        const row = document.createElement("div");
        row.className = "drawer-row";
        const name = document.createElement(targetId ? "button" : "span");
        name.textContent = item.name;
        if (targetId) {
            name.type = "button";
            name.className = "drawer-link";
            name.onclick = () => openDrawer(targetId, false);
        }
        const qty = document.createElement("span");
        qty.textContent = qtyText(item);
        row.appendChild(name);
        row.appendChild(qty);
        container.appendChild(row);
    });
}

const drawerEls = {
    drawer: document.getElementById("detailDrawer"),
    breadcrumbs: document.getElementById("drawerBreadcrumbs"),
    content: document.getElementById("drawerContent"),
    editLink: document.getElementById("drawerEditLink"),
    closeBtn: document.getElementById("closeDrawerBtn"),
};
let drawerStack = [];

function openDrawer(id, reset = true) {
    if (!recipesById[id]) return;
    if (reset || drawerStack.length === 0) drawerStack = [id];
    else if (drawerStack[drawerStack.length - 1] !== id) drawerStack.push(id);
    drawerEls.drawer.classList.remove("hidden");
    document.documentElement.classList.add("drawer-open");
    renderDrawerContent();
}

function closeDrawer() {
    drawerStack = [];
    drawerEls.drawer.classList.add("hidden");
    document.documentElement.classList.remove("drawer-open");
}

function renderDrawerBreadcrumbs() {
    drawerEls.breadcrumbs.innerHTML = "";
    if (drawerStack.length <= 1) return;
    drawerStack.forEach((id, index) => {
        const recipe = recipesById[id];
        if (!recipe) return;
        if (index > 0) addText(drawerEls.breadcrumbs, "span", "bc-crumb-sep", "/");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = index === 0 ? "← " + recipe.name : recipe.name;
        btn.disabled = index === drawerStack.length - 1;
        btn.onclick = () => { drawerStack = drawerStack.slice(0, index + 1); renderDrawerContent(); };
        drawerEls.breadcrumbs.appendChild(btn);
    });
}

function renderDrawerContent() {
    const id = drawerStack[drawerStack.length - 1];
    const recipe = recipesById[id];
    if (!recipe) { closeDrawer(); return; }

    renderDrawerBreadcrumbs();
    drawerEls.editLink.href = editUrl(recipe.id);
    drawerEls.content.innerHTML = "";

    addText(drawerEls.content, "h3", "", recipe.name);

    const subline = document.createElement("div");
    subline.className = "drawer-subline";
    addText(subline, "span", "bc-type-badge", recipeKind(recipe));
    const extra = [recipe.subtype, recipe.main_spirit].filter(Boolean).join(" / ");
    if (extra) addText(subline, "span", "muted", extra);
    drawerEls.content.appendChild(subline);

    if (recipe.image_url) {
        const img = document.createElement("img");
        img.className = "drawer-image";
        img.src = recipe.image_url;
        img.alt = recipe.name;
        drawerEls.content.appendChild(img);
    }

    const comp = document.createElement("div");
    comp.className = "drawer-section";
    addText(comp, "h4", "", "Ингредиенты");
    const compList = document.createElement("div");
    compList.className = "drawer-list";
    renderDrawerItems(compList, recipe.id);
    comp.appendChild(compList);
    drawerEls.content.appendChild(comp);

    const meta = document.createElement("div");
    meta.className = "drawer-meta";
    addMeta(meta, "Выход", recipeVolumeText(recipe));
    addMeta(meta, "Тип", recipe.subtype || "");
    addMeta(meta, "Ингредиентов", String((itemsByRecipe[recipe.id] || []).length));
    addMeta(meta, "Бокал", recipe.glass || "");
    addMeta(meta, "Основа", recipe.main_spirit || "");
    if (recipe.is_prep) {
        addMeta(meta, "Время", recipe.labor_minutes ? `${formatNum(recipe.labor_minutes)} мин` : "");
        addMeta(meta, "Закупка", purchaseSummary(recipe));
    }
    drawerEls.content.appendChild(meta);

    if (recipe.description) {
        const sec = document.createElement("div");
        sec.className = "drawer-section";
        addText(sec, "h4", "", "Метод");
        addText(sec, "div", "drawer-text", recipe.description);
        drawerEls.content.appendChild(sec);
    }
    if (recipe.notes) {
        const sec = document.createElement("div");
        sec.className = "drawer-section";
        addText(sec, "h4", "", "Заметки");
        addText(sec, "div", "drawer-text", recipe.notes);
        drawerEls.content.appendChild(sec);
    }
    if (recipe.source_url) {
        const link = document.createElement("a");
        link.className = "source-link";
        link.href = recipe.source_url;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "Источник";
        drawerEls.content.appendChild(link);
    }
}

drawerEls.closeBtn.onclick = closeDrawer;
drawerEls.drawer.addEventListener("click", (e) => { if (e.target === drawerEls.drawer) closeDrawer(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !drawerEls.drawer.classList.contains("hidden")) closeDrawer(); });

// ---- Модалка подтверждения (напр. удаление позиции из меню) ----

const confirmEls = {
    overlay: document.getElementById("confirmOverlay"),
    message: document.getElementById("confirmMessage"),
    okBtn: document.getElementById("confirmOkBtn"),
    cancelBtn: document.getElementById("confirmCancelBtn"),
};

function openConfirm(message, onConfirm) {
    confirmEls.message.textContent = message;
    confirmEls.overlay.classList.remove("hidden");
    confirmEls.okBtn.onclick = () => { confirmEls.overlay.classList.add("hidden"); onConfirm(); };
}

confirmEls.cancelBtn.onclick = () => confirmEls.overlay.classList.add("hidden");
confirmEls.overlay.addEventListener("click", (e) => { if (e.target === confirmEls.overlay) confirmEls.overlay.classList.add("hidden"); });

// ---- Редактирование информации о мероприятии ----

const eventEditEls = {
    overlay: document.getElementById("eventEditOverlay"),
    name: document.getElementById("editEvName"),
    date: document.getElementById("editEvDate"),
    guests: document.getElementById("editEvGuests"),
    budget: document.getElementById("editEvBudget"),
    comment: document.getElementById("editEvComment"),
    closeBtn: document.getElementById("eventEditCloseBtn"),
    saveBtn: document.getElementById("eventEditSaveBtn"),
};

function openEventEdit() {
    eventEditEls.name.value = eventRow.name || "";
    eventEditEls.date.value = eventRow.event_date || "";
    eventEditEls.guests.value = eventRow.guests_count ?? "";
    eventEditEls.budget.value = eventRow.plan_budget ?? "";
    eventEditEls.comment.value = eventRow.comment || "";
    eventEditEls.overlay.classList.remove("hidden");
}

function closeEventEdit() {
    eventEditEls.overlay.classList.add("hidden");
}

async function saveEventEdit() {
    const name = eventEditEls.name.value.trim();
    if (!name) { showToast("Заполните название мероприятия", "error"); return; }
    const patch = {
        name,
        event_date: eventEditEls.date.value || null,
        guests_count: eventEditEls.guests.value.trim() ? Number(eventEditEls.guests.value.trim()) : null,
        plan_budget: eventEditEls.budget.value.trim() ? Number(eventEditEls.budget.value.trim().replace(",", ".")) : null,
        comment: eventEditEls.comment.value.trim() || null,
    };
    const { error } = await db.from("events").update(patch).eq("id", eventId);
    if (error) { showToast("Не сохранилось: " + error.message, "error"); return; }
    eventRow = { ...eventRow, ...patch };
    closeEventEdit();
    renderHeader();
    refreshAfterChange();
}

document.getElementById("editEventBtn").onclick = openEventEdit;
eventEditEls.closeBtn.onclick = closeEventEdit;
eventEditEls.saveBtn.onclick = saveEventEdit;
eventEditEls.overlay.addEventListener("click", (e) => { if (e.target === eventEditEls.overlay) closeEventEdit(); });

// ---- Загрузка ----

async function loadAll() {
    const [evRes, recRes, itemsRes, ingRes, pkgRes, convRes, menuRes, ingStateRes, prepStateRes, manualRes] = await Promise.all([
        db.from("events").select("*").eq("id", eventId).single(),
        db.from("recipes").select("*"),
        db.from("recipe_items").select("recipe_id, qty, unit, is_topup, topup_default_qty, ingredient_id, sub_recipe_id, ingredient:ingredients(name), sub_recipe:recipes!sub_recipe_id(name)"),
        db.from("ingredients").select("id,name,category,base_unit"),
        db.from("ingredient_packages").select("ingredient_id,package_size,package_price,purchase_unit,purchase_source,purchase_link"),
        db.from("unit_conversions").select("ingredient_id,from_unit,coefficient"),
        db.from("event_menu_items").select("recipe_id, qty_portions").eq("event_id", eventId).eq("included", true),
        db.from("event_ingredient_state").select("ingredient_id, is_checked").eq("event_id", eventId),
        db.from("event_prep_state").select("recipe_id, container_size, is_checked, expand_nested, buy_ready").eq("event_id", eventId),
        db.from("event_manual_items").select("*").eq("event_id", eventId),
    ]);

    for (const res of [evRes, recRes, itemsRes, ingRes, pkgRes, convRes, menuRes, ingStateRes, prepStateRes]) {
        if (res.error) {
            showStatus(statusEl, "Ошибка загрузки: " + res.error.message, "error");
            return false;
        }
    }
    manualItems = manualRes.error ? [] : manualRes.data;

    eventRow = evRes.data;

    recipesById = {};
    recipeIdByName = {};
    recRes.data.forEach((r) => { recipesById[r.id] = r; recipeIdByName[normalized(r.name)] = r.id; });

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

    return true;
}

function renderHeader() {
    document.getElementById("evName").textContent = eventRow.name;
    const parts = [formatDate(eventRow.event_date)];
    if (eventRow.guests_count) parts.push(`${eventRow.guests_count} гостей`);
    if (eventRow.plan_budget) parts.push(`бюджет ${formatMoney(eventRow.plan_budget)}`);
    if (eventRow.comment) parts.push(eventRow.comment);
    document.getElementById("evMeta").textContent = parts.join(" · ");
}

// ---- Вкладки (bc-segmented — тот же скользящий "thumb", что и в recipes-v2.js) ----

const TABS = [["menu", "меню"], ["preps", "заготовки"], ["shopping", "закупка"], ["issues", "проблемы"]];
let tabButtons = [];
let tabThumb = null;

function setupTabs() {
    const el = document.getElementById("evTabs");
    tabThumb = el.querySelector(".bc-segmented-thumb");
    tabButtons = TABS.map(([id, label]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.tab = id;
        btn.textContent = label;
        btn.className = activeTab === id ? "active" : "";
        btn.onclick = () => selectTab(id);
        el.appendChild(btn);
        return btn;
    });
    setTabThumb();
    window.addEventListener("resize", () => setTabThumb());
}

function setTabThumb() {
    if (!tabThumb) return;
    const activeBtn = tabButtons.find((b) => b.dataset.tab === activeTab);
    if (!activeBtn) return;
    tabThumb.style.left = activeBtn.offsetLeft + "px";
    tabThumb.style.width = activeBtn.offsetWidth + "px";
}

function selectTab(id) {
    activeTab = id;
    tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
    setTabThumb();
    document.querySelectorAll(".ev-tab").forEach((sec) => sec.classList.toggle("active", sec.dataset.tab === activeTab));
    renderActiveTab();
}

function renderActiveTab() {
    if (activeTab === "menu") renderMenu();
    if (activeTab === "preps") renderPreps();
    if (activeTab === "shopping") renderShopping();
    if (activeTab === "issues") renderIssues();
}

// ---- Сводка (kpi-карточки вверху) ----

function eventTotalsSafe() {
    if (menuItems.length === 0) return { ingredientTotals: [], prepTotals: [] };
    return computeEventTotals(menuItems, recipesById, itemsByRecipe, prepStateMap, ingredientsByName, conversionsByIngredientId);
}

function renderSummary() {
    const { ingredientTotals, prepTotals } = eventTotalsSafe();
    const { totalCost, lines } = computeBudget(ingredientTotals, ingredientsByName, packagesByIngredientId);
    const manualCost = manualItems.reduce((sum, m) => sum + (m.cost || 0), 0);

    const portions = menuItems.reduce((sum, m) => sum + Number(m.qty_portions || 0), 0);
    const cocktails = menuItems.filter((m) => Number(m.qty_portions) > 0).length;
    const liters = prepTotals.reduce((sum, p) => {
        if (p.unit === "л") return sum + Number(p.neededQty || 0);
        if (p.unit === "мл") return sum + Number(p.neededQty || 0) / 1000;
        return sum;
    }, 0);
    const issuesCount = computeIssues().length;

    const el = document.getElementById("evSummary");
    el.innerHTML = "";
    [
        [String(portions), pluralize(portions, ["порция", "порции", "порций"]), false],
        [String(cocktails), pluralize(cocktails, ["коктейль", "коктейля", "коктейлей"]), false],
        [`${formatNum(liters)} л`, "заготовок", false],
        [String(issuesCount), pluralize(issuesCount, ["проблема", "проблемы", "проблем"]), issuesCount > 0],
        [formatMoney(totalCost + manualCost), "стоимость", false],
    ].forEach(([value, label, warn]) => {
        const stat = document.createElement("div");
        stat.className = "ev-stat";
        const b = document.createElement("b");
        b.textContent = value;
        if (warn) b.style.color = "var(--red)";
        const span = document.createElement("span");
        span.textContent = label;
        stat.appendChild(b);
        stat.appendChild(span);
        el.appendChild(stat);
    });
}

function refreshAfterChange() {
    renderSummary();
    renderActiveTab();
}

// ---- Пикер "+ добавить рецепт" (по образцу bc-calc-picker из calculator-v2.js) ----

const PICKER_FILTERS = [["all", "все"], ["cocktail", "коктейли"], ["shot", "шоты"], ["infusion", "настойки"], ["custom", "кастом"]];
const PICKER_SORTS = [["name", "а-я"], ["kind", "по типу"]];

function pickerSearchText(recipe) {
    return [recipe.name, recipe.subtype, recipeKind(recipe)].filter(Boolean).join(" ").toLowerCase();
}

function pickerVisibleRecipes() {
    const needle = normalized(pickerSearch);
    const chosenIds = new Set(menuItems.map((m) => m.recipe_id));
    return Object.values(recipesById)
        .filter((r) => !chosenIds.has(r.id))
        .filter((r) => !r.is_prep || GUEST_SERVABLE_PREP_SUBTYPES.includes(r.subtype))
        .filter((r) => !needle || pickerSearchText(r).includes(needle))
        .filter((r) => pickerFilter === "all" || recipeBucket(r) === pickerFilter)
        .filter((r) => pickerSpirit === "all" || normalized(r.main_spirit) === pickerSpirit)
        .sort((a, b) => {
            if (pickerSort === "kind") {
                const c = recipeKind(a).localeCompare(recipeKind(b), "ru");
                if (c) return c;
            }
            return a.name.localeCompare(b.name, "ru");
        })
        .slice(0, 80);
}

function renderPickerControls() {
    const selectedSpirit = els.recipePickerSpirit.value || pickerSpirit;
    const spirits = [...new Set(Object.values(recipesById).map((r) => r.main_spirit).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
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
    els.recipePickerSpirit.value = [...els.recipePickerSpirit.options].some((o) => o.value === selectedSpirit) ? selectedSpirit : "all";

    els.recipePickerFilters.innerHTML = "";
    PICKER_FILTERS.forEach(([value, label]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.className = pickerFilter === value ? "active" : "";
        btn.onclick = () => { pickerFilter = value; renderPicker(); };
        els.recipePickerFilters.appendChild(btn);
    });

    els.recipePickerSorts.innerHTML = "";
    PICKER_SORTS.forEach(([value, label]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.className = pickerSort === value ? "active" : "";
        btn.onclick = () => { pickerSort = value; renderPicker(); };
        els.recipePickerSorts.appendChild(btn);
    });
}

function renderPicker() {
    renderPickerControls();
    els.recipePickerList.innerHTML = "";
    const visible = pickerVisibleRecipes();
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
        btn.className = "bc-calc-picker-option";
        btn.setAttribute("role", "option");
        const name = document.createElement("span");
        name.textContent = recipe.name;
        const kind = document.createElement("small");
        kind.textContent = recipeKind(recipe);
        btn.appendChild(name);
        btn.appendChild(kind);
        btn.onclick = () => { addMenuItem(recipe.id); closePicker(); };
        els.recipePickerList.appendChild(btn);
    });
}

function openPicker() {
    els.recipePickerPopup.classList.remove("hidden");
    els.recipePickerBtn.setAttribute("aria-expanded", "true");
    renderPicker();
    els.recipeSearchInput.focus();
}

function closePicker() {
    els.recipePickerPopup.classList.add("hidden");
    els.recipePickerBtn.setAttribute("aria-expanded", "false");
}

els.recipePickerBtn.onclick = () => {
    if (els.recipePickerPopup.classList.contains("hidden")) openPicker();
    else closePicker();
};
els.recipeSearchInput.oninput = () => { pickerSearch = els.recipeSearchInput.value; renderPicker(); };
els.recipePickerSpirit.onchange = () => { pickerSpirit = els.recipePickerSpirit.value; renderPicker(); };
document.addEventListener("click", (event) => {
    // composedPath(), а не target — клик по фильтру/сортировке тут же перерисовывает
    // список кнопок (innerHTML=""), кликнутая кнопка удаляется из DOM ещё до того, как
    // событие дойдёт сюда по всплытию, и .contains(event.target) на отсоединённом узле
    // всегда вернёт false, из-за чего попап закрывался при любом клике внутри себя.
    const path = event.composedPath();
    if (!path.includes(document.getElementById("recipePicker"))) closePicker();
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePicker();
});

// ---- Вкладка "Меню": состав барной карты ----

async function addMenuItem(recipeId) {
    const recipe = recipesById[recipeId];
    const defaultQty = (recipe && recipe.is_prep && recipe.yield_qty) ? recipe.yield_qty : 1;
    const { error } = await db.from("event_menu_items").insert({ event_id: eventId, recipe_id: recipeId, included: true, qty_portions: defaultQty });
    if (error) { showStatus(statusEl, "Не получилось добавить: " + error.message, "error"); return; }
    menuItems.push({ recipe_id: recipeId, qty_portions: defaultQty });
    selectTab("menu");
    refreshAfterChange();
}

async function removeMenuItem(recipeId) {
    await db.from("event_menu_items").delete().eq("event_id", eventId).eq("recipe_id", recipeId);
    menuItems = menuItems.filter((m) => m.recipe_id !== recipeId);
    refreshAfterChange();
}

async function updateMenuItemQty(recipeId, qty) {
    await db.from("event_menu_items").update({ qty_portions: qty }).eq("event_id", eventId).eq("recipe_id", recipeId);
    const m = menuItems.find((mi) => mi.recipe_id === recipeId);
    if (m) m.qty_portions = qty;
    refreshAfterChange();
}

// ---- Поиск/фильтр/сортировка уже добавленных в меню позиций ----

let menuSearch = "";
let menuFilter = "all";
let menuSort = "name";

function setupMenuToolbar() {
    const search = document.getElementById("menuSearchInput");
    search.oninput = () => { menuSearch = search.value; renderMenu(); };

    const filtersEl = document.getElementById("menuFilterChips");
    filtersEl.innerHTML = "";
    PICKER_FILTERS.forEach(([value, label]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.className = menuFilter === value ? "active" : "";
        btn.onclick = () => {
            menuFilter = value;
            [...filtersEl.children].forEach((b) => b.classList.toggle("active", b === btn));
            renderMenu();
        };
        filtersEl.appendChild(btn);
    });

    const sortsEl = document.getElementById("menuSortChips");
    sortsEl.innerHTML = "";
    [["name", "а-я"], ["kind", "по типу"], ["portions", "по количеству"]].forEach(([value, label]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.className = menuSort === value ? "active" : "";
        btn.onclick = () => {
            menuSort = value;
            [...sortsEl.children].forEach((b) => b.classList.toggle("active", b === btn));
            renderMenu();
        };
        sortsEl.appendChild(btn);
    });
}

function renderMenu() {
    const listEl = document.getElementById("evMenuList");
    listEl.innerHTML = "";
    if (menuItems.length === 0) {
        const empty = document.createElement("div");
        empty.className = "bc-empty";
        empty.textContent = "Пока ни один рецепт не выбран — нажмите «+ добавить в меню».";
        listEl.appendChild(empty);
        return;
    }

    const needle = normalized(menuSearch);
    const visible = menuItems.filter((m) => {
        const r = recipesById[m.recipe_id];
        if (!r) return false;
        if (needle && !r.name.toLowerCase().includes(needle)) return false;
        if (menuFilter !== "all" && recipeBucket(r) !== menuFilter) return false;
        return true;
    });

    if (visible.length === 0) {
        const empty = document.createElement("div");
        empty.className = "bc-empty";
        empty.textContent = "Ничего не найдено.";
        listEl.appendChild(empty);
        return;
    }

    visible
        .slice()
        .sort((a, b) => {
            const ra = recipesById[a.recipe_id];
            const rb = recipesById[b.recipe_id];
            if (menuSort === "kind") {
                const c = recipeKind(ra).localeCompare(recipeKind(rb), "ru");
                if (c) return c;
            }
            if (menuSort === "portions") {
                const c = Number(b.qty_portions || 0) - Number(a.qty_portions || 0);
                if (c) return c;
            }
            return (ra?.name || "").localeCompare(rb?.name || "", "ru");
        })
        .forEach((m, idx) => {
            const r = recipesById[m.recipe_id];
            if (!r) return;
            const row = document.createElement("div");
            row.className = "ev-row";

            const index = document.createElement("span");
            index.className = "ev-row-index";
            index.textContent = String(idx + 1).padStart(2, "0");
            row.appendChild(index);

            const nameWrap = document.createElement("span");
            nameWrap.className = "ev-row-name";
            const strong = document.createElement("strong");
            strong.textContent = r.name;
            strong.style.cursor = "pointer";
            strong.title = "Открыть карточку рецепта";
            strong.onclick = () => openDrawer(r.id);
            const sub = document.createElement("span");
            sub.textContent = recipeKind(r);
            nameWrap.appendChild(strong);
            nameWrap.appendChild(sub);
            row.appendChild(nameWrap);

            const stepper = document.createElement("span");
            stepper.className = "ev-stepper";
            const minus = document.createElement("button");
            minus.type = "button";
            minus.textContent = "−";
            minus.onclick = () => updateMenuItemQty(m.recipe_id, Math.max(0, Number(m.qty_portions) - 1));
            const input = document.createElement("input");
            input.type = "text";
            input.inputMode = "decimal";
            input.value = m.qty_portions;
            input.onchange = () => {
                const v = Number(String(input.value).replace(",", "."));
                if (!v || v < 0) { input.value = m.qty_portions; return; }
                updateMenuItemQty(m.recipe_id, v);
            };
            const plus = document.createElement("button");
            plus.type = "button";
            plus.textContent = "+";
            plus.onclick = () => updateMenuItemQty(m.recipe_id, Number(m.qty_portions) + 1);
            stepper.appendChild(minus);
            stepper.appendChild(input);
            stepper.appendChild(plus);
            row.appendChild(stepper);

            // qty_portions хранит то же количество, что вписано в степпер: для коктейлей — число
            // порций, для заготовок, поданных гостю напрямую (настойка/кастом алкоголь) — итоговый
            // нужный объём в yield_unit рецепта (см. js/event.js renderMenuItems).
            const needed = document.createElement("span");
            needed.className = "ev-needed";
            const b = document.createElement("b");
            b.textContent = r.is_prep ? formatQty(m.qty_portions, r.yield_unit || "") : `${formatNum(m.qty_portions)} порц.`;
            const small = document.createElement("span");
            small.textContent = r.is_prep ? "нужно всего" : "порций всего";
            needed.appendChild(b);
            needed.appendChild(small);
            row.appendChild(needed);

            row.appendChild(Object.assign(document.createElement("button"), {
                type: "button",
                className: "bc-icon-btn",
                textContent: "×",
                title: "Убрать из меню",
                onclick: () => openConfirm(`Вы действительно хотите удалить «${r.name}» из меню?`, () => removeMenuItem(m.recipe_id)),
            }));

            listEl.appendChild(row);
        });
}

// ---- Вкладка "Проблемы" ----

function conversionWarningLink(entry) {
    const link = document.createElement("a");
    link.href = "converter.html?ingredient=" + encodeURIComponent(entry.name) + "&unit=" + encodeURIComponent(entry.unit || "");
    link.target = "_blank";
    link.textContent = "задать в Конвертере";
    return link;
}

function computeIssues() {
    if (menuItems.length === 0) return [];
    const { ingredientTotals, prepTotals } = eventTotalsSafe();
    const { lines } = computeBudget(ingredientTotals, ingredientsByName, packagesByIngredientId);
    const issues = [];

    lines.forEach((entry) => {
        if (entry.isTopup) return;
        if (entry.conversionMissing) {
            issues.push({ text: `«${entry.name}»: нет коэффициента конвертации для единицы «${entry.unit}»`, fixHref: "converter.html?ingredient=" + encodeURIComponent(entry.name) + "&unit=" + encodeURIComponent(entry.unit || ""), fixLabel: "Задать в Конвертере" });
            return;
        }
        if (entry.isBoughtPrep) {
            if (entry.cost === null || entry.cost === undefined) {
                issues.push({ text: `«${entry.name}» (покупное): не указана закупочная упаковка или цена`, fixHref: "recipes.html?edit=" + encodeURIComponent(entry.recipeId), fixLabel: "Заполнить в Рецептах" });
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
            issues.push({ text: `«${name}»: не указан выход партии`, fixHref: p.recipeId ? "recipes.html?edit=" + encodeURIComponent(p.recipeId) : null, fixLabel: "Заполнить в Рецептах" });
        }
        if (p.cyclic) {
            issues.push({ text: `«${name}»: обнаружена циклическая ссылка на заготовку — расчёт может быть неполным`, fixHref: p.recipeId ? "recipes.html?edit=" + encodeURIComponent(p.recipeId) : null, fixLabel: "Открыть в Рецептах" });
        }
    });

    return issues;
}

function renderIssues() {
    const el = document.getElementById("evIssuesList");
    el.innerHTML = "";
    const issues = computeIssues();
    if (issues.length === 0) {
        const empty = document.createElement("div");
        empty.className = "bc-empty";
        empty.textContent = menuItems.length === 0 ? "Сначала соберите меню на вкладке «Меню»." : "Проблем не найдено — данные для расчёта заполнены полностью.";
        el.appendChild(empty);
        return;
    }
    issues.forEach((issue) => {
        const row = document.createElement("div");
        row.className = "ev-issue-row";
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

// ---- Вкладка "Закупка" ----

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
    if (!name) { showToast("Заполните название позиции", "error"); return; }
    const qty = qtyInput.value.trim() ? Number(qtyInput.value.trim().replace(",", ".")) : null;
    const cost = costInput.value.trim() ? Number(costInput.value.trim().replace(",", ".")) : null;

    const { data, error } = await db
        .from("event_manual_items")
        .insert({ event_id: eventId, name, qty, unit: unitInput.value.trim() || null, category: categoryInput.value.trim() || null, cost, is_checked: false })
        .select("*")
        .single();
    if (error) { showToast("Не сохранилось: " + error.message, "error"); return; }
    manualItems.push(data);
    nameInput.value = ""; qtyInput.value = ""; unitInput.value = ""; categoryInput.value = ""; costInput.value = "";
    refreshAfterChange();
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

function formatPackageCombo(combo) {
    return combo.combo.map((c) => {
        const sourceLabel = c.purchase_source ? ` (${c.purchase_source})` : "";
        return `${c.count}× ${formatQty(c.package_size, c.purchase_unit)}${sourceLabel}`;
    }).join(", ");
}

function renderShopping() {
    const listEl = document.getElementById("evShoppingList");
    listEl.innerHTML = "";

    const { ingredientTotals } = eventTotalsSafe();
    const { totalCost: computedCost, lines } = computeBudget(ingredientTotals, ingredientsByName, packagesByIngredientId);

    const manualLines = manualItems.map((m) => ({ isManual: true, manualId: m.id, name: m.name, qty: m.qty, unit: m.unit, category: m.category, cost: m.cost, is_checked: m.is_checked }));
    const allLines = [...lines, ...manualLines];

    if (allLines.length === 0) {
        const empty = document.createElement("div");
        empty.className = "bc-empty";
        empty.textContent = "Сначала соберите меню на вкладке «Меню» или добавьте позицию вручную выше.";
        listEl.appendChild(empty);
        document.getElementById("evBudgetTotal").textContent = "";
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
        group.className = "ev-category-group";
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
                row.className = "ev-check-row" + (checked ? " checked" : "");
                row.appendChild(createCheckButton(checked, false, async (v) => { await toggleManualItemChecked(entry.manualId, v); renderShopping(); }));
                const name = document.createElement("span");
                name.className = "ev-check-name";
                name.textContent = entry.name + " (вручную)";
                row.appendChild(name);
                const qty = document.createElement("span");
                qty.className = "ev-check-qty";
                qty.textContent = formatQty(entry.qty, entry.unit);
                row.appendChild(qty);
                const cost = document.createElement("span");
                cost.className = "ev-check-cost";
                cost.textContent = entry.cost !== null && entry.cost !== undefined ? formatMoney(entry.cost) : "нет цены";
                row.appendChild(cost);
                const delBtn = document.createElement("button");
                delBtn.type = "button";
                delBtn.className = "bc-icon-btn";
                delBtn.textContent = "×";
                delBtn.title = "Удалить";
                delBtn.onclick = async () => { await deleteManualItem(entry.manualId); renderShopping(); };
                row.appendChild(delBtn);
                group.appendChild(row);
                return;
            }

            const ing = entry.isBoughtPrep ? null : ingredientsByName[entry.name];
            const checked = isShoppingEntryChecked(entry);
            const canCheck = entry.isBoughtPrep || !!ing;

            const row = document.createElement("div");
            row.className = "ev-check-row" + (checked ? " checked" : "");
            row.appendChild(createCheckButton(checked, !canCheck, async (v) => {
                if (entry.isBoughtPrep) await updatePrepState(entry.recipeId, { is_checked: v });
                else await toggleIngredientChecked(ing.id, v);
                renderShopping();
            }));

            const name = document.createElement("span");
            name.className = "ev-check-name";
            name.textContent = entry.name + (entry.isBoughtPrep ? " (готовое)" : "");
            if (entry.isBoughtPrep) {
                name.style.cursor = "pointer";
                name.title = "Открыть карточку рецепта";
                name.onclick = () => openDrawer(entry.recipeId);
            }
            row.appendChild(name);

            const qty = document.createElement("span");
            qty.className = "ev-check-qty";
            qty.textContent = entry.isTopup ? `≈ ${formatQty(entry.qty, entry.unit)} (топом)` : formatQty(entry.qty, entry.unit);
            row.appendChild(qty);

            const cost = document.createElement("span");
            cost.className = "ev-check-cost";
            cost.textContent = entry.cost !== null && entry.cost !== undefined ? formatMoney(entry.cost) : "нет цены";
            row.appendChild(cost);

            group.appendChild(row);

            if (!entry.isBoughtPrep) {
                const packLine = document.createElement("div");
                packLine.className = "ev-pack-line";
                if (entry.conversionMissing) {
                    packLine.classList.add("warn");
                    packLine.append("Нет коэффициента для «" + entry.unit + "» — ", conversionWarningLink(entry));
                } else if (entry.packageCombo) {
                    packLine.textContent = "Купить: " + formatPackageCombo(entry.packageCombo);
                } else if (ing) {
                    packLine.classList.add("warn");
                    packLine.textContent = "Нет вариантов упаковки — добавьте в Номенклатуре";
                }
                if (packLine.textContent || packLine.childElementCount > 0) group.appendChild(packLine);
            }
        });

        listEl.appendChild(group);
    });

    const budget = document.getElementById("evBudgetTotal");
    budget.className = "ev-budget-total" + (eventRow.plan_budget && totalCost > eventRow.plan_budget ? " over" : "");
    budget.textContent = `Итого по закупке: ${formatMoney(totalCost)}` + (eventRow.plan_budget ? ` из бюджета ${formatMoney(eventRow.plan_budget)}` : "");
}

function buildShoppingMarkdown() {
    const { ingredientTotals } = eventTotalsSafe();
    const { totalCost: computedCost, lines } = computeBudget(ingredientTotals, ingredientsByName, packagesByIngredientId);
    const manualLines = manualItems.map((m) => ({ isManual: true, name: m.name, qty: m.qty, unit: m.unit, category: m.category, cost: m.cost, is_checked: m.is_checked }));
    const totalCost = computedCost + manualLines.reduce((sum, m) => sum + (m.cost || 0), 0);

    const byCategory = new Map();
    [...lines, ...manualLines].forEach((entry) => {
        const cat = entry.category || "Без категории";
        (byCategory.get(cat) || byCategory.set(cat, []).get(cat)).push(entry);
    });

    const md = [`# Список покупок — ${eventRow.name}`, ""];
    [...byCategory.keys()].sort((a, b) => a.localeCompare(b, "ru")).forEach((cat) => {
        md.push(`## ${cat}`, "");
        byCategory.get(cat).slice().sort((a, b) => a.name.localeCompare(b.name, "ru")).forEach((entry) => {
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

// ---- Вкладка "Заготовки": многоуровневое раскрытие вложенных заготовок
// (порт renderRecipeTree/renderCalcRow из calculator-v2.js — тот же приём "+/− строка,
// отступ по уровню, доля от максимума в виде полоски") ----

let expandedTreeKeys = new Set();

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

function renderPrepTreeRow(container, row, options) {
    const item = document.createElement("div");
    item.className = "bc-calc-row" + (row.type === "sub" ? " is-sub" : "");
    if (row.isTopup) item.classList.add("is-topup");
    if (options.level > 0) item.classList.add("is-tree");
    item.style.setProperty("--level", String(options.level || 0));

    const canExpand = row.type === "sub" && row.recipeId && (itemsByRecipe[row.recipeId] || []).length > 0;
    const name = canExpand ? document.createElement("button") : document.createElement("span");
    name.className = "bc-calc-row-name";
    if (canExpand) {
        name.type = "button";
        name.classList.add("has-tree");
        name.textContent = `${expandedTreeKeys.has(options.key) ? "−" : "+"} ${row.name}`;
        name.onclick = () => {
            if (expandedTreeKeys.has(options.key)) expandedTreeKeys.delete(options.key);
            else expandedTreeKeys.add(options.key);
            renderPreps();
        };
    } else {
        name.textContent = row.name;
    }

    const perOne = document.createElement("span");
    perOne.className = "bc-calc-row-base";
    perOne.textContent = row.perOne ? formatQty(row.perOne, row.unit) : "-";

    const target = document.createElement("span");
    target.className = "bc-calc-row-target";
    target.textContent = row.isTopup ? "топом" : formatQty(row.qty, row.unit);

    const share = document.createElement("span");
    share.className = "bc-calc-share";
    const bar = document.createElement("i");
    bar.style.width = row.isTopup ? "28%" : Math.max(5, Math.min(100, (Number(row.qty || 0) / options.maxQty) * 100)) + "%";
    share.appendChild(bar);

    item.appendChild(name);
    item.appendChild(perOne);
    item.appendChild(target);
    item.appendChild(share);
    container.appendChild(item);
}

function renderPrepTree(container, recipeId, requiredQty, requiredUnit, level, path) {
    const recipe = recipesById[recipeId];
    if (!recipe || !recipe.yield_qty) return;
    const qtyInRecipeUnit = amountInRecipeYieldUnit(requiredQty, requiredUnit || recipe.yield_unit, recipe);
    const factor = qtyInRecipeUnit / Number(recipe.yield_qty || 1);
    const items = itemsByRecipe[recipeId] || [];
    if (items.length === 0) return;
    const maxQty = Math.max(...items.map((item) => Number(item.qty || item.topup_default_qty || 0) * factor), 1);

    items.forEach((item, index) => {
        const isSub = item.isSub && item.targetId;
        const subRecipe = isSub ? recipesById[item.targetId] : null;
        const unit = item.is_topup ? "" : (item.unit || (subRecipe && subRecipe.yield_unit) || "");
        const qty = item.is_topup ? Number(item.topup_default_qty || 0) : Number(item.qty || 0) * factor;
        const row = {
            type: isSub ? "sub" : "ingredient",
            name: item.name,
            perOne: item.is_topup ? item.topup_default_qty : item.qty,
            qty,
            unit,
            isTopup: item.is_topup,
            recipeId: isSub ? item.targetId : null,
        };
        const key = `${path}>${index}:${item.targetId || item.name}:${normalized(unit)}`;
        renderPrepTreeRow(container, row, { maxQty, level, key });
        if (isSub && expandedTreeKeys.has(key)) {
            renderPrepTree(container, item.targetId, qty, unit, level + 1, key);
        }
    });
}

// ---- Вкладка "Заготовки" ----

async function updatePrepState(recipeId, patch) {
    const current = prepStateMap[recipeId] || { container_size: null, is_checked: false, expand_nested: false, buy_ready: false };
    const next = { ...current, ...patch };
    prepStateMap[recipeId] = next;
    await db.from("event_prep_state").upsert({ event_id: eventId, recipe_id: recipeId, ...next }, { onConflict: "event_id,recipe_id" });
}

function renderPreps() {
    const listEl = document.getElementById("evPrepsList");

    // FLIP: запоминаем текущее положение карточек, чтобы после пересортировки (по галочке)
    // они не перескакивали мгновенно, а плавно "переезжали" на новое место.
    const prevRects = new Map();
    listEl.querySelectorAll(".ev-prep-card[data-recipe-id]").forEach((card) => {
        prevRects.set(card.dataset.recipeId, card.getBoundingClientRect());
    });

    listEl.innerHTML = "";

    if (menuItems.length === 0) {
        const empty = document.createElement("div");
        empty.className = "bc-empty";
        empty.textContent = "Сначала соберите меню на вкладке «Меню».";
        listEl.appendChild(empty);
        return;
    }

    const { prepTotals } = eventTotalsSafe();

    if (prepTotals.length === 0) {
        const empty = document.createElement("div");
        empty.className = "bc-empty";
        empty.textContent = "В выбранных рецептах нет заготовок — готовить ничего не нужно.";
        listEl.appendChild(empty);
        return;
    }

    const sorted = prepTotals.slice().sort((a, b) => {
        const checkedA = prepStateMap[a.recipeId] ? !!prepStateMap[a.recipeId].is_checked : false;
        const checkedB = prepStateMap[b.recipeId] ? !!prepStateMap[b.recipeId].is_checked : false;
        if (checkedA !== checkedB) return checkedA ? 1 : -1;
        return ((a.recipe && a.recipe.name) || "").localeCompare((b.recipe && b.recipe.name) || "", "ru");
    });

    sorted.forEach((p) => {
        const state = prepStateMap[p.recipeId] || { container_size: null, is_checked: false, expand_nested: false, buy_ready: false };
        const card = document.createElement("div");
        card.className = "ev-prep-card" + (state.is_checked ? " checked" : "");
        card.dataset.recipeId = p.recipeId;

        const head = document.createElement("div");
        head.className = "ev-prep-head";
        const checkBtn = createCheckButton(!!state.is_checked, false, async (v) => { await updatePrepState(p.recipeId, { is_checked: v }); refreshAfterChange(); });
        checkBtn.title = p.buyReady ? "Отметить как купленное" : "Отметить как приготовленное";
        head.appendChild(checkBtn);

        const title = document.createElement("div");
        title.className = "ev-prep-title";
        title.textContent = ((p.recipe && p.recipe.name) || "?") + (p.buyReady ? " (покупаем готовое)" : "");
        head.appendChild(title);

        const qty = document.createElement("div");
        qty.className = "ev-prep-qty";
        if (p.buyReady) {
            qty.textContent = `нужно ${formatQty(p.neededQty, p.unit)}`;
        } else if (p.yieldMissing) {
            qty.classList.add("warn");
            qty.append(`нужно ${formatQty(p.neededQty, p.unit)} — нет выхода партии — `, Object.assign(document.createElement("a"), { href: "recipes.html?edit=" + encodeURIComponent(p.recipeId), target: "_blank", textContent: "заполнить" }));
        } else {
            qty.textContent = `нужно ${formatQty(p.neededQty, p.unit)} (×${formatNum(p.coefficient)})`;
        }
        head.appendChild(qty);
        card.appendChild(head);

        if (!state.is_checked) {
            const buyRow = document.createElement("div");
            buyRow.className = "ev-switch-row";
            buyRow.appendChild(createSwitch(!!state.buy_ready, async (v) => { await updatePrepState(p.recipeId, { buy_ready: v }); refreshAfterChange(); }));
            buyRow.appendChild(document.createTextNode("Купить готовое вместо приготовления"));
            card.appendChild(buyRow);

            if (p.buyReady && p.recipe && !(p.recipe.purchase_package_size && p.recipe.purchase_package_price)) {
                const hint = document.createElement("div");
                hint.className = "ev-prep-hint";
                hint.append("Цена не посчитана — заполните закупочную упаковку и цену в карточке рецепта, ", Object.assign(document.createElement("a"), { href: "recipes.html?edit=" + encodeURIComponent(p.recipeId), target: "_blank", textContent: "открыть карточку" }));
                card.appendChild(hint);
            }
        }

        if (!state.is_checked && !p.buyReady) {
            const body = document.createElement("div");
            body.className = "ev-prep-body";

            if (p.laborMinutes !== null && p.laborMinutes !== undefined) {
                const time = document.createElement("div");
                time.textContent = `≈ ${formatNum(p.laborMinutes)} мин на приготовление`;
                body.appendChild(time);
            }

            if (!p.yieldMissing) {
                const taraField = document.createElement("div");
                taraField.className = "form-field";
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
                    taraResult.textContent = `нужно тары: ${count} шт.`;
                    body.appendChild(taraResult);
                }
            }

            const expandBtn = document.createElement("button");
            expandBtn.type = "button";
            expandBtn.className = "ev-expand-toggle";
            expandBtn.textContent = (state.expand_nested ? "▾ " : "▸ ") + "раскрыть вложенные заготовки";
            expandBtn.onclick = async () => { await updatePrepState(p.recipeId, { expand_nested: !state.expand_nested }); renderPreps(); };
            body.appendChild(expandBtn);

            card.appendChild(body);

            if (state.expand_nested) {
                const treeBox = document.createElement("div");
                treeBox.className = "bc-calc-table";
                treeBox.style.marginTop = "10px";
                const head = document.createElement("div");
                head.className = "bc-calc-table-head";
                ["сырьё", "на 1", "на партию", "доля"].forEach((label) => addText(head, "span", "", label));
                treeBox.appendChild(head);
                const rows = document.createElement("div");
                rows.className = "bc-calc-rows";
                treeBox.appendChild(rows);
                renderPrepTree(rows, p.recipeId, p.neededQty, p.unit, 0, "prep:" + p.recipeId);
                card.appendChild(treeBox);
            }

            if (p.cyclic) {
                const warn = document.createElement("div");
                warn.className = "ev-prep-hint";
                warn.textContent = "Обнаружена циклическая ссылка на заготовку — расчёт может быть неполным.";
                card.appendChild(warn);
            }
        }

        listEl.appendChild(card);
    });

    if (prevRects.size > 0) {
        requestAnimationFrame(() => {
            listEl.querySelectorAll(".ev-prep-card[data-recipe-id]").forEach((card) => {
                const prev = prevRects.get(card.dataset.recipeId);
                if (!prev) return;
                const next = card.getBoundingClientRect();
                const dy = prev.top - next.top;
                if (!dy) return;
                card.style.transition = "none";
                card.style.transform = `translateY(${dy}px)`;
                requestAnimationFrame(() => {
                    card.style.transition = "";
                    card.style.transform = "";
                });
            });
        });
    }
}

// ---- Липнущая при скролле полоска вкладок (по образцу .bc-recipes-sticky из recipes-v2.js —
// без перехвата тапа, как у calculator-v2: там он нужен только потому, что кнопка сжимается
// до маленького кружка-пикера, а наши вкладки остаются нормально кликабельными и сжатыми) ----

function setupStickyTabs() {
    const stickyEl = document.getElementById("evSticky");
    const workspaceEl = document.querySelector(".bc-v2-content");
    if (!stickyEl || !workspaceEl) return;

    const updateCompact = () => {
        const scrolled = Math.max(workspaceEl.scrollTop, window.scrollY || document.documentElement.scrollTop || 0);
        stickyEl.classList.toggle("compact", scrolled > 24);
        // Ширина/паддинг кнопок меняются в компакт-режиме — скользящий "thumb" нужно пересчитать.
        setTabThumb();
    };
    workspaceEl.addEventListener("scroll", updateCompact);
    window.addEventListener("scroll", updateCompact);
}

// ---- Кнопка "+ добавить рецепт": на мобильном живёт внутри вкладки "Меню", а не в шапке ----

function setupAddPickerPlacement() {
    const picker = document.getElementById("recipePicker");
    const headerActions = document.querySelector(".ev-header-actions");
    const menuTab = document.querySelector('.ev-tab[data-tab="menu"]');
    const mq = window.matchMedia("(max-width: 1080px)");

    const place = () => {
        if (mq.matches) {
            if (picker.parentElement !== menuTab) menuTab.insertBefore(picker, menuTab.firstChild);
        } else if (picker.parentElement !== headerActions) {
            headerActions.appendChild(picker);
        }
    };
    place();
    mq.addEventListener("change", place);
}

// ---- Инициализация ----

async function init() {
    if (!isDbConfigured()) { showStatus(statusEl, "База данных не подключена", "error"); return; }
    if (!eventId) { showStatus(statusEl, "Не указано мероприятие", "error"); return; }
    populateManualItemDatalists();
    setupTabs();
    setupStickyTabs();
    setupAddPickerPlacement();
    setupMenuToolbar();
    const ok = await loadAll();
    if (!ok) return;
    renderHeader();
    renderSummary();
    renderMenu();
}

init();

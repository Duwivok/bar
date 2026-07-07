const state = {
    recipes: [],
    recipesById: {},
    recipeIdByName: {},
    itemsByRecipe: {},
    tagsByRecipe: {},
    mode: "all",
    search: "",
    subtype: [],
    tag: [],
    ingredient: [],
    selectedId: null,
    detailStack: [],
    multiplier: 1,
    drawerStack: [],
    filters: {},
};

const els = {
    status: document.getElementById("status"),
    count: document.getElementById("recipeCount"),
    search: document.getElementById("searchInput"),
    modeTabs: document.getElementById("modeTabs"),
    subtypeFilter: document.getElementById("subtypeFilter"),
    tagFilter: document.getElementById("tagFilter"),
    ingredientFilter: document.getElementById("ingredientFilter"),
    list: document.getElementById("recipeList"),
    previewBreadcrumbs: document.getElementById("previewBreadcrumbs"),
    previewImage: document.getElementById("previewImage"),
    previewType: document.getElementById("previewType"),
    previewTitle: document.getElementById("previewTitle"),
    previewMeta: document.getElementById("previewMeta"),
    previewItems: document.getElementById("previewItems"),
    previewQuick: document.getElementById("previewQuick"),
    openDetailBtn: document.getElementById("openDetailBtn"),
    editRecipeLink: document.getElementById("editRecipeLink"),
    calcRecipeLink: document.getElementById("calcRecipeLink"),
    drawer: document.getElementById("detailDrawer"),
    drawerContent: document.getElementById("drawerContent"),
    drawerBreadcrumbs: document.getElementById("drawerBreadcrumbs"),
    drawerEditLink: document.getElementById("drawerEditLink"),
    closeDrawerBtn: document.getElementById("closeDrawerBtn"),
    sticky: document.getElementById("recipesSticky"),
};

function setStatus(message) {
    els.status.textContent = message || "";
    els.status.classList.toggle("show", !!message);
}

function editUrl(id) {
    return "recipes.html?edit=" + encodeURIComponent(id);
}

function calcUrl(id) {
    return "calculator-v2.html?recipe=" + encodeURIComponent(id);
}

function normalized(value) {
    return String(value || "").trim().toLowerCase();
}

function isShot(recipe) {
    return normalized(recipe.subtype) === "шот";
}

function recipeKind(recipe) {
    if (recipe.is_prep) return "Заготовка";
    if (isShot(recipe)) return "Шот";
    return "Коктейль";
}

function qtyText(item, multiplier = 1) {
    if (item.is_topup) return "топом";
    const qty = Number(item.qty || 0);
    const value = qty ? formatNum(qty * multiplier) : item.qty;
    return [value, item.unit].filter((v) => v !== null && v !== undefined && v !== "").join(" ") || "-";
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
    return state.recipeIdByName[normalized(item.name)] || null;
}

function ingredientSummary(recipeId) {
    const items = state.itemsByRecipe[recipeId] || [];
    if (items.length === 0) return "состав не указан";
    const names = items.map((item) => item.name).filter(Boolean);
    const visible = names.slice(0, 4).join(", ");
    return names.length > 4 ? `${visible} +${names.length - 4}` : visible;
}

function recipeVolumeText(recipe) {
    if (recipe.is_prep && recipe.yield_qty) {
        return formatQty(recipe.yield_qty, recipe.yield_unit || "");
    }

    const items = state.itemsByRecipe[recipe.id] || [];
    let ml = 0;
    let hasMl = false;
    const other = [];

    items.forEach((item) => {
        const unit = normalized(item.unit);
        if (item.is_topup) {
            const estimate = Number(item.topup_default_qty || 0);
            if (estimate > 0) {
                ml += estimate;
                hasMl = true;
            }
            return;
        }
        const qty = Number(item.qty || 0);
        if (!qty) return;
        if (unit === "мл" || unit === "ml") {
            ml += qty;
            hasMl = true;
        } else if (unit) {
            other.push(formatQty(qty, item.unit));
        }
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

// Невидимая подложка позади открытого попапа фильтра: перехватывает клик "мимо",
// чтобы он не проваливался на карточку рецепта под попапом, а просто закрывал фильтр.
const filterOverlay = document.createElement("div");
filterOverlay.className = "bc-filter-overlay hidden";
document.body.appendChild(filterOverlay);
filterOverlay.addEventListener("click", (event) => {
    event.stopPropagation();
    document.querySelectorAll(".bc-filter-popup").forEach((popup) => popup.classList.add("hidden"));
    document.querySelectorAll(".bc-filter.open").forEach((el) => el.classList.remove("open"));
    filterOverlay.classList.add("hidden");
});

function createFilter(root, label, onChange, iconSvg) {
    const filter = { root, label, value: [], options: [], search: "" };
    root.className = "bc-filter";
    root.innerHTML = "";

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
        if (filter.value.length === 0) return filter.label;
        if (filter.value.length === 1) return filter.value[0];
        return `${filter.label} · ${filter.value.length}`;
    }

    function renderOptions() {
        if (labelEl) labelEl.textContent = triggerLabel();
        else trigger.textContent = triggerLabel();
        trigger.classList.toggle("active", filter.value.length > 0);
        clearBtn.classList.toggle("hidden", filter.value.length === 0);
        list.innerHTML = "";

        const all = document.createElement("button");
        all.type = "button";
        all.textContent = "сбросить";
        all.className = filter.value.length === 0 ? "active" : "";
        all.onclick = () => {
            filter.value = [];
            close();
            renderOptions();
            onChange(filter.value);
        };
        list.appendChild(all);

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
        document.querySelectorAll(".bc-filter-popup").forEach((el) => {
            if (el !== popup) {
                el.classList.add("hidden");
                el.closest(".bc-filter")?.classList.remove("open");
            }
        });
        popup.classList.toggle("hidden");
        const isOpen = !popup.classList.contains("hidden");
        root.classList.toggle("open", isOpen);
        filterOverlay.classList.toggle("hidden", !isOpen);
        filter.search = "";
        search.value = "";
        renderOptions();
        if (isOpen) { positionFilterPopup(trigger, popup); search.focus(); }
    };

    clearBtn.onclick = (event) => {
        event.stopPropagation();
        filter.value = [];
        close();
        renderOptions();
        onChange(filter.value);
    };

    search.oninput = () => {
        filter.search = search.value;
        renderOptions();
    };

    filter.setOptions = (options) => {
        filter.options = options;
        const filtered = filter.value.filter((v) => options.includes(v));
        if (filtered.length !== filter.value.length) {
            filter.value = filtered;
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

async function loadAll() {
    if (!isDbConfigured()) {
        setStatus("База данных не подключена.");
        return;
    }

    const [recRes, itemsRes, tagsRes] = await Promise.all([
        db.from("recipes").select("*"),
        db.from("recipe_items").select("recipe_id, qty, unit, is_topup, topup_default_qty, ingredient_id, sub_recipe_id, ingredient:ingredients(name), sub_recipe:recipes!sub_recipe_id(name)"),
        db.from("recipe_tags").select("recipe_id, tag:tags(name)"),
    ]);

    for (const res of [recRes, itemsRes, tagsRes]) {
        if (res.error) {
            setStatus("Ошибка загрузки: " + res.error.message);
            return;
        }
    }

    state.recipes = recRes.data || [];
    state.recipesById = {};
    state.recipeIdByName = {};
    state.recipes.forEach((recipe) => {
        state.recipesById[recipe.id] = recipe;
        state.recipeIdByName[normalized(recipe.name)] = recipe.id;
    });

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
        };
        (state.itemsByRecipe[row.recipe_id] ||= []).push(item);
    });

    state.tagsByRecipe = {};
    (tagsRes.data || []).forEach((row) => {
        if (!row.tag) return;
        (state.tagsByRecipe[row.recipe_id] ||= []).push(row.tag.name);
    });

    populateFilters();
    render();

    // Переход по ссылке "рецепты с этим сырьём" со страницы Сырьё (?id=<recipe_id>) —
    // сразу открываем нужный рецепт вместо первого по списку.
    const linkedId = new URLSearchParams(location.search).get("id");
    if (linkedId && state.recipesById[linkedId]) {
        selectRecipe(linkedId);
    }
}

function populateFilters() {
    const subtypes = new Set();
    const tags = new Set();
    const ingredients = new Set();

    state.recipes.forEach((recipe) => {
        if (recipe.subtype) subtypes.add(recipe.subtype);
        (state.tagsByRecipe[recipe.id] || []).forEach((tag) => tags.add(tag));
        (state.itemsByRecipe[recipe.id] || []).forEach((item) => {
            if (item.name) ingredients.add(item.name);
        });
    });

    state.filters.subtype.setOptions([...subtypes].sort((a, b) => a.localeCompare(b, "ru")));
    state.filters.tag.setOptions([...tags].sort((a, b) => a.localeCompare(b, "ru")));
    state.filters.ingredient.setOptions([...ingredients].sort((a, b) => a.localeCompare(b, "ru")));
}

function filteredRecipes() {
    const q = normalized(state.search);
    return state.recipes
        .filter((recipe) => {
            if (state.mode === "cocktail" && (recipe.is_prep || isShot(recipe))) return false;
            if (state.mode === "shot" && (recipe.is_prep || !isShot(recipe))) return false;
            if (state.mode === "prep" && !recipe.is_prep) return false;
            if (state.subtype.length > 0 && !state.subtype.includes(recipe.subtype)) return false;
            if (state.tag.length > 0 && !(state.tagsByRecipe[recipe.id] || []).some((t) => state.tag.includes(t))) return false;
            if (state.ingredient.length > 0 && !(state.itemsByRecipe[recipe.id] || []).some((item) => state.ingredient.includes(item.name))) return false;
            if (q && !normalized(recipe.name).includes(q)) return false;
            return true;
        })
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

function render() {
    const list = filteredRecipes();
    els.count.textContent = list.length;

    if (!state.selectedId || !list.some((recipe) => recipe.id === state.selectedId)) {
        state.selectedId = list[0] ? list[0].id : null;
        state.detailStack = state.selectedId ? [state.selectedId] : [];
    }

    renderList(list);
    renderPreview();
}

function selectRecipe(id) {
    state.selectedId = id;
    state.detailStack = [id];
    state.multiplier = 1;
    render();
    if (window.matchMedia("(max-width: 1080px)").matches) {
        openDrawer(id);
    }
}

function pushPreview(id) {
    if (!state.recipesById[id]) return;
    if (window.matchMedia("(max-width: 1080px)").matches) {
        openDrawer(id);
        return;
    }
    if (state.detailStack[state.detailStack.length - 1] !== id) {
        state.detailStack.push(id);
    }
    state.selectedId = state.detailStack[0];
    renderList(filteredRecipes());
    renderPreview();
}

function renderList(list) {
    els.list.innerHTML = "";
    if (list.length === 0) {
        addText(els.list, "div", "bc-empty", "Ничего не найдено.");
        return;
    }

    list.forEach((recipe, index) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "bc-recipe-row" + (recipe.id === state.selectedId ? " selected" : "");
        row.onclick = () => selectRecipe(recipe.id);

        const top = document.createElement("span");
        top.className = "bc-row-top";

        addText(top, "span", "bc-index", String(index + 1).padStart(2, "0"));

        const title = document.createElement("span");
        title.className = "bc-row-title";
        addText(title, "strong", "", recipe.name);
        addText(title, "span", "", ingredientSummary(recipe.id));
        top.appendChild(title);
        row.appendChild(top);

        const badges = document.createElement("span");
        badges.className = "bc-row-badges";
        addText(badges, "span", "bc-badge-volume", recipeVolumeText(recipe) || "—");
        addText(badges, "span", "", recipeKind(recipe));
        addText(badges, "span", "", `${(state.itemsByRecipe[recipe.id] || []).length} ингр.`);
        row.appendChild(badges);

        els.list.appendChild(row);
    });
}

function renderPreviewBreadcrumbs() {
    els.previewBreadcrumbs.innerHTML = "";
    if (state.detailStack.length <= 1) return;

    state.detailStack.forEach((id, index) => {
        const recipe = state.recipesById[id];
        if (!recipe) return;
        if (index > 0) addText(els.previewBreadcrumbs, "span", "bc-crumb-sep", "/");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = index === 0 ? "← " + recipe.name : recipe.name;
        btn.disabled = index === state.detailStack.length - 1;
        btn.onclick = () => {
            state.detailStack = state.detailStack.slice(0, index + 1);
            renderPreview();
        };
        els.previewBreadcrumbs.appendChild(btn);
    });
}

function renderPreview() {
    const id = state.detailStack[state.detailStack.length - 1] || state.selectedId;
    const recipe = id ? state.recipesById[id] : null;
    if (!recipe) {
        els.previewImage.textContent = "нет фото";
        els.previewType.className = "bc-kicker";
        els.previewType.textContent = "выберите рецепт";
        els.previewTitle.textContent = "карточка будет здесь";
        els.previewMeta.innerHTML = "";
        els.previewItems.innerHTML = "";
        els.previewQuick.innerHTML = "";
        els.openDetailBtn.disabled = true;
        els.editRecipeLink.classList.add("disabled");
        els.calcRecipeLink.classList.add("disabled");
        return;
    }

    renderPreviewBreadcrumbs();

    els.previewImage.innerHTML = "";
    if (recipe.image_url) {
        const img = document.createElement("img");
        img.src = recipe.image_url;
        img.alt = recipe.name;
        els.previewImage.appendChild(img);
    } else {
        els.previewImage.textContent = "нет фото";
    }

    els.previewType.textContent = recipeKind(recipe);
    els.previewType.className = "bc-type-badge";
    els.previewTitle.textContent = recipe.name;

    els.previewItems.innerHTML = "";
    renderItems(els.previewItems, recipe.id, null, state.multiplier, "preview");
    renderQuickAmounts(els.previewQuick, recipe);

    els.previewMeta.innerHTML = "";
    addMeta(els.previewMeta, "Выход", recipeVolumeText(recipe));
    addMeta(els.previewMeta, "Тип", recipe.subtype || "");
    addMeta(els.previewMeta, "Ингредиентов", String((state.itemsByRecipe[recipe.id] || []).length));
    addMeta(els.previewMeta, "Бокал", recipe.glass || "");
    addMeta(els.previewMeta, "Основа", recipe.main_spirit || "");
    if (recipe.is_prep) {
        addMeta(els.previewMeta, "Время", recipe.labor_minutes ? `${formatNum(recipe.labor_minutes)} мин` : "");
        addMeta(els.previewMeta, "Закупка", purchaseSummary(recipe));
    }
    addMeta(els.previewMeta, "Теги", (state.tagsByRecipe[recipe.id] || []).join(", "));

    if (recipe.description) {
        const sec = document.createElement("div");
        sec.className = "bc-preview-text";
        addText(sec, "div", "bc-section-title", "Метод");
        addText(sec, "p", "", recipe.description);
        els.previewMeta.appendChild(sec);
    }
    if (recipe.notes) {
        const sec = document.createElement("div");
        sec.className = "bc-preview-text";
        addText(sec, "div", "bc-section-title", "Заметки");
        addText(sec, "p", "", recipe.notes);
        els.previewMeta.appendChild(sec);
    }
    if (recipe.source_url) {
        const link = document.createElement("a");
        link.className = "source-link";
        link.href = recipe.source_url;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "Источник →";
        els.previewMeta.appendChild(link);
    }

    els.openDetailBtn.disabled = false;
    els.openDetailBtn.onclick = () => openDrawer(recipe.id);
    els.editRecipeLink.href = editUrl(recipe.id);
    els.calcRecipeLink.href = calcUrl(recipe.id);
    els.editRecipeLink.classList.remove("disabled");
    els.calcRecipeLink.classList.remove("disabled");
}

function renderItems(container, recipeId, limit, multiplier = 1, variant = "preview") {
    const items = state.itemsByRecipe[recipeId] || [];
    if (items.length === 0) {
        addText(container, "div", variant === "drawer" ? "drawer-row" : "bc-item", "Состав пока не указан");
        return;
    }

    items.slice(0, limit || items.length).forEach((item) => {
        const targetId = itemTargetId(item);
        const row = document.createElement("div");
        row.className = variant === "drawer" ? "drawer-row" : "bc-item";

        const name = document.createElement(targetId ? "button" : "span");
        name.textContent = item.name;
        if (targetId) {
            name.type = "button";
            name.className = variant === "drawer" ? "drawer-link" : "bc-item-link";
            name.onclick = () => {
                if (variant === "drawer") openDrawer(targetId, false);
                else pushPreview(targetId);
            };
        }

        const qty = document.createElement("span");
        qty.textContent = qtyText(item, multiplier);
        row.appendChild(name);
        row.appendChild(qty);
        container.appendChild(row);
    });
}

function quickAmountPresets(recipe) {
    if (recipe.is_prep) {
        const unit = recipe.yield_unit || "мл";
        const yieldQty = Number(recipe.yield_qty || 0);
        return [100, 300, 500, 1000].map((value) => ({
            label: formatQty(value, unit),
            multiplier: yieldQty ? value / yieldQty : 0,
        }));
    }
    return [1, 2, 3, 4, 5, 10].map((value) => ({ label: String(value), multiplier: value }));
}

function renderQuickAmounts(container, recipe) {
    container.innerHTML = "";
    quickAmountPresets(recipe).forEach((preset) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = preset.label;
        if (Math.abs(state.multiplier - preset.multiplier) < 1e-9) btn.classList.add("active");
        btn.onclick = () => {
            state.multiplier = preset.multiplier;
            renderPreview();
            if (state.drawerStack.length > 0) renderDrawer();
        };
        container.appendChild(btn);
    });
}

function renderBreadcrumbs() {
    els.drawerBreadcrumbs.innerHTML = "";
    if (state.drawerStack.length <= 1) return;

    state.drawerStack.forEach((id, index) => {
        const recipe = state.recipesById[id];
        if (!recipe) return;
        if (index > 0) addText(els.drawerBreadcrumbs, "span", "bc-crumb-sep", "/");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = index === 0 ? "← " + recipe.name : recipe.name;
        btn.disabled = index === state.drawerStack.length - 1;
        btn.onclick = () => {
            state.drawerStack = state.drawerStack.slice(0, index + 1);
            renderDrawer();
        };
        els.drawerBreadcrumbs.appendChild(btn);
    });
}

function openDrawer(id, reset = true) {
    if (!state.recipesById[id]) return;
    if (reset || state.drawerStack.length === 0) {
        state.drawerStack = [id];
    } else if (state.drawerStack[state.drawerStack.length - 1] !== id) {
        state.drawerStack.push(id);
    }
    els.drawer.classList.remove("hidden");
    document.documentElement.classList.add("drawer-open");
    renderDrawer();
}

function renderDrawer() {
    const id = state.drawerStack[state.drawerStack.length - 1];
    const recipe = state.recipesById[id];
    if (!recipe) return closeDrawer();

    renderBreadcrumbs();
    els.drawerEditLink.href = editUrl(recipe.id);
    els.drawerContent.innerHTML = "";

    addText(els.drawerContent, "h3", "", recipe.name);

    const subline = document.createElement("div");
    subline.className = "drawer-subline";
    addText(subline, "span", "bc-type-badge", recipeKind(recipe));
    const extra = [recipe.subtype, recipe.main_spirit].filter(Boolean).join(" / ");
    if (extra) addText(subline, "span", "muted", extra);
    els.drawerContent.appendChild(subline);

    if (recipe.image_url) {
        const img = document.createElement("img");
        img.className = "drawer-image";
        img.src = recipe.image_url;
        img.alt = recipe.name;
        els.drawerContent.appendChild(img);
    }

    const comp = document.createElement("div");
    comp.className = "drawer-section";
    addText(comp, "h4", "", "Ингредиенты");
    const compList = document.createElement("div");
    compList.className = "drawer-list";
    renderItems(compList, recipe.id, null, state.multiplier, "drawer");
    comp.appendChild(compList);
    const quickBox = document.createElement("div");
    quickBox.className = "bc-quick";
    renderQuickAmounts(quickBox, recipe);
    comp.appendChild(quickBox);
    els.drawerContent.appendChild(comp);

    const meta = document.createElement("div");
    meta.className = "drawer-meta";
    addMeta(meta, "Выход", recipeVolumeText(recipe));
    addMeta(meta, "Тип", recipe.subtype || "");
    addMeta(meta, "Ингредиентов", String((state.itemsByRecipe[recipe.id] || []).length));
    addMeta(meta, "Бокал", recipe.glass || "");
    addMeta(meta, "Основа", recipe.main_spirit || "");
    if (recipe.is_prep) {
        addMeta(meta, "Время", recipe.labor_minutes ? `${formatNum(recipe.labor_minutes)} мин` : "");
        addMeta(meta, "Закупка", purchaseSummary(recipe));
    }
    addMeta(meta, "Теги", (state.tagsByRecipe[recipe.id] || []).join(", "));
    els.drawerContent.appendChild(meta);

    appendTextSection("Метод", recipe.description);
    appendTextSection("Заметки", recipe.notes);
    appendSource(recipe);
}

function appendTextSection(title, text) {
    if (!text) return;
    const sec = document.createElement("div");
    sec.className = "drawer-section";
    addText(sec, "h4", "", title);
    addText(sec, "div", "drawer-text", text);
    els.drawerContent.appendChild(sec);
}

function appendSource(recipe) {
    if (!recipe.source_url) return;
    const link = document.createElement("a");
    link.className = "source-link";
    link.href = recipe.source_url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Источник";
    els.drawerContent.appendChild(link);
}

function closeDrawer() {
    state.drawerStack = [];
    els.drawer.classList.add("hidden");
    document.documentElement.classList.remove("drawer-open");
}

// Все иконки нарисованы строго симметрично по горизонтали (координаты зеркальны
// относительно x=12 в viewBox 24×24), чтобы не «съезжать» в круглой кнопке.
const FILTER_ICONS = {
    type: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 3h12v15l-6-4-6 4Z"/></svg>',
    ingredient: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 7h14M5 12h14M5 17h14"/></svg>',
};

state.filters.subtype = createFilter(els.subtypeFilter, "тип", (value) => {
    state.subtype = value;
    render();
}, FILTER_ICONS.type);
state.filters.tag = createFilter(els.tagFilter, "тег", (value) => {
    state.tag = value;
    render();
}, FILTER_ICONS.tag);
state.filters.ingredient = createFilter(els.ingredientFilter, "состав", (value) => {
    state.ingredient = value;
    render();
}, FILTER_ICONS.ingredient);


const searchClearBtn = document.getElementById("searchClearBtn");
function updateSearchClearVisibility() {
    if (searchClearBtn) searchClearBtn.classList.toggle("hidden", !els.search.value);
}
els.search.oninput = () => {
    state.search = els.search.value;
    updateSearchClearVisibility();
    render();
};
if (searchClearBtn) {
    searchClearBtn.onclick = () => {
        els.search.value = "";
        state.search = "";
        updateSearchClearVisibility();
        render();
        els.search.focus();
    };
}

const modeButtons = [...els.modeTabs.querySelectorAll("button")];
const modeThumb = els.modeTabs.querySelector(".bc-segmented-thumb");
let activeModeButton = modeButtons[0];

function setModeThumb(btn) {
    if (btn) activeModeButton = btn;
    if (!modeThumb || !activeModeButton) return;
    modeThumb.style.transform = "none";
    modeThumb.style.left = activeModeButton.offsetLeft + "px";
    modeThumb.style.width = activeModeButton.offsetWidth + "px";
}

window.addEventListener("resize", () => setModeThumb());

modeButtons.forEach((btn) => {
    btn.onclick = () => {
        state.mode = btn.dataset.mode;
        modeButtons.forEach((button) => button.classList.toggle("active", button === btn));
        setModeThumb(btn);
        render();
    };
});

els.closeDrawerBtn.onclick = closeDrawer;
els.drawer.onclick = (event) => {
    if (event.target === els.drawer) closeDrawer();
};

setModeThumb(modeButtons[0]);
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => setModeThumb());
}

// Панель режимов/фильтров на мобильном (≤1080px) сверху страницы развёрнута (как на
// десктопе), а при скролле сжимается в кружки — как у "Сырья" (см. #recipesSticky.compact
// в styles-v2.css). На десктопе панель всегда остаётся развёрнутой и просто прилипает
// к верху (position:sticky) — компактный режим там не применяется вовсе.
const RECIPES_MOBILE_QUERY = window.matchMedia("(max-width: 1080px)");

if (els.sticky) {
    // rAF-throttling + гистерезис (разные пороги входа/выхода) убирают дёрганье
    // от частых scroll-событий и переключения класса туда-обратно на границе.
    let compactRaf = null;
    let isCompact = false;
    const updateCompact = () => {
        compactRaf = null;
        if (!RECIPES_MOBILE_QUERY.matches) {
            if (isCompact) { isCompact = false; els.sticky.classList.remove("compact"); setModeThumb(); }
            return;
        }
        const scrolled = window.scrollY || document.documentElement.scrollTop || 0;
        const wasCompact = isCompact;
        if (!isCompact && scrolled > 40) isCompact = true;
        else if (isCompact && scrolled < 16) isCompact = false;
        els.sticky.classList.toggle("compact", isCompact);
        // Сжатый режим сужает пузырь переключателя (см. #recipesSticky.compact
        // .bc-segmented в styles-v2.css) — бегунок нужно пересчитать под новый размер.
        if (isCompact !== wasCompact) setModeThumb();
    };
    const onScroll = () => {
        if (compactRaf === null) compactRaf = requestAnimationFrame(updateCompact);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    RECIPES_MOBILE_QUERY.addEventListener("change", updateCompact);
}

loadAll();

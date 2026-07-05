const TOPUP_DEFAULT_QTY = 100;
const IMAGE_BUCKET = "recipe-images";

const BULK_TEMPLATE = `# Формат для вставки рецептов в барный калькулятор. Каждая строка = один ингредиент рецепта, поля разделены табуляцией (Tab).
# Если у рецепта несколько ингредиентов — повторите название рецепта на нескольких строках подряд.
# Поля Тип рецепта / Подтип / Основной алкоголь / Тэги / Описание / Заметки / Источник / Картинка / Выход-кол-во / Выход-ед / Трудоёмкость достаточно заполнить один раз в первой строке рецепта, дальше можно оставлять пустыми.
# Тип рецепта: "Коктейль" или "Заготовка".
# Подтип для коктейля: Шот / Лонг / Сауэр / Сприц / Смэш.
# Подтип для заготовки: Пена / Гарниш / Кордиал / Содовая / Лимонад / Настойка / Сироп / Кастом алкоголь / Пребэтч / Пюре.
# Картинка — ссылка на изображение (загрузить файл с устройства через текстовый импорт нельзя, только ссылкой).
# Выход-кол-во / Выход-ед / Трудоёмкость — только для заготовок: сколько получается за одно приготовление (напр. 1000 и "мл") и сколько минут занимает. Без этого калькулятор техкарт и расчёт на мероприятие не смогут пересчитать объём заготовки.
# Тип ингредиента: "Сырьё" (обычный ингредиент) или "Заготовка" (если это другой рецепт из этой же базы).
# Топом: напишите "топом", если это долив без фиксированного количества — тогда Кол-во и Ед. можно оставить пустыми.
# Тэги указывайте через запятую в одной ячейке.
# Строку заголовков ниже можно оставить как есть — парсер её пропускает.
Рецепт\tТип рецепта\tПодтип\tОсновной алкоголь\tТэги\tОписание\tЗаметки\tИсточник\tКартинка\tВыход-кол-во\tВыход-ед\tТрудоёмкость\tИнгредиент\tТип ингредиента\tКол-во\tЕд.\tТопом
`;

const statusEl = document.getElementById("status");
const recipeGrid = document.getElementById("recipeGrid");
const searchInput = document.getElementById("searchInput");
const typeSegmented = document.getElementById("typeSegmented");
const filtersRow = document.getElementById("filtersRow");
const datalistEl = document.getElementById("ingredientOrPrepList");

const addOverlay = document.getElementById("addOverlay");
const fItemsBody = document.getElementById("fItemsBody");
const fIsPrep = document.getElementById("fIsPrep");
const fSubtype = document.getElementById("fSubtype");
const fMainSpirit = document.getElementById("fMainSpirit");

const modalOverlay = document.getElementById("genericModal");
const modalTitleEl = document.getElementById("modalTitle");
const modalMessageEl = document.getElementById("modalMessage");
const modalButtonsEl = document.getElementById("modalButtons");
const modalCloseBtn = document.getElementById("modalCloseBtn");

// ---- Кэши данных ----
let ingredientMap = {};      // name -> id
let ingredientsFull = [];    // [{id,name,category}]
let recipeMap = {};          // name -> id (все рецепты, включая заготовки)
let prepNameSet = new Set(); // имена рецептов с is_prep = true
let recipesById = {};        // id -> запись рецепта
let itemsByRecipe = {};      // recipeId -> [{name, qty, unit, is_topup, isSub, targetId, key}]
let tagsByRecipe = {};       // recipeId -> [tagName]
let tagMap = {};             // name -> id

let mode = "all";            // all | cocktail | prep
let searchQuery = "";
let editingRecipeId = null;
let bulkDrafts = [];
let bulkDraftCounter = 0;

let ingredientsFilter, typeFilter, tagsFilter;

// ---- Общий попап ----

function showModal({ title, message, buttons }) {
    modalTitleEl.textContent = title || "";
    modalMessageEl.textContent = message || "";
    modalButtonsEl.innerHTML = "";
    (buttons && buttons.length ? buttons : [{ label: "Ок", className: "primary" }]).forEach((b) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = b.label;
        btn.className = b.className || "";
        btn.onclick = () => {
            closeModal();
            if (b.onClick) b.onClick();
        };
        modalButtonsEl.appendChild(btn);
    });
    modalOverlay.classList.remove("hidden");
}
function closeModal() {
    modalOverlay.classList.add("hidden");
}
function showError(title, message) {
    showModal({ title, message, buttons: [{ label: "Ок", className: "primary" }] });
}
modalCloseBtn.onclick = closeModal;
modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });

// ---- Вспомогательные ----

function refreshDatalist() {
    datalistEl.innerHTML = "";
    [...Object.keys(ingredientMap), ...prepNameSet].forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        datalistEl.appendChild(opt);
    });
}

function populateUnitDatalist() {
    const dl = document.getElementById("unitOptionsList");
    dl.innerHTML = "";
    UNIT_OPTIONS.forEach((u) => {
        const opt = document.createElement("option");
        opt.value = u;
        dl.appendChild(opt);
    });
}

async function resolveOrCreateIngredientOrPrep(name, unitHint) {
    // Если имя совпадает и с сырьевым ингредиентом, и с рецептом-заготовкой — это почти всегда
    // непреднамеренное совпадение названий (например, настойка «Апероль» и одноимённый ингредиент
    // в номенклатуре). Раньше в этом случае молча привязывали к ингредиенту, из-за чего заготовку
    // никогда не просили приготовить — она просто попадала в закупку сырья без предупреждения.
    // Приоритизируем заготовку: приготовить то, что явно существует как рецепт, логичнее,
    // чем закупить одноимённое сырьё по ошибке.
    if (recipeMap[name] && prepNameSet.has(name)) return { ingredient_id: null, sub_recipe_id: recipeMap[name], created: false };
    if (ingredientMap[name]) return { ingredient_id: ingredientMap[name], sub_recipe_id: null, created: false };

    const { data, error } = await db.from("ingredients").insert({ name, base_unit: unitHint || null }).select("id,name").single();
    if (error) return null;
    ingredientMap[name] = data.id;
    refreshDatalist();
    return { ingredient_id: data.id, sub_recipe_id: null, created: true };
}

async function getOrCreateTagId(name) {
    if (tagMap[name]) return tagMap[name];
    const { data, error } = await db.from("tags").insert({ name }).select("id,name").single();
    if (error) return null;
    tagMap[name] = data.id;
    return data.id;
}

function iconFor(r) {
    if (r.subtype && SUBTYPE_ICONS[r.subtype]) return SUBTYPE_ICONS[r.subtype];
    return r.is_prep ? "🧪" : "🍸";
}

function isNameTaken(name) {
    return !!recipeMap[name];
}

function compositionSignature(items) {
    return items.map((it) => `${it.key}|${it.qty ?? ""}|${(it.unit || "").toLowerCase().trim()}`).sort().join(";");
}

function findDuplicateComposition(resolvedItems, excludeId) {
    const sig = compositionSignature(resolvedItems.map((it) => ({
        key: it.sub_recipe_id ? "sub:" + it.sub_recipe_id : "ing:" + it.ingredient_id,
        qty: it.qty,
        unit: it.unit,
    })));
    for (const [rid, items] of Object.entries(itemsByRecipe)) {
        if (rid === excludeId) continue;
        if (compositionSignature(items) === sig) return rid;
    }
    return null;
}

async function uploadImageIfAny() {
    const fileInput = document.getElementById("fImageFile");
    const file = fileInput.files && fileInput.files[0];
    if (!file) return null;
    const path = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error } = await db.storage.from(IMAGE_BUCKET).upload(path, file);
    if (error) {
        showError("Не получилось загрузить картинку", error.message + "\n\nПроверьте, что в Supabase создан публичный bucket «" + IMAGE_BUCKET + "» (Storage → New bucket → Public bucket).");
        return null;
    }
    const { data } = db.storage.from(IMAGE_BUCKET).getPublicUrl(path);
    return data.publicUrl;
}

// ---- Загрузка данных ----

async function loadAll() {
    const [ingRes, recRes, itemsRes, tagsRes, recipeTagsRes] = await Promise.all([
        db.from("ingredients").select("id,name,category"),
        db.from("recipes").select("*"),
        db.from("recipe_items").select("recipe_id, qty, unit, is_topup, ingredient_id, sub_recipe_id, ingredient:ingredients(name), sub_recipe:recipes!sub_recipe_id(name)"),
        db.from("tags").select("id,name"),
        db.from("recipe_tags").select("recipe_id, tag:tags(name)"),
    ]);

    for (const res of [ingRes, recRes, itemsRes, tagsRes, recipeTagsRes]) {
        if (res.error) {
            showError("Ошибка загрузки", res.error.message);
            return;
        }
    }

    ingredientsFull = ingRes.data;
    ingredientMap = {};
    ingRes.data.forEach((i) => { ingredientMap[i.name] = i.id; });

    recipeMap = {};
    prepNameSet = new Set();
    recipesById = {};
    recRes.data.forEach((r) => {
        recipeMap[r.name] = r.id;
        if (r.is_prep) prepNameSet.add(r.name);
        recipesById[r.id] = r;
    });

    itemsByRecipe = {};
    itemsRes.data.forEach((row) => {
        const isSub = !!row.sub_recipe_id;
        const entry = {
            name: isSub ? (row.sub_recipe ? row.sub_recipe.name : "") : (row.ingredient ? row.ingredient.name : ""),
            qty: row.qty,
            unit: row.unit,
            is_topup: row.is_topup,
            isSub,
            targetId: isSub ? row.sub_recipe_id : null,
            key: isSub ? "sub:" + row.sub_recipe_id : "ing:" + row.ingredient_id,
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

    refreshDatalist();
    refreshMainSpiritOptions();
    populateCategoryDatalist();
    refreshFilterOptions();
    applyFilters();
    warnAboutNameCollisions();
}

// Позиция номенклатуры и рецепт-заготовка с одинаковым названием — почти всегда ошибка
// (см. resolveOrCreateIngredientOrPrep выше): состав коктейля с таким именем однозначно
// привязывается к заготовке, а одноимённое сырьё в номенклатуре при этом никогда не
// используется через это название — стоит переименовать одно из двух.
function warnAboutNameCollisions() {
    const collisions = Object.keys(ingredientMap).filter((name) => prepNameSet.has(name));
    if (collisions.length === 0) return;
    showStatus(
        statusEl,
        `Обнаружены совпадения названий между номенклатурой и заготовками: ${collisions.map((n) => `«${n}»`).join(", ")}. ` +
        `В составе коктейля такое имя будет считаться заготовкой (её попросят приготовить), а одноимённая позиция в номенклатуре останется неиспользуемой — переименуйте одно из двух, чтобы не путаться.`,
        "error"
    );
}

function refreshMainSpiritOptions() {
    const prev = fMainSpirit.value;
    fMainSpirit.innerHTML = '<option value="">—</option>';
    const alcoholNames = ingredientsFull
        .filter((i) => i.category && i.category.toLowerCase().includes("алкогол"))
        .map((i) => i.name)
        .sort((a, b) => a.localeCompare(b, "ru"));
    alcoholNames.forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        fMainSpirit.appendChild(opt);
    });
    if (alcoholNames.includes(prev)) fMainSpirit.value = prev;
}

// ---- Фильтры ----

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
        // Заготовки-конвертеры (напр. "Цедра лимона"), созданные в разделе "Выход продукта
        // из сырья" на вкладке "Конвертер" — техническая связка сырьё->продукт, не рецепт для
        // просмотра здесь. Управляются в Конвертере, но продолжают работать в составах рецептов.
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

function renderGrid(list) {
    recipeGrid.innerHTML = "";
    if (list.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "Ничего не найдено — попробуйте изменить фильтры или добавьте рецепт.";
        recipeGrid.appendChild(empty);
        return;
    }
    list.forEach((r) => {
        const card = document.createElement("div");
        card.className = "recipe-card";
        card.onclick = () => openDetail(r.id);

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

// ---- Детальная панель + вложенная навигация ----
// Логика самого оверлея (хлебные крошки, рендер карточки) вынесена в recipe-detail.js,
// т.к. переиспользуется и на странице "Мероприятия" — здесь только подключаем её
// к данным этой страницы и сохраняем возможность редактирования из карточки.

const recipeDetail = createRecipeDetailOverlay({
    getRecipe: (id) => recipesById[id],
    getItems: (id) => itemsByRecipe[id] || [],
    getTags: (id) => tagsByRecipe[id] || [],
    onEdit: (id) => openEditModal(id),
});

function openDetail(id) { recipeDetail.open(id); }
function pushDetail(id) { recipeDetail.push(id); }
function closeDetail() { recipeDetail.close(); }

// ---- Верхняя панель: поиск + переключатель ----

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

// ---- Модалка добавления рецепта ----

function populateSubtypeSelect() {
    const isPrep = fIsPrep.value === "true";
    const options = isPrep ? PREP_SUBTYPES : COCKTAIL_SUBTYPES;
    fSubtype.innerHTML = '<option value="">—</option>';
    options.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s;
        opt.textContent = s;
        fSubtype.appendChild(opt);
    });
    document.getElementById("prepFieldsRow").style.display = isPrep ? "" : "none";
    document.getElementById("purchaseFieldsRow").style.display = isPrep ? "" : "none";
}
fIsPrep.onchange = populateSubtypeSelect;

function populateCategoryDatalist() {
    const dl = document.getElementById("categoryOptionsList");
    dl.innerHTML = "";
    const names = new Set(CATEGORY_SEED);
    ingredientsFull.forEach((i) => { if (i.category) names.add(i.category); });
    [...names].forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c;
        dl.appendChild(opt);
    });
}

function fBuildItemRow() {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.setAttribute("list", "ingredientOrPrepList");
    nameTd.appendChild(nameInput);
    tr.appendChild(nameTd);

    const qtyTd = document.createElement("td");
    const qtyInput = document.createElement("input");
    qtyInput.type = "text";
    qtyInput.inputMode = "decimal";
    qtyInput.placeholder = "кол-во";
    const topupEstInput = document.createElement("input");
    topupEstInput.type = "text";
    topupEstInput.inputMode = "decimal";
    topupEstInput.placeholder = "оценка объёма, мл";
    topupEstInput.value = TOPUP_DEFAULT_QTY;
    topupEstInput.style.display = "none";
    qtyTd.appendChild(qtyInput);
    qtyTd.appendChild(topupEstInput);
    tr.appendChild(qtyTd);

    const unitTd = document.createElement("td");
    const unitInput = document.createElement("input");
    unitInput.type = "text";
    unitInput.setAttribute("list", "unitOptionsList");
    unitTd.appendChild(unitInput);
    tr.appendChild(unitTd);

    const topupTd = document.createElement("td");
    const topupCb = document.createElement("input");
    topupCb.type = "checkbox";
    topupCb.onchange = () => {
        const isTopup = topupCb.checked;
        qtyInput.style.display = isTopup ? "none" : "";
        unitInput.style.display = isTopup ? "none" : "";
        topupEstInput.style.display = isTopup ? "" : "none";
        qtyInput.disabled = isTopup;
        unitInput.disabled = isTopup;
    };
    topupTd.appendChild(topupCb);
    tr.appendChild(topupTd);

    const actionsTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "danger";
    delBtn.textContent = "×";
    delBtn.onclick = () => tr.remove();
    actionsTd.appendChild(delBtn);
    tr.appendChild(actionsTd);

    tr._inputs = { nameInput, qtyInput, unitInput, topupCb, topupEstInput };
    return tr;
}

document.getElementById("fAddItemBtn").onclick = () => {
    fItemsBody.appendChild(fBuildItemRow());
};

function resetForm() {
    document.getElementById("fName").value = "";
    fIsPrep.value = "false";
    populateSubtypeSelect();
    fMainSpirit.value = "";
    document.getElementById("fTags").value = "";
    document.getElementById("fDescription").value = "";
    document.getElementById("fNotes").value = "";
    document.getElementById("fImageUrl").value = "";
    document.getElementById("fImageFile").value = "";
    document.getElementById("fSourceUrl").value = "";
    document.getElementById("fYieldQty").value = "";
    document.getElementById("fYieldUnit").value = "";
    document.getElementById("fLaborMinutes").value = "";
    document.getElementById("fPurchaseUnit").value = "";
    document.getElementById("fPurchasePackageSize").value = "";
    document.getElementById("fPurchasePackagePrice").value = "";
    document.getElementById("fPurchaseCategory").value = "";
    document.getElementById("fPurchaseLink").value = "";
    fItemsBody.innerHTML = "";
    fItemsBody.appendChild(fBuildItemRow());
}

function openAddModal() {
    editingRecipeId = null;
    resetForm();
    clearBulkPreview();
    document.getElementById("fSaveBtn").textContent = "Сохранить рецепт";
    document.getElementById("tabBulkBtn").style.display = "";
    document.getElementById("tabFormBtn").onclick();
    addOverlay.classList.remove("hidden");
    document.getElementById("bulkInput").value = "";
}
function closeAddModal() {
    addOverlay.classList.add("hidden");
    clearBulkPreview();
}

function openEditModal(id) {
    const r = recipesById[id];
    if (!r) return;
    editingRecipeId = id;
    resetForm();

    document.getElementById("fName").value = r.name;
    fIsPrep.value = r.is_prep ? "true" : "false";
    populateSubtypeSelect();
    fSubtype.value = r.subtype || "";
    fMainSpirit.value = r.main_spirit || "";
    document.getElementById("fDescription").value = r.description || "";
    document.getElementById("fNotes").value = r.notes || "";
    document.getElementById("fImageUrl").value = r.image_url || "";
    document.getElementById("fSourceUrl").value = r.source_url || "";
    document.getElementById("fTags").value = (tagsByRecipe[id] || []).join(", ");
    document.getElementById("fYieldQty").value = r.yield_qty ?? "";
    document.getElementById("fYieldUnit").value = r.yield_unit || "";
    document.getElementById("fLaborMinutes").value = r.labor_minutes ?? "";
    document.getElementById("fPurchaseUnit").value = r.purchase_unit || "";
    document.getElementById("fPurchasePackageSize").value = r.purchase_package_size ?? "";
    document.getElementById("fPurchasePackagePrice").value = r.purchase_package_price ?? "";
    document.getElementById("fPurchaseCategory").value = r.purchase_category || "";
    document.getElementById("fPurchaseLink").value = r.purchase_link || "";

    fItemsBody.innerHTML = "";
    const items = itemsByRecipe[id] || [];
    if (items.length === 0) {
        fItemsBody.appendChild(fBuildItemRow());
    } else {
        items.forEach((it) => {
            const tr = fBuildItemRow();
            tr._inputs.nameInput.value = it.name;
            if (it.is_topup) {
                tr._inputs.topupCb.checked = true;
                tr._inputs.topupCb.onchange();
                tr._inputs.topupEstInput.value = it.topup_default_qty ?? TOPUP_DEFAULT_QTY;
            } else {
                tr._inputs.qtyInput.value = it.qty ?? "";
                tr._inputs.unitInput.value = it.unit ?? "";
            }
            fItemsBody.appendChild(tr);
        });
    }

    document.getElementById("fSaveBtn").textContent = "Сохранить изменения";
    document.getElementById("tabFormBtn").onclick();
    document.getElementById("tabBulkBtn").style.display = "none";
    closeDetail();
    addOverlay.classList.remove("hidden");
}

document.getElementById("addRecipeBtn").onclick = openAddModal;
document.getElementById("addCloseBtn").onclick = closeAddModal;
addOverlay.addEventListener("click", (e) => { if (e.target === addOverlay) closeAddModal(); });

document.getElementById("tabFormBtn").onclick = () => {
    document.getElementById("tabFormBtn").classList.add("active");
    document.getElementById("tabBulkBtn").classList.remove("active");
    document.getElementById("tabForm").style.display = "";
    document.getElementById("tabBulk").style.display = "none";
};
document.getElementById("tabBulkBtn").onclick = () => {
    document.getElementById("tabBulkBtn").classList.add("active");
    document.getElementById("tabFormBtn").classList.remove("active");
    document.getElementById("tabBulk").style.display = "";
    document.getElementById("tabForm").style.display = "none";
};

document.getElementById("copyTemplateBtn").onclick = async () => {
    try {
        await navigator.clipboard.writeText(BULK_TEMPLATE);
        showModal({ title: "Скопировано", message: "Шаблон скопирован в буфер обмена — можно вставить сюда или отправить нейросети для форматирования.", buttons: [{ label: "Ок", className: "primary" }] });
    } catch (e) {
        document.getElementById("bulkInput").value = BULK_TEMPLATE;
    }
};

async function finalizeSaveRecipe(name, resolvedItems, tagNames) {
    const wasEditing = !!editingRecipeId;
    const uploadedUrl = await uploadImageIfAny();
    const isPrep = fIsPrep.value === "true";
    const yieldQtyRaw = document.getElementById("fYieldQty").value.trim();
    const laborRaw = document.getElementById("fLaborMinutes").value.trim();
    const purchaseSizeRaw = document.getElementById("fPurchasePackageSize").value.trim();
    const purchasePriceRaw = document.getElementById("fPurchasePackagePrice").value.trim();
    const recipeValues = {
        name,
        type: isPrep ? "Заготовка" : "Коктейль",
        is_prep: isPrep,
        subtype: fSubtype.value || null,
        main_spirit: fMainSpirit.value || null,
        description: document.getElementById("fDescription").value.trim() || null,
        notes: document.getElementById("fNotes").value.trim() || null,
        image_url: uploadedUrl || document.getElementById("fImageUrl").value.trim() || null,
        source_url: document.getElementById("fSourceUrl").value.trim() || null,
        yield_qty: isPrep && yieldQtyRaw ? Number(yieldQtyRaw.replace(",", ".")) : null,
        yield_unit: isPrep ? (document.getElementById("fYieldUnit").value.trim() || null) : null,
        labor_minutes: isPrep && laborRaw ? Number(laborRaw.replace(",", ".")) : null,
        purchase_unit: isPrep ? (document.getElementById("fPurchaseUnit").value.trim() || null) : null,
        purchase_package_size: isPrep && purchaseSizeRaw ? Number(purchaseSizeRaw.replace(",", ".")) : null,
        purchase_package_price: isPrep && purchasePriceRaw ? Number(purchasePriceRaw.replace(",", ".")) : null,
        purchase_category: isPrep ? (document.getElementById("fPurchaseCategory").value.trim() || null) : null,
        purchase_link: isPrep ? (document.getElementById("fPurchaseLink").value.trim() || null) : null,
    };

    let recipeId;
    if (wasEditing) {
        recipeId = editingRecipeId;
        const oldName = recipesById[recipeId].name;
        const { error } = await db.from("recipes").update(recipeValues).eq("id", recipeId);
        if (error) { showError("Не сохранились изменения", error.message); return; }
        if (oldName !== name) delete recipeMap[oldName];
        recipeMap[name] = recipeId;
        if (recipeValues.is_prep) prepNameSet.add(name); else prepNameSet.delete(name);
        await db.from("recipe_tags").delete().eq("recipe_id", recipeId);
        await db.from("recipe_items").delete().eq("recipe_id", recipeId);
    } else {
        const { data: inserted, error: insertErr } = await db.from("recipes").insert(recipeValues).select("id,name,is_prep").single();
        if (insertErr) { showError("Не сохранился рецепт", insertErr.message); return; }
        recipeId = inserted.id;
        recipeMap[inserted.name] = inserted.id;
        if (inserted.is_prep) prepNameSet.add(inserted.name);
    }

    for (const tagName of tagNames) {
        const tagId = await getOrCreateTagId(tagName);
        if (tagId) await db.from("recipe_tags").insert({ recipe_id: recipeId, tag_id: tagId });
    }

    const itemsToInsert = resolvedItems.map((it) => ({ ...it, recipe_id: recipeId }));
    if (itemsToInsert.length > 0) {
        const { error } = await db.from("recipe_items").insert(itemsToInsert);
        if (error) { showError("Рецепт сохранён, но состав не сохранился", error.message); }
    }

    closeAddModal();
    editingRecipeId = null;
    document.getElementById("fSaveBtn").textContent = "Сохранить рецепт";
    showStatus(statusEl, wasEditing ? `Рецепт «${name}» обновлён` : `Рецепт «${name}» сохранён`, "info");
    await loadAll();
}

document.getElementById("fSaveBtn").onclick = async () => {
    const name = document.getElementById("fName").value.trim();
    if (!name) { showError("Заполните название", "Название рецепта не может быть пустым."); return; }
    const existingId = recipeMap[name];
    if (existingId && existingId !== editingRecipeId) { showError("Название занято", `Рецепт с названием «${name}» уже есть в базе. Выберите другое название.`); return; }

    const itemRows = [...fItemsBody.children].filter((tr) => tr._inputs.nameInput.value.trim());
    if (itemRows.length === 0) { showError("Нет состава", "Добавьте хотя бы один ингредиент состава."); return; }

    const resolvedItems = [];
    const skipped = [];
    for (const tr of itemRows) {
        const { nameInput, qtyInput, unitInput, topupCb, topupEstInput } = tr._inputs;
        const ingName = nameInput.value.trim();
        const isTopup = topupCb.checked;
        const resolved = await resolveOrCreateIngredientOrPrep(ingName, isTopup ? null : (unitInput.value.trim() || null));
        if (!resolved) { skipped.push(ingName); continue; }
        resolvedItems.push({
            ingredient_id: resolved.ingredient_id,
            sub_recipe_id: resolved.sub_recipe_id,
            qty: isTopup ? null : (qtyInput.value.trim() === "" ? null : Number(qtyInput.value.replace(",", "."))),
            unit: isTopup ? null : (unitInput.value.trim() || null),
            is_topup: isTopup,
            topup_default_qty: isTopup ? (Number(String(topupEstInput.value).replace(",", ".")) || TOPUP_DEFAULT_QTY) : null,
            comment: null,
        });
    }
    if (skipped.length > 0) { showError("Не получилось создать позиции", `Не удалось добавить в номенклатуру: ${skipped.join(", ")}`); return; }

    const tagNames = document.getElementById("fTags").value.split(",").map((s) => s.trim()).filter(Boolean);

    const dupId = findDuplicateComposition(resolvedItems, editingRecipeId);
    if (dupId) {
        showModal({
            title: "Такой состав уже есть",
            message: `Подобный рецепт уже сохранён («${recipesById[dupId].name}»). Хотите добавить его ещё раз?`,
            buttons: [
                { label: "Да, добавить", className: "primary", onClick: () => finalizeSaveRecipe(name, resolvedItems, tagNames) },
                { label: "Показать похожий рецепт", onClick: () => { closeAddModal(); openDetail(dupId); } },
            ],
        });
        return;
    }

    await finalizeSaveRecipe(name, resolvedItems, tagNames);
};

// ---- Импорт текстом ----

function parseBulkRows(text) {
    const rawLines = text.split("\n");
    const rows = [];
    for (const raw of rawLines) {
        const line = raw.replace(/\r$/, "");
        if (!line.trim()) continue;
        if (line.trim().startsWith("#")) continue;
        const cols = line.split("\t").map((c) => c.trim());
        if (cols[0] === "Рецепт") continue;
        rows.push(cols);
    }
    return rows;
}

function clearBulkPreview() {
    bulkDrafts = [];
    const preview = document.getElementById("bulkPreview");
    if (preview) {
        preview.innerHTML = "";
        preview.classList.add("hidden");
    }
}

function normalizeLoose(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/ё/g, "е")
        .replace(/[^a-zа-я0-9]+/g, " ")
        .trim();
}

function isTopupMark(value) {
    const v = normalizeLoose(value);
    return v === "топом" || v === "top" || v === "topup" || v.includes("топ");
}

function toNumberOrNull(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const n = Number(raw.replace(",", "."));
    return Number.isFinite(n) ? n : null;
}

function buildBulkDrafts(text) {
    const rows = parseBulkRows(text);
    const groups = new Map();
    for (const cols of rows) {
        const [recipeName, recipeType, subtype, mainSpirit, tagsRaw, description, notes, sourceUrl, imageUrl, yieldQtyRaw, yieldUnit, laborRaw, ingName, ingType, qtyRaw, unitRaw, topupRaw] = cols;
        if (!recipeName) continue;
        if (!groups.has(recipeName)) {
            bulkDraftCounter += 1;
            groups.set(recipeName, {
                tempId: "bulk" + bulkDraftCounter,
                enabled: true,
                name: recipeName,
                recipeType: recipeType || "Коктейль",
                subtype: subtype || "",
                mainSpirit: mainSpirit || "",
                tagsRaw: tagsRaw || "",
                description: description || "",
                notes: notes || "",
                sourceUrl: sourceUrl || "",
                imageUrl: imageUrl || "",
                yieldQtyRaw: yieldQtyRaw || "",
                yieldUnit: yieldUnit || "",
                laborRaw: laborRaw || "",
                rows: [],
            });
        }
        const draft = groups.get(recipeName);
        if (!draft.recipeType && recipeType) draft.recipeType = recipeType;
        if (!draft.subtype && subtype) draft.subtype = subtype;
        if (!draft.mainSpirit && mainSpirit) draft.mainSpirit = mainSpirit;
        if (!draft.tagsRaw && tagsRaw) draft.tagsRaw = tagsRaw;
        if (!draft.description && description) draft.description = description;
        if (!draft.notes && notes) draft.notes = notes;
        if (!draft.sourceUrl && sourceUrl) draft.sourceUrl = sourceUrl;
        if (!draft.imageUrl && imageUrl) draft.imageUrl = imageUrl;
        if (!draft.yieldQtyRaw && yieldQtyRaw) draft.yieldQtyRaw = yieldQtyRaw;
        if (!draft.yieldUnit && yieldUnit) draft.yieldUnit = yieldUnit;
        if (!draft.laborRaw && laborRaw) draft.laborRaw = laborRaw;
        draft.rows.push({ ingName: ingName || "", ingType: ingType || "", qtyRaw: qtyRaw || "", unitRaw: unitRaw || "", topupRaw: topupRaw || "" });
    }
    return [...groups.values()];
}

function draftItemKeys(draft) {
    return draft.rows
        .filter((r) => r.ingName)
        .map((r) => normalizeLoose(r.ingName))
        .filter(Boolean);
}

function existingItemKeys(recipeId) {
    return (itemsByRecipe[recipeId] || [])
        .filter((r) => r.name)
        .map((r) => normalizeLoose(r.name))
        .filter(Boolean);
}

function jaccardScore(a, b) {
    const setA = new Set(a);
    const setB = new Set(b);
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    setA.forEach((key) => { if (setB.has(key)) intersection += 1; });
    return intersection / (setA.size + setB.size - intersection);
}

function quantitySimilarityBonus(draft, recipeId) {
    const existing = itemsByRecipe[recipeId] || [];
    let compared = 0;
    let matched = 0;
    draft.rows.forEach((row) => {
        if (!row.ingName || isTopupMark(row.topupRaw)) return;
        const qty = toNumberOrNull(row.qtyRaw);
        const unit = normalizeLoose(row.unitRaw);
        const sameName = existing.find((it) => normalizeLoose(it.name) === normalizeLoose(row.ingName));
        if (!sameName || qty === null) return;
        compared += 1;
        const sameQty = Number(sameName.qty) === qty;
        const sameUnit = normalizeLoose(sameName.unit) === unit;
        if (sameQty && sameUnit) matched += 1;
    });
    return compared > 0 ? (matched / compared) * 0.15 : 0;
}

function findSimilarRecipesForDraft(draft) {
    const draftKeys = draftItemKeys(draft);
    return Object.entries(recipesById)
        .map(([id, recipe]) => {
            const baseScore = jaccardScore(draftKeys, existingItemKeys(id));
            const score = Math.min(1, baseScore + quantitySimilarityBonus(draft, id));
            return { id, recipe, score };
        })
        .filter((m) => m.score >= 0.62)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
}

function validateBulkDraft(draft) {
    const problems = [];
    const warnings = [];
    if (!draft.enabled) return { problems, warnings, similar: [] };
    if (!draft.name.trim()) problems.push("нет названия");
    if (isNameTaken(draft.name.trim())) problems.push(`название «${draft.name.trim()}» уже занято в базе`);
    const isPrep = (draft.recipeType || "Коктейль") === "Заготовка";
    const subtypeList = isPrep ? PREP_SUBTYPES : COCKTAIL_SUBTYPES;
    if (draft.subtype && !subtypeList.includes(draft.subtype)) {
        problems.push(`неизвестный подтип «${draft.subtype}» для типа «${isPrep ? "Заготовка" : "Коктейль"}»`);
    }
    const filledRows = draft.rows.filter((r) => r.ingName.trim());
    if (filledRows.length === 0) problems.push("нет ни одного ингредиента");
    filledRows.forEach((r) => {
        const isTopup = isTopupMark(r.topupRaw);
        if (!isTopup && !String(r.qtyRaw || "").trim()) problems.push(`«${r.ingName}»: не указано количество`);
        if (!isTopup && String(r.qtyRaw || "").trim() && toNumberOrNull(r.qtyRaw) === null) problems.push(`«${r.ingName}»: количество не похоже на число`);
        if (!isTopup && String(r.qtyRaw || "").trim() && !String(r.unitRaw || "").trim()) problems.push(`«${r.ingName}»: количество указано без единицы`);
    });
    const similar = findSimilarRecipesForDraft(draft);
    similar.forEach((m) => {
        const percent = Math.round(m.score * 100);
        warnings.push(`похоже на «${m.recipe.name}» (${percent}% совпадения состава)`);
    });
    return { problems, warnings, similar };
}

function makeBulkInput(value, onChange, attrs = {}) {
    const input = document.createElement("input");
    input.type = attrs.type || "text";
    if (attrs.inputMode) input.inputMode = attrs.inputMode;
    if (attrs.list) input.setAttribute("list", attrs.list);
    if (attrs.placeholder) input.placeholder = attrs.placeholder;
    input.value = value || "";
    input.oninput = () => { onChange(input.value); };
    input.onchange = renderBulkPreview;
    return input;
}

function makeBulkSelect(value, options, onChange) {
    const select = document.createElement("select");
    options.forEach((opt) => {
        const option = document.createElement("option");
        option.value = opt.value;
        option.textContent = opt.label;
        select.appendChild(option);
    });
    select.value = value || options[0].value;
    select.onchange = () => { onChange(select.value); renderBulkPreview(); };
    return select;
}

function renderBulkItemRow(draft, row, index, tbody) {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.appendChild(makeBulkInput(row.ingName, (v) => { row.ingName = v; }, { list: "ingredientOrPrepList" }));
    tr.appendChild(nameTd);

    const qtyTd = document.createElement("td");
    qtyTd.appendChild(makeBulkInput(row.qtyRaw, (v) => { row.qtyRaw = v; }, { inputMode: "decimal", placeholder: "кол-во" }));
    tr.appendChild(qtyTd);

    const unitTd = document.createElement("td");
    unitTd.appendChild(makeBulkInput(row.unitRaw, (v) => { row.unitRaw = v; }, { list: "unitOptionsList" }));
    tr.appendChild(unitTd);

    const topupTd = document.createElement("td");
    topupTd.appendChild(makeBulkInput(row.topupRaw, (v) => { row.topupRaw = v; }, { placeholder: "топом" }));
    tr.appendChild(topupTd);

    const actionsTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "danger";
    delBtn.textContent = "×";
    delBtn.onclick = () => {
        draft.rows.splice(index, 1);
        renderBulkPreview();
    };
    actionsTd.appendChild(delBtn);
    tr.appendChild(actionsTd);

    tbody.appendChild(tr);
}

function renderBulkPreview() {
    const preview = document.getElementById("bulkPreview");
    preview.innerHTML = "";
    if (bulkDrafts.length === 0) {
        preview.classList.add("hidden");
        return;
    }
    preview.classList.remove("hidden");

    const summary = document.createElement("div");
    summary.className = "bulk-preview-summary";
    const validations = bulkDrafts.map(validateBulkDraft);
    const activeCount = bulkDrafts.filter((d) => d.enabled).length;
    const problemCount = validations.reduce((sum, v) => sum + v.problems.length, 0);
    const warningCount = validations.reduce((sum, v) => sum + v.warnings.length, 0);
    summary.textContent = `Черновик импорта: ${activeCount} выбрано из ${bulkDrafts.length}. Ошибок: ${problemCount}. Предупреждений: ${warningCount}.`;
    preview.appendChild(summary);

    bulkDrafts.forEach((draft, idx) => {
        const validation = validations[idx];
        const card = document.createElement("div");
        card.className = "bulk-draft-card";
        if (validation.problems.length > 0) card.classList.add("has-errors");
        else if (validation.warnings.length > 0) card.classList.add("has-warnings");
        if (!draft.enabled) card.classList.add("disabled");

        const head = document.createElement("div");
        head.className = "bulk-draft-head";

        const enabledLabel = document.createElement("label");
        enabledLabel.className = "bulk-draft-enabled";
        const enabledCb = document.createElement("input");
        enabledCb.type = "checkbox";
        enabledCb.checked = draft.enabled;
        enabledCb.onchange = () => { draft.enabled = enabledCb.checked; renderBulkPreview(); };
        enabledLabel.appendChild(enabledCb);
        enabledLabel.appendChild(document.createTextNode(" импортировать"));
        head.appendChild(enabledLabel);

        const title = document.createElement("div");
        title.className = "bulk-draft-title";
        title.textContent = draft.name || "Без названия";
        head.appendChild(title);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "danger";
        removeBtn.textContent = "Убрать";
        removeBtn.onclick = () => {
            bulkDrafts = bulkDrafts.filter((d) => d !== draft);
            renderBulkPreview();
        };
        head.appendChild(removeBtn);
        card.appendChild(head);

        const meta = document.createElement("div");
        meta.className = "bulk-draft-meta";
        meta.appendChild(makeBulkInput(draft.name, (v) => { draft.name = v; }, { placeholder: "Название" }));
        meta.appendChild(makeBulkSelect(draft.recipeType, [
            { value: "Коктейль", label: "Коктейль" },
            { value: "Заготовка", label: "Заготовка" },
        ], (v) => { draft.recipeType = v; }));
        const subtypeOptions = [{ value: "", label: "Подтип" }, ...((draft.recipeType === "Заготовка" ? PREP_SUBTYPES : COCKTAIL_SUBTYPES).map((s) => ({ value: s, label: s })))];
        meta.appendChild(makeBulkSelect(draft.subtype, subtypeOptions, (v) => { draft.subtype = v; }));
        meta.appendChild(makeBulkInput(draft.mainSpirit, (v) => { draft.mainSpirit = v; }, { placeholder: "Основа" }));
        meta.appendChild(makeBulkInput(draft.tagsRaw, (v) => { draft.tagsRaw = v; }, { placeholder: "Тэги" }));
        meta.appendChild(makeBulkInput(draft.description, (v) => { draft.description = v; }, { placeholder: "Описание" }));
        meta.appendChild(makeBulkInput(draft.notes, (v) => { draft.notes = v; }, { placeholder: "Заметки" }));
        meta.appendChild(makeBulkInput(draft.sourceUrl, (v) => { draft.sourceUrl = v; }, { placeholder: "Источник" }));
        meta.appendChild(makeBulkInput(draft.imageUrl, (v) => { draft.imageUrl = v; }, { placeholder: "Картинка" }));
        if (draft.recipeType === "Заготовка") {
            meta.appendChild(makeBulkInput(draft.yieldQtyRaw, (v) => { draft.yieldQtyRaw = v; }, { inputMode: "decimal", placeholder: "Выход" }));
            meta.appendChild(makeBulkInput(draft.yieldUnit, (v) => { draft.yieldUnit = v; }, { list: "unitOptionsList", placeholder: "Ед. выхода" }));
            meta.appendChild(makeBulkInput(draft.laborRaw, (v) => { draft.laborRaw = v; }, { inputMode: "decimal", placeholder: "Минуты" }));
        }
        card.appendChild(meta);

        if (validation.problems.length > 0 || validation.warnings.length > 0) {
            const notes = document.createElement("div");
            notes.className = "bulk-draft-notes";
            validation.problems.forEach((p) => {
                const div = document.createElement("div");
                div.className = "bulk-problem";
                div.textContent = p;
                notes.appendChild(div);
            });
            validation.warnings.forEach((w, warningIndex) => {
                const div = document.createElement("div");
                div.className = "bulk-warning";
                div.textContent = w;
                const similar = validation.similar[warningIndex];
                if (similar) {
                    const btn = document.createElement("button");
                    btn.type = "button";
                    btn.textContent = "Открыть";
                    btn.onclick = () => window.open("recipes.html?open=" + encodeURIComponent(similar.id), "_blank");
                    div.appendChild(btn);
                }
                notes.appendChild(div);
            });
            card.appendChild(notes);
        }

        const tableWrap = document.createElement("div");
        tableWrap.className = "table-wrap";
        const table = document.createElement("table");
        table.className = "bulk-items-table";
        table.innerHTML = "<thead><tr><th>Сырьё / заготовка</th><th>Кол-во</th><th>Ед.</th><th>Топом</th><th></th></tr></thead>";
        const tbody = document.createElement("tbody");
        draft.rows.forEach((row, rowIndex) => renderBulkItemRow(draft, row, rowIndex, tbody));
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        card.appendChild(tableWrap);

        const addRowBtn = document.createElement("button");
        addRowBtn.type = "button";
        addRowBtn.textContent = "+ Ингредиент";
        addRowBtn.onclick = () => {
            draft.rows.push({ ingName: "", ingType: "", qtyRaw: "", unitRaw: "", topupRaw: "" });
            renderBulkPreview();
        };
        card.appendChild(addRowBtn);

        preview.appendChild(card);
    });

    const actions = document.createElement("div");
    actions.className = "bulk-preview-actions";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "primary";
    saveBtn.textContent = "Сохранить выбранные рецепты";
    saveBtn.disabled = activeCount === 0 || problemCount > 0;
    saveBtn.onclick = saveBulkDrafts;
    actions.appendChild(saveBtn);

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.textContent = "Очистить предпросмотр";
    clearBtn.onclick = clearBulkPreview;
    actions.appendChild(clearBtn);
    preview.appendChild(actions);
}

document.getElementById("bulkImportBtn").onclick = () => {
    const text = document.getElementById("bulkInput").value;
    if (!text.trim()) return;

    bulkDrafts = buildBulkDrafts(text);
    if (bulkDrafts.length === 0) {
        showError("Пусто", "Не нашёл ни одной строки данных.");
        return;
    }
    renderBulkPreview();
};

async function saveBulkDrafts() {
    const selectedDrafts = bulkDrafts.filter((d) => d.enabled);
    const seenNames = new Set();
    const repeatedNames = [];
    selectedDrafts.forEach((draft) => {
        const name = normalizeLoose(draft.name);
        if (!name) return;
        if (seenNames.has(name)) repeatedNames.push(draft.name.trim());
        seenNames.add(name);
    });
    if (repeatedNames.length > 0) {
        showError("Есть повторяющиеся названия", "В черновике несколько новых рецептов с одинаковым названием:\n" + repeatedNames.join("\n"));
        return;
    }
    const validations = selectedDrafts.map(validateBulkDraft);
    const blocking = validations
        .map((v, i) => ({ v, draft: selectedDrafts[i] }))
        .filter((x) => x.v.problems.length > 0);
    if (blocking.length > 0) {
        showError("Нужно поправить черновик", blocking.map((x) => `«${x.draft.name || "Без названия"}»: ${x.v.problems.join("; ")}`).join("\n"));
        renderBulkPreview();
        return;
    }
    if (selectedDrafts.length === 0) return;

    const toInsert = selectedDrafts.map((draft) => {
        const isPrep = (draft.recipeType || "Коктейль") === "Заготовка";
        return {
            name: draft.name.trim(),
            type: draft.recipeType || "Коктейль",
            is_prep: isPrep,
            subtype: draft.subtype || null,
            main_spirit: draft.mainSpirit || null,
            description: draft.description || null,
            notes: draft.notes || null,
            source_url: draft.sourceUrl || null,
            image_url: draft.imageUrl || null,
            yield_qty: isPrep ? toNumberOrNull(draft.yieldQtyRaw) : null,
            yield_unit: isPrep ? (draft.yieldUnit || null) : null,
            labor_minutes: isPrep ? toNumberOrNull(draft.laborRaw) : null,
        };
    });

    const { data: insertedRecipes, error: insertErr } = await db.from("recipes").insert(toInsert).select("id,name,is_prep");
    if (insertErr) { showError("Ошибка создания рецептов", insertErr.message); return; }
    const insertedIdByName = new Map();
    insertedRecipes.forEach((r) => {
        insertedIdByName.set(r.name, r.id);
        recipeMap[r.name] = r.id;
        if (r.is_prep) prepNameSet.add(r.name);
    });

    for (const draft of selectedDrafts) {
        if (!draft.tagsRaw) continue;
        const recipeId = insertedIdByName.get(draft.name.trim());
        const tagNames = draft.tagsRaw.split(",").map((s) => s.trim()).filter(Boolean);
        for (const tagName of tagNames) {
            const tagId = await getOrCreateTagId(tagName);
            if (tagId) await db.from("recipe_tags").insert({ recipe_id: recipeId, tag_id: tagId });
        }
    }

    const itemsToInsert = [];
    const itemErrors = [];
    for (const draft of selectedDrafts) {
        const recipeId = insertedIdByName.get(draft.name.trim());
        for (const r of draft.rows) {
            if (!r.ingName) continue;
            const isTopup = isTopupMark(r.topupRaw);
            const resolved = await resolveOrCreateIngredientOrPrep(r.ingName, isTopup ? null : (r.unitRaw || null));
            if (!resolved) { itemErrors.push(`${draft.name} / ${r.ingName}: не получилось создать в номенклатуре`); continue; }
            itemsToInsert.push({
                recipe_id: recipeId,
                ingredient_id: resolved.ingredient_id,
                sub_recipe_id: resolved.sub_recipe_id,
                qty: isTopup ? null : toNumberOrNull(r.qtyRaw),
                unit: isTopup ? null : (r.unitRaw || null),
                is_topup: isTopup,
                topup_default_qty: isTopup ? TOPUP_DEFAULT_QTY : null,
                comment: null,
            });
        }
    }
    if (itemsToInsert.length > 0) {
        const { error } = await db.from("recipe_items").insert(itemsToInsert);
        if (error) { showError("Ошибка импорта состава", error.message); return; }
    }

    document.getElementById("bulkInput").value = "";
    clearBulkPreview();
    closeAddModal();
    await loadAll();

    const dupWarnings = [];
    for (const draft of selectedDrafts) {
        const recipeName = draft.name.trim();
        const rid = recipeMap[recipeName];
        const sig = compositionSignature(itemsByRecipe[rid] || []);
        for (const [otherId, otherItems] of Object.entries(itemsByRecipe)) {
            if (otherId === rid) continue;
            if (compositionSignature(otherItems) === sig) {
                dupWarnings.push(`«${recipeName}» — точно такой же состав, как у «${recipesById[otherId].name}»`);
                break;
            }
        }
    }

    const summaryLines = [`Импортировано рецептов: ${selectedDrafts.length}.`];
    if (itemErrors.length) summaryLines.push(`Проблемы со строками состава: ${itemErrors.join("; ")}`);
    if (dupWarnings.length) summaryLines.push(`Возможные дубли состава: ${dupWarnings.join("; ")}`);

    showModal({
        title: itemErrors.length ? "Импорт завершён с замечаниями" : "Импорт завершён",
        message: summaryLines.join("\n\n"),
        buttons: [{ label: "Ок", className: "primary" }],
    });
}

// ---- Инициализация ----

async function init() {
    if (!isDbConfigured()) {
        showStatus(statusEl, "База данных не подключена", "error");
        return;
    }
    populateUnitDatalist();
    populateSubtypeSelect();
    setupFilters();
    await loadAll();

    const params = new URLSearchParams(window.location.search);
    const editId = params.get("edit");
    const openId = params.get("open");
    if (editId && recipesById[editId]) openEditModal(editId);
    else if (openId && recipesById[openId]) openDetail(openId);
    else if (params.get("add")) openAddModal();
}

init();

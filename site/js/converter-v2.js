// v2 "Единицы": список + детейл-панель поверх той же модели данных, что и в js/converter.js
// (таблицы unit_conversions и "простые" заготовки-рецепты), но с UI в стиле остальных v2-вкладок.
// Специально НЕ переиспользует js/converter.js, чтобы не рисковать v1-страницей converter.html.

const statusEl = document.getElementById("status");

let ingredientsByName = {}; // name -> {id, name, base_unit}
let ingredientsById = {};   // id -> {id, name, base_unit}
let allRecipesByName = {};  // name -> {id, name, is_prep, yield_qty, yield_unit}

let convRows = [];   // из unit_conversions
let yieldRows = [];  // "простые" заготовки (см. loadAll)
let complexPrepCount = 0;

let mode = "conv";        // "conv" | "yield"
let searchQuery = "";
let selectedConvId = null;
let selectedYieldId = null;
let editingConvId = null; // id редактируемой (не новой) записи в открытой форме конвертации
let editingYieldId = null;

function findConv(id) { return convRows.find((r) => r.id === id) || null; }
function findYield(id) { return yieldRows.find((r) => r.id === id) || null; }

// ---- Список ----

function visibleConvRows() {
    const q = searchQuery;
    return convRows
        .filter((r) => {
            if (!q) return true;
            const ing = ingredientsById[r.ingredient_id];
            return ing && ing.name.toLowerCase().includes(q);
        })
        .slice()
        .sort((a, b) => {
            const na = (ingredientsById[a.ingredient_id] || {}).name || "";
            const nb = (ingredientsById[b.ingredient_id] || {}).name || "";
            return na.localeCompare(nb, "ru") || a.from_unit.localeCompare(b.from_unit, "ru");
        });
}

function visibleYieldRows() {
    const q = searchQuery;
    return yieldRows
        .filter((r) => {
            if (!q) return true;
            const rawName = (ingredientsById[r.ingredient_id] || {}).name || "";
            return r.name.toLowerCase().includes(q) || rawName.toLowerCase().includes(q);
        })
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

function buildConvRow(record, index) {
    const ing = ingredientsById[record.ingredient_id];
    const row = document.createElement("button");
    row.type = "button";
    row.className = "bc-recipe-row" + (record.id === selectedConvId ? " selected" : "");

    const top = document.createElement("span");
    top.className = "bc-row-top";
    const indexEl = document.createElement("span");
    indexEl.className = "bc-index";
    indexEl.textContent = String(index + 1).padStart(2, "0");
    top.appendChild(indexEl);

    const title = document.createElement("span");
    title.className = "bc-row-title";
    const strong = document.createElement("strong");
    strong.textContent = ing ? ing.name : "ингредиент не найден";
    const sub = document.createElement("span");
    sub.textContent = ing && ing.base_unit ? `1 ${record.from_unit} = ${record.coefficient} ${ing.base_unit}` : record.from_unit;
    title.appendChild(strong);
    title.appendChild(sub);
    top.appendChild(title);
    row.appendChild(top);

    const badges = document.createElement("span");
    badges.className = "bc-row-badges";
    const badge = document.createElement("span");
    badge.className = "bc-badge-volume";
    badge.textContent = record.from_unit;
    badges.appendChild(badge);
    row.appendChild(badges);

    row.onclick = () => selectConv(record.id);
    return row;
}

function buildYieldRow(record, index) {
    const rawIng = ingredientsById[record.ingredient_id];
    const row = document.createElement("button");
    row.type = "button";
    row.className = "bc-recipe-row" + (record.id === selectedYieldId ? " selected" : "");

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
    const rawLabel = rawIng ? rawIng.name : "?";
    sub.textContent = record.rawQty && record.rawUnit
        ? `${record.rawQty} ${record.rawUnit} (${rawLabel}) → ${record.yield_qty} ${record.yield_unit}`
        : "состав не задан";
    title.appendChild(strong);
    title.appendChild(sub);
    top.appendChild(title);
    row.appendChild(top);

    const badges = document.createElement("span");
    badges.className = "bc-row-badges";
    const badge = document.createElement("span");
    badge.className = "bc-badge-volume";
    badge.textContent = `${record.yield_qty || "?"} ${record.yield_unit || ""}`.trim();
    badges.appendChild(badge);
    row.appendChild(badges);

    row.onclick = () => selectYield(record.id);
    return row;
}

function renderList() {
    const list = document.getElementById("convList");
    list.innerHTML = "";
    const rows = mode === "conv" ? visibleConvRows() : visibleYieldRows();
    document.getElementById("convCount").textContent = mode === "conv" ? convRows.length : yieldRows.length;

    if (rows.length === 0) {
        const empty = document.createElement("div");
        empty.className = "bc-empty";
        empty.textContent = searchQuery
            ? "Ничего не найдено"
            : (mode === "conv" ? "Пока нет ни одной конвертации" : "Пока нет ни одного выхода из сырья");
        list.appendChild(empty);
        return;
    }
    rows.forEach((record, index) => {
        list.appendChild(mode === "conv" ? buildConvRow(record, index) : buildYieldRow(record, index));
    });

    if (mode === "yield" && complexPrepCount > 0 && !searchQuery) {
        const hint = document.createElement("div");
        hint.className = "bc-field-hint";
        hint.style.padding = "8px 4px";
        hint.textContent = `Ещё ${complexPrepCount} заготовок(-и) со сложным составом — редактируются в «Рецептах».`;
        list.appendChild(hint);
    }
}

function selectConv(id) {
    selectedConvId = id;
    renderList();
    renderDetail();
    if (window.matchMedia("(max-width: 1080px)").matches) openDrawer();
}

function selectYield(id) {
    selectedYieldId = id;
    renderList();
    renderDetail();
    if (window.matchMedia("(max-width: 1080px)").matches) openDrawer();
}

// ---- Детейл-панель (только чтение) ----

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

function buildConvDetail(record, opts = {}) {
    const { titleActions = true } = opts;
    const ing = ingredientsById[record.ingredient_id];
    const root = document.createElement("div");

    const top = document.createElement("div");
    top.className = "bc-detail-top";
    const titleWrap = document.createElement("div");
    const kicker = document.createElement("div");
    kicker.className = "bc-kicker";
    kicker.textContent = ing ? (ing.base_unit || "без базовой ед.") : "ингредиент не найден";
    titleWrap.appendChild(kicker);

    const titleRow = document.createElement("div");
    titleRow.className = "ing-title-row";
    const h2 = document.createElement("h2");
    h2.textContent = ing ? ing.name : "?";
    titleRow.appendChild(h2);

    if (titleActions) {
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "bc-icon-btn";
        editBtn.title = "Изменить";
        editBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4Z"/><path d="M14 5l3 3"/></svg>';
        editBtn.onclick = () => openConvForm(record.id);
        titleRow.appendChild(editBtn);

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "bc-icon-btn ing-danger";
        delBtn.title = "Удалить";
        delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 7h14M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-9 0 1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>';
        delBtn.onclick = () => deleteConv(record);
        titleRow.appendChild(delBtn);
    }
    titleWrap.appendChild(titleRow);
    top.appendChild(titleWrap);
    root.appendChild(top);

    const meta = document.createElement("div");
    meta.className = "bc-meta";
    addMetaLine(meta, "Единица рецепта", record.from_unit);
    addMetaLine(meta, "Коэффициент", String(record.coefficient));
    if (ing && ing.base_unit) addMetaLine(meta, "Формула", `1 ${record.from_unit} = ${record.coefficient} ${ing.base_unit}`);
    addMetaLine(meta, "Комментарий", record.comment || "");
    root.appendChild(meta);

    return root;
}

function buildYieldDetail(record, opts = {}) {
    const { titleActions = true } = opts;
    const rawIng = ingredientsById[record.ingredient_id];
    const root = document.createElement("div");

    const top = document.createElement("div");
    top.className = "bc-detail-top";
    const titleWrap = document.createElement("div");
    const kicker = document.createElement("div");
    kicker.className = "bc-kicker";
    kicker.textContent = "выход из сырья";
    titleWrap.appendChild(kicker);

    const titleRow = document.createElement("div");
    titleRow.className = "ing-title-row";
    const h2 = document.createElement("h2");
    h2.textContent = record.name;
    titleRow.appendChild(h2);

    if (titleActions) {
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "bc-icon-btn";
        editBtn.title = "Изменить";
        editBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4Z"/><path d="M14 5l3 3"/></svg>';
        editBtn.onclick = () => openYieldForm(record.id);
        titleRow.appendChild(editBtn);

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "bc-icon-btn ing-danger";
        delBtn.title = "Удалить";
        delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 7h14M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-9 0 1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>';
        delBtn.onclick = () => deleteYield(record);
        titleRow.appendChild(delBtn);
    }
    titleWrap.appendChild(titleRow);
    top.appendChild(titleWrap);
    root.appendChild(top);

    const meta = document.createElement("div");
    meta.className = "bc-meta";
    addMetaLine(meta, "Сырьё", rawIng ? rawIng.name : "?");
    addMetaLine(meta, "Кол-во сырья", record.rawQty ? `${record.rawQty} ${record.rawUnit || ""}`.trim() : "");
    addMetaLine(meta, "Выход", record.yield_qty ? `${record.yield_qty} ${record.yield_unit || ""}`.trim() : "");
    addMetaLine(meta, "Комментарий", record.comment || "");
    root.appendChild(meta);

    const actionsWrap = document.createElement("div");
    actionsWrap.className = "bc-detail-actions";
    const link = document.createElement("a");
    link.className = "bc-button-link";
    link.href = "recipes.html?open=" + encodeURIComponent(record.id);
    link.target = "_blank";
    link.textContent = "открыть в Рецептах →";
    actionsWrap.appendChild(link);
    root.appendChild(actionsWrap);

    return root;
}

function renderDetail() {
    const pane = document.getElementById("detailPane");
    pane.innerHTML = "";
    const record = mode === "conv" ? findConv(selectedConvId) : findYield(selectedYieldId);
    if (!record) {
        const empty = document.createElement("div");
        empty.className = "bc-empty";
        empty.textContent = "выберите строку слева";
        pane.appendChild(empty);
    } else {
        pane.appendChild(mode === "conv" ? buildConvDetail(record) : buildYieldDetail(record));
    }

    const drawer = document.getElementById("detailDrawer");
    if (!drawer.classList.contains("hidden")) {
        if (!record) { closeDrawer(); return; }
        const drawerContent = document.getElementById("drawerContent");
        drawerContent.innerHTML = "";
        drawerContent.appendChild(mode === "conv" ? buildConvDetail(record, { titleActions: false }) : buildYieldDetail(record, { titleActions: false }));
        updateDrawerActions(record);
    }
}

function updateDrawerActions(record) {
    document.getElementById("drawerEditBtn").onclick = () => {
        closeDrawer();
        if (mode === "conv") openConvForm(record.id); else openYieldForm(record.id);
    };
    document.getElementById("drawerDeleteBtn").onclick = () => {
        if (mode === "conv") deleteConv(record); else deleteYield(record);
    };
}

function openDrawer() { document.getElementById("detailDrawer").classList.remove("hidden"); }
function closeDrawer() { document.getElementById("detailDrawer").classList.add("hidden"); }

function render() {
    renderList();
    renderDetail();
}

// ---- Форма конвертации ----

function refreshConvFormula() {
    const name = document.getElementById("cfName").value.trim();
    const fromUnit = document.getElementById("cfUnit").value.trim();
    const coeff = document.getElementById("cfCoeff").value.trim();
    const ing = ingredientsByName[name];
    const out = document.getElementById("cfFormula");
    if (ing && ing.base_unit && fromUnit && coeff) {
        out.textContent = `1 ${fromUnit} = ${coeff} ${ing.base_unit}`;
    } else if (name && !ing) {
        out.textContent = "ингредиент не найден в Сырье";
    } else {
        out.textContent = "";
    }
}

function openConvForm(id) {
    editingConvId = id || null;
    const record = id ? findConv(id) : null;
    document.getElementById("convFormTitle").textContent = record ? "Изменить конвертацию" : "Новая конвертация";
    document.getElementById("convFormStatus").innerHTML = "";
    document.getElementById("cfName").value = record ? (ingredientsById[record.ingredient_id] || {}).name || "" : "";
    document.getElementById("cfUnit").value = record ? record.from_unit : "";
    document.getElementById("cfCoeff").value = record ? record.coefficient : "";
    document.getElementById("cfComment").value = record ? (record.comment || "") : "";
    refreshConvFormula();
    document.getElementById("convFormDrawer").classList.remove("hidden");
}

function closeConvForm() {
    document.getElementById("convFormDrawer").classList.add("hidden");
}

async function saveConvForm() {
    const name = document.getElementById("cfName").value.trim();
    const fromUnit = document.getElementById("cfUnit").value.trim();
    const coeffRaw = document.getElementById("cfCoeff").value.trim();
    const comment = document.getElementById("cfComment").value.trim();

    if (!name || !fromUnit || !coeffRaw) {
        showStatus(document.getElementById("convFormStatus"), "Заполните ингредиент, единицу рецепта и коэффициент", "error");
        return;
    }
    const ing = ingredientsByName[name];
    if (!ing) {
        showStatus(document.getElementById("convFormStatus"), `Ингредиент «${name}» не найден в Сырье — сначала заведите его там`, "error");
        return;
    }
    const coefficient = Number(coeffRaw.replace(",", "."));
    if (!coefficient || coefficient <= 0) {
        showStatus(document.getElementById("convFormStatus"), "Коэффициент должен быть положительным числом", "error");
        return;
    }

    const values = { ingredient_id: ing.id, from_unit: fromUnit, coefficient, comment: comment || null };
    let error;
    if (editingConvId) {
        ({ error } = await db.from("unit_conversions").update(values).eq("id", editingConvId));
    } else {
        ({ error } = await db.from("unit_conversions").insert(values));
    }
    if (error) {
        const msg = error.code === "23505"
            ? `Для «${name}» единица «${fromUnit}» уже сконвертирована — отредактируйте существующую строку`
            : error.message;
        showStatus(document.getElementById("convFormStatus"), "Не сохранилось: " + msg, "error");
        return;
    }
    showToast("Сохранено", "info");
    closeConvForm();
    await loadAll();
}

async function deleteConv(record) {
    if (!confirm("Удалить эту конвертацию?")) return;
    const { error } = await db.from("unit_conversions").delete().eq("id", record.id);
    if (error) {
        showToast("Не удалилось: " + error.message, "error");
        return;
    }
    showToast("Удалено", "info");
    selectedConvId = null;
    closeDrawer();
    await loadAll();
}

// ---- Форма выхода из сырья ----
// Под капотом это заготовка (recipes.is_prep=true) с составом из одного сырья — та же сущность,
// что редактируется в "Рецептах", просто здесь узкий случай "1 сырьё -> выход" в компактной форме.

function refreshYieldFormula() {
    const outputName = document.getElementById("yfOutputName").value.trim();
    const rawName = document.getElementById("yfRawName").value.trim();
    const rawQty = document.getElementById("yfRawQty").value.trim();
    const rawUnit = document.getElementById("yfRawUnit").value.trim();
    const yieldQty = document.getElementById("yfYieldQty").value.trim();
    const yieldUnit = document.getElementById("yfYieldUnit").value.trim();
    const out = document.getElementById("yfFormula");
    if (rawQty && rawUnit && rawName && yieldQty && yieldUnit) {
        out.textContent = `${rawQty} ${rawUnit} (${rawName}) → ${yieldQty} ${yieldUnit} (${outputName || "?"})`;
    } else {
        out.textContent = "";
    }
}

function openYieldForm(id) {
    editingYieldId = id || null;
    const record = id ? findYield(id) : null;
    document.getElementById("yfFormTitle").textContent = record ? "Изменить выход из сырья" : "Новый выход из сырья";
    document.getElementById("yieldFormStatus").innerHTML = "";
    document.getElementById("yfOutputName").value = record ? record.name : "";
    document.getElementById("yfRawName").value = record ? (ingredientsById[record.ingredient_id] || {}).name || "" : "";
    document.getElementById("yfRawQty").value = record ? (record.rawQty || "") : "";
    document.getElementById("yfRawUnit").value = record ? (record.rawUnit || "") : "";
    document.getElementById("yfYieldQty").value = record ? (record.yield_qty || "") : "";
    document.getElementById("yfYieldUnit").value = record ? (record.yield_unit || "") : "";
    document.getElementById("yfComment").value = record ? (record.comment || "") : "";
    refreshYieldFormula();
    document.getElementById("yieldFormDrawer").classList.remove("hidden");
}

function closeYieldForm() {
    document.getElementById("yieldFormDrawer").classList.add("hidden");
}

function formatQtyForConfirm(qty, unit) {
    if (qty === null || qty === undefined) return unit || "";
    return unit ? `${qty} ${unit}` : String(qty);
}

async function findIngredientUsages(ingredientId) {
    const { data, error } = await db
        .from("recipe_items")
        .select("id,qty,unit,recipe:recipes!recipe_id(name)")
        .eq("ingredient_id", ingredientId);
    if (error) return { error };
    return { usages: data };
}

async function saveYieldForm() {
    const statusEl2 = document.getElementById("yieldFormStatus");
    const outputName = document.getElementById("yfOutputName").value.trim();
    const rawName = document.getElementById("yfRawName").value.trim();
    const rawQtyRaw = document.getElementById("yfRawQty").value.trim();
    const rawUnit = document.getElementById("yfRawUnit").value.trim();
    const yieldQtyRaw = document.getElementById("yfYieldQty").value.trim();
    const yieldUnit = document.getElementById("yfYieldUnit").value.trim();
    const comment = document.getElementById("yfComment").value.trim();

    if (!outputName || !rawName || !rawQtyRaw || !rawUnit || !yieldQtyRaw || !yieldUnit) {
        showStatus(statusEl2, "Заполните продукт, сырьё, количество сырья и выход целиком", "error");
        return;
    }
    if (outputName === rawName) {
        showStatus(statusEl2, "Продукт и сырьё называются одинаково — заготовка не может производиться сама из себя", "error");
        return;
    }
    const existingByName = allRecipesByName[outputName];
    if (existingByName && existingByName.id !== editingYieldId) {
        showStatus(statusEl2, `Название «${outputName}» уже занято в Рецептах — выберите другое`, "error");
        return;
    }
    const rawQty = Number(rawQtyRaw.replace(",", "."));
    const yieldQty = Number(yieldQtyRaw.replace(",", "."));
    if (!rawQty || rawQty <= 0 || !yieldQty || yieldQty <= 0) {
        showStatus(statusEl2, "Количество сырья и выход должны быть положительными числами", "error");
        return;
    }

    if (allRecipesByName[rawName] && allRecipesByName[rawName].id !== editingYieldId) {
        const proceed = confirm(`«${rawName}» уже существует как заготовка в Рецептах, а не как сырьё. Обычно сырьём должно быть то, что покупается напрямую. Всё равно создать сырьё с таким же именем?`);
        if (!proceed) return;
    }

    const collidingIngredient = ingredientsByName[outputName];
    let usagesToRelink = [];
    if (collidingIngredient) {
        const { usages, error } = await findIngredientUsages(collidingIngredient.id);
        if (error) {
            showStatus(statusEl2, "Не удалось проверить использование «" + outputName + "» как сырья: " + error.message, "error");
            return;
        }
        if (usages.length > 0) {
            const list = usages.map((u) => `«${(u.recipe && u.recipe.name) || "?"}» (${formatQtyForConfirm(u.qty, u.unit)})`).join(", ");
            const proceed = confirm(
                `В Сырье уже есть позиция «${outputName}» — она используется как ингредиент в: ${list}. ` +
                `Похоже, это должно ссылаться на новую заготовку, а не на сырьё напрямую. Перепривязать эти строки состава на заготовку «${outputName}»?\n\n` +
                `Отмена — заготовка всё равно будет сохранена, но старые строки останутся привязаны к сырью как раньше (свяжете вручную).`
            );
            if (proceed) usagesToRelink = usages;
        } else {
            showToast(`Учтите: в Сырье уже есть неиспользуемая позиция «${outputName}» — после сохранения её стоит удалить, чтобы не путаться.`, "info");
        }
    }

    let ing = ingredientsByName[rawName];
    if (!ing) {
        const { data, error } = await db.from("ingredients").insert({ name: rawName, base_unit: rawUnit }).select("id,name,base_unit").single();
        if (error) {
            showStatus(statusEl2, "Не получилось создать сырьё: " + error.message, "error");
            return;
        }
        ing = data;
        ingredientsByName[ing.name] = ing;
        ingredientsById[ing.id] = ing;
        refreshIngredientDatalist();
    }

    const existingRecord = editingYieldId ? findYield(editingYieldId) : null;
    let recipeId = editingYieldId;
    if (recipeId) {
        const { error } = await db.from("recipes").update({ name: outputName, yield_qty: yieldQty, yield_unit: yieldUnit, is_yield_helper: true }).eq("id", recipeId);
        if (error) { showStatus(statusEl2, "Не сохранилось: " + error.message, "error"); return; }
    } else {
        const { data, error } = await db.from("recipes").insert({ name: outputName, type: "Заготовка", is_prep: true, yield_qty: yieldQty, yield_unit: yieldUnit, is_yield_helper: true }).select("id").single();
        if (error) { showStatus(statusEl2, "Не сохранилось: " + error.message, "error"); return; }
        recipeId = data.id;
    }

    const itemValues = { ingredient_id: ing.id, sub_recipe_id: null, qty: rawQty, unit: rawUnit, is_topup: false, comment: comment || null };
    let itemError;
    if (existingRecord && existingRecord.itemId) {
        ({ error: itemError } = await db.from("recipe_items").update(itemValues).eq("id", existingRecord.itemId));
    } else {
        ({ error: itemError } = await db.from("recipe_items").insert({ ...itemValues, recipe_id: recipeId }));
    }
    if (itemError) {
        showStatus(statusEl2, "Заготовка сохранена, но состав не сохранился: " + itemError.message, "error");
        return;
    }

    if (usagesToRelink.length > 0) {
        const { error: relinkError } = await db
            .from("recipe_items")
            .update({ ingredient_id: null, sub_recipe_id: recipeId })
            .in("id", usagesToRelink.map((u) => u.id));
        if (relinkError) {
            showToast("Заготовка сохранена, но перепривязать старые строки не получилось: " + relinkError.message, "error");
        } else {
            showToast(`Сохранено, перепривязано использований: ${usagesToRelink.length}`, "info");
        }
    } else {
        showToast("Сохранено", "info");
    }

    closeYieldForm();
    await loadAll();
}

async function deleteYield(record) {
    const { data: usages, error: usageError } = await db
        .from("recipe_items")
        .select("recipe:recipes!recipe_id(name)")
        .eq("sub_recipe_id", record.id);
    if (usageError) {
        showToast("Не удалось проверить использование: " + usageError.message, "error");
        return;
    }
    if (usages.length > 0) {
        const names = [...new Set(usages.map((u) => u.recipe && u.recipe.name).filter(Boolean))];
        alert(`Нельзя удалить «${record.name}» — она используется в составе: ${names.join(", ")}. Сначала уберите её оттуда.`);
        return;
    }
    if (!confirm(`Удалить заготовку «${record.name}» целиком (вместе с составом)?`)) return;
    const { error } = await db.from("recipes").delete().eq("id", record.id);
    if (error) {
        showToast("Не удалилось: " + error.message, "error");
        return;
    }
    showToast("Удалено", "info");
    selectedYieldId = null;
    closeDrawer();
    await loadAll();
}

// ---- Загрузка данных ----

function refreshIngredientDatalist() {
    const dl = document.getElementById("ingredientNamesList");
    dl.innerHTML = "";
    Object.keys(ingredientsByName).sort((a, b) => a.localeCompare(b, "ru")).forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        dl.appendChild(opt);
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

async function loadAll() {
    const [ingRes, convRes, recRes, itemsRes] = await Promise.all([
        db.from("ingredients").select("id,name,base_unit").order("name"),
        db.from("unit_conversions").select("*"),
        db.from("recipes").select("id,name,is_prep,subtype,yield_qty,yield_unit"),
        db.from("recipe_items").select("id,recipe_id,ingredient_id,sub_recipe_id,qty,unit,is_topup,comment"),
    ]);
    if (ingRes.error) { showStatus(statusEl, "Ошибка загрузки: " + ingRes.error.message, "error"); return; }
    if (convRes.error) { showStatus(statusEl, "Ошибка загрузки конвертаций: " + convRes.error.message, "error"); return; }
    if (recRes.error || itemsRes.error) { showStatus(statusEl, "Ошибка загрузки рецептов: " + (recRes.error || itemsRes.error).message, "error"); return; }

    ingredientsByName = {};
    ingredientsById = {};
    ingRes.data.forEach((i) => { ingredientsByName[i.name] = i; ingredientsById[i.id] = i; });
    convRows = convRes.data;

    allRecipesByName = {};
    recRes.data.forEach((r) => { allRecipesByName[r.name] = r; });
    const itemsByRecipeId = {};
    itemsRes.data.forEach((it) => { (itemsByRecipeId[it.recipe_id] ||= []).push(it); });

    // "Простая" заготовка для этого раздела — заготовка с составом ровно из одного сырья
    // (не долив, не вложенная заготовка). Более сложный состав редактируется в "Рецептах".
    complexPrepCount = 0;
    yieldRows = recRes.data
        .filter((r) => r.is_prep)
        .map((r) => {
            const items = itemsByRecipeId[r.id] || [];
            const simple = items.length === 0 || (items.length === 1 && items[0].ingredient_id && !items[0].is_topup);
            if (!simple) { complexPrepCount += 1; return null; }
            const item = items[0] || null;
            return {
                id: r.id,
                name: r.name,
                yield_qty: r.yield_qty,
                yield_unit: r.yield_unit,
                itemId: item ? item.id : null,
                ingredient_id: item ? item.ingredient_id : null,
                rawQty: item ? item.qty : null,
                rawUnit: item ? item.unit : null,
                comment: item ? item.comment : null,
            };
        })
        .filter(Boolean);

    refreshIngredientDatalist();
    render();
}

// ---- Переход по ссылке из "Мероприятия"/"Сырья" с уже известным ингредиентом/единицей ----

function applyQueryPrefill() {
    const params = new URLSearchParams(window.location.search);
    const ingredient = params.get("ingredient");
    const unit = params.get("unit");
    if (!ingredient) return;
    mode = "conv";
    setModeUI();
    openConvForm(null);
    document.getElementById("cfName").value = ingredient;
    document.getElementById("cfUnit").value = unit || "";
    refreshConvFormula();
}

// ---- Вкладки/тулбар/обработчики ----

const modeTabsEl = document.getElementById("modeTabs");
const modeButtons = [...modeTabsEl.querySelectorAll("button")];
const modeThumb = modeTabsEl.querySelector(".bc-segmented-thumb");

let activeModeButton = modeButtons[0];

function setModeThumb(btn) {
    if (btn) activeModeButton = btn;
    if (!modeThumb || !activeModeButton) return;
    modeThumb.style.transform = "none";
    modeThumb.style.left = activeModeButton.offsetLeft + "px";
    modeThumb.style.width = activeModeButton.offsetWidth + "px";
}

function setModeUI() {
    modeButtons.forEach((btn) => {
        const active = btn.dataset.mode === mode;
        btn.classList.toggle("active", active);
        if (active) setModeThumb(btn);
    });
    document.getElementById("addBtn").textContent = mode === "conv" ? "+ конвертация" : "+ выход из сырья";
    document.getElementById("searchInput").placeholder = mode === "conv" ? "поиск по ингредиенту..." : "поиск по продукту или сырью...";
    render();
}

modeButtons.forEach((btn) => {
    btn.onclick = () => {
        if (btn.dataset.mode === mode) return;
        mode = btn.dataset.mode;
        setModeUI();
    };
});
window.addEventListener("resize", () => setModeThumb());
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => setModeThumb());
}

document.getElementById("addBtn").onclick = () => {
    if (mode === "conv") openConvForm(null); else openYieldForm(null);
};

document.getElementById("searchInput").oninput = (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    render();
};

document.getElementById("closeDrawerBtn").onclick = closeDrawer;
document.getElementById("detailDrawer").onclick = (e) => { if (e.target.id === "detailDrawer") closeDrawer(); };

document.getElementById("convFormCloseBtn").onclick = closeConvForm;
document.getElementById("convFormDrawer").onclick = (e) => { if (e.target.id === "convFormDrawer") closeConvForm(); };
document.getElementById("cfSaveBtn").onclick = saveConvForm;
["cfName", "cfUnit", "cfCoeff"].forEach((id) => document.getElementById(id).addEventListener("input", refreshConvFormula));

document.getElementById("yieldFormCloseBtn").onclick = closeYieldForm;
document.getElementById("yieldFormDrawer").onclick = (e) => { if (e.target.id === "yieldFormDrawer") closeYieldForm(); };
document.getElementById("yfSaveBtn").onclick = saveYieldForm;
["yfOutputName", "yfRawName", "yfRawQty", "yfRawUnit", "yfYieldQty", "yfYieldUnit"].forEach((id) => document.getElementById(id).addEventListener("input", refreshYieldFormula));

document.getElementById("toolsBtn").onclick = () => document.getElementById("toolsOverlay").classList.remove("hidden");
document.getElementById("closeToolsBtn").onclick = () => document.getElementById("toolsOverlay").classList.add("hidden");
document.getElementById("toolsOverlay").onclick = (e) => { if (e.target.id === "toolsOverlay") document.getElementById("toolsOverlay").classList.add("hidden"); };

document.getElementById("bulkConvImportBtn").onclick = async () => {
    const text = document.getElementById("bulkConvInput").value.trim();
    if (!text) return;
    const rows = text.split("\n").map((line) => line.split("\t")).filter((cols) => cols.some((c) => c.trim()));
    if (rows.length === 0) return;

    const toInsert = [];
    const errors = [];
    rows.forEach((cols, idx) => {
        const name = (cols[0] || "").trim();
        const fromUnit = (cols[1] || "").trim();
        const coeffRaw = (cols[2] || "").trim();
        const comment = (cols[3] || "").trim();
        if (!name || !fromUnit || !coeffRaw) return;
        const ing = ingredientsByName[name];
        if (!ing) { errors.push(`Строка ${idx + 1}: ингредиент «${name}» не найден в Сырье`); return; }
        const coefficient = Number(coeffRaw.replace(",", "."));
        if (!coefficient || coefficient <= 0) { errors.push(`Строка ${idx + 1}: некорректный коэффициент`); return; }
        toInsert.push({ ingredient_id: ing.id, from_unit: fromUnit, coefficient, comment: comment || null });
    });

    if (toInsert.length === 0) {
        showToast(errors.length ? "Ни одной строки не удалось разобрать" : "Не нашёл ни одной строки", "error");
        if (errors.length) alert(errors.join("\n"));
        return;
    }

    const { error } = await db.from("unit_conversions").upsert(toInsert, { onConflict: "ingredient_id,from_unit" });
    if (error) { showToast("Ошибка импорта: " + error.message, "error"); return; }

    document.getElementById("bulkConvInput").value = "";
    showToast(`Импортировано: ${toInsert.length}` + (errors.length ? `, ошибок: ${errors.length}` : ""), errors.length ? "error" : "info");
    if (errors.length) alert("Не всё получилось:\n\n" + errors.join("\n"));
    await loadAll();
};

document.getElementById("bulkYieldImportBtn").onclick = async () => {
    const text = document.getElementById("bulkYieldInput").value.trim();
    if (!text) return;
    const rows = text.split("\n").map((line) => line.split("\t")).filter((cols) => cols.some((c) => c.trim()));
    if (rows.length === 0) return;

    let ok = 0;
    const errors = [];
    for (let idx = 0; idx < rows.length; idx += 1) {
        const cols = rows[idx];
        const outputName = (cols[0] || "").trim();
        const rawName = (cols[1] || "").trim();
        const rawQtyRaw = (cols[2] || "").trim();
        const rawUnit = (cols[3] || "").trim();
        const yieldQtyRaw = (cols[4] || "").trim();
        const yieldUnit = (cols[5] || "").trim();
        const comment = (cols[6] || "").trim();
        if (!outputName || !rawName || !rawQtyRaw || !rawUnit || !yieldQtyRaw || !yieldUnit) continue;
        if (allRecipesByName[outputName]) { errors.push(`Строка ${idx + 1}: «${outputName}» уже занято в Рецептах`); continue; }
        const rawQty = Number(rawQtyRaw.replace(",", "."));
        const yieldQty = Number(yieldQtyRaw.replace(",", "."));
        if (!rawQty || rawQty <= 0 || !yieldQty || yieldQty <= 0) { errors.push(`Строка ${idx + 1}: некорректное количество`); continue; }

        let ing = ingredientsByName[rawName];
        if (!ing) {
            const { data, error } = await db.from("ingredients").insert({ name: rawName, base_unit: rawUnit }).select("id,name,base_unit").single();
            if (error) { errors.push(`Строка ${idx + 1}: не удалось создать сырьё «${rawName}»: ${error.message}`); continue; }
            ing = data;
            ingredientsByName[ing.name] = ing;
            ingredientsById[ing.id] = ing;
        }

        const { data: recipeData, error: recipeError } = await db
            .from("recipes")
            .insert({ name: outputName, type: "Заготовка", is_prep: true, yield_qty: yieldQty, yield_unit: yieldUnit, is_yield_helper: true })
            .select("id")
            .single();
        if (recipeError) { errors.push(`Строка ${idx + 1}: ${recipeError.message}`); continue; }
        allRecipesByName[outputName] = { id: recipeData.id, name: outputName };

        const { error: itemError } = await db.from("recipe_items").insert({
            recipe_id: recipeData.id, ingredient_id: ing.id, sub_recipe_id: null,
            qty: rawQty, unit: rawUnit, is_topup: false, comment: comment || null,
        });
        if (itemError) { errors.push(`Строка ${idx + 1}: заготовка создана, но состав не сохранился: ${itemError.message}`); continue; }
        ok += 1;
    }

    if (ok === 0 && errors.length === 0) { showToast("Не нашёл ни одной строки", "error"); return; }
    document.getElementById("bulkYieldInput").value = "";
    showToast(`Импортировано: ${ok}` + (errors.length ? `, ошибок: ${errors.length}` : ""), errors.length ? "error" : "info");
    if (errors.length) alert("Не всё получилось:\n\n" + errors.join("\n"));
    await loadAll();
};

if (!isDbConfigured()) {
    showStatus(statusEl, "База данных ещё не подключена — впишите SUPABASE_URL и SUPABASE_ANON_KEY в js/supabase-client.js", "error");
} else {
    populateUnitDatalist();
    setModeUI();
    loadAll().then(() => applyQueryPrefill());
}

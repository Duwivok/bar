// Конвертер единиц: управление таблицей unit_conversions — коэффициенты перевода
// "неудобной для закупки, но удобной для готовки" единицы рецепта (веточка, лист, шт)
// в базовую единицу ингредиента (мл/г/кг), которую используют для закупки на мероприятие.

const statusEl = document.getElementById("status");
const tbody = document.getElementById("conversionsBody");
const emptyHint = document.getElementById("emptyHint");

let ingredientsByName = {}; // name -> {id, name, base_unit}
let ingredientsById = {};   // id -> {id, name, base_unit}
let allRows = [];           // из базы: {id, ingredient_id, from_unit, coefficient, comment}
let draftRows = [];         // новые, ещё не сохранённые строки
let editingIds = new Set();
let draftCounter = 0;
let pendingEdits = {};      // rowKey -> {field: значение}

let searchQuery = "";

const yieldTbody = document.getElementById("yieldBody");
const yieldEmptyHint = document.getElementById("yieldEmptyHint");

let allRecipesByName = {};   // name -> {id, name, is_prep, subtype, yield_qty, yield_unit} (все рецепты, для проверки занятости имени)
let itemsByRecipeId = {};    // recipeId -> [{id, recipe_id, ingredient_id, sub_recipe_id, qty, unit, is_topup}]
let yieldRows = [];          // из базы, только "простые" заготовки — см. loadAll()
let complexPrepCount = 0;    // заготовки со сложным составом — не показываем здесь, редактируются в "Рецептах"
let yieldDraftRows = [];
let yieldEditingIds = new Set();
let yieldDraftCounter = 0;
let yieldPendingEdits = {};  // rowKey -> {field: значение}

function cellInput(value, key, rowKey, opts) {
    opts = opts || {};
    const input = document.createElement("input");
    input.type = "text";
    if (key === "coefficient") input.inputMode = "decimal";
    if (opts.list) input.setAttribute("list", opts.list);
    if (value !== null && value !== undefined) input.value = value;
    input.dataset.field = key;
    input.oninput = () => {
        (pendingEdits[rowKey] ||= {})[key] = input.value;
        if (key === "ingredientName" || key === "from_unit" || key === "coefficient") refreshRowFormula(rowKey);
    };
    return input;
}

function currentValue(record, rowKey, key) {
    const overrides = pendingEdits[rowKey] || {};
    if (key in overrides) return overrides[key];
    if (key === "ingredientName") {
        const ing = ingredientsById[record.ingredient_id];
        return ing ? ing.name : "";
    }
    return record[key];
}

function refreshRowFormula(rowKey) {
    const row = tbody.querySelector(`[data-rowkey="${CSS.escape(rowKey)}"]`);
    if (!row) return;
    const baseUnitCell = row.querySelector(".cell-base-unit");
    const formulaCell = row.querySelector(".cell-formula");
    const overrides = pendingEdits[rowKey] || {};
    const name = overrides.ingredientName !== undefined ? overrides.ingredientName : baseUnitCell.dataset.name;
    const ing = ingredientsByName[name];
    const baseUnit = ing ? ing.base_unit : null;
    baseUnitCell.textContent = baseUnit || (ing ? "—" : (name ? "ингредиент не найден" : ""));
    baseUnitCell.classList.toggle("suspicious-value", !!name && !ing);

    const fromUnit = overrides.from_unit !== undefined ? overrides.from_unit : formulaCell.dataset.fromUnit;
    const coeff = overrides.coefficient !== undefined ? overrides.coefficient : formulaCell.dataset.coeff;
    if (ing && baseUnit && fromUnit && coeff) {
        formulaCell.textContent = `1 ${fromUnit} = ${coeff} ${baseUnit}`;
    } else {
        formulaCell.textContent = "";
    }
}

// Обёртка "подпись сверху + поле" — тот же паттерн, что в форме добавления рецепта
// (.form-grid/.form-field), поля сами переносятся на новую строку, когда не помещаются.
function formField(labelText, control) {
    const field = document.createElement("div");
    field.className = "form-field";
    const label = document.createElement("label");
    label.textContent = labelText;
    field.appendChild(label);
    field.appendChild(control);
    return field;
}

function buildRow(record, isDraft) {
    const rowKey = record.id || record.tempId;
    const locked = !isDraft && !editingIds.has(record.id);
    const row = document.createElement("div");
    row.className = "conv-row";
    row.dataset.rowkey = rowKey;
    const inputs = {};

    const grid = document.createElement("div");
    grid.className = "form-grid";

    const nameVal = currentValue(record, rowKey, "ingredientName");
    inputs.ingredientName = cellInput(nameVal, "ingredientName", rowKey, { list: "ingredientNamesList" });
    inputs.ingredientName.disabled = locked;
    grid.appendChild(formField("Ингредиент", inputs.ingredientName));

    const baseUnitDisplay = document.createElement("div");
    baseUnitDisplay.className = "cell-base-unit conv-readonly";
    baseUnitDisplay.dataset.name = nameVal || "";
    grid.appendChild(formField("Базовая ед.", baseUnitDisplay));

    const fromUnitVal = currentValue(record, rowKey, "from_unit");
    inputs.from_unit = cellInput(fromUnitVal, "from_unit", rowKey, { list: "unitOptionsList" });
    inputs.from_unit.disabled = locked;
    grid.appendChild(formField("Единица рецепта", inputs.from_unit));

    const coeffVal = currentValue(record, rowKey, "coefficient");
    inputs.coefficient = cellInput(coeffVal, "coefficient", rowKey);
    inputs.coefficient.disabled = locked;
    grid.appendChild(formField("Коэффициент", inputs.coefficient));

    const commentVal = currentValue(record, rowKey, "comment");
    inputs.comment = cellInput(commentVal, "comment", rowKey);
    inputs.comment.disabled = locked;
    grid.appendChild(formField("Комментарий", inputs.comment));

    row.appendChild(grid);

    const footer = document.createElement("div");
    footer.className = "conv-row-footer";

    const formula = document.createElement("div");
    formula.className = "cell-formula conv-row-formula";
    formula.dataset.fromUnit = fromUnitVal || "";
    formula.dataset.coeff = coeffVal || "";
    footer.appendChild(formula);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    if (locked) {
        const editBtn = document.createElement("button");
        editBtn.textContent = "Изменить";
        editBtn.onclick = () => { editingIds.add(record.id); render(); };
        actions.appendChild(editBtn);
    } else {
        const saveBtn = document.createElement("button");
        saveBtn.textContent = "Сохранить";
        saveBtn.className = "primary";
        saveBtn.onclick = () => saveRow(record, inputs, isDraft);
        actions.appendChild(saveBtn);

        const delBtn = document.createElement("button");
        delBtn.textContent = "Удалить";
        delBtn.className = "danger";
        delBtn.onclick = () => deleteRow(record, isDraft);
        actions.appendChild(delBtn);
    }
    footer.appendChild(actions);
    row.appendChild(footer);

    return row;
}

async function saveRow(record, inputs, isDraft) {
    const name = inputs.ingredientName.value.trim();
    const fromUnit = inputs.from_unit.value.trim();
    const coeffRaw = inputs.coefficient.value.trim();
    const comment = inputs.comment.value.trim();

    if (!name || !fromUnit || !coeffRaw) {
        showToast("Заполните ингредиент, единицу рецепта и коэффициент", "error");
        return;
    }
    const ing = ingredientsByName[name];
    if (!ing) {
        showToast(`Ингредиент «${name}» не найден в Номенклатуре — сначала заведите его там`, "error");
        return;
    }
    const coefficient = Number(coeffRaw.replace(",", "."));
    if (!coefficient || coefficient <= 0) {
        showToast("Коэффициент должен быть положительным числом", "error");
        return;
    }

    const values = { ingredient_id: ing.id, from_unit: fromUnit, coefficient, comment: comment || null };
    const rowKey = record.id || record.tempId;
    let error;
    if (record.id) {
        ({ error } = await db.from("unit_conversions").update(values).eq("id", record.id));
        editingIds.delete(record.id);
    } else {
        ({ error } = await db.from("unit_conversions").insert(values));
        if (!error) draftRows = draftRows.filter((r) => r.tempId !== record.tempId);
    }
    if (error) {
        const msg = error.code === "23505"
            ? `Для «${name}» единица «${fromUnit}» уже сконвертирована — отредактируйте существующую строку`
            : error.message;
        showToast("Не сохранилось: " + msg, "error");
        return;
    }
    delete pendingEdits[rowKey];
    showToast("Сохранено", "info");
    await loadAll();
}

async function deleteRow(record, isDraft) {
    const rowKey = record.id || record.tempId;
    if (isDraft) {
        draftRows = draftRows.filter((r) => r.tempId !== record.tempId);
        delete pendingEdits[rowKey];
        render();
        return;
    }
    if (!confirm("Удалить эту конвертацию?")) return;
    const { error } = await db.from("unit_conversions").delete().eq("id", record.id);
    if (error) {
        showToast("Не удалилось: " + error.message, "error");
        return;
    }
    delete pendingEdits[rowKey];
    showToast("Удалено", "info");
    await loadAll();
}

function render() {
    tbody.innerHTML = "";
    const q = searchQuery;
    const filteredDrafts = draftRows;
    const filtered = allRows.filter((r) => {
        if (!q) return true;
        const ing = ingredientsById[r.ingredient_id];
        return ing && ing.name.toLowerCase().includes(q);
    });

    filteredDrafts.forEach((r) => tbody.appendChild(buildRow(r, true)));
    filtered
        .slice()
        .sort((a, b) => {
            const na = (ingredientsById[a.ingredient_id] || {}).name || "";
            const nb = (ingredientsById[b.ingredient_id] || {}).name || "";
            return na.localeCompare(nb, "ru") || a.from_unit.localeCompare(b.from_unit, "ru");
        })
        .forEach((r) => tbody.appendChild(buildRow(r, false)));

    [...tbody.querySelectorAll(".conv-row")].forEach((row) => refreshRowFormula(row.dataset.rowkey));

    emptyHint.textContent = (filteredDrafts.length === 0 && filtered.length === 0)
        ? (q ? "Ничего не найдено." : "Пока нет ни одной конвертации — добавьте первую кнопкой выше.")
        : "";
}

// ---- Раздел "Выход продукта из сырья" (Цедра/пил лимона и т.п.) ----
// Под капотом это заготовка (recipes.is_prep=true) с составом из одного сырья — та же сущность,
// что редактируется в "Рецептах", просто здесь для узкого случая "1 сырьё -> выход" даём
// компактную форму без лишних полей (описание, фото, тэги).

function yieldCellInput(value, key, rowKey, opts) {
    opts = opts || {};
    const input = document.createElement("input");
    input.type = "text";
    if (key === "rawQty" || key === "yield_qty") input.inputMode = "decimal";
    if (opts.list) input.setAttribute("list", opts.list);
    if (value !== null && value !== undefined) input.value = value;
    input.dataset.field = key;
    input.oninput = () => {
        (yieldPendingEdits[rowKey] ||= {})[key] = input.value;
        refreshYieldFormula(rowKey);
    };
    return input;
}

function currentYieldValue(record, rowKey, key) {
    const overrides = yieldPendingEdits[rowKey] || {};
    if (key in overrides) return overrides[key];
    if (key === "outputName") return record.name;
    if (key === "rawName") {
        const ing = ingredientsById[record.ingredient_id];
        return ing ? ing.name : "";
    }
    return record[key];
}

function refreshYieldFormula(rowKey) {
    const row = yieldTbody.querySelector(`[data-rowkey="${CSS.escape(rowKey)}"]`);
    if (!row) return;
    const formulaCell = row.querySelector(".cell-yield-formula");
    const overrides = yieldPendingEdits[rowKey] || {};
    const outputName = overrides.outputName !== undefined ? overrides.outputName : formulaCell.dataset.outputName;
    const rawQty = overrides.rawQty !== undefined ? overrides.rawQty : formulaCell.dataset.rawQty;
    const rawUnit = overrides.rawUnit !== undefined ? overrides.rawUnit : formulaCell.dataset.rawUnit;
    const rawName = overrides.rawName !== undefined ? overrides.rawName : formulaCell.dataset.rawName;
    const yieldQty = overrides.yield_qty !== undefined ? overrides.yield_qty : formulaCell.dataset.yieldQty;
    const yieldUnit = overrides.yield_unit !== undefined ? overrides.yield_unit : formulaCell.dataset.yieldUnit;
    if (rawQty && rawUnit && rawName && yieldQty && yieldUnit) {
        formulaCell.textContent = `${rawQty} ${rawUnit} (${rawName}) → ${yieldQty} ${yieldUnit} (${outputName || "?"})`;
    } else {
        formulaCell.textContent = "";
    }
}

function buildYieldRow(record, isDraft) {
    const rowKey = record.id || record.tempId;
    const locked = !isDraft && !yieldEditingIds.has(record.id);
    const row = document.createElement("div");
    row.className = "conv-row";
    row.dataset.rowkey = rowKey;
    const inputs = {};

    const grid = document.createElement("div");
    grid.className = "form-grid";

    const outputVal = currentYieldValue(record, rowKey, "outputName");
    inputs.outputName = yieldCellInput(outputVal, "outputName", rowKey);
    inputs.outputName.disabled = locked;
    const outputField = formField("Продукт (заготовка)", inputs.outputName);
    if (record.id) {
        const link = document.createElement("a");
        link.href = "recipes.html?open=" + encodeURIComponent(record.id);
        link.target = "_blank";
        link.className = "field-hint";
        link.style.display = "block";
        link.textContent = "открыть в Рецептах →";
        outputField.appendChild(link);
    }
    grid.appendChild(outputField);

    const rawNameVal = currentYieldValue(record, rowKey, "rawName");
    inputs.rawName = yieldCellInput(rawNameVal, "rawName", rowKey, { list: "ingredientNamesList" });
    inputs.rawName.disabled = locked;
    grid.appendChild(formField("Из чего (сырьё)", inputs.rawName));

    const rawQtyVal = currentYieldValue(record, rowKey, "rawQty");
    inputs.rawQty = yieldCellInput(rawQtyVal, "rawQty", rowKey);
    inputs.rawQty.disabled = locked;
    grid.appendChild(formField("Кол-во сырья", inputs.rawQty));

    const rawUnitVal = currentYieldValue(record, rowKey, "rawUnit");
    inputs.rawUnit = yieldCellInput(rawUnitVal, "rawUnit", rowKey, { list: "unitOptionsList" });
    inputs.rawUnit.disabled = locked;
    grid.appendChild(formField("Ед. сырья", inputs.rawUnit));

    const yieldQtyVal = currentYieldValue(record, rowKey, "yield_qty");
    inputs.yieldQty = yieldCellInput(yieldQtyVal, "yield_qty", rowKey);
    inputs.yieldQty.disabled = locked;
    grid.appendChild(formField("Выход — кол-во", inputs.yieldQty));

    const yieldUnitVal = currentYieldValue(record, rowKey, "yield_unit");
    inputs.yieldUnit = yieldCellInput(yieldUnitVal, "yield_unit", rowKey, { list: "unitOptionsList" });
    inputs.yieldUnit.disabled = locked;
    grid.appendChild(formField("Выход — ед.", inputs.yieldUnit));

    const commentVal = currentYieldValue(record, rowKey, "comment");
    inputs.comment = yieldCellInput(commentVal, "comment", rowKey);
    inputs.comment.disabled = locked;
    grid.appendChild(formField("Комментарий", inputs.comment));

    row.appendChild(grid);

    const footer = document.createElement("div");
    footer.className = "conv-row-footer";

    const formula = document.createElement("div");
    formula.className = "cell-yield-formula conv-row-formula";
    formula.dataset.outputName = outputVal || "";
    formula.dataset.rawName = rawNameVal || "";
    formula.dataset.rawQty = rawQtyVal || "";
    formula.dataset.rawUnit = rawUnitVal || "";
    formula.dataset.yieldQty = yieldQtyVal || "";
    formula.dataset.yieldUnit = yieldUnitVal || "";
    footer.appendChild(formula);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    if (locked) {
        const editBtn = document.createElement("button");
        editBtn.textContent = "Изменить";
        editBtn.onclick = () => { yieldEditingIds.add(record.id); renderYield(); };
        actions.appendChild(editBtn);
    } else {
        const saveBtn = document.createElement("button");
        saveBtn.textContent = "Сохранить";
        saveBtn.className = "primary";
        saveBtn.onclick = () => saveYieldRow(record, inputs, isDraft);
        actions.appendChild(saveBtn);

        const delBtn = document.createElement("button");
        delBtn.textContent = "Удалить";
        delBtn.className = "danger";
        delBtn.onclick = () => deleteYieldRow(record, isDraft);
        actions.appendChild(delBtn);
    }
    footer.appendChild(actions);
    row.appendChild(footer);

    return row;
}

// Ищет строки состава других рецептов, которые ссылаются на СЫРЬЁ с этим именем напрямую
// (ingredient_id), а не на заготовку — это и есть тот самый конфликт: строка была введена
// до того, как появилась одноимённая заготовка, и её нужно перепривязать на sub_recipe_id.
async function findIngredientUsages(ingredientId) {
    const { data, error } = await db
        .from("recipe_items")
        .select("id,qty,unit,recipe:recipes!recipe_id(name)")
        .eq("ingredient_id", ingredientId);
    if (error) return { error };
    return { usages: data };
}

async function saveYieldRow(record, inputs, isDraft) {
    const outputName = inputs.outputName.value.trim();
    const rawName = inputs.rawName.value.trim();
    const rawQtyRaw = inputs.rawQty.value.trim();
    const rawUnit = inputs.rawUnit.value.trim();
    const yieldQtyRaw = inputs.yieldQty.value.trim();
    const yieldUnit = inputs.yieldUnit.value.trim();
    const comment = inputs.comment.value.trim();

    if (!outputName || !rawName || !rawQtyRaw || !rawUnit || !yieldQtyRaw || !yieldUnit) {
        showToast("Заполните продукт, сырьё, количество сырья и выход целиком", "error");
        return;
    }
    if (outputName === rawName) {
        showToast("Продукт и сырьё называются одинаково — заготовка не может производиться сама из себя", "error");
        return;
    }
    const existingByName = allRecipesByName[outputName];
    if (existingByName && existingByName.id !== record.id) {
        showToast(`Название «${outputName}» уже занято в Рецептах — выберите другое`, "error");
        return;
    }
    const rawQty = Number(rawQtyRaw.replace(",", "."));
    const yieldQty = Number(yieldQtyRaw.replace(",", "."));
    if (!rawQty || rawQty <= 0 || !yieldQty || yieldQty <= 0) {
        showToast("Количество сырья и выход должны быть положительными числами", "error");
        return;
    }

    // Защита от дурака №1: сырьё называется так же, как уже существующая заготовка. Скорее всего
    // это ошибка — заготовку хотели использовать как заготовку, а не заводить одноимённое сырьё.
    if (allRecipesByName[rawName] && allRecipesByName[rawName].id !== record.id) {
        const proceed = confirm(`«${rawName}» уже существует как заготовка в Рецептах, а не как сырьё. Обычно сырьём должно быть то, что покупается напрямую. Всё равно создать сырьё с таким же именем?`);
        if (!proceed) return;
    }

    // Защита от дурака №2: в Номенклатуре уже есть СЫРЬЁ с именем будущего продукта (типичная
    // причина — строка состава была введена раньше, чем появилась эта заготовка, и указывает
    // напрямую на сырьё). Если это сырьё где-то используется — предлагаем перепривязать все такие
    // строки состава на новую заготовку, но только с явного подтверждения, а не молча.
    const collidingIngredient = ingredientsByName[outputName];
    let usagesToRelink = [];
    if (collidingIngredient) {
        const { usages, error } = await findIngredientUsages(collidingIngredient.id);
        if (error) {
            showToast("Не удалось проверить использование «" + outputName + "» как сырья: " + error.message, "error");
            return;
        }
        if (usages.length > 0) {
            const list = usages.map((u) => `«${(u.recipe && u.recipe.name) || "?"}» (${formatQtyForConfirm(u.qty, u.unit)})`).join(", ");
            const proceed = confirm(
                `В Номенклатуре уже есть сырьё «${outputName}» — оно используется как ингредиент в: ${list}. ` +
                `Похоже, это должно ссылаться на новую заготовку, а не на сырьё напрямую. Перепривязать эти строки состава на заготовку «${outputName}»?\n\n` +
                `Отмена — заготовка всё равно будет сохранена, но старые строки останутся привязаны к сырью как раньше (свяжете вручную).`
            );
            if (proceed) usagesToRelink = usages;
        } else {
            showToast(`Учтите: в Номенклатуре уже есть неиспользуемое сырьё «${outputName}» — после сохранения его стоит удалить, чтобы не путаться.`, "info");
        }
    }

    // Сырьё может быть новой позицией — создаём в Номенклатуре сразу, как это делает "Рецепты"
    // при вводе состава (см. resolveOrCreateIngredientOrPrep в recipes.js).
    let ing = ingredientsByName[rawName];
    if (!ing) {
        const { data, error } = await db.from("ingredients").insert({ name: rawName, base_unit: rawUnit }).select("id,name,base_unit").single();
        if (error) {
            showToast("Не получилось создать сырьё в Номенклатуре: " + error.message, "error");
            return;
        }
        ing = data;
        ingredientsByName[ing.name] = ing;
        ingredientsById[ing.id] = ing;
        refreshIngredientDatalist();
    }

    const rowKey = record.id || record.tempId;
    let recipeId = record.id;
    // is_yield_helper: true — эта заготовка создана здесь, в Конвертере, а не в "Рецептах",
    // поэтому не должна засорять общий список рецептов (см. фильтр в recipes.js).
    if (recipeId) {
        const { error } = await db.from("recipes").update({ name: outputName, yield_qty: yieldQty, yield_unit: yieldUnit, is_yield_helper: true }).eq("id", recipeId);
        if (error) { showToast("Не сохранилось: " + error.message, "error"); return; }
    } else {
        const { data, error } = await db.from("recipes").insert({ name: outputName, type: "Заготовка", is_prep: true, yield_qty: yieldQty, yield_unit: yieldUnit, is_yield_helper: true }).select("id").single();
        if (error) { showToast("Не сохранилось: " + error.message, "error"); return; }
        recipeId = data.id;
    }

    const itemValues = { ingredient_id: ing.id, sub_recipe_id: null, qty: rawQty, unit: rawUnit, is_topup: false, comment: comment || null };
    let itemError;
    if (record.itemId) {
        ({ error: itemError } = await db.from("recipe_items").update(itemValues).eq("id", record.itemId));
    } else {
        ({ error: itemError } = await db.from("recipe_items").insert({ ...itemValues, recipe_id: recipeId }));
    }
    if (itemError) {
        showToast("Заготовка сохранена, но состав не сохранился: " + itemError.message, "error");
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

    if (isDraft) yieldDraftRows = yieldDraftRows.filter((r) => r.tempId !== record.tempId);
    yieldEditingIds.delete(record.id);
    delete yieldPendingEdits[rowKey];
    await loadAll();
}

function formatQtyForConfirm(qty, unit) {
    if (qty === null || qty === undefined) return unit || "";
    return unit ? `${qty} ${unit}` : String(qty);
}

async function deleteYieldRow(record, isDraft) {
    const rowKey = record.id || record.tempId;
    if (isDraft) {
        yieldDraftRows = yieldDraftRows.filter((r) => r.tempId !== record.tempId);
        delete yieldPendingEdits[rowKey];
        renderYield();
        return;
    }
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
    delete yieldPendingEdits[rowKey];
    showToast("Удалено", "info");
    await loadAll();
}

function renderYield() {
    yieldTbody.innerHTML = "";
    yieldDraftRows.forEach((r) => yieldTbody.appendChild(buildYieldRow(r, true)));
    yieldRows
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "ru"))
        .forEach((r) => yieldTbody.appendChild(buildYieldRow(r, false)));

    [...yieldTbody.querySelectorAll(".conv-row")].forEach((row) => refreshYieldFormula(row.dataset.rowkey));

    const hints = [];
    if (yieldDraftRows.length === 0 && yieldRows.length === 0) {
        hints.push("Пока нет ни одного выхода из сырья — добавьте первый кнопкой выше.");
    }
    if (complexPrepCount > 0) {
        hints.push(`Ещё ${complexPrepCount} заготовок(-и) со сложным составом (несколько ингредиентов) — редактируются в «Рецептах».`);
    }
    yieldEmptyHint.textContent = hints.join(" ");
}

document.getElementById("addYieldRowBtn").onclick = () => {
    yieldDraftCounter += 1;
    yieldDraftRows.unshift({ tempId: "yielddraft" + yieldDraftCounter });
    renderYield();
};

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
    if (ingRes.error) {
        showStatus(statusEl, "Ошибка загрузки: " + ingRes.error.message, "error");
        return;
    }
    if (convRes.error) {
        showStatus(statusEl, "Ошибка загрузки конвертаций: " + convRes.error.message, "error");
        return;
    }
    if (recRes.error || itemsRes.error) {
        showStatus(statusEl, "Ошибка загрузки рецептов: " + (recRes.error || itemsRes.error).message, "error");
        return;
    }
    ingredientsByName = {};
    ingredientsById = {};
    ingRes.data.forEach((i) => { ingredientsByName[i.name] = i; ingredientsById[i.id] = i; });
    allRows = convRes.data;

    allRecipesByName = {};
    recRes.data.forEach((r) => { allRecipesByName[r.name] = r; });
    itemsByRecipeId = {};
    itemsRes.data.forEach((it) => { (itemsByRecipeId[it.recipe_id] ||= []).push(it); });

    // "Простая" заготовка для этого раздела — заготовка с составом ровно из одного сырья
    // (не долив, не вложенная заготовка). Более сложный состав редактируется в "Рецептах" —
    // здесь его трогать не даём, чтобы случайно не затереть остальные ингредиенты.
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
    renderYield();
}

document.getElementById("addRowBtn").onclick = () => {
    draftCounter += 1;
    draftRows.unshift({ tempId: "draft" + draftCounter });
    render();
};

document.getElementById("searchInput").oninput = (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    render();
};

document.getElementById("bulkImportBtn").onclick = async () => {
    const text = document.getElementById("bulkInput").value.trim();
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
        if (!ing) { errors.push(`Строка ${idx + 1}: ингредиент «${name}» не найден в Номенклатуре`); return; }
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
    if (error) {
        showToast("Ошибка импорта: " + error.message, "error");
        return;
    }

    document.getElementById("bulkInput").value = "";
    showToast(`Импортировано: ${toInsert.length}` + (errors.length ? `, ошибок: ${errors.length}` : ""), errors.length ? "error" : "info");
    if (errors.length) alert("Не всё получилось:\n\n" + errors.join("\n"));
    await loadAll();
};

// Переход по ссылке из "Мероприятия" или "Номенклатуры" с уже известным ингредиентом/единицей —
// сразу открываем черновик новой строки с подставленными значениями.
function applyQueryPrefill() {
    const params = new URLSearchParams(window.location.search);
    const ingredient = params.get("ingredient");
    const unit = params.get("unit");
    if (!ingredient) return;
    draftCounter += 1;
    const tempId = "draft" + draftCounter;
    draftRows.unshift({ tempId });
    pendingEdits[tempId] = { ingredientName: ingredient, from_unit: unit || "" };
    searchQuery = "";
    document.getElementById("searchInput").value = "";
}

if (!isDbConfigured()) {
    showStatus(statusEl, "База данных ещё не подключена — впишите SUPABASE_URL и SUPABASE_ANON_KEY в js/supabase-client.js", "error");
} else {
    populateUnitDatalist();
    loadAll().then(() => {
        applyQueryPrefill();
        render();
    });
}

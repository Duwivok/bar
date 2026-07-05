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
    const row = tbody.querySelector(`tr[data-rowkey="${CSS.escape(rowKey)}"]`);
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

function buildRow(record, isDraft) {
    const rowKey = record.id || record.tempId;
    const locked = !isDraft && !editingIds.has(record.id);
    const tr = document.createElement("tr");
    tr.dataset.rowkey = rowKey;
    const inputs = {};

    const tdName = document.createElement("td");
    const nameVal = currentValue(record, rowKey, "ingredientName");
    inputs.ingredientName = cellInput(nameVal, "ingredientName", rowKey, { list: "ingredientNamesList" });
    inputs.ingredientName.disabled = locked;
    tdName.appendChild(inputs.ingredientName);
    tr.appendChild(tdName);

    const tdBase = document.createElement("td");
    tdBase.className = "cell-base-unit field-hint";
    tdBase.dataset.name = nameVal || "";
    tr.appendChild(tdBase);

    const tdFromUnit = document.createElement("td");
    const fromUnitVal = currentValue(record, rowKey, "from_unit");
    inputs.from_unit = cellInput(fromUnitVal, "from_unit", rowKey, { list: "unitOptionsList" });
    inputs.from_unit.disabled = locked;
    tdFromUnit.appendChild(inputs.from_unit);
    tr.appendChild(tdFromUnit);

    const tdCoeff = document.createElement("td");
    const coeffVal = currentValue(record, rowKey, "coefficient");
    inputs.coefficient = cellInput(coeffVal, "coefficient", rowKey);
    inputs.coefficient.disabled = locked;
    tdCoeff.appendChild(inputs.coefficient);
    tr.appendChild(tdCoeff);

    const tdFormula = document.createElement("td");
    tdFormula.className = "cell-formula field-hint";
    tdFormula.dataset.fromUnit = fromUnitVal || "";
    tdFormula.dataset.coeff = coeffVal || "";
    tr.appendChild(tdFormula);

    const tdComment = document.createElement("td");
    const commentVal = currentValue(record, rowKey, "comment");
    inputs.comment = cellInput(commentVal, "comment", rowKey);
    inputs.comment.disabled = locked;
    tdComment.appendChild(inputs.comment);
    tr.appendChild(tdComment);

    const tdActions = document.createElement("td");
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
    tdActions.appendChild(actions);
    tr.appendChild(tdActions);

    return tr;
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

    [...tbody.querySelectorAll("tr")].forEach((tr) => refreshRowFormula(tr.dataset.rowkey));

    emptyHint.textContent = (filteredDrafts.length === 0 && filtered.length === 0)
        ? (q ? "Ничего не найдено." : "Пока нет ни одной конвертации — добавьте первую кнопкой выше.")
        : "";
}

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
    const [ingRes, convRes] = await Promise.all([
        db.from("ingredients").select("id,name,base_unit").order("name"),
        db.from("unit_conversions").select("*"),
    ]);
    if (ingRes.error) {
        showStatus(statusEl, "Ошибка загрузки: " + ingRes.error.message, "error");
        return;
    }
    if (convRes.error) {
        showStatus(statusEl, "Ошибка загрузки конвертаций: " + convRes.error.message, "error");
        return;
    }
    ingredientsByName = {};
    ingredientsById = {};
    ingRes.data.forEach((i) => { ingredientsByName[i.name] = i; ingredientsById[i.id] = i; });
    allRows = convRes.data;
    refreshIngredientDatalist();
    render();
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

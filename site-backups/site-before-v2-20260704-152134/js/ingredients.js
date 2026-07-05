// FIELDS — полный набор колонок ингредиента для разбора вставки пачкой / Excel (историч. плоский формат).
const FIELDS = [
    { key: "name", type: "text" },
    { key: "category", type: "combo", list: "categoryOptionsList" },
    { key: "base_unit", type: "combo", list: "baseUnitOptionsList" },
    { key: "purchase_unit", type: "text" },
    { key: "package_size", type: "number" },
    { key: "package_price", type: "number" },
    { key: "purchase_link", type: "text" },
    { key: "comment", type: "text" },
];

// Поля, которые реально хранятся на самом ингредиенте (остальное — в вариантах упаковки).
const INGREDIENT_FIELDS = FIELDS.filter((f) => ["name", "category", "base_unit", "comment"].includes(f.key));

// Поля одного варианта упаковки (ingredient_packages).
const PACKAGE_FIELDS = [
    { key: "package_size", type: "number" },
    { key: "package_price", type: "number" },
    { key: "purchase_unit", type: "text" },
    { key: "purchase_source", type: "select", options: PURCHASE_SOURCE_OPTIONS },
    { key: "purchase_link", type: "text" },
    { key: "price_source_type", type: "select", options: PRICE_SOURCE_TYPE_OPTIONS },
    { key: "price_source_query", type: "text" },
    { key: "price_source_enabled", type: "checkbox" },
];

const statusEl = document.getElementById("status");
const priceCheckPanel = document.getElementById("priceCheckPanel");

let allRows = [];       // из базы
let draftRows = [];     // новые, ещё не сохранённые строки
let editingIds = new Set(); // id "корректных" строк, временно разблокированных кнопкой "Изменить"
let expandedIds = new Set(); // rowKey строк с развёрнутыми доп. полями
let draftCounter = 0;

let packagesByIngredient = {}; // ingredientId -> [{id, package_size, package_price, purchase_unit, purchase_link}]
let packageDrafts = {};        // ingredientId -> [ещё не сохранённые варианты упаковки]
let packageDraftCounter = 0;

let conversionsByIngredient = {}; // ingredientId -> [{id, from_unit, coefficient, comment}]

const MAIN_FIELD_KEYS = ["name", "category", "base_unit"];
const DETAIL_FIELDS = [
    { key: "comment", label: "Комментарий" },
];
let pendingEdits = {};  // rowKey -> { field: непечатанное-но-ещё-не-сохранённое значение } — переживает перерисовку списка

let searchQuery = "";
let sortMode = "name";
let categoryFilter;
let priceCheckResults = [];
let priceCheckState = "idle";

function cheapestPackage(ingredientId) {
    const pkgs = (packagesByIngredient[ingredientId] || []).filter((p) => p.package_price != null);
    if (pkgs.length === 0) return null;
    return pkgs.reduce((a, b) => (b.package_price < a.package_price ? b : a));
}

function packageSummary(ingredientId) {
    const pkgs = packagesByIngredient[ingredientId] || [];
    if (pkgs.length === 0) return "—";
    const cheapest = cheapestPackage(ingredientId);
    if (!cheapest) return `${pkgs.length} вар. без цены`;
    const sizeLabel = cheapest.package_size != null ? ` / ${cheapest.package_size}` : "";
    const sourceLabel = cheapest.purchase_source ? ` · ${cheapest.purchase_source}` : "";
    return (pkgs.length > 1 ? `от ${cheapest.package_price} ₽${sizeLabel} · ${pkgs.length} вар.` : `${cheapest.package_price} ₽${sizeLabel}`) + sourceLabel;
}

function conversionSummary(ingredientId) {
    const n = (conversionsByIngredient[ingredientId] || []).length;
    return n > 0 ? `${n} ед.` : "—";
}

function packageAlreadyExists(ingredientId, size, price) {
    return (packagesByIngredient[ingredientId] || []).some((p) => p.package_size === size && p.package_price === price);
}

function classify(record) {
    if (!record.id) return "new";
    const hasPackage = (packagesByIngredient[record.id] || []).some((p) => p.package_size != null && p.package_price != null);
    const complete = !!(record.category && record.base_unit && hasPackage);
    return complete ? "ok" : "incomplete";
}

// Как classify(), но пока у позиции остаются несохранённые черновики вариантов упаковки —
// принудительно "incomplete", чтобы позиция не уезжала в «Корректные» (и не блокировалась)
// сразу после сохранения первого варианта, пока пользователь ещё заполняет остальные.
// Финализирует секцию только явное «Сохранить всё» (saveAllForRow), которое очищает черновики.
function effectiveKind(record) {
    if ((packageDrafts[record.id] || []).length > 0) return "incomplete";
    return classify(record);
}

function cellInput(value, field, rowKey) {
    if (field.type === "checkbox") {
        const label = document.createElement("label");
        label.className = "checkbox-cell";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = value !== false;
        input.dataset.field = field.key;
        input.onchange = () => {
            (pendingEdits[rowKey] ||= {})[field.key] = input.checked;
        };
        label.appendChild(input);
        label.appendChild(document.createTextNode("вкл"));
        return label;
    }

    if (field.type === "select") {
        const select = document.createElement("select");
        const emptyOpt = document.createElement("option");
        emptyOpt.value = "";
        emptyOpt.textContent = "—";
        select.appendChild(emptyOpt);
        field.options.forEach((opt) => {
            const o = document.createElement("option");
            o.value = opt;
            o.textContent = opt;
            select.appendChild(o);
        });
        if (value !== null && value !== undefined) select.value = value;
        select.dataset.field = field.key;
        select.onchange = () => {
            (pendingEdits[rowKey] ||= {})[field.key] = select.value;
        };
        return select;
    }

    const input = document.createElement("input");
    input.type = "text";
    if (field.type === "number") input.inputMode = "decimal";
    if (field.type === "combo") input.setAttribute("list", field.list);
    if (value !== null && value !== undefined) input.value = value;
    input.dataset.field = field.key;
    input.oninput = () => {
        (pendingEdits[rowKey] ||= {})[field.key] = input.value;
    };
    return input;
}

function readValues(inputs, fields) {
    const values = {};
    fields.forEach((field) => {
        if (field.type === "checkbox") {
            values[field.key] = inputs[field.key].querySelector("input").checked;
            return;
        }

        const raw = inputs[field.key].value.trim();
        if (raw === "") values[field.key] = null;
        else if (field.type === "number") values[field.key] = Number(raw.replace(",", "."));
        else values[field.key] = raw;
    });
    return values;
}

function flashInputs(inputs) {
    Object.values(inputs).forEach((input) => {
        if (!("value" in input)) return;
        const cls = input.value.trim() ? "flash-ok" : "flash-empty";
        input.classList.remove("flash-ok", "flash-empty");
        void input.offsetWidth; // форсируем перерисовку, чтобы анимация проигрывалась заново при повторном сохранении
        input.classList.add(cls);
    });
}

// ---- Варианты упаковки ----

// Единицы, в которых упаковка почти всегда исчисляется большими числами (мл, г) — если размер
// подозрительно маленький (похоже на литры/кг вместо мл/г), подсвечиваем предупреждением.
const SUSPICIOUS_SMALL_SIZE_UNITS = ["мл", "г"];
const SUSPICIOUS_SMALL_SIZE_THRESHOLD = 20;

function buildPackageRow(ingredientId, pkg, locked, baseUnit) {
    const rowKey = "pkg:" + (pkg.id || pkg.tempId);
    const overrides = pendingEdits[rowKey] || {};
    const inputs = {};
    const tr = document.createElement("tr");

    PACKAGE_FIELDS.forEach((field) => {
        const td = document.createElement("td");
        let value = field.key in overrides ? overrides[field.key] : pkg[field.key];
        if (value === undefined && field.key === "price_source_type") value = "manual";
        if (value === undefined && field.key === "price_source_enabled") value = true;
        const input = cellInput(value, field, rowKey);
        if (field.type === "checkbox") input.querySelector("input").disabled = locked;
        else input.disabled = locked;
        inputs[field.key] = input;
        td.appendChild(input);
        tr.appendChild(td);

        if (field.key === "package_size") {
            const checkSuspicious = () => {
                const n = Number(String(input.value).replace(",", "."));
                const suspicious = SUSPICIOUS_SMALL_SIZE_UNITS.includes(baseUnit) && n > 0 && n < SUSPICIOUS_SMALL_SIZE_THRESHOLD;
                input.classList.toggle("suspicious-value", suspicious);
                input.title = suspicious ? `Похоже на литры/кг вместо ${baseUnit} — например, бутылка 0.5 л при базовой единице «${baseUnit}» это 500, а не 0.5` : "";
            };
            checkSuspicious();
            input.addEventListener("input", checkSuspicious);
        }
    });

    const actionsTd = document.createElement("td");
    if (pkg.id) {
        const checkBtn = document.createElement("button");
        checkBtn.type = "button";
        checkBtn.textContent = "Проверить";
        checkBtn.onclick = () => checkPackagePrice(ingredientId, pkg);
        actionsTd.appendChild(checkBtn);
    }

    if (!locked) {
        const actions = document.createElement("div");
        actions.className = "row-actions";

        const saveBtn = document.createElement("button");
        saveBtn.textContent = "Сохранить";
        saveBtn.className = "primary";
        saveBtn.onclick = () => savePackageRow(ingredientId, pkg, inputs);
        actions.appendChild(saveBtn);

        const delBtn = document.createElement("button");
        delBtn.textContent = "Удалить";
        delBtn.className = "danger";
        delBtn.onclick = () => deletePackageRow(ingredientId, pkg);
        actions.appendChild(delBtn);

        actionsTd.appendChild(actions);
    }
    tr.appendChild(actionsTd);
    return tr;
}

function buildPackagesBlock(record, locked) {
    const wrap = document.createElement("div");
    wrap.className = "packages-block";

    const heading = document.createElement("h4");
    heading.textContent = "Варианты упаковки";
    wrap.appendChild(heading);

    const unitHint = document.createElement("div");
    unitHint.className = "field-hint";
    unitHint.textContent = `Размер упаковки указывайте в базовой единице этой позиции (${record.base_unit || "укажите базовую ед. выше"}) — напр. бутылка 0.5 л при базовой единице «мл» это 500, а не 0.5.`;
    wrap.appendChild(unitHint);

    if (!record.id) {
        const hint = document.createElement("div");
        hint.className = "field-hint";
        hint.textContent = "Сначала сохраните позицию — тогда можно будет добавить варианты упаковки.";
        wrap.appendChild(hint);
        return wrap;
    }

    const table = document.createElement("table");
    table.className = "packages-table";
    const thead = document.createElement("thead");
    const sizeLabel = record.base_unit ? `Размер (в ${record.base_unit})` : "Размер";
    thead.innerHTML = `<tr><th>${sizeLabel}</th><th>Цена</th><th>Закупочная ед.</th><th>Источник</th><th>Ссылка</th><th>Парсер</th><th>Запрос</th><th>Автоцена</th><th></th></tr>`;
    table.appendChild(thead);
    const tbody = document.createElement("tbody");

    const pkgs = [...(packagesByIngredient[record.id] || []), ...(packageDrafts[record.id] || [])];
    if (pkgs.length === 0) {
        const emptyTr = document.createElement("tr");
        const emptyTd = document.createElement("td");
        emptyTd.colSpan = 9;
        emptyTd.className = "field-hint";
        emptyTd.textContent = "Пока ни одного варианта — добавьте хотя бы один, чтобы позиция считалась заполненной.";
        emptyTr.appendChild(emptyTd);
        tbody.appendChild(emptyTr);
    } else {
        pkgs.forEach((pkg) => tbody.appendChild(buildPackageRow(record.id, pkg, locked, record.base_unit)));
    }
    table.appendChild(tbody);
    wrap.appendChild(table);

    if (!locked) {
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.textContent = "+ Добавить вариант";
        addBtn.style.marginTop = "8px";
        addBtn.onclick = () => {
            packageDraftCounter += 1;
            (packageDrafts[record.id] ||= []).push({
                tempId: "pkgdraft" + packageDraftCounter,
                package_size: null, package_price: null, purchase_unit: null, purchase_link: null,
                price_source_type: "manual", price_source_query: null, price_source_enabled: true,
            });
            expandedIds.add(record.id);
            render();
        };
        wrap.appendChild(addBtn);
    }

    return wrap;
}

// opts.reload/opts.flash — false когда вызывается из saveAllForRow(): там нужно сохранить
// несколько вариантов подряд и обновить экран/тост один раз в конце, а не после каждого.
async function savePackageRow(ingredientId, pkg, inputs, opts = {}) {
    const { reload = true, flash = true } = opts;
    const values = readValues(inputs, PACKAGE_FIELDS);
    if (flash) flashInputs(inputs);
    const rowKey = "pkg:" + (pkg.id || pkg.tempId);
    let error;
    if (pkg.id) {
        ({ error } = await db.from("ingredient_packages").update(values).eq("id", pkg.id));
    } else {
        ({ error } = await db.from("ingredient_packages").insert({ ...values, ingredient_id: ingredientId }));
        if (!error) packageDrafts[ingredientId] = (packageDrafts[ingredientId] || []).filter((p) => p.tempId !== pkg.tempId);
    }
    if (error) {
        showToast("Не сохранилось: " + error.message, "error");
        return false;
    }
    delete pendingEdits[rowKey];
    expandedIds.add(ingredientId);
    if (reload) {
        showToast("Сохранено", "info");
        await loadIngredients();
    }
    return true;
}

// Значения полей черновика варианта упаковки без ссылки на реальные DOM-инпуты (они живут
// в отдельно построенной строке таблицы упаковок) — берём из pendingEdits, куда их пишет
// cellInput() при каждом вводе, и оборачиваем в {value} — этого достаточно для readValues().
function pseudoInputsForPackageDraft(pkg) {
    const rowKey = "pkg:" + (pkg.id || pkg.tempId);
    const overrides = pendingEdits[rowKey] || {};
    const inputs = {};
    PACKAGE_FIELDS.forEach((field) => {
        const v = field.key in overrides ? overrides[field.key] : pkg[field.key];
        if (field.type === "checkbox") {
            const checkbox = { checked: v !== false };
            inputs[field.key] = { querySelector: () => checkbox };
        } else {
            inputs[field.key] = { value: v === null || v === undefined ? "" : String(v) };
        }
    });
    return inputs;
}

async function deletePackageRow(ingredientId, pkg) {
    const rowKey = "pkg:" + (pkg.id || pkg.tempId);
    if (!pkg.id) {
        packageDrafts[ingredientId] = (packageDrafts[ingredientId] || []).filter((p) => p.tempId !== pkg.tempId);
        delete pendingEdits[rowKey];
        render();
        return;
    }
    if (!confirm("Удалить этот вариант упаковки?")) return;
    const { error } = await db.from("ingredient_packages").delete().eq("id", pkg.id);
    if (error) {
        showToast("Не удалилось: " + error.message, "error");
        return;
    }
    delete pendingEdits[rowKey];
    expandedIds.add(ingredientId);
    showToast("Удалено", "info");
    await loadIngredients();
}

// ---- Строки номенклатуры ----

function buildRow(record, kind) {
    const rowKey = record.id || record.tempId;
    const overrides = pendingEdits[rowKey] || {};
    const locked = kind === "ok" && !editingIds.has(record.id);
    const expanded = expandedIds.has(rowKey);
    const inputs = {};

    function makeInput(fieldKey) {
        const field = FIELDS.find((f) => f.key === fieldKey);
        const value = fieldKey in overrides ? overrides[fieldKey] : record[fieldKey];
        const input = cellInput(value, field, rowKey);
        input.disabled = locked;
        inputs[fieldKey] = input;
        return input;
    }

    const tr = document.createElement("tr");
    tr.dataset.id = record.id || "";

    const toggleTd = document.createElement("td");
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "row-expand-toggle";
    toggleBtn.textContent = expanded ? "▾" : "▸";
    toggleBtn.title = "Показать остальные поля и упаковки";
    toggleBtn.onclick = () => {
        if (expanded) expandedIds.delete(rowKey); else expandedIds.add(rowKey);
        render();
    };
    toggleTd.appendChild(toggleBtn);
    tr.appendChild(toggleTd);

    MAIN_FIELD_KEYS.forEach((key) => {
        const td = document.createElement("td");
        td.appendChild(makeInput(key));
        tr.appendChild(td);
    });

    const pkgTd = document.createElement("td");
    const pkgSpan = document.createElement("span");
    pkgSpan.className = "package-summary";
    pkgSpan.textContent = record.id ? packageSummary(record.id) : "—";
    pkgTd.appendChild(pkgSpan);
    tr.appendChild(pkgTd);

    const convTd = document.createElement("td");
    if (record.id) {
        const convLink = document.createElement("a");
        convLink.href = "converter.html?ingredient=" + encodeURIComponent(record.name || "");
        convLink.target = "_blank";
        convLink.title = "Единицы рецепта (веточка, лист, шт...) → базовая единица — управляется на вкладке «Конвертер»";
        convLink.textContent = conversionSummary(record.id);
        convTd.appendChild(convLink);
    } else {
        convTd.textContent = "—";
    }
    tr.appendChild(convTd);

    const actionsTd = document.createElement("td");
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
        saveBtn.title = "Сохранить только основные поля позиции — варианты упаковки сохраняются отдельно, своими кнопками";
        saveBtn.onclick = () => saveRow(record, inputs);
        actions.appendChild(saveBtn);

        if (record.id) {
            const saveAllBtn = document.createElement("button");
            saveAllBtn.textContent = "Сохранить всё";
            saveAllBtn.className = "primary";
            saveAllBtn.title = "Сохранить позицию и все ещё не сохранённые варианты упаковки, закончить редактирование";
            saveAllBtn.onclick = () => saveAllForRow(record, inputs);
            actions.appendChild(saveAllBtn);
        }

        const delBtn = document.createElement("button");
        delBtn.textContent = "Удалить";
        delBtn.className = "danger";
        delBtn.onclick = () => deleteRow(record, kind);
        actions.appendChild(delBtn);
    }

    actionsTd.appendChild(actions);
    tr.appendChild(actionsTd);

    const detailTr = document.createElement("tr");
    detailTr.className = "row-detail" + (expanded ? "" : " collapsed");
    const detailTd = document.createElement("td");
    detailTd.colSpan = 7;
    const grid = document.createElement("div");
    grid.className = "row-detail-grid";
    DETAIL_FIELDS.forEach(({ key, label }) => {
        const field = document.createElement("div");
        field.className = "row-detail-field";
        const lbl = document.createElement("label");
        lbl.textContent = label;
        field.appendChild(lbl);
        field.appendChild(makeInput(key));
        grid.appendChild(field);
    });
    detailTd.appendChild(grid);
    detailTd.appendChild(buildPackagesBlock(record, locked));
    detailTr.appendChild(detailTd);

    return [tr, detailTr];
}

async function saveRow(record, inputs) {
    const values = readValues(inputs, INGREDIENT_FIELDS);
    if (!values.name) {
        showToast("Заполните название", "error");
        return;
    }
    flashInputs(inputs);
    const rowKey = record.id || record.tempId;
    let error;
    if (record.id) {
        ({ error } = await db.from("ingredients").update(values).eq("id", record.id));
        editingIds.delete(record.id);
    } else {
        ({ error } = await db.from("ingredients").insert(values));
        if (!error) draftRows = draftRows.filter((r) => r.tempId !== record.tempId);
    }
    if (error) {
        showToast("Не сохранилось: " + error.message, "error");
        return;
    }
    delete pendingEdits[rowKey];
    showToast("Сохранено", "info");
    await loadIngredients();
}

// Финализирует позицию за один клик: сохраняет основные поля и по очереди все ещё не
// сохранённые варианты упаковки, затем позиция обычным образом переклассифицируется
// и уезжает в «Корректные» — в отличие от отдельных кнопок «Сохранить» у полей/вариантов,
// которые не двигают и не блокируют позицию, пока в ней остаются несохранённые черновики.
async function saveAllForRow(record, inputs) {
    const values = readValues(inputs, INGREDIENT_FIELDS);
    if (!values.name) {
        showToast("Заполните название", "error");
        return;
    }
    flashInputs(inputs);
    const rowKey = record.id || record.tempId;
    let error;
    if (record.id) {
        ({ error } = await db.from("ingredients").update(values).eq("id", record.id));
        editingIds.delete(record.id);
    } else {
        ({ error } = await db.from("ingredients").insert(values));
        if (!error) draftRows = draftRows.filter((r) => r.tempId !== record.tempId);
    }
    if (error) {
        showToast("Не сохранилось: " + error.message, "error");
        return;
    }
    delete pendingEdits[rowKey];

    const ingredientId = record.id;
    if (ingredientId) {
        const drafts = [...(packageDrafts[ingredientId] || [])];
        for (const pkg of drafts) {
            await savePackageRow(ingredientId, pkg, pseudoInputsForPackageDraft(pkg), { reload: false, flash: false });
        }
    }

    showToast("Позиция и все варианты упаковки сохранены", "info");
    await loadIngredients();
}

async function deleteRow(record, kind) {
    const rowKey = record.id || record.tempId;
    if (kind === "new") {
        draftRows = draftRows.filter((r) => r.tempId !== record.tempId);
        delete pendingEdits[rowKey];
        render();
        return;
    }
    const { data: usages, error: usageError } = await db
        .from("recipe_items")
        .select("recipe:recipes!recipe_id(name)")
        .eq("ingredient_id", record.id);
    if (usageError) {
        showToast("Не удалось проверить использование: " + usageError.message, "error");
        return;
    }
    if (usages.length > 0) {
        const recipeNames = [...new Set(usages.map((u) => u.recipe?.name).filter(Boolean))];
        alert(`Нельзя удалить «${record.name}» — она используется в составе рецептов:\n\n${recipeNames.join("\n")}\n\nСначала уберите её оттуда (или замените на другой ингредиент), потом удаляйте.`);
        return;
    }

    if (!confirm("Удалить эту позицию из номенклатуры?")) return;
    const { error } = await db.from("ingredients").delete().eq("id", record.id);
    if (error) {
        showToast("Не удалилось: " + error.message, "error");
        return;
    }
    delete pendingEdits[rowKey];
    showToast("Удалено", "info");
    await loadIngredients();
}

// ---- Проверка цен ----

function moneyLabel(value) {
    if (value === null || value === undefined || isNaN(value)) return "—";
    return Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " ₽";
}

function findIngredientById(ingredientId) {
    return allRows.find((row) => row.id === ingredientId) || null;
}

function buildPriceItem(ingredientId, pkg) {
    const ingredient = findIngredientById(ingredientId);
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
            id: pkg.id,
            type: sourceType,
            title: pkg.purchase_source || sourceType,
            url: pkg.purchase_link || undefined,
            query: pkg.price_source_query || ingredient.name,
            externalId: pkg.price_source_external_id || undefined,
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
    try {
        payload = await response.json();
    } catch {
        payload = {};
    }
    if (!response.ok) throw new Error(payload.error || "Сервис цен недоступен");
    return payload.results || [];
}

async function checkPackagePrice(ingredientId, pkg) {
    const item = buildPriceItem(ingredientId, pkg);
    if (!item) return;
    priceCheckState = "loading";
    priceCheckResults = [];
    renderPriceCheckPanel();
    try {
        priceCheckResults = await requestPriceCheck([item]);
        priceCheckState = "results";
    } catch (error) {
        priceCheckState = "error";
        priceCheckResults = [{ message: error.message || "Не удалось проверить цену", status: "error" }];
    }
    renderPriceCheckPanel();
}

async function checkAllPrices() {
    const items = collectPriceItems();
    if (items.length === 0) {
        showToast("Нет сохранённых включённых источников цен", "error");
        return;
    }
    priceCheckState = "loading";
    priceCheckResults = [];
    renderPriceCheckPanel();
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
    if (!result.packageId || result.newPrice === null || result.newPrice === undefined) return;

    const values = {
        package_price: result.newPrice,
        price_last_checked_at: result.fetchedAt || new Date().toISOString(),
        price_last_status: result.status,
        price_last_error: result.status === "changed" || result.status === "unchanged" ? null : (result.message || null),
    };
    const { error } = await db.from("ingredient_packages").update(values).eq("id", result.packageId);
    if (error) {
        showToast("Не удалось принять цену: " + error.message, "error");
        return;
    }

    priceCheckResults = priceCheckResults.map((r) => (
        r.packageId === result.packageId ? { ...r, applied: true, oldPrice: result.newPrice } : r
    ));
    showToast("Цена принята", "info");
    await loadIngredients();
    renderPriceCheckPanel();
}

function dismissPriceResult(result) {
    priceCheckResults = priceCheckResults.filter((r) => r !== result);
    if (priceCheckResults.length === 0) priceCheckState = "idle";
    renderPriceCheckPanel();
}

function renderPriceCheckPanel() {
    if (!priceCheckPanel) return;
    priceCheckPanel.innerHTML = "";
    priceCheckPanel.classList.toggle("hidden", priceCheckState === "idle");

    if (priceCheckState === "loading") {
        priceCheckPanel.textContent = "Проверяю цены...";
        return;
    }

    const header = document.createElement("div");
    header.className = "price-check-header";
    const title = document.createElement("strong");
    title.textContent = priceCheckState === "error" ? "Проверка не удалась" : "Найденные изменения";
    header.appendChild(title);
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "Закрыть";
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

    priceCheckResults.forEach((result) => {
        const card = document.createElement("div");
        card.className = "price-result-card";
        if (result.warning) card.classList.add("warning");

        const name = document.createElement("div");
        name.className = "price-result-title";
        name.textContent = result.title || result.itemName || result.itemId || "Позиция";
        card.appendChild(name);

        const meta = document.createElement("div");
        meta.className = "price-result-meta";
        meta.textContent = [
            `Было: ${moneyLabel(result.oldPrice)}`,
            `Стало: ${result.newPrice === null || result.newPrice === undefined ? "ошибка" : moneyLabel(result.newPrice)}`,
            `Статус: ${result.status}`,
            result.sourceType ? `Источник: ${result.sourceType}` : "",
        ].filter(Boolean).join(" · ");
        card.appendChild(meta);

        if (result.message || result.warning) {
            const msg = document.createElement("div");
            msg.className = "field-hint";
            msg.textContent = result.warning ? `Проверьте руками: изменение ${result.diffPercent}%` : result.message;
            card.appendChild(msg);
        }

        const actions = document.createElement("div");
        actions.className = "row-actions";
        if (result.url) {
            const link = document.createElement("a");
            link.href = result.url;
            link.target = "_blank";
            link.textContent = "Открыть источник";
            actions.appendChild(link);
        }
        if (result.status === "changed" && !result.applied) {
            const acceptBtn = document.createElement("button");
            acceptBtn.type = "button";
            acceptBtn.className = "primary";
            acceptBtn.textContent = "Принять";
            acceptBtn.onclick = () => applyPriceResult(result);
            actions.appendChild(acceptBtn);
        }
        const keepBtn = document.createElement("button");
        keepBtn.type = "button";
        keepBtn.textContent = result.applied ? "Готово" : "Оставить старую";
        keepBtn.onclick = () => dismissPriceResult(result);
        actions.appendChild(keepBtn);
        card.appendChild(actions);
        priceCheckPanel.appendChild(card);
    });
}

function renderSection(bodyId, countId, rows, kind) {
    const body = document.getElementById(bodyId);
    body.innerHTML = "";
    document.getElementById(countId).textContent = rows.length;
    rows.forEach((r) => {
        const [mainTr, detailTr] = buildRow(r, kind);
        body.appendChild(mainTr);
        body.appendChild(detailTr);
    });
}

function render() {
    const q = searchQuery;
    const catSel = categoryFilter.getSelected();

    const filtered = allRows.filter((r) => {
        if (q && !r.name.toLowerCase().includes(q)) return false;
        if (catSel.length > 0 && !catSel.includes(r.category || "")) return false;
        return true;
    });

    const incomplete = [];
    const ok = [];
    filtered.forEach((r) => (effectiveKind(r) === "ok" ? ok : incomplete).push(r));

    const sortFns = {
        name: (a, b) => a.name.localeCompare(b.name, "ru"),
        category: (a, b) => (a.category || "").localeCompare(b.category || "", "ru") || a.name.localeCompare(b.name, "ru"),
        price: (a, b) => (cheapestPackage(a.id)?.package_price ?? -1) - (cheapestPackage(b.id)?.package_price ?? -1),
    };
    const sortFn = sortFns[sortMode];
    incomplete.sort(sortFn);
    ok.sort(sortFn);

    renderSection("bodyNew", "countNew", draftRows, "new");
    renderSection("bodyIncomplete", "countIncomplete", incomplete, "incomplete");
    renderSection("bodyOk", "countOk", ok, "ok");
}

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

function setupFilters() {
    categoryFilter = createMultiselect({ label: "Категория", onChange: render });
    document.getElementById("filtersRow").appendChild(categoryFilter.el);
}

async function loadIngredients() {
    const [ingRes, pkgRes, convRes] = await Promise.all([
        db.from("ingredients").select("*").order("name"),
        db.from("ingredient_packages").select("*"),
        db.from("unit_conversions").select("*"),
    ]);
    if (ingRes.error) {
        showStatus(statusEl, "Ошибка загрузки: " + ingRes.error.message, "error");
        return;
    }
    if (pkgRes.error) {
        showStatus(statusEl, "Ошибка загрузки упаковок: " + pkgRes.error.message, "error");
        return;
    }
    if (convRes.error) {
        showStatus(statusEl, "Ошибка загрузки конвертаций: " + convRes.error.message, "error");
        return;
    }
    allRows = ingRes.data;
    packagesByIngredient = {};
    pkgRes.data.forEach((p) => { (packagesByIngredient[p.ingredient_id] ||= []).push(p); });
    conversionsByIngredient = {};
    convRes.data.forEach((c) => { (conversionsByIngredient[c.ingredient_id] ||= []).push(c); });
    refreshCategoryOptions();
    render();
}

document.getElementById("addRowBtn").onclick = () => {
    draftCounter += 1;
    draftRows.unshift({ tempId: "draft" + draftCounter, name: "", category: null, base_unit: null, comment: null });
    render();
    document.getElementById("sectionNewBody").classList.remove("collapsed");
};

document.getElementById("checkPricesBtn").onclick = checkAllPrices;

document.querySelectorAll(".section-header").forEach((header) => {
    header.onclick = () => {
        const target = document.getElementById(header.dataset.target);
        target.classList.toggle("collapsed");
        header.querySelector(".section-toggle").textContent = target.classList.contains("collapsed") ? "▸" : "▾";
    };
});

document.getElementById("searchInput").oninput = (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    render();
};

document.getElementById("sortSelect").onchange = (e) => {
    sortMode = e.target.value;
    render();
};

document.getElementById("bulkImportBtn").onclick = async () => {
    const text = document.getElementById("bulkInput").value.trim();
    if (!text) return;

    // Строка = один вариант упаковки. Если у позиции их несколько — повторите название на
    // нескольких строках подряд (как в bulk-импорте рецептов). Категория/базовая ед./комментарий
    // достаточно заполнить один раз в первой строке.
    const rows = text.split("\n").map((line) => line.split("\t")).filter((cols) => cols.some((c) => c.trim()));
    if (rows.length === 0) return;

    const groups = new Map(); // name -> { meta: {category, base_unit, comment}, variants: [...] }
    rows.forEach((cols) => {
        const record = {};
        FIELDS.forEach((field, i) => {
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
                purchase_unit: record.purchase_unit,
                purchase_link: record.purchase_link,
            });
        }
    });

    if (groups.size === 0) {
        showToast("Не нашёл ни одной строки с названием", "error");
        return;
    }

    const ingredientRecords = [...groups.entries()].map(([name, g]) => ({
        name, category: g.meta.category || null, base_unit: g.meta.base_unit || null, comment: g.meta.comment || null,
    }));
    const { data: inserted, error } = await db.from("ingredients").insert(ingredientRecords).select("id,name");
    if (error) {
        showToast("Ошибка импорта: " + error.message, "error");
        return;
    }

    const byName = new Map(inserted.map((i) => [i.name, i.id]));
    const packagesToInsert = [];
    for (const [name, g] of groups) {
        const id = byName.get(name);
        if (!id) continue;
        g.variants.forEach((v) => packagesToInsert.push({ ingredient_id: id, ...v }));
    }
    if (packagesToInsert.length > 0) {
        await db.from("ingredient_packages").insert(packagesToInsert);
    }

    document.getElementById("bulkInput").value = "";
    showToast(`Позиций: ${inserted.length}, вариантов упаковки: ${packagesToInsert.length}`, "info");
    await loadIngredients();
};

// ---- Экспорт / импорт Excel ----

const EXCEL_HEADER_MAP = {
    "ID": "id",
    "ID упаковки": "package_id",
    "Название": "name",
    "Категория": "category",
    "Базовая ед.": "base_unit",
    "Закупочная ед.": "purchase_unit",
    "Источник": "purchase_source",
    "Размер упаковки": "package_size",
    "Цена упаковки": "package_price",
    "Ссылка": "purchase_link",
    "Парсер цены": "price_source_type",
    "Запрос цены": "price_source_query",
    "Автоцена включена": "price_source_enabled",
    "Комментарий": "comment",
};

// Экспортируем по одной строке НА КАЖДЫЙ вариант упаковки (не только самый дешёвый) —
// это позволяет при обратной загрузке точно обновить конкретный вариант по "ID упаковки"
// или добавить новые варианты, просто дописав строки снизу с пустым ID/ID упаковки.
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

    let updated = 0;
    let inserted = 0;
    let packagesAdded = 0;
    let packagesUpdated = 0;
    const resolvedIngredientId = new Map(); // Название -> id (в рамках этого импорта, чтобы не дублировать вставку)

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
                ingredientId = targetId;
                updated++;
            } else {
                const { data, error } = await db.from("ingredients").insert(ingredientValues).select("id").single();
                if (error) { errors.push(`«${rec.name}»: ${error.message}`); continue; }
                ingredientId = data.id;
                inserted++;
            }
            resolvedIngredientId.set(rec.name, ingredientId);
        }

        if (rec.package_size == null && rec.package_price == null) continue;

        const values = {
            package_size: rec.package_size, package_price: rec.package_price,
            purchase_unit: rec.purchase_unit, purchase_source: rec.purchase_source, purchase_link: rec.purchase_link,
            price_source_type: rec.price_source_type || "manual",
            price_source_query: rec.price_source_query,
            price_source_enabled: rec.price_source_enabled !== false,
        };
        const existingPkg = rec.package_id && (packagesByIngredient[ingredientId] || []).find((p) => p.id === rec.package_id);
        if (existingPkg) {
            const { error } = await db.from("ingredient_packages").update(values).eq("id", rec.package_id);
            if (error) errors.push(`«${rec.name}» (упаковка): ${error.message}`);
            else packagesUpdated++;
        } else if (!packageAlreadyExists(ingredientId, rec.package_size, rec.package_price)) {
            const { error } = await db.from("ingredient_packages").insert({ ingredient_id: ingredientId, ...values });
            if (error) errors.push(`«${rec.name}» (упаковка): ${error.message}`);
            else packagesAdded++;
        }
    }

    showToast(
        `Позиций: обновлено ${updated}, добавлено ${inserted}. Упаковок: обновлено ${packagesUpdated}, добавлено ${packagesAdded}` + (errors.length ? `, ошибок: ${errors.length}` : ""),
        errors.length ? "error" : "info"
    );
    if (errors.length) alert("Не всё получилось:\n\n" + errors.join("\n"));
    await loadIngredients();
}

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
    setupFilters();
    loadIngredients();
}

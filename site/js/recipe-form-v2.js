// Форма добавления/редактирования рецепта во v2-оформлении. Логика сохранения
// (резолв сырья/заготовок по имени, поиск дублей состава, теги, загрузка фото)
// перенесена из js/recipes.js один в один — так же остаётся безопасной для базы.
(function () {
    const TOPUP_DEFAULT_QTY = 100;
    const IMAGE_BUCKET = "recipe-images";

    const form = {
        ingredientsFull: [],
        ingredientMap: {},
        tagMap: {},
        editingId: null,
        loaded: false,
        bulkDrafts: [],
        bulkDraftCounter: 0,
    };

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

    const fEls = {
        drawer: document.getElementById("recipeFormDrawer"),
        title: document.getElementById("recipeFormTitle"),
        status: document.getElementById("recipeFormStatus"),
        closeBtn: document.getElementById("recipeFormCloseBtn"),
        name: document.getElementById("rfName"),
        isPrep: document.getElementById("rfIsPrep"),
        isPrepSegmented: document.getElementById("rfIsPrepSegmented"),
        subtype: document.getElementById("rfSubtype"),
        mainSpirit: document.getElementById("rfMainSpirit"),
        prepFields: document.getElementById("rfPrepFields"),
        yieldQty: document.getElementById("rfYieldQty"),
        yieldUnit: document.getElementById("rfYieldUnit"),
        laborMinutes: document.getElementById("rfLaborMinutes"),
        purchaseDetails: document.getElementById("rfPurchaseDetails"),
        purchaseUnit: document.getElementById("rfPurchaseUnit"),
        purchasePackageSize: document.getElementById("rfPurchasePackageSize"),
        purchasePackagePrice: document.getElementById("rfPurchasePackagePrice"),
        purchaseCategory: document.getElementById("rfPurchaseCategory"),
        purchaseLink: document.getElementById("rfPurchaseLink"),
        items: document.getElementById("rfItems"),
        addItemBtn: document.getElementById("rfAddItemBtn"),
        description: document.getElementById("rfDescription"),
        notes: document.getElementById("rfNotes"),
        imageUrl: document.getElementById("rfImageUrl"),
        imageFile: document.getElementById("rfImageFile"),
        sourceUrl: document.getElementById("rfSourceUrl"),
        tags: document.getElementById("rfTags"),
        saveBtn: document.getElementById("rfSaveBtn"),
        deleteBtn: document.getElementById("rfDeleteBtn"),
        ingredientList: document.getElementById("rfIngredientList"),
        unitList: document.getElementById("rfUnitList"),
        categoryList: document.getElementById("rfCategoryList"),
        tabs: document.getElementById("recipeFormTabs"),
        formTab: document.getElementById("rfFormTab"),
        bulkTab: document.getElementById("rfBulkTab"),
        footer: document.querySelector(".bc-form-footer"),
        bulkInput: document.getElementById("rfBulkInput"),
        bulkCheckBtn: document.getElementById("rfBulkCheckBtn"),
        copyTemplateBtn: document.getElementById("rfCopyTemplateBtn"),
        bulkPreview: document.getElementById("rfBulkPreview"),
    };

    function setFormStatus(message, kind) {
        fEls.status.textContent = message || "";
        fEls.status.className = "bc-status" + (message ? " show" : "");
        if (message) fEls.status.style.borderColor = kind === "error" ? "rgba(255,59,48,.55)" : "rgba(255,103,43,.55)";
    }

    // Поле с datalist (напр. единицы измерения) технически остаётся текстовым вводом,
    // поэтому после выбора варианта из подсказки клавиатура на телефоне не закрывается
    // сама — фокус никуда не делся. Как только значение совпало с одним из вариантов
    // списка "один в один", это уже готовый ответ (единицы — короткие фиксированные
    // токены, дальше печатать нечего), так что можно смело убрать клавиатуру.
    function dismissKeyboardOnListMatch(input, options) {
        input.addEventListener("input", () => {
            if (options.includes(input.value)) {
                setTimeout(() => { if (document.activeElement === input) input.blur(); }, 50);
            }
        });
    }

    // ---- Переключение вкладок «Форма» / «Текстом» ----
    const formTabButtons = [...fEls.tabs.querySelectorAll("button")];
    const formTabThumb = fEls.tabs.querySelector(".bc-segmented-thumb");

    function setFormTab(tabName) {
        const btn = formTabButtons.find((b) => b.dataset.tab === tabName) || formTabButtons[0];
        formTabButtons.forEach((b) => b.classList.toggle("active", b === btn));
        if (formTabThumb && btn) {
            formTabThumb.style.transform = "none";
            formTabThumb.style.left = btn.offsetLeft + "px";
            formTabThumb.style.width = btn.offsetWidth + "px";
        }
        const isBulk = tabName === "bulk";
        fEls.formTab.classList.toggle("hidden", isBulk);
        fEls.bulkTab.classList.toggle("hidden", !isBulk);
        fEls.footer.classList.toggle("hidden", isBulk);
    }

    formTabButtons.forEach((btn) => {
        btn.onclick = () => setFormTab(btn.dataset.tab);
    });

    const bulkTabBtn = formTabButtons.find((b) => b.dataset.tab === "bulk");

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

    function isNameTaken(name) {
        return !!state.recipeIdByName[normalized(name)];
    }

    function buildBulkDrafts(text) {
        const rows = parseBulkRows(text);
        const groups = new Map();
        for (const cols of rows) {
            const [recipeName, recipeType, subtype, mainSpirit, tagsRaw, description, notes, sourceUrl, imageUrl, yieldQtyRaw, yieldUnit, laborRaw, ingName, ingType, qtyRaw, unitRaw, topupRaw] = cols;
            if (!recipeName) continue;
            if (!groups.has(recipeName)) {
                form.bulkDraftCounter += 1;
                groups.set(recipeName, {
                    tempId: "bulk" + form.bulkDraftCounter,
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
        return (state.itemsByRecipe[recipeId] || [])
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
        const existing = state.itemsByRecipe[recipeId] || [];
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
        return Object.entries(state.recipesById)
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

    function renderBulkItemRow(draft, row, index, container) {
        const rowEl = document.createElement("div");
        rowEl.className = "bc-bulk-item-row";

        rowEl.appendChild(makeBulkInput(row.ingName, (v) => { row.ingName = v; }, { list: "rfIngredientList", placeholder: "сырьё / заготовка" }));
        rowEl.appendChild(makeBulkInput(row.qtyRaw, (v) => { row.qtyRaw = v; }, { inputMode: "decimal", placeholder: "кол-во" }));
        rowEl.appendChild(makeBulkInput(row.unitRaw, (v) => { row.unitRaw = v; }, { list: "rfUnitList", placeholder: "ед." }));
        rowEl.appendChild(makeBulkInput(row.topupRaw, (v) => { row.topupRaw = v; }, { placeholder: "топом" }));

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "bc-bulk-item-remove";
        delBtn.textContent = "×";
        delBtn.onclick = () => {
            draft.rows.splice(index, 1);
            renderBulkPreview();
        };
        rowEl.appendChild(delBtn);

        container.appendChild(rowEl);
    }

    function clearBulkPreview() {
        form.bulkDrafts = [];
        fEls.bulkPreview.innerHTML = "";
        fEls.bulkPreview.classList.add("hidden");
    }

    function renderBulkPreview() {
        const preview = fEls.bulkPreview;
        preview.innerHTML = "";
        if (form.bulkDrafts.length === 0) {
            preview.classList.add("hidden");
            return;
        }
        preview.classList.remove("hidden");

        const summary = document.createElement("div");
        summary.className = "bc-bulk-summary";
        const validations = form.bulkDrafts.map(validateBulkDraft);
        const activeCount = form.bulkDrafts.filter((d) => d.enabled).length;
        const problemCount = validations.reduce((sum, v) => sum + v.problems.length, 0);
        const warningCount = validations.reduce((sum, v) => sum + v.warnings.length, 0);
        summary.textContent = `Черновик импорта: ${activeCount} выбрано из ${form.bulkDrafts.length}. Ошибок: ${problemCount}. Предупреждений: ${warningCount}.`;
        preview.appendChild(summary);

        form.bulkDrafts.forEach((draft, idx) => {
            const validation = validations[idx];
            const card = document.createElement("div");
            card.className = "bc-bulk-draft-card";
            if (validation.problems.length > 0) card.classList.add("has-errors");
            else if (validation.warnings.length > 0) card.classList.add("has-warnings");
            if (!draft.enabled) card.classList.add("disabled");

            const head = document.createElement("div");
            head.className = "bc-bulk-draft-head";

            const enabledLabel = document.createElement("label");
            enabledLabel.className = "bc-bulk-draft-enabled";
            const enabledCb = document.createElement("input");
            enabledCb.type = "checkbox";
            enabledCb.checked = draft.enabled;
            enabledCb.onchange = () => { draft.enabled = enabledCb.checked; renderBulkPreview(); };
            enabledLabel.appendChild(enabledCb);
            enabledLabel.appendChild(document.createTextNode(" импортировать"));
            head.appendChild(enabledLabel);

            const title = document.createElement("div");
            title.className = "bc-bulk-draft-title";
            title.textContent = draft.name || "Без названия";
            head.appendChild(title);

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.textContent = "Убрать";
            removeBtn.onclick = () => {
                form.bulkDrafts = form.bulkDrafts.filter((d) => d !== draft);
                renderBulkPreview();
            };
            head.appendChild(removeBtn);
            card.appendChild(head);

            const meta = document.createElement("div");
            meta.className = "bc-bulk-draft-meta";
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
                meta.appendChild(makeBulkInput(draft.yieldUnit, (v) => { draft.yieldUnit = v; }, { list: "rfUnitList", placeholder: "Ед. выхода" }));
                meta.appendChild(makeBulkInput(draft.laborRaw, (v) => { draft.laborRaw = v; }, { inputMode: "decimal", placeholder: "Минуты" }));
            }
            card.appendChild(meta);

            if (validation.problems.length > 0 || validation.warnings.length > 0) {
                const notes = document.createElement("div");
                notes.className = "bc-bulk-draft-notes";
                validation.problems.forEach((p) => {
                    const div = document.createElement("div");
                    div.className = "bc-bulk-problem";
                    div.textContent = p;
                    notes.appendChild(div);
                });
                validation.warnings.forEach((w, warningIndex) => {
                    const div = document.createElement("div");
                    div.className = "bc-bulk-warning";
                    const span = document.createElement("span");
                    span.textContent = w;
                    div.appendChild(span);
                    const similar = validation.similar[warningIndex];
                    if (similar) {
                        const btn = document.createElement("button");
                        btn.type = "button";
                        btn.textContent = "Открыть";
                        btn.onclick = () => { closeFormDrawer(); openDrawer(similar.id, true); };
                        div.appendChild(btn);
                    }
                    notes.appendChild(div);
                });
                card.appendChild(notes);
            }

            const table = document.createElement("div");
            table.className = "bc-bulk-items-table";
            draft.rows.forEach((row, rowIndex) => renderBulkItemRow(draft, row, rowIndex, table));
            card.appendChild(table);

            const addRowBtn = document.createElement("button");
            addRowBtn.type = "button";
            addRowBtn.className = "bc-bulk-add-row";
            addRowBtn.textContent = "+ Ингредиент";
            addRowBtn.onclick = () => {
                draft.rows.push({ ingName: "", ingType: "", qtyRaw: "", unitRaw: "", topupRaw: "" });
                renderBulkPreview();
            };
            card.appendChild(addRowBtn);

            preview.appendChild(card);
        });

        const actions = document.createElement("div");
        actions.className = "bc-bulk-preview-actions";
        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "bc-primary-link";
        saveBtn.textContent = "Сохранить выбранные рецепты";
        saveBtn.disabled = activeCount === 0 || problemCount > 0;
        saveBtn.onclick = saveBulkDrafts;
        actions.appendChild(saveBtn);

        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "bc-ghost-link";
        clearBtn.textContent = "Очистить предпросмотр";
        clearBtn.onclick = clearBulkPreview;
        actions.appendChild(clearBtn);
        preview.appendChild(actions);
    }

    async function saveBulkDrafts() {
        const selectedDrafts = form.bulkDrafts.filter((d) => d.enabled);
        const seenNames = new Set();
        const repeatedNames = [];
        selectedDrafts.forEach((draft) => {
            const name = normalizeLoose(draft.name);
            if (!name) return;
            if (seenNames.has(name)) repeatedNames.push(draft.name.trim());
            seenNames.add(name);
        });
        if (repeatedNames.length > 0) {
            setFormStatus("В черновике несколько новых рецептов с одинаковым названием: " + repeatedNames.join(", "), "error");
            return;
        }
        const validations = selectedDrafts.map(validateBulkDraft);
        const blocking = validations
            .map((v, i) => ({ v, draft: selectedDrafts[i] }))
            .filter((x) => x.v.problems.length > 0);
        if (blocking.length > 0) {
            setFormStatus("Нужно поправить черновик: " + blocking.map((x) => `«${x.draft.name || "Без названия"}»: ${x.v.problems.join("; ")}`).join(" | "), "error");
            renderBulkPreview();
            return;
        }
        if (selectedDrafts.length === 0) return;

        setFormStatus("Сохраняем…");

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
        if (insertErr) { setFormStatus("Ошибка создания рецептов: " + insertErr.message, "error"); return; }
        const insertedIdByName = new Map();
        insertedRecipes.forEach((r) => { insertedIdByName.set(r.name, r.id); });

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
            if (error) { setFormStatus("Ошибка импорта состава: " + error.message, "error"); return; }
        }

        fEls.bulkInput.value = "";
        clearBulkPreview();
        closeFormDrawer();
        await loadAll();

        const dupWarnings = [];
        for (const draft of selectedDrafts) {
            const recipeName = draft.name.trim();
            const rid = insertedIdByName.get(recipeName);
            const sig = compositionSignature((state.itemsByRecipe[rid] || []).map((it) => ({
                key: it.isSub ? "sub:" + it.targetId : "ing:" + form.ingredientMap[it.name],
                qty: it.qty,
                unit: it.unit,
            })));
            for (const [otherId, otherItems] of Object.entries(state.itemsByRecipe)) {
                if (otherId === rid) continue;
                const otherSig = compositionSignature(otherItems.map((it) => ({
                    key: it.isSub ? "sub:" + it.targetId : "ing:" + form.ingredientMap[it.name],
                    qty: it.qty,
                    unit: it.unit,
                })));
                if (otherSig === sig) {
                    dupWarnings.push(`«${recipeName}» — точно такой же состав, как у «${state.recipesById[otherId].name}»`);
                    break;
                }
            }
        }

        const summaryLines = [`Импортировано рецептов: ${selectedDrafts.length}.`];
        if (itemErrors.length) summaryLines.push(`Проблемы со строками состава: ${itemErrors.join("; ")}`);
        if (dupWarnings.length) summaryLines.push(`Возможные дубли состава: ${dupWarnings.join("; ")}`);
        showToast(summaryLines.join(" "), itemErrors.length ? "error" : "info");
    }

    fEls.copyTemplateBtn.onclick = async () => {
        try {
            await navigator.clipboard.writeText(BULK_TEMPLATE);
            setFormStatus("Шаблон скопирован в буфер обмена.");
        } catch (e) {
            fEls.bulkInput.value = BULK_TEMPLATE;
        }
    };

    fEls.bulkCheckBtn.onclick = () => {
        const text = fEls.bulkInput.value;
        if (!text.trim()) return;
        form.bulkDrafts = buildBulkDrafts(text);
        if (form.bulkDrafts.length === 0) {
            setFormStatus("Не нашёл ни одной строки данных.", "error");
            return;
        }
        setFormStatus("");
        renderBulkPreview();
    };

    async function loadFormData() {
        if (form.loaded) return;
        const [ingRes, tagsRes] = await Promise.all([
            db.from("ingredients").select("id,name,category,base_unit"),
            db.from("tags").select("id,name"),
        ]);
        if (!ingRes.error) {
            form.ingredientsFull = ingRes.data || [];
            form.ingredientMap = {};
            form.ingredientsFull.forEach((i) => { form.ingredientMap[i.name] = i.id; });
        }
        if (!tagsRes.error) {
            form.tagMap = {};
            (tagsRes.data || []).forEach((t) => { form.tagMap[t.name] = t.id; });
        }
        refreshIngredientDatalist();
        populateMainSpiritOptions();
        populateCategoryDatalist();
        populateUnitDatalist();
        form.loaded = true;
    }

    function refreshIngredientDatalist() {
        fEls.ingredientList.innerHTML = "";
        const names = new Set([...Object.keys(form.ingredientMap), ...Object.keys(state.recipeIdByName || {}).map((k) => state.recipesById[state.recipeIdByName[k]].name)]);
        names.forEach((name) => {
            const opt = document.createElement("option");
            opt.value = name;
            fEls.ingredientList.appendChild(opt);
        });
    }

    function populateMainSpiritOptions() {
        fEls.mainSpirit.innerHTML = '<option value="">—</option>';
        const spirits = form.ingredientsFull.filter((i) => i.category && i.category.toLowerCase().includes("алкогол"));
        spirits.forEach((i) => {
            const opt = document.createElement("option");
            opt.value = i.name;
            opt.textContent = i.name;
            fEls.mainSpirit.appendChild(opt);
        });
    }

    function populateCategoryDatalist() {
        fEls.categoryList.innerHTML = "";
        const names = new Set(CATEGORY_SEED);
        form.ingredientsFull.forEach((i) => { if (i.category) names.add(i.category); });
        names.forEach((c) => {
            const opt = document.createElement("option");
            opt.value = c;
            fEls.categoryList.appendChild(opt);
        });
    }

    function populateUnitDatalist() {
        fEls.unitList.innerHTML = "";
        UNIT_OPTIONS.forEach((u) => {
            const opt = document.createElement("option");
            opt.value = u;
            fEls.unitList.appendChild(opt);
        });
    }
    dismissKeyboardOnListMatch(fEls.yieldUnit, UNIT_OPTIONS);

    function populateSubtypeSelect() {
        const isPrep = fEls.isPrep.value === "true";
        const options = isPrep ? PREP_SUBTYPES : COCKTAIL_SUBTYPES;
        fEls.subtype.innerHTML = '<option value="">—</option>';
        options.forEach((s) => {
            const opt = document.createElement("option");
            opt.value = s;
            opt.textContent = s;
            fEls.subtype.appendChild(opt);
        });
        fEls.prepFields.style.display = isPrep ? "" : "none";
        fEls.purchaseDetails.style.display = isPrep ? "" : "none";
    }
    fEls.isPrep.onchange = populateSubtypeSelect;

    const isPrepButtons = [...fEls.isPrepSegmented.querySelectorAll("button")];
    const isPrepThumb = fEls.isPrepSegmented.querySelector(".bc-segmented-thumb");

    function setIsPrep(value) {
        const strValue = String(value);
        fEls.isPrep.value = strValue;
        const btn = isPrepButtons.find((b) => b.dataset.value === strValue) || isPrepButtons[0];
        isPrepButtons.forEach((b) => b.classList.toggle("active", b === btn));
        if (isPrepThumb && btn) {
            isPrepThumb.style.transform = "none";
            isPrepThumb.style.left = btn.offsetLeft + "px";
            isPrepThumb.style.width = btn.offsetWidth + "px";
        }
        populateSubtypeSelect();
    }

    isPrepButtons.forEach((btn) => {
        btn.onclick = () => setIsPrep(btn.dataset.value);
    });

    function buildItemRow() {
        const row = document.createElement("div");
        row.className = "bc-form-item-row";

        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.className = "bc-item-name";
        nameInput.placeholder = "сырьё / заготовка";
        nameInput.setAttribute("list", "rfIngredientList");

        const qtyInput = document.createElement("input");
        qtyInput.type = "text";
        qtyInput.className = "bc-item-qty";
        qtyInput.inputMode = "decimal";
        qtyInput.placeholder = "кол-во";

        const topupEstInput = document.createElement("input");
        topupEstInput.type = "text";
        topupEstInput.className = "bc-item-qty";
        topupEstInput.inputMode = "decimal";
        topupEstInput.placeholder = "оценка, мл";
        topupEstInput.value = TOPUP_DEFAULT_QTY;
        topupEstInput.style.display = "none";

        const unitInput = document.createElement("input");
        unitInput.type = "text";
        unitInput.className = "bc-item-unit";
        unitInput.placeholder = "ед.";
        unitInput.setAttribute("list", "rfUnitList");
        dismissKeyboardOnListMatch(unitInput, UNIT_OPTIONS);

        const topupWrap = document.createElement("label");
        topupWrap.className = "bc-form-item-topup";
        const topupCb = document.createElement("input");
        topupCb.type = "checkbox";
        topupWrap.appendChild(topupCb);
        topupWrap.appendChild(document.createTextNode("топом"));

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "bc-form-item-remove";
        removeBtn.textContent = "×";
        removeBtn.onclick = () => row.remove();

        topupCb.onchange = () => {
            const isTopup = topupCb.checked;
            row.classList.toggle("is-topup", isTopup);
            qtyInput.style.display = isTopup ? "none" : "";
            unitInput.style.display = isTopup ? "none" : "";
            topupEstInput.style.display = isTopup ? "" : "none";
        };

        row.appendChild(nameInput);
        row.appendChild(qtyInput);
        row.appendChild(topupEstInput);
        row.appendChild(unitInput);
        row.appendChild(topupWrap);
        row.appendChild(removeBtn);

        row._inputs = { nameInput, qtyInput, unitInput, topupCb, topupEstInput };
        return row;
    }

    fEls.addItemBtn.onclick = () => {
        fEls.items.appendChild(buildItemRow());
    };

    function resetForm() {
        form.editingId = null;
        setFormStatus("");
        fEls.name.value = "";
        setIsPrep("false");
        fEls.mainSpirit.value = "";
        fEls.tags.value = "";
        fEls.description.value = "";
        fEls.notes.value = "";
        fEls.imageUrl.value = "";
        fEls.imageFile.value = "";
        fEls.sourceUrl.value = "";
        fEls.yieldQty.value = "";
        fEls.yieldUnit.value = "";
        fEls.laborMinutes.value = "";
        fEls.purchaseUnit.value = "";
        fEls.purchasePackageSize.value = "";
        fEls.purchasePackagePrice.value = "";
        fEls.purchaseCategory.value = "";
        fEls.purchaseLink.value = "";
        fEls.purchaseDetails.open = false;
        fEls.items.innerHTML = "";
        fEls.items.appendChild(buildItemRow());
        fEls.saveBtn.textContent = "Сохранить рецепт";
        fEls.title.textContent = "Новый рецепт";
        if (fEls.deleteBtn) fEls.deleteBtn.classList.add("hidden");
        fEls.bulkInput.value = "";
        clearBulkPreview();
        if (bulkTabBtn) bulkTabBtn.classList.remove("hidden");
        setFormTab("form");
    }

    async function openForNew() {
        await loadFormData();
        resetForm();
        showFormDrawer();
    }

    async function openForEdit(id) {
        await loadFormData();
        const r = state.recipesById[id];
        if (!r) return;
        resetForm();
        if (bulkTabBtn) bulkTabBtn.classList.add("hidden");
        form.editingId = id;
        fEls.title.textContent = "Редактировать рецепт";
        fEls.saveBtn.textContent = "Сохранить изменения";
        if (fEls.deleteBtn) fEls.deleteBtn.classList.remove("hidden");

        fEls.name.value = r.name;
        setIsPrep(r.is_prep ? "true" : "false");
        fEls.subtype.value = r.subtype || "";
        fEls.mainSpirit.value = r.main_spirit || "";
        fEls.description.value = r.description || "";
        fEls.notes.value = r.notes || "";
        fEls.imageUrl.value = r.image_url || "";
        fEls.sourceUrl.value = r.source_url || "";
        fEls.tags.value = (state.tagsByRecipe[id] || []).join(", ");
        fEls.yieldQty.value = r.yield_qty ?? "";
        fEls.yieldUnit.value = r.yield_unit || "";
        fEls.laborMinutes.value = r.labor_minutes ?? "";
        fEls.purchaseUnit.value = r.purchase_unit || "";
        fEls.purchasePackageSize.value = r.purchase_package_size ?? "";
        fEls.purchasePackagePrice.value = r.purchase_package_price ?? "";
        fEls.purchaseCategory.value = r.purchase_category || "";
        fEls.purchaseLink.value = r.purchase_link || "";

        const items = state.itemsByRecipe[id] || [];
        fEls.items.innerHTML = "";
        if (items.length === 0) {
            fEls.items.appendChild(buildItemRow());
        } else {
            items.forEach((it) => {
                const row = buildItemRow();
                row._inputs.nameInput.value = it.name;
                if (it.is_topup) {
                    row._inputs.topupCb.checked = true;
                    row._inputs.topupCb.onchange();
                    row._inputs.topupEstInput.value = it.topup_default_qty ?? TOPUP_DEFAULT_QTY;
                } else {
                    row._inputs.qtyInput.value = it.qty ?? "";
                    row._inputs.unitInput.value = it.unit ?? "";
                }
                fEls.items.appendChild(row);
            });
        }
        showFormDrawer();
    }

    function showFormDrawer() {
        fEls.drawer.classList.remove("hidden");
        document.documentElement.classList.add("drawer-open");
        // Пересчитываем позицию бегунков после того, как панель реально стала видимой —
        // до этого offsetWidth/offsetLeft кнопок ещё нулевые (скрытый родитель).
        setIsPrep(fEls.isPrep.value);
        const activeTabBtn = formTabButtons.find((b) => b.classList.contains("active")) || formTabButtons[0];
        setFormTab(activeTabBtn.dataset.tab);
    }

    function closeFormDrawer() {
        fEls.drawer.classList.add("hidden");
        document.documentElement.classList.remove("drawer-open");
    }

    fEls.closeBtn.onclick = closeFormDrawer;
    fEls.drawer.addEventListener("click", (event) => {
        if (event.target === fEls.drawer) closeFormDrawer();
    });

    // Заготовку с тем же именем, что и сырьё, приоритизируем как заготовку — иначе
    // рецепт с таким именем никогда не попросят приготовить (см. комментарий в recipes.js).
    async function resolveOrCreateIngredientOrPrep(name, unitHint) {
        const prepId = state.recipeIdByName[normalized(name)];
        if (prepId && state.recipesById[prepId] && state.recipesById[prepId].is_prep) {
            return { ingredient_id: null, sub_recipe_id: prepId, created: false };
        }
        if (form.ingredientMap[name]) return { ingredient_id: form.ingredientMap[name], sub_recipe_id: null, created: false };

        const { data, error } = await db.from("ingredients").insert({ name, base_unit: unitHint || null }).select("id,name").single();
        if (error) return null;
        form.ingredientMap[name] = data.id;
        form.ingredientsFull.push({ id: data.id, name, category: null, base_unit: unitHint || null });
        refreshIngredientDatalist();
        return { ingredient_id: data.id, sub_recipe_id: null, created: true };
    }

    async function getOrCreateTagId(name) {
        if (form.tagMap[name]) return form.tagMap[name];
        const { data, error } = await db.from("tags").insert({ name }).select("id,name").single();
        if (error) return null;
        form.tagMap[name] = data.id;
        return data.id;
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
        for (const [rid, items] of Object.entries(state.itemsByRecipe)) {
            if (rid === excludeId) continue;
            const itemsWithKeys = items.map((it) => ({ key: it.isSub ? "sub:" + it.targetId : "ing:" + form.ingredientMap[it.name], qty: it.qty, unit: it.unit }));
            if (compositionSignature(itemsWithKeys) === sig) return rid;
        }
        return null;
    }

    async function uploadImageIfAny() {
        const file = fEls.imageFile.files && fEls.imageFile.files[0];
        if (!file) return null;
        const path = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error } = await db.storage.from(IMAGE_BUCKET).upload(path, file);
        if (error) {
            setFormStatus("Не получилось загрузить картинку: " + error.message, "error");
            return null;
        }
        const { data } = db.storage.from(IMAGE_BUCKET).getPublicUrl(path);
        return data.publicUrl;
    }

    async function finalizeSave(name, resolvedItems, tagNames) {
        const wasEditing = !!form.editingId;
        const uploadedUrl = await uploadImageIfAny();
        const isPrep = fEls.isPrep.value === "true";
        const yieldQtyRaw = fEls.yieldQty.value.trim();
        const laborRaw = fEls.laborMinutes.value.trim();
        const purchaseSizeRaw = fEls.purchasePackageSize.value.trim();
        const purchasePriceRaw = fEls.purchasePackagePrice.value.trim();

        const recipeValues = {
            name,
            type: isPrep ? "Заготовка" : "Коктейль",
            is_prep: isPrep,
            subtype: fEls.subtype.value || null,
            main_spirit: fEls.mainSpirit.value || null,
            description: fEls.description.value.trim() || null,
            notes: fEls.notes.value.trim() || null,
            image_url: uploadedUrl || fEls.imageUrl.value.trim() || null,
            source_url: fEls.sourceUrl.value.trim() || null,
            yield_qty: isPrep && yieldQtyRaw ? Number(yieldQtyRaw.replace(",", ".")) : null,
            yield_unit: isPrep ? (fEls.yieldUnit.value.trim() || null) : null,
            labor_minutes: isPrep && laborRaw ? Number(laborRaw.replace(",", ".")) : null,
            purchase_unit: isPrep ? (fEls.purchaseUnit.value.trim() || null) : null,
            purchase_package_size: isPrep && purchaseSizeRaw ? Number(purchaseSizeRaw.replace(",", ".")) : null,
            purchase_package_price: isPrep && purchasePriceRaw ? Number(purchasePriceRaw.replace(",", ".")) : null,
            purchase_category: isPrep ? (fEls.purchaseCategory.value.trim() || null) : null,
            purchase_link: isPrep ? (fEls.purchaseLink.value.trim() || null) : null,
        };

        let recipeId;
        if (wasEditing) {
            recipeId = form.editingId;
            const { error } = await db.from("recipes").update(recipeValues).eq("id", recipeId);
            if (error) { setFormStatus("Не сохранились изменения: " + error.message, "error"); return; }
            await db.from("recipe_tags").delete().eq("recipe_id", recipeId);
            await db.from("recipe_items").delete().eq("recipe_id", recipeId);
        } else {
            const { data: inserted, error: insertErr } = await db.from("recipes").insert(recipeValues).select("id,name").single();
            if (insertErr) { setFormStatus("Не сохранился рецепт: " + insertErr.message, "error"); return; }
            recipeId = inserted.id;
        }

        for (const tagName of tagNames) {
            const tagId = await getOrCreateTagId(tagName);
            if (tagId) await db.from("recipe_tags").insert({ recipe_id: recipeId, tag_id: tagId });
        }

        const itemsToInsert = resolvedItems.map((it) => ({ ...it, recipe_id: recipeId }));
        if (itemsToInsert.length > 0) {
            const { error } = await db.from("recipe_items").insert(itemsToInsert);
            if (error) setFormStatus("Рецепт сохранён, но состав не сохранился: " + error.message, "error");
        }

        closeFormDrawer();
        showToast(wasEditing ? `Рецепт «${name}» обновлён` : `Рецепт «${name}» сохранён`, "info");
        await loadAll();
    }

    fEls.saveBtn.onclick = async () => {
        const name = fEls.name.value.trim();
        if (!name) { setFormStatus("Заполните название рецепта.", "error"); return; }
        const existingId = state.recipeIdByName[normalized(name)];
        if (existingId && existingId !== form.editingId) {
            setFormStatus(`Рецепт с названием «${name}» уже есть в базе. Выберите другое название.`, "error");
            return;
        }

        const rows = [...fEls.items.children].filter((row) => row._inputs.nameInput.value.trim());
        if (rows.length === 0) { setFormStatus("Добавьте хотя бы один ингредиент состава.", "error"); return; }

        setFormStatus("Сохраняем…");
        const resolvedItems = [];
        const skipped = [];
        for (const row of rows) {
            const { nameInput, qtyInput, unitInput, topupCb, topupEstInput } = row._inputs;
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
        if (skipped.length > 0) {
            setFormStatus("Не удалось добавить в номенклатуру: " + skipped.join(", "), "error");
            return;
        }

        const tagNames = fEls.tags.value.split(",").map((s) => s.trim()).filter(Boolean);
        const dupId = findDuplicateComposition(resolvedItems, form.editingId);
        if (dupId && state.recipesById[dupId]) {
            const proceed = window.confirm(`Похожий состав уже есть у рецепта «${state.recipesById[dupId].name}». Всё равно сохранить новый рецепт?`);
            if (!proceed) { setFormStatus(""); return; }
        }

        await finalizeSave(name, resolvedItems, tagNames);
    };

    // Общая логика удаления — используется и кнопкой в форме редактирования, и иконкой
    // в карточке просмотра рецепта (мобильный detailDrawer), см. wiring ниже.
    async function deleteRecipeById(recipeId, { reportError } = {}) {
        const recipe = state.recipesById[recipeId];
        if (!recipe) return;
        const fail = reportError || ((msg) => alert(msg));

        // Рецепт может использоваться как заготовка в составе других рецептов —
        // как и с сырьём в номенклатуре, сначала проверяем, не сломаем ли им состав.
        const { data: usages, error: usageError } = await db
            .from("recipe_items")
            .select("recipe:recipes!recipe_id(name)")
            .eq("sub_recipe_id", recipeId);
        if (usageError) { fail("Не получилось проверить использование: " + usageError.message); return; }
        if (usages.length > 0) {
            const names = [...new Set(usages.map((u) => u.recipe && u.recipe.name).filter(Boolean))];
            alert(`Нельзя удалить «${recipe.name}» — он используется как заготовка в составе: ${names.join(", ")}. Сначала уберите его из этих рецептов.`);
            return;
        }

        if (!confirm(`Удалить рецепт «${recipe.name}»? Это действие необратимо.`)) return;

        await db.from("recipe_tags").delete().eq("recipe_id", recipeId);
        await db.from("recipe_items").delete().eq("recipe_id", recipeId);
        const { error } = await db.from("recipes").delete().eq("id", recipeId);
        if (error) { fail("Не получилось удалить рецепт: " + error.message); return; }

        showToast(`Рецепт «${recipe.name}» удалён`, "info");
        await loadAll();
    }

    // Элемент может отсутствовать, если у клиента закэширован старый HTML этой страницы
    // без этой кнопки — без этой проверки вся инициализация формы ниже обрывалась бы
    // на TypeError (см. аналогичный случай с recipePickerComplexToggle в калькуляторе).
    if (fEls.deleteBtn) fEls.deleteBtn.onclick = async () => {
        const recipeId = form.editingId;
        if (!recipeId) return;
        fEls.deleteBtn.disabled = true;
        setFormStatus("Удаляем…");
        await deleteRecipeById(recipeId, { reportError: (msg) => setFormStatus(msg, "error") });
        fEls.deleteBtn.disabled = false;
        if (!state.recipesById[recipeId]) closeFormDrawer();
    };

    const drawerDeleteBtn = document.getElementById("drawerDeleteBtn");
    if (drawerDeleteBtn) drawerDeleteBtn.onclick = async () => {
        const recipeId = state.selectedId;
        if (!recipeId) return;
        drawerDeleteBtn.disabled = true;
        await deleteRecipeById(recipeId);
        drawerDeleteBtn.disabled = false;
        if (!state.recipesById[recipeId]) closeDrawer();
    };

    document.getElementById("newRecipeBtn").onclick = openForNew;

    // Быстрое добавление с главной (index-v2.html?new=1 -> recipes-v2.html?new=1) —
    // сразу открывает форму нового рецепта, не требуя лишнего клика.
    if (new URLSearchParams(location.search).get("new") === "1") openForNew();

    function interceptEditLink(link) {
        if (!link) return;
        link.addEventListener("click", (event) => {
            const id = new URL(link.href, location.href).searchParams.get("edit");
            if (!id) return;
            event.preventDefault();
            openForEdit(id);
        });
    }
    interceptEditLink(document.getElementById("editRecipeLink"));
    interceptEditLink(document.getElementById("drawerEditLink"));

    // Переход по прямой ссылке "recipes-v2.html?edit=<id>" (напр. из калькулятора) —
    // ждём, пока recipes-v2.js подгрузит рецепты, и открываем форму редактирования сразу,
    // без дополнительного клика по карточке.
    (function openEditFromQueryParam() {
        const editId = new URLSearchParams(location.search).get("edit");
        if (!editId) return;
        let attemptsLeft = 100;
        const tryOpen = () => {
            if (state.recipesById[editId]) {
                openForEdit(editId);
                return;
            }
            attemptsLeft -= 1;
            if (attemptsLeft > 0) setTimeout(tryOpen, 100);
        };
        tryOpen();
    })();

    // Кастомный выпадающий список поверх обычного <select> — только для десктопа
    // (на мобильном нативный пикер удобнее и остаётся как есть).
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
        // Список опций select пересобирается динамически (populateSubtypeSelect и т.п.) —
        // подхватываем подпись триггера при любом таком обновлении.
        new MutationObserver(renderTrigger).observe(selectEl, { childList: true });
    }

    enhanceSelect(fEls.subtype);
    enhanceSelect(fEls.mainSpirit);
})();

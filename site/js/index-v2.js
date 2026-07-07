// Главная v2 — сводка по базе (рецепты/номенклатура), проблемы данных и карточка
// ближайшего мероприятия. Ничего не редактирует напрямую — только читает данные и
// ведёт на соответствующие разделы (см. shared-план: "не перегружать" главную).

const statusEl = document.getElementById("status");

function normalized(value) {
    return (value || "").toString().trim().toLowerCase();
}

function isShot(recipe) {
    return normalized(recipe.subtype) === "шот";
}

function formatDate(d) {
    if (!d) return "без даты";
    const [y, m, day] = d.split("-");
    return `${day}.${m}.${y}`;
}

// Склонение существительного по числу: pluralize(3, ["гость","гостя","гостей"]) -> "гостя".
function pluralize(n, forms) {
    const mod100 = Math.abs(Math.round(n)) % 100;
    const mod10 = mod100 % 10;
    if (mod100 > 10 && mod100 < 20) return forms[2];
    if (mod10 > 1 && mod10 < 5) return forms[1];
    if (mod10 === 1) return forms[0];
    return forms[2];
}

function daysUntilText(dateStr) {
    if (!dateStr) return "";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr + "T00:00:00");
    const days = Math.round((target - today) / 86400000);
    if (days > 1) return `через ${days} ${pluralize(days, ["день", "дня", "дней"])}`;
    if (days === 1) return "завтра";
    if (days === 0) return "сегодня";
    const ago = Math.abs(days);
    return `${ago} ${pluralize(ago, ["день", "дня", "дней"])} назад`;
}

function addText(parent, tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text;
    parent.appendChild(el);
    return el;
}

function timeAgoText(isoString) {
    if (!isoString) return "";
    const then = new Date(isoString);
    const diffDays = Math.floor((Date.now() - then.getTime()) / 86400000);
    if (diffDays <= 0) return "сегодня";
    if (diffDays === 1) return "вчера";
    return `${diffDays} ${pluralize(diffDays, ["день", "дня", "дней"])} назад`;
}

// Топ-N по количеству — переиспользуем внешний вид чипов из "Сырьё — сводка" (ing-summary-chip).
function renderChips(container, counts, limit) {
    container.innerHTML = "";
    [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .forEach(([label, count]) => {
            const chip = document.createElement("span");
            chip.className = "ing-summary-chip hm-chip";
            chip.textContent = `${label} · ${count}`;
            container.appendChild(chip);
        });
}

// ---- Рецепты — счётчик с расшифровкой по типам ----
// Та же таксономия, что и сегментированные вкладки на recipes-v2.html (все/коктейли/шоты/заготовки).

async function loadRecipesStats() {
    const { data, error } = await db.from("recipes").select("id, is_prep, subtype");
    if (error) {
        showStatus(statusEl, "Ошибка загрузки рецептов: " + error.message, "error");
        return null;
    }
    const total = data.length;
    const preps = data.filter((r) => r.is_prep).length;
    const shots = data.filter((r) => !r.is_prep && isShot(r)).length;
    const cocktails = total - preps - shots;

    document.getElementById("recipesTotal").textContent = total;
    const parts = [];
    if (cocktails) parts.push(`${cocktails} ${pluralize(cocktails, ["коктейль", "коктейля", "коктейлей"])}`);
    if (shots) parts.push(`${shots} ${pluralize(shots, ["шот", "шота", "шотов"])}`);
    if (preps) parts.push(`${preps} ${pluralize(preps, ["заготовка", "заготовки", "заготовок"])}`);
    document.getElementById("recipesBreakdown").textContent = parts.join(" · ");

    // Подтипы заготовок (Сироп/Кордиал/Пюре/...) — та же разбивка, что доступна фильтром
    // по подтипу на recipes-v2.html, тут просто топ-6 самых частых как чипы.
    const subtypeCounts = new Map();
    data.filter((r) => r.is_prep && r.subtype).forEach((r) => {
        subtypeCounts.set(r.subtype, (subtypeCounts.get(r.subtype) || 0) + 1);
    });
    renderChips(document.getElementById("recipesChips"), subtypeCounts, 6);

    return { total, cocktails, shots, preps, rows: data };
}

// ---- Номенклатура — счётчик с расшифровкой по заполненности ----
// classify() — та же логика, что и в ingredients-v2.js: позиция "ок", если есть категория,
// базовая единица и хотя бы один вариант упаковки с размером и ценой.

async function loadIngredientsStats() {
    const [ingRes, pkgRes] = await Promise.all([
        db.from("ingredients").select("id, category, base_unit"),
        db.from("ingredient_packages").select("ingredient_id, package_size, package_price"),
    ]);
    if (ingRes.error) {
        showStatus(statusEl, "Ошибка загрузки номенклатуры: " + ingRes.error.message, "error");
        return null;
    }
    const packagesByIngredient = {};
    (pkgRes.data || []).forEach((p) => {
        (packagesByIngredient[p.ingredient_id] = packagesByIngredient[p.ingredient_id] || []).push(p);
    });

    function classify(record) {
        const hasPackage = (packagesByIngredient[record.id] || []).some((p) => p.package_size != null && p.package_price != null);
        return record.category && record.base_unit && hasPackage ? "ok" : "incomplete";
    }

    const rows = ingRes.data;
    const total = rows.length;
    const incomplete = rows.filter((r) => classify(r) === "incomplete").length;
    const ok = total - incomplete;

    document.getElementById("ingredientsTotal").textContent = total;
    const parts = [];
    if (ok) parts.push(`${ok} заполнены`);
    if (incomplete) parts.push(`${incomplete} ${pluralize(incomplete, ["неполная", "неполные", "неполных"])}`);
    document.getElementById("ingredientsBreakdown").textContent = parts.join(" · ");

    const categoryCounts = new Map();
    rows.forEach((r) => {
        const key = r.category || "без категории";
        categoryCounts.set(key, (categoryCounts.get(key) || 0) + 1);
    });
    renderChips(document.getElementById("ingredientsChips"), categoryCounts, 6);

    return { total, ok, incomplete };
}

// ---- Проблемы — та же проверка неполноты номенклатуры + заготовки без выхода партии
// (аналог computeIssues() в event-v2.js, но по всей базе, а не по одному мероприятию) ----

async function loadIssues(recipesStats, ingredientsStats) {
    const issuesList = document.getElementById("issuesList");
    const trigger = document.getElementById("issuesTrigger");
    issuesList.innerHTML = "";

    const items = [];

    if (ingredientsStats && ingredientsStats.incomplete > 0) {
        items.push({
            text: `${ingredientsStats.incomplete} ${pluralize(ingredientsStats.incomplete, ["позиция сырья", "позиции сырья", "позиций сырья"])} без категории, базовой ед. или упаковки`,
            href: "ingredients-v2.html",
        });
    }

    const { data: preps, error } = await db.from("recipes").select("id").eq("is_prep", true).is("yield_qty", null);
    if (!error && preps && preps.length > 0) {
        items.push({
            text: `${preps.length} ${pluralize(preps.length, ["заготовка", "заготовки", "заготовок"])} без указанного выхода партии`,
            href: "recipes-v2.html",
        });
    }

    const totalCount = (ingredientsStats ? ingredientsStats.incomplete : 0) + (preps && !error ? preps.length : 0);

    if (totalCount > 0) {
        trigger.textContent = `Проблемы: ${totalCount}`;
        trigger.classList.add("hm-has-issues");
    } else {
        trigger.textContent = "Данные в порядке";
        trigger.classList.remove("hm-has-issues");
    }

    if (items.length === 0) {
        addText(issuesList, "div", "bc-empty hm-issues-empty", "Проблем не найдено — данные заполнены полностью.");
        return;
    }

    items.forEach((it) => {
        const row = document.createElement("a");
        row.className = "hm-issue-row";
        row.href = it.href;
        addText(row, "span", "", it.text);
        addText(row, "span", "hm-issue-fix", "исправить →");
        issuesList.appendChild(row);
    });
}

// ---- Ближайшее мероприятие ----
// Приоритет: активное (сегодня) -> ближайшее будущее -> последний черновик (без даты) -> пусто.

function pickHighlightedEvent(events) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const active = events.find((e) => e.event_date === todayStr);
    if (active) return active;

    const future = events
        .filter((e) => e.event_date && e.event_date > todayStr)
        .sort((a, b) => (a.event_date < b.event_date ? -1 : 1));
    if (future.length > 0) return future[0];

    const drafts = events
        .filter((e) => !e.event_date)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    if (drafts.length > 0) return drafts[0];

    return null;
}

// Прогресс по заготовкам/закупке для одного мероприятия — облегчённый вариант того же
// разворачивания состава, что делает computeEventTotals() в event-calc-v2.js, но без
// денег/юнитов/конвертаций — нужны только id-шники, чтобы посчитать "N из M отмечено".
// buy_ready — переопределение НА УРОВНЕ МЕРОПРИЯТИЯ (event_prep_state), поэтому запрос
// именно по этому eventId, а не общий признак рецепта.
async function computeEventProgress(eventId, recipeRows) {
    if (!recipeRows) return null;
    const isPrepMap = {};
    recipeRows.forEach((r) => { isPrepMap[r.id] = r.is_prep; });

    const [menuRes, itemsRes, prepStateRes, ingStateRes, manualRes] = await Promise.all([
        db.from("event_menu_items").select("recipe_id").eq("event_id", eventId).eq("included", true),
        db.from("recipe_items").select("recipe_id, ingredient_id, sub_recipe_id"),
        db.from("event_prep_state").select("recipe_id, is_checked, buy_ready").eq("event_id", eventId),
        db.from("event_ingredient_state").select("ingredient_id, is_checked").eq("event_id", eventId),
        db.from("event_manual_items").select("id, is_checked").eq("event_id", eventId),
    ]);
    if (menuRes.error || itemsRes.error || !menuRes.data.length) return null;

    const itemsByRecipe = {};
    (itemsRes.data || []).forEach((it) => {
        (itemsByRecipe[it.recipe_id] = itemsByRecipe[it.recipe_id] || []).push(it);
    });

    const buyReadyByRecipe = {};
    const checkedPrepByRecipe = {};
    (prepStateRes.data || []).forEach((s) => {
        buyReadyByRecipe[s.recipe_id] = !!s.buy_ready;
        checkedPrepByRecipe[s.recipe_id] = !!s.is_checked;
    });
    const checkedIngredient = {};
    (ingStateRes.data || []).forEach((s) => { checkedIngredient[s.ingredient_id] = !!s.is_checked; });

    const prepIds = new Set();       // заготовки, которые нужно приготовить
    const boughtPrepIds = new Set(); // заготовки, отмеченные "купить готовым" для этого события
    const ingredientIds = new Set(); // сырьё для закупки
    const visited = new Set();

    function walkComposition(recipeId) {
        (itemsByRecipe[recipeId] || []).forEach((item) => {
            if (item.ingredient_id) ingredientIds.add(item.ingredient_id);
            else if (item.sub_recipe_id) addPrepNode(item.sub_recipe_id);
        });
    }

    function addPrepNode(recipeId) {
        if (visited.has(recipeId)) return;
        visited.add(recipeId);
        if (buyReadyByRecipe[recipeId]) {
            boughtPrepIds.add(recipeId); // состав купленной готовой заготовки не разворачиваем
            return;
        }
        prepIds.add(recipeId);
        walkComposition(recipeId);
    }

    (menuRes.data || []).forEach((mi) => {
        if (visited.has(mi.recipe_id)) return;
        if (isPrepMap[mi.recipe_id]) {
            addPrepNode(mi.recipe_id);
        } else {
            visited.add(mi.recipe_id);
            walkComposition(mi.recipe_id);
        }
    });

    const manualRows = manualRes.error ? [] : manualRes.data;

    const prepsTotal = prepIds.size;
    const prepsDone = [...prepIds].filter((id) => checkedPrepByRecipe[id]).length;

    const shoppingTotal = ingredientIds.size + boughtPrepIds.size + manualRows.length;
    const shoppingDone =
        [...ingredientIds].filter((id) => checkedIngredient[id]).length +
        [...boughtPrepIds].filter((id) => checkedPrepByRecipe[id]).length +
        manualRows.filter((m) => m.is_checked).length;

    return { prepsTotal, prepsDone, shoppingTotal, shoppingDone };
}

function renderProgressBar(parent, label, done, total, href) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const row = document.createElement("a");
    row.className = "hm-progress-row";
    row.href = href;
    const top = document.createElement("div");
    top.className = "hm-progress-top";
    addText(top, "span", "", label);
    addText(top, "span", "hm-progress-count", `${done} из ${total}`);
    row.appendChild(top);
    const track = document.createElement("div");
    track.className = "hm-progress-track";
    const fill = document.createElement("div");
    fill.className = "hm-progress-fill" + (pct >= 100 ? " done" : "");
    fill.style.width = pct + "%";
    track.appendChild(fill);
    row.appendChild(track);
    parent.appendChild(row);
}

// ---- Недавняя активность — последние изменённые рецепты (updated_at) и добавленные
// позиции сырья (created_at). Разная семантика полей, поэтому каждая строка помечена типом. ----

async function loadRecentActivity() {
    const list = document.getElementById("recentList");
    if (!list) return;

    const [recRes, ingRes] = await Promise.all([
        db.from("recipes").select("id, name, is_prep, subtype, updated_at").order("updated_at", { ascending: false }).limit(6),
        db.from("ingredients").select("id, name, created_at").order("created_at", { ascending: false }).limit(6),
    ]);

    const items = [];
    if (!recRes.error) {
        (recRes.data || []).forEach((r) => items.push({
            kind: r.is_prep ? "заготовка" : (isShot(r) ? "шот" : "коктейль"),
            name: r.name,
            time: r.updated_at,
            href: "recipes-v2.html",
        }));
    }
    if (!ingRes.error) {
        (ingRes.data || []).forEach((i) => items.push({
            kind: "сырьё",
            name: i.name,
            time: i.created_at,
            href: "ingredients-v2.html",
        }));
    }
    items.sort((a, b) => (a.time < b.time ? 1 : -1));

    list.innerHTML = "";
    if (items.length === 0) {
        addText(list, "div", "bc-empty", "Пока пусто.");
        return;
    }
    items.slice(0, 7).forEach((it) => {
        const row = document.createElement("a");
        row.className = "hm-recent-row";
        row.href = it.href;
        addText(row, "span", "hm-recent-kind", it.kind);
        addText(row, "span", "hm-recent-name", it.name);
        addText(row, "span", "hm-recent-time", timeAgoText(it.time));
        list.appendChild(row);
    });
}

// ---- Ближайшие события — короткий список того, что идёт СЛЕДОМ за выделенным на главной
// карточке (её саму сюда не дублируем). ----

function renderUpcomingList(events, excludeId) {
    const list = document.getElementById("upcomingList");
    if (!list) return;
    list.innerHTML = "";

    const todayStr = new Date().toISOString().slice(0, 10);
    const upcoming = events
        .filter((e) => e.id !== excludeId && e.event_date && e.event_date >= todayStr)
        .sort((a, b) => (a.event_date < b.event_date ? -1 : 1))
        .slice(0, 4);

    if (upcoming.length === 0) {
        addText(list, "div", "bc-empty", "Больше ближайших мероприятий нет.");
        return;
    }
    upcoming.forEach((ev) => {
        const row = document.createElement("a");
        row.className = "hm-upcoming-row";
        row.href = "event-v2.html?id=" + ev.id;
        addText(row, "span", "hm-upcoming-date", formatDate(ev.event_date));
        const nameWrap = document.createElement("span");
        nameWrap.className = "hm-upcoming-name";
        addText(nameWrap, "strong", "", ev.name);
        const metaParts = [];
        if (ev.guests_count) metaParts.push(`${ev.guests_count} ${pluralize(ev.guests_count, ["гость", "гостя", "гостей"])}`);
        const countdown = daysUntilText(ev.event_date);
        if (countdown) metaParts.push(countdown);
        if (metaParts.length) addText(nameWrap, "span", "hm-upcoming-meta", metaParts.join(" · "));
        row.appendChild(nameWrap);
        list.appendChild(row);
    });
}

async function loadEventCard(recipeRows) {
    const el = document.getElementById("latestEventSummary");
    el.innerHTML = "";

    const { data, error } = await db.from("events").select("*");
    if (error) {
        showStatus(statusEl, "Ошибка загрузки мероприятий: " + error.message, "error");
        return;
    }

    const ev = pickHighlightedEvent(data || []);
    renderUpcomingList(data || [], ev ? ev.id : null);
    if (!ev) {
        addText(el, "div", "bc-empty hm-side-empty", "Пока нет ни одного мероприятия.");
        const createBtn = document.createElement("a");
        createBtn.className = "bc-primary-link hm-side-open-btn";
        createBtn.href = "events-v2.html?new=1";
        createBtn.textContent = "+ Создать мероприятие";
        el.appendChild(createBtn);
        return;
    }

    addText(el, "h2", "", ev.name);
    const meta = document.createElement("div");
    meta.className = "hm-side-meta";
    const metaParts = [formatDate(ev.event_date)];
    if (ev.guests_count) metaParts.push(`${ev.guests_count} ${pluralize(ev.guests_count, ["гость", "гостя", "гостей"])}`);
    meta.textContent = metaParts.join(" · ");
    el.appendChild(meta);

    const countdown = ev.event_date ? daysUntilText(ev.event_date) : "черновик — дата не назначена";
    addText(el, "div", "hm-side-countdown", countdown);

    if (ev.comment) addText(el, "div", "hm-side-comment", ev.comment);

    const [menuRes, manualRes] = await Promise.all([
        db.from("event_menu_items").select("qty_portions, recipe:recipes(is_prep, subtype)").eq("event_id", ev.id).eq("included", true),
        db.from("event_manual_items").select("cost").eq("event_id", ev.id),
    ]);

    const section = document.createElement("div");
    section.className = "hm-side-section";

    if (menuRes.error || !menuRes.data || menuRes.data.length === 0) {
        addText(section, "div", "hm-side-progress", "Меню ещё не собрано");
    } else {
        const rows = menuRes.data;
        const preps = rows.filter((r) => r.recipe && r.recipe.is_prep).length;
        const shots = rows.filter((r) => r.recipe && !r.recipe.is_prep && isShot(r.recipe)).length;
        const cocktails = rows.length - preps - shots;
        addText(section, "div", "hm-side-progress", `${rows.length} ${pluralize(rows.length, ["позиция", "позиции", "позиций"])} в меню`);
        const breakdown = [];
        if (cocktails) breakdown.push(`${cocktails} ${pluralize(cocktails, ["коктейль", "коктейля", "коктейлей"])}`);
        if (shots) breakdown.push(`${shots} ${pluralize(shots, ["шот", "шота", "шотов"])}`);
        if (preps) breakdown.push(`${preps} ${pluralize(preps, ["заготовка", "заготовки", "заготовок"])}`);
        if (breakdown.length) addText(section, "div", "hm-side-breakdown", breakdown.join(" · "));
    }

    if (!manualRes.error && manualRes.data && manualRes.data.length > 0) {
        const manualCost = manualRes.data.reduce((sum, m) => sum + (m.cost || 0), 0);
        const manualText = `${manualRes.data.length} ${pluralize(manualRes.data.length, ["позиция", "позиции", "позиций"])} вручную` + (manualCost ? ` — ${formatMoney(manualCost)}` : "");
        addText(section, "div", "hm-side-breakdown", manualText);
    }

    if (ev.plan_budget) addText(section, "div", "hm-side-cost", `Плановый бюджет: ${formatMoney(ev.plan_budget)}`);
    el.appendChild(section);

    const progress = await computeEventProgress(ev.id, recipeRows);
    if (progress && (progress.prepsTotal > 0 || progress.shoppingTotal > 0)) {
        const progressSection = document.createElement("div");
        progressSection.className = "hm-side-section";
        if (progress.prepsTotal > 0) {
            renderProgressBar(progressSection, "Заготовки", progress.prepsDone, progress.prepsTotal, "event-v2.html?id=" + ev.id + "&tab=preps");
        }
        if (progress.shoppingTotal > 0) {
            renderProgressBar(progressSection, "Закупка", progress.shoppingDone, progress.shoppingTotal, "event-v2.html?id=" + ev.id + "&tab=shopping");
        }
        el.appendChild(progressSection);
    }

    const actions = document.createElement("div");
    actions.className = "hm-side-actions";

    const openBtn = document.createElement("a");
    openBtn.className = "bc-primary-link hm-side-open-btn";
    openBtn.href = "event-v2.html?id=" + ev.id;
    openBtn.textContent = "Открыть →";
    actions.appendChild(openBtn);

    const prepsBtn = document.createElement("a");
    prepsBtn.className = "bc-button-link";
    prepsBtn.href = "event-v2.html?id=" + ev.id + "&tab=preps";
    prepsBtn.textContent = "Заготовки";
    actions.appendChild(prepsBtn);

    const shoppingBtn = document.createElement("a");
    shoppingBtn.className = "bc-button-link";
    shoppingBtn.href = "event-v2.html?id=" + ev.id + "&tab=shopping";
    shoppingBtn.textContent = "Закупка";
    actions.appendChild(shoppingBtn);

    el.appendChild(actions);
}

// ---- Попапы (+ добавить / Проблемы) — та же разметка bc-filter/bc-filter-popup/bc-filter-overlay,
// что и у фильтров на других страницах, но без поиска/чекбоксов — просто список ссылок.
//
// В шапке рядом друг с другом стоят две кнопки-триггера (+ добавить / Проблемы) в узкой
// bc-header-actions, которая на средних ширинах переносит их на новую строку (flex-wrap).
// Поповер у bc-filter-popup по умолчанию position:absolute внутри своего .bc-filter —
// он не знает, что сосед перенёсся строкой ниже, и геометрически наезжает на его кнопку.
// Чиним тем, что позиционируем поповер через position:fixed по реальным координатам
// триггера (getBoundingClientRect), а не полагаемся на CSS-якорь внутри шапки. Заодно
// открытие одного поповера закрывает другой — раньше оба могли быть открыты одновременно.

let openPopupHandle = null;

function setupPopup(filterId, triggerId, popupId, overlayId) {
    const filter = document.getElementById(filterId);
    const trigger = document.getElementById(triggerId);
    const popup = document.getElementById(popupId);
    const overlay = document.getElementById(overlayId);

    function reposition() {
        const rect = trigger.getBoundingClientRect();
        const popupWidth = popup.offsetWidth || 280;
        let left = rect.right - popupWidth;
        if (left < 8) left = 8;
        if (left + popupWidth > window.innerWidth - 8) left = window.innerWidth - 8 - popupWidth;
        popup.style.left = left + "px";
        popup.style.top = (rect.bottom + 8) + "px";
    }

    function close() {
        popup.classList.add("hidden");
        overlay.classList.add("hidden");
        filter.classList.remove("open");
        if (openPopupHandle === handle) openPopupHandle = null;
    }
    function open() {
        if (openPopupHandle && openPopupHandle !== handle) openPopupHandle.close();
        popup.classList.remove("hidden");
        overlay.classList.remove("hidden");
        filter.classList.add("open");
        reposition();
        openPopupHandle = handle;
    }

    trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        if (popup.classList.contains("hidden")) open(); else close();
    });
    overlay.addEventListener("click", close);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    window.addEventListener("resize", () => { if (!popup.classList.contains("hidden")) close(); });
    document.querySelector(".bc-list-pane").addEventListener("scroll", () => { if (!popup.classList.contains("hidden")) close(); }, { passive: true });

    const handle = { close, open };
    return handle;
}

async function init() {
    setupPopup("quickAddFilter", "quickAddTrigger", "quickAddPopup", "quickAddOverlay");
    setupPopup("issuesFilter", "issuesTrigger", "issuesPopup", "issuesOverlay");

    if (!isDbConfigured()) {
        showStatus(statusEl, "База данных не подключена", "error");
        return;
    }

    const recipesStats = await loadRecipesStats();
    const ingredientsStats = await loadIngredientsStats();
    await Promise.all([
        loadIssues(recipesStats, ingredientsStats),
        loadEventCard(recipesStats ? recipesStats.rows : null),
        loadRecentActivity(),
    ]);
}

init();

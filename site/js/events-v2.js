// Список мероприятий (v2) — полностью независимый от js/events.js (тот остаётся для
// старой events.html), так как здесь другой визуальный язык карточек (bc-recipe-row,
// как на странице "Рецепты", без эмодзи, с круглой кнопкой копирования).

const statusEl = document.getElementById("status");
const eventGrid = document.getElementById("eventGrid");
const addOverlay = document.getElementById("addOverlay");
const addModalTitle = document.getElementById("addModalTitle");

let eventsList = [];
let copySourceId = null; // если задан — при сохранении копируем состав барной карты из этого мероприятия

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

async function loadEvents() {
    const { data, error } = await db.from("events").select("*").order("event_date", { ascending: false, nullsFirst: false });
    if (error) {
        showStatus(statusEl, "Ошибка загрузки: " + error.message, "error");
        return;
    }
    eventsList = data;
    renderGrid();
    renderLatestSummary();
}

// Сводка по верхнему (последнему по дате) мероприятию в правой колонке на десктопе —
// та же колонка (.bc-detail-pane), что занята карточкой рецепта на других страницах.
// Полный пересчёт по рецептам/заготовкам сюда не тащим (это отдельный расчётный движок
// event-calc-v2.js, специфичный для страницы одного мероприятия) — только количество
// позиций в барной карте, отдельным лёгким запросом.
async function renderLatestSummary() {
    const el = document.getElementById("latestEventSummary");
    if (!el) return;
    el.innerHTML = "";
    const ev = eventsList[0];
    if (!ev) {
        addText(el, "div", "bc-empty ev-side-empty", "Пока нет ни одного мероприятия.");
        return;
    }

addText(el, "h2", "", ev.name);
    const meta = document.createElement("div");
    meta.className = "ev-side-meta";
    const metaParts = [formatDate(ev.event_date)];
    if (ev.guests_count) metaParts.push(`${ev.guests_count} ${pluralize(ev.guests_count, ["гость", "гостя", "гостей"])}`);
    meta.textContent = metaParts.join(" · ");
    el.appendChild(meta);

    const countdown = daysUntilText(ev.event_date);
    if (countdown) addText(el, "div", "ev-side-countdown", countdown);

    if (ev.comment) addText(el, "div", "ev-side-comment", ev.comment);

    // Полный пересчёт стоимости/заготовок сюда не тащим (это отдельный расчётный движок
    // event-calc-v2.js, специфичный для страницы одного мероприятия) — только лёгкие
    // запросы: разбивка меню по типу рецепта и позиции, добавленные вручную в закупках.
    const [menuRes, manualRes] = await Promise.all([
        db.from("event_menu_items").select("qty_portions, recipe:recipes(is_prep, subtype)").eq("event_id", ev.id).eq("included", true),
        db.from("event_manual_items").select("cost").eq("event_id", ev.id),
    ]);

    const section = document.createElement("div");
    section.className = "ev-side-section";

    if (menuRes.error || !menuRes.data || menuRes.data.length === 0) {
        addText(section, "div", "ev-side-progress", "Меню ещё не собрано");
    } else {
        const rows = menuRes.data;
        const preps = rows.filter((r) => r.recipe && r.recipe.is_prep).length;
        const shots = rows.filter((r) => r.recipe && !r.recipe.is_prep && r.recipe.subtype === "шот").length;
        const cocktails = rows.length - preps - shots;
        addText(section, "div", "ev-side-progress", `${rows.length} ${pluralize(rows.length, ["позиция", "позиции", "позиций"])} в меню`);
        const breakdown = [];
        if (cocktails) breakdown.push(`${cocktails} ${pluralize(cocktails, ["коктейль", "коктейля", "коктейлей"])}`);
        if (shots) breakdown.push(`${shots} ${pluralize(shots, ["шот", "шота", "шотов"])}`);
        if (preps) breakdown.push(`${preps} ${pluralize(preps, ["заготовка", "заготовки", "заготовок"])}`);
        if (breakdown.length) addText(section, "div", "ev-side-breakdown", breakdown.join(" · "));
    }

    if (!manualRes.error && manualRes.data && manualRes.data.length > 0) {
        const manualCost = manualRes.data.reduce((sum, m) => sum + (m.cost || 0), 0);
        const manualText = `${manualRes.data.length} ${pluralize(manualRes.data.length, ["позиция", "позиции", "позиций"])} вручную` + (manualCost ? ` — ${formatMoney(manualCost)}` : "");
        addText(section, "div", "ev-side-breakdown", manualText);
    }

    if (ev.plan_budget) addText(section, "div", "ev-side-cost", `Плановый бюджет: ${formatMoney(ev.plan_budget)}`);
    el.appendChild(section);

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "bc-primary-link ev-side-open-btn";
    openBtn.textContent = "Открыть мероприятие →";
    openBtn.onclick = () => { window.location.href = "event-v2.html?id=" + ev.id; };
    el.appendChild(openBtn);
}

function renderGrid() {
    eventGrid.innerHTML = "";
    if (eventsList.length === 0) {
        addText(eventGrid, "div", "bc-empty", "Пока нет ни одного мероприятия — создайте первое.");
        return;
    }
    eventsList.forEach((ev, index) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "bc-recipe-row ev-list-row";
        row.onclick = () => { window.location.href = "event-v2.html?id=" + ev.id; };

        const top = document.createElement("span");
        top.className = "bc-row-top";
        addText(top, "span", "bc-index", String(index + 1).padStart(2, "0"));

        const title = document.createElement("span");
        title.className = "bc-row-title";
        addText(title, "strong", "", ev.name);
        const metaParts = [formatDate(ev.event_date)];
        if (ev.guests_count) metaParts.push(`${ev.guests_count} ${pluralize(ev.guests_count, ["гость", "гостя", "гостей"])}`);
        addText(title, "span", "", metaParts.join(" · "));
        top.appendChild(title);
        row.appendChild(top);

        const actions = document.createElement("span");
        actions.className = "ev-list-actions";

        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "ev-list-copy-btn";
        copyBtn.title = "Скопировать в новое мероприятие";
        copyBtn.setAttribute("aria-label", "Скопировать в новое мероприятие");
        copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/></svg>';
        copyBtn.onclick = (e) => { e.stopPropagation(); openCopyModal(ev); };
        actions.appendChild(copyBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "ev-list-copy-btn ev-list-delete-btn";
        deleteBtn.title = "Удалить мероприятие";
        deleteBtn.setAttribute("aria-label", "Удалить мероприятие");
        deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 7h14M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M7.5 7l.8 12a2 2 0 0 0 2 1.9h3.4a2 2 0 0 0 2-1.9l.8-12"/></svg>';
        deleteBtn.onclick = (e) => { e.stopPropagation(); openDeleteConfirm(ev); };
        actions.appendChild(deleteBtn);

        row.appendChild(actions);

        eventGrid.appendChild(row);
    });
}

function resetForm() {
    document.getElementById("fName").value = "";
    document.getElementById("fDate").value = "";
    document.getElementById("fGuests").value = "";
    document.getElementById("fBudget").value = "";
    document.getElementById("fComment").value = "";
}

function openAddModal() {
    copySourceId = null;
    addModalTitle.textContent = "Новое мероприятие";
    document.getElementById("fSaveBtn").textContent = "Создать мероприятие";
    resetForm();
    addOverlay.classList.remove("hidden");
}

function openCopyModal(ev) {
    copySourceId = ev.id;
    addModalTitle.textContent = `Копия «${ev.name}»`;
    document.getElementById("fSaveBtn").textContent = "Создать копию";
    resetForm();
    document.getElementById("fName").value = ev.name + " (копия)";
    document.getElementById("fGuests").value = ev.guests_count ?? "";
    document.getElementById("fBudget").value = ev.plan_budget ?? "";
    document.getElementById("fComment").value = ev.comment ?? "";
    addOverlay.classList.remove("hidden");
}

const deleteConfirmOverlay = document.getElementById("deleteConfirmOverlay");
const deleteConfirmMessage = document.getElementById("deleteConfirmMessage");

function openDeleteConfirm(ev) {
    deleteConfirmMessage.textContent = `Вы действительно хотите удалить «${ev.name}»? Это действие необратимо — вместе с ним удалятся меню, заготовки и закупки.`;
    deleteConfirmOverlay.classList.remove("hidden");
    document.getElementById("deleteConfirmOkBtn").onclick = async () => {
        deleteConfirmOverlay.classList.add("hidden");
        eventsList = eventsList.filter((e) => e.id !== ev.id);
        renderGrid();
        renderLatestSummary();
        const { error } = await db.from("events").delete().eq("id", ev.id);
        if (error) showStatus(statusEl, "Не получилось удалить: " + error.message, "error");
    };
}

document.getElementById("deleteConfirmCloseBtn").onclick = () => deleteConfirmOverlay.classList.add("hidden");
document.getElementById("deleteConfirmCancelBtn").onclick = () => deleteConfirmOverlay.classList.add("hidden");
deleteConfirmOverlay.addEventListener("click", (e) => { if (e.target === deleteConfirmOverlay) deleteConfirmOverlay.classList.add("hidden"); });

document.getElementById("addEventBtn").onclick = openAddModal;
document.getElementById("addCloseBtn").onclick = () => addOverlay.classList.add("hidden");
addOverlay.addEventListener("click", (e) => { if (e.target === addOverlay) addOverlay.classList.add("hidden"); });

document.getElementById("fSaveBtn").onclick = async () => {
    const name = document.getElementById("fName").value.trim();
    if (!name) { showStatus(statusEl, "Заполните название мероприятия", "error"); return; }

    const values = {
        name,
        event_date: document.getElementById("fDate").value || null,
        guests_count: document.getElementById("fGuests").value.trim() ? Number(document.getElementById("fGuests").value) : null,
        plan_budget: document.getElementById("fBudget").value.trim() ? Number(String(document.getElementById("fBudget").value).replace(",", ".")) : null,
        comment: document.getElementById("fComment").value.trim() || null,
    };

    const { data: inserted, error } = await db.from("events").insert(values).select("id").single();
    if (error) { showStatus(statusEl, "Не получилось создать: " + error.message, "error"); return; }

    if (copySourceId) {
        const { data: sourceItems, error: itemsErr } = await db.from("event_menu_items").select("recipe_id, included, qty_portions").eq("event_id", copySourceId);
        if (!itemsErr && sourceItems.length > 0) {
            const toInsert = sourceItems.map((it) => ({ event_id: inserted.id, recipe_id: it.recipe_id, included: it.included, qty_portions: it.qty_portions }));
            await db.from("event_menu_items").insert(toInsert);
        }
    }

    window.location.href = "event-v2.html?id=" + inserted.id;
};

// Глазик переключения версии — рядом с "+ новое событие", а не в углу экрана (см. тот же
// приём на event-v2.html: position:sticky держит его на месте при скролле, но в потоке
// разметки он стоит вплотную к кнопке).
function setupInlineVersionToggle() {
    const btn = document.getElementById("versionToggleBtn");
    const actions = document.querySelector(".bc-header-actions");
    if (!btn || !actions) return;
    actions.appendChild(btn);
    btn.classList.add("ev-inline-toggle");
}

async function init() {
    setupInlineVersionToggle();
    if (!isDbConfigured()) {
        showStatus(statusEl, "База данных не подключена", "error");
        return;
    }
    await loadEvents();

    // Быстрое добавление с главной (index-v2.html?new=1 -> events-v2.html?new=1) —
    // сразу открывает форму нового мероприятия, не требуя лишнего клика.
    if (new URLSearchParams(location.search).get("new") === "1") openAddModal();
}

init();

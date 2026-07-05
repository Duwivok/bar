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

        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "ev-list-copy-btn";
        copyBtn.title = "Скопировать в новое мероприятие";
        copyBtn.setAttribute("aria-label", "Скопировать в новое мероприятие");
        copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/></svg>';
        copyBtn.onclick = (e) => { e.stopPropagation(); openCopyModal(ev); };
        row.appendChild(copyBtn);

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

async function init() {
    if (!isDbConfigured()) {
        showStatus(statusEl, "База данных не подключена", "error");
        return;
    }
    await loadEvents();
}

init();

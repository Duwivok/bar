const statusEl = document.getElementById("status");
const eventGrid = document.getElementById("eventGrid");
const addOverlay = document.getElementById("addOverlay");
const addModalTitle = document.getElementById("addModalTitle");

let eventsList = [];
let copySourceId = null; // если задан — при сохранении копируем состав барной карты из этого мероприятия

// v2-список теперь использует отдельный js/events-v2.js — этот файл только для events.html (v1).
const eventDetailPage = "event.html";

function formatDate(d) {
    if (!d) return "без даты";
    const [y, m, day] = d.split("-");
    return `${day}.${m}.${y}`;
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
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "Пока нет ни одного мероприятия — создайте первое.";
        eventGrid.appendChild(empty);
        return;
    }
    eventsList.forEach((ev) => {
        const card = document.createElement("div");
        card.className = "recipe-card";
        card.onclick = () => { window.location.href = eventDetailPage + "?id=" + ev.id; };

        const icon = document.createElement("div");
        icon.className = "icon";
        icon.textContent = "🎉";
        card.appendChild(icon);

        const name = document.createElement("div");
        name.className = "name";
        name.textContent = ev.name;
        card.appendChild(name);

        const meta = document.createElement("div");
        meta.className = "spirit";
        meta.textContent = [formatDate(ev.event_date), ev.guests_count ? `${ev.guests_count} гостей` : null].filter(Boolean).join(" · ");
        card.appendChild(meta);

        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.textContent = "Скопировать в новое мероприятие";
        copyBtn.style.marginTop = "6px";
        copyBtn.onclick = (e) => { e.stopPropagation(); openCopyModal(ev); };
        card.appendChild(copyBtn);

        eventGrid.appendChild(card);
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

    window.location.href = eventDetailPage + "?id=" + inserted.id;
};

async function init() {
    if (!isDbConfigured()) {
        showStatus(statusEl, "База данных не подключена", "error");
        return;
    }
    await loadEvents();
}

init();

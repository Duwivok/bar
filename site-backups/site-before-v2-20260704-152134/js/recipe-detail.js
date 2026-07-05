// Универсальный оверлей карточки рецепта с вложенной навигацией (хлебные крошки).
// Переиспользуется на страницах "Рецепты" и "Мероприятие" — обе загружают recipesById/
// itemsByRecipe/tagsByRecipe в одинаковом формате (см. loadAll() в recipes.js и event.js),
// поэтому оверлею не нужны собственные копии этих данных — только геттеры к чужим.
// Требует в разметке страницы: #detailOverlay > .overlay-panel с #breadcrumbs, #detailContent,
// #detailCloseBtn и (опционально) #detailEditBtn.
function createRecipeDetailOverlay({ getRecipe, getItems, getTags, onEdit }) {
    const overlay = document.getElementById("detailOverlay");
    const breadcrumbsEl = document.getElementById("breadcrumbs");
    const detailContent = document.getElementById("detailContent");
    const editBtn = document.getElementById("detailEditBtn");
    const closeBtn = document.getElementById("detailCloseBtn");

    let navStack = [];

    function open(id) {
        navStack = [id];
        overlay.classList.remove("hidden");
        render();
    }

    function push(id) {
        if (navStack[navStack.length - 1] === id) return;
        navStack.push(id);
        render();
    }

    function close() {
        navStack = [];
        overlay.classList.add("hidden");
    }

    function render() {
        const currentId = navStack[navStack.length - 1];
        const r = getRecipe(currentId);
        if (!r) { close(); return; }

        if (editBtn) {
            if (onEdit) {
                editBtn.style.display = "";
                editBtn.onclick = () => onEdit(r.id);
            } else {
                editBtn.style.display = "none";
            }
        }

        breadcrumbsEl.innerHTML = "";
        navStack.forEach((id, idx) => {
            const isLast = idx === navStack.length - 1;
            const rec = getRecipe(id);
            const btn = document.createElement("button");
            btn.textContent = rec ? rec.name : "?";
            btn.disabled = isLast;
            if (!isLast) {
                btn.onclick = () => { navStack = navStack.slice(0, idx + 1); render(); };
                breadcrumbsEl.appendChild(btn);
                breadcrumbsEl.appendChild(document.createTextNode(" › "));
            } else {
                breadcrumbsEl.appendChild(btn);
            }
        });

        detailContent.innerHTML = "";

        const title = document.createElement("div");
        title.className = "detail-title";
        title.textContent = r.name;
        detailContent.appendChild(title);

        const subtypeLine = document.createElement("div");
        subtypeLine.className = "detail-subtype";
        subtypeLine.textContent = [r.subtype || (r.is_prep ? "Заготовка" : "Рецепт"), r.main_spirit].filter(Boolean).join(" · ");
        detailContent.appendChild(subtypeLine);

        if (r.is_prep) {
            const yieldLine = document.createElement("div");
            yieldLine.className = "detail-subtype";
            yieldLine.textContent = r.yield_qty
                ? `Выход партии: ${r.yield_qty} ${r.yield_unit || ""}`.trim() + (r.labor_minutes ? ` · ≈ ${r.labor_minutes} мин` : "")
                : "Выход партии не указан — заполните в редактировании, иначе калькуляторы не смогут пересчитать объём";
            detailContent.appendChild(yieldLine);
        }

        const items = getItems(r.id);
        const compTitle = document.createElement("h4");
        compTitle.textContent = "Состав";
        detailContent.appendChild(compTitle);
        const compList = document.createElement("ul");
        compList.className = "composition-list";
        items.forEach((it) => {
            const li = document.createElement("li");
            const left = document.createElement("span");
            left.textContent = it.name;
            const right = document.createElement("span");
            right.textContent = it.is_topup ? "топом" : [it.qty, it.unit].filter((v) => v !== null && v !== undefined && v !== "").join(" ");
            li.appendChild(left);
            li.appendChild(right);
            if (it.isSub && it.targetId) {
                li.classList.add("clickable");
                li.onclick = () => push(it.targetId);
            }
            compList.appendChild(li);
        });
        if (items.length === 0) {
            const li = document.createElement("li");
            li.textContent = "Состав пока не указан";
            compList.appendChild(li);
        }
        detailContent.appendChild(compList);

        if (r.description) {
            const sec = document.createElement("div");
            sec.className = "detail-section";
            const h = document.createElement("h4");
            h.textContent = "Приготовление";
            const p = document.createElement("div");
            p.textContent = r.description;
            sec.appendChild(h);
            sec.appendChild(p);
            detailContent.appendChild(sec);
        }

        if (r.image_url) {
            const img = document.createElement("img");
            img.className = "detail-image";
            img.src = r.image_url;
            img.alt = r.name;
            detailContent.appendChild(img);
        }

        if (r.notes) {
            const sec = document.createElement("div");
            sec.className = "detail-section";
            const h = document.createElement("h4");
            h.textContent = "Заметки / рекомендации";
            const p = document.createElement("div");
            p.textContent = r.notes;
            sec.appendChild(h);
            sec.appendChild(p);
            detailContent.appendChild(sec);
        }

        const tags = getTags(r.id);
        if (tags.length > 0) {
            const sec = document.createElement("div");
            sec.className = "detail-section";
            tags.forEach((t) => {
                const chip = document.createElement("span");
                chip.className = "tag-chip";
                chip.textContent = t;
                sec.appendChild(chip);
            });
            detailContent.appendChild(sec);
        }

        if (r.source_url) {
            const link = document.createElement("a");
            link.className = "source-link";
            link.href = r.source_url;
            link.target = "_blank";
            link.rel = "noopener";
            link.textContent = "Источник →";
            detailContent.appendChild(link);
        }
    }

    closeBtn.onclick = close;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    return { open, push, close };
}

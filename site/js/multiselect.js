// Переиспользуемый мультиселект-фильтр: кнопка -> попап с поиском, чекбоксами и сбросом.
// createMultiselect({ label, onChange }) -> { el, setOptions(names), getSelected(), clear() }

function createMultiselect({ label, onChange }) {
    const root = document.createElement("div");
    root.className = "multiselect";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "multiselect-btn";
    root.appendChild(btn);

    const clearBadge = document.createElement("button");
    clearBadge.type = "button";
    clearBadge.className = "multiselect-clear-badge";
    clearBadge.textContent = "×";
    clearBadge.title = "Сбросить этот фильтр";
    clearBadge.style.display = "none";
    root.appendChild(clearBadge);

    const popup = document.createElement("div");
    popup.className = "multiselect-popup";
    popup.style.display = "none";

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Поиск...";
    searchInput.className = "multiselect-search";
    popup.appendChild(searchInput);
    if (typeof makeSearchClearable === "function") makeSearchClearable(searchInput);

    const listEl = document.createElement("div");
    listEl.className = "multiselect-list";
    popup.appendChild(listEl);

    const footer = document.createElement("div");
    footer.className = "multiselect-footer";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.textContent = "Сбросить";
    clearBtn.className = "multiselect-clear";
    footer.appendChild(clearBtn);
    popup.appendChild(footer);

    root.appendChild(popup);

    let options = [];
    const selected = new Set();

    function updateButtonLabel() {
        btn.textContent = selected.size > 0 ? `${label} (${selected.size})` : label;
        btn.classList.toggle("active", selected.size > 0);
        clearBadge.style.display = selected.size > 0 ? "flex" : "none";
    }

    function renderList() {
        const q = searchInput.value.trim().toLowerCase();
        listEl.innerHTML = "";
        options
            .filter((name) => name.toLowerCase().includes(q))
            .forEach((name) => {
                const row = document.createElement("label");
                row.className = "multiselect-row";
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.checked = selected.has(name);
                cb.onchange = () => {
                    if (cb.checked) selected.add(name);
                    else selected.delete(name);
                    updateButtonLabel();
                    if (onChange) onChange([...selected]);
                };
                row.appendChild(cb);
                const span = document.createElement("span");
                span.textContent = name;
                row.appendChild(span);
                listEl.appendChild(row);
            });
        if (options.length === 0) {
            const empty = document.createElement("div");
            empty.className = "multiselect-empty";
            empty.textContent = "Пока нет вариантов";
            listEl.appendChild(empty);
        }
    }

    searchInput.oninput = renderList;

    clearBtn.onclick = () => {
        selected.clear();
        updateButtonLabel();
        renderList();
        if (onChange) onChange([...selected]);
    };

    clearBadge.onclick = (e) => {
        e.stopPropagation();
        selected.clear();
        updateButtonLabel();
        renderList();
        popup.style.display = "none";
        if (onChange) onChange([...selected]);
    };

    btn.onclick = (e) => {
        e.stopPropagation();
        const isOpen = popup.style.display !== "none";
        document.querySelectorAll(".multiselect-popup").forEach((p) => { p.style.display = "none"; });
        popup.style.display = isOpen ? "none" : "block";
        if (!isOpen) {
            searchInput.value = "";
            renderList();
            searchInput.focus();
        }
    };

    document.addEventListener("click", (e) => {
        if (!root.contains(e.target)) popup.style.display = "none";
    });

    updateButtonLabel();

    return {
        el: root,
        setOptions(names) {
            options = [...new Set(names)].sort((a, b) => a.localeCompare(b, "ru"));
            const stillValid = new Set([...selected].filter((s) => options.includes(s)));
            if (stillValid.size !== selected.size) {
                selected.clear();
                stillValid.forEach((s) => selected.add(s));
                updateButtonLabel();
            }
            renderList();
        },
        getSelected() {
            return [...selected];
        },
        clear() {
            selected.clear();
            updateButtonLabel();
            renderList();
        },
    };
}

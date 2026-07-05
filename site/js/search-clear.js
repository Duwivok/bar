// Добавляет крестик очистки в правой части поля поиска — работает с любым <input>,
// оборачивает его в контейнер на лету, крестик появляется только когда есть текст.
function makeSearchClearable(input) {
    if (!input || input.dataset.clearable) return;
    input.dataset.clearable = "1";

    const wrap = document.createElement("div");
    wrap.className = "search-clear-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "search-clear-btn";
    btn.textContent = "×";
    btn.tabIndex = -1;
    wrap.appendChild(btn);

    function update() {
        btn.style.display = input.value ? "flex" : "none";
    }

    btn.onclick = () => {
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
        update();
    };

    input.addEventListener("input", update);
    update();
}

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".search-input").forEach(makeSearchClearable);
});

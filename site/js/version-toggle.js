// Кнопка-глаз — переключение между старой и новой версией раздела.
// Если для текущей страницы новой версии ещё нет, просто предупреждает об этом.
(function () {
    const ALT_VERSION = {
        "index.html": "index-v2.html",
        "index-v2.html": "index.html",
        "recipes.html": "recipes-v2.html",
        "recipes-v2.html": "recipes.html",
        "calculator.html": "calculator-v2.html",
        "calculator-v2.html": "calculator.html",
        "events.html": "events-v2.html",
        "events-v2.html": "events.html",
        "event.html": "event-v2.html",
        "event-v2.html": "event.html",
        "ingredients.html": "ingredients-v2.html",
        "ingredients-v2.html": "ingredients.html",
        "converter.html": "converter-v2.html",
        "converter-v2.html": "converter.html",
    };

    let path = location.pathname.split("/").pop() || "index.html";
    // Netlify отдаёт красивые URL без расширения (напр. /ingredients вместо
    // /ingredients.html) — без этой нормализации переключатель не находил
    // страницу в ALT_VERSION и всегда ошибочно писал "новой версии ещё нет".
    if (!path.includes(".")) path += ".html";
    const target = ALT_VERSION[path] || null;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "versionToggleBtn";
    btn.setAttribute("aria-label", "Переключить версию интерфейса");
    btn.title = target ? "Переключить версию интерфейса" : "Новая версия этого раздела ещё не готова";
    btn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">' +
        '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/>' +
        '<circle cx="12" cy="12" r="3.2"/>' +
        "</svg>";

    btn.addEventListener("click", () => {
        if (target) {
            // Сохраняем query-строку (напр. ?id=... на странице мероприятия/рецепта) —
            // без этого переключение версии сбрасывало бы, какую именно запись показывать.
            location.href = target + location.search;
            return;
        }
        const message = "Новая версия этого раздела ещё не готова";
        if (typeof showToast === "function") {
            showToast(message, "error");
        } else {
            alert(message);
        }
    });

    const slot = document.getElementById("versionToggleSlot");

    // Кнопку докаем прямо в шапку раздела, рядом с "инструменты"/основным действием
    // (см. #versionToggleSlot в разметке) — она живёт в обычном потоке страницы и
    // уезжает вместе с шапкой при скролле вниз, а не висит поверх всего экрана.
    //
    // Если на странице нет слота (напр. "События") — оставляем старое поведение:
    // фиксированный слой в углу экрана. Слой — отдельный fixed-контейнер на весь
    // экран (pointer-events: none), а сама кнопка внутри него position:absolute;
    // так браузер не пересчитывает position:fixed для самой кнопки на каждый кадр
    // скролла, что раньше вызывало заметное "плавание".
    if (slot) {
        btn.classList.add("docked");
        slot.appendChild(btn);
    } else {
        const fixedLayer = document.createElement("div");
        fixedLayer.id = "versionToggleFixedLayer";
        document.body.appendChild(fixedLayer);
        fixedLayer.appendChild(btn);
    }
})();

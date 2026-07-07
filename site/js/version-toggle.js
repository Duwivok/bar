// Кнопка-глаз — переключение между старой и новой версией раздела.
// Если для текущей страницы новой версии ещё нет, просто предупреждает об этом.
(function () {
    const ALT_VERSION = {
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

    // На десктопе шапка раздела никуда не скроллится — кнопку докаем прямо в неё,
    // рядом с "инструменты"/основным действием (см. #versionToggleSlot в разметке),
    // без отдельного фиксированного элемента.
    //
    // На мобильном шапка уезжает вместе со списком при скролле, поэтому кнопку
    // держим в фиксированном слое поверх всей страницы. Слой — это отдельный
    // fixed-контейнер на весь экран (pointer-events: none), а сама кнопка внутри
    // него положением absolute; так браузер не пересчитывает position:fixed для
    // самой кнопки на каждый кадр скролла, что раньше вызывало заметное "плавание".
    let fixedLayer = null;
    function ensureFixedLayer() {
        if (fixedLayer) return fixedLayer;
        fixedLayer = document.createElement("div");
        fixedLayer.id = "versionToggleFixedLayer";
        document.body.appendChild(fixedLayer);
        return fixedLayer;
    }

    const isDesktop = () => window.matchMedia("(min-width: 1081px)").matches;

    // "Единицы" и "Калькулятор" докаем всегда, даже на мобильном: контент тут не такой
    // длинный, как в "Рецептах"/"Сырье", и плавающая поверх всего кнопка либо закрывала
    // цифры конвертера, либо просто мешала — пользователь явно просил, чтобы глазик
    // прокручивался вместе со страницей и пропадал из виду при скролле вниз.
    const ALWAYS_DOCK_PAGES = ["converter-v2.html", "calculator-v2.html"];
    const alwaysDock = ALWAYS_DOCK_PAGES.includes(path);

    function place() {
        if (slot && (alwaysDock || isDesktop())) {
            btn.classList.add("docked");
            slot.appendChild(btn);
        } else {
            btn.classList.remove("docked");
            ensureFixedLayer().appendChild(btn);
        }
    }

    place();

    let resizeTimer = null;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(place, 150);
    });
})();

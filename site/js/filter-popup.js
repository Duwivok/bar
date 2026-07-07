// Общее позиционирование выпадающих .bc-filter-popup на мобильном (Рецепты/Сырьё/События).
// Перепробовали: жёстко к низу экрана (закрывала появившаяся клавиатура), жёстко к 74px
// (перекрывал соседние кнопки той же строки фильтров), от положения самой кнопки-триггера
// (при малом числе результатов после поиска попап получался коротким и мог оказаться почти
// у низа экрана — не предсказуемо для пользователя). Теперь якорь — низ ВСЕЙ панели фильтров
// (.bc-recipes-sticky), а не конкретной кнопки: попап всегда открывается в одном и том же
// месте, сразу под всей строкой фильтров, не перекрывая соседние кнопки и не уезжая вниз,
// даже если под ним оказывается только 1-2 варианта.
const FILTER_POPUP_MOBILE_QUERY = window.matchMedia("(max-width: 1080px)");

function positionFilterPopup(trigger, popup) {
    popup._filterTrigger = trigger;
    if (!FILTER_POPUP_MOBILE_QUERY.matches) {
        popup.style.position = "";
        popup.style.top = "";
        popup.style.bottom = "";
        popup.style.left = "";
        popup.style.right = "";
        popup.style.maxHeight = "";
        return;
    }

    const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const anchor = trigger.closest(".bc-recipes-sticky") || trigger;
    const rect = anchor.getBoundingClientRect();
    const margin = 12;
    const spaceBelow = viewportHeight - rect.bottom - margin;

    popup.style.position = "fixed";
    popup.style.left = margin + "px";
    popup.style.right = margin + "px";
    popup.style.width = "auto";
    popup.style.top = (rect.bottom + 8) + "px";
    popup.style.bottom = "auto";
    popup.style.maxHeight = Math.max(120, spaceBelow - 8) + "px";
}

function repositionOpenFilterPopup() {
    const popup = document.querySelector(".bc-filter-popup:not(.hidden)");
    if (popup && popup._filterTrigger) positionFilterPopup(popup._filterTrigger, popup);
}

window.addEventListener("resize", repositionOpenFilterPopup);
if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", repositionOpenFilterPopup);
    window.visualViewport.addEventListener("scroll", repositionOpenFilterPopup);
}

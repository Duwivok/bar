// Данные подключения к вашей базе в Supabase.
// Project Settings -> API -> Project URL и anon public key.
const SUPABASE_URL = "https://pkjbepsvqrdvqluydmpr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_A1RIxLYkJmqRj2m7U0a4NA_G20D63VJ";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function isDbConfigured() {
    return !SUPABASE_URL.startsWith("ВСТАВЬТЕ") && !SUPABASE_ANON_KEY.startsWith("ВСТАВЬТЕ");
}

function showStatus(el, message, kind) {
    el.textContent = message;
    el.className = "status " + (kind || "info");
    el.style.display = message ? "block" : "none";
}

// Маленькое всплывающее уведомление снизу экрана — не мешает работать дальше,
// само пропадает через пару секунд, новое всегда заменяет предыдущее (не копится стопкой).
// Если предыдущее ещё видно — сначала быстро гаснет оно, потом появляется новое.
let toastHideTimer = null;
let toastSwapTimer = null;
function showToast(message, kind) {
    let el = document.getElementById("toastNotice");
    if (!el) {
        el = document.createElement("div");
        el.id = "toastNotice";
        document.body.appendChild(el);
    }
    clearTimeout(toastHideTimer);
    clearTimeout(toastSwapTimer);

    const present = () => {
        el.textContent = message;
        el.className = "toast " + (kind || "info");
        void el.offsetWidth; // форсируем перерисовку, чтобы анимация появления сыграла заново
        el.classList.add("show");
        toastHideTimer = setTimeout(() => { el.classList.remove("show"); }, 1000);
    };

    if (el.classList.contains("show")) {
        el.classList.remove("show"); // короткое затухание прошлого уведомления
        toastSwapTimer = setTimeout(present, 80);
    } else {
        present();
    }
}

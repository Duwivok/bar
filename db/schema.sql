-- Схема базы данных для барного калькулятора.
-- Выполняется один раз в Supabase: SQL Editor -> New query -> вставить весь файл -> Run.

create extension if not exists "pgcrypto";

-- Ингредиенты: и сырьё (ром, сахар, мята), и заготовки как позиции номенклатуры.
-- Одновременно служит справочником закупки (цена/упаковка) — в старом файле это были два разных листа.
create table ingredients (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    category text,                 -- Алкоголь / Соки / Зелень / Сухие / Прочее ...
    base_unit text,                -- мл / г / шт — единица, в которой считаем расход
    purchase_unit text,            -- бутылка / упаковка / кг ...
    package_size numeric,          -- сколько base_unit в одной упаковке (напр. 700 мл в бутылке)
    package_price numeric,         -- цена за упаковку
    purchase_link text,
    comment text,
    updated_at timestamptz not null default now()
);

-- Конвертация нестандартных единиц рецепта в base_unit конкретного ингредиента.
-- Пример: Мята, из "веточка" в "г", коэффициент 2.
create table unit_conversions (
    id uuid primary key default gen_random_uuid(),
    ingredient_id uuid not null references ingredients(id) on delete cascade,
    from_unit text not null,
    coefficient numeric not null,  -- 1 "from_unit" = coefficient * base_unit
    comment text,
    unique (ingredient_id, from_unit)
);

-- Рецепты: и позиции меню (коктейль/шот/настойка), и заготовки (сироп/кордиал/пребэтч/лимонад/...).
-- is_prep=true -> это заготовка: у неё есть выход партии и трудоёмкость, её саму можно использовать как ингредиент в других рецептах.
-- is_prep=false -> подаётся гостю напрямую, в барную карту мероприятия попадают только такие.
create table recipes (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    type text not null,            -- Коктейль / Шот / Настойка / Сироп / Кордиал / Пребэтч / Лимонад / Гарнир ...
    is_prep boolean not null default false,
    yield_qty numeric,             -- выход одной партии (для заготовок), напр. 1000
    yield_unit text,                -- мл
    labor_minutes numeric,          -- базовая трудоёмкость приготовления одной партии, мин
    comment text,
    updated_at timestamptz not null default now()
);

-- Состав рецепта: одна строка = один ингредиент ИЛИ одна вложенная заготовка.
-- Ровно одно из ingredient_id / sub_recipe_id должно быть заполнено.
create table recipe_items (
    id uuid primary key default gen_random_uuid(),
    recipe_id uuid not null references recipes(id) on delete cascade,
    ingredient_id uuid references ingredients(id),
    sub_recipe_id uuid references recipes(id),
    qty numeric,                    -- количество; NULL если is_topup = true
    unit text,
    is_topup boolean not null default false,      -- "долить до объёма" (напр. содовая топом)
    topup_default_qty numeric,       -- сколько считать при расчёте закупки, если is_topup = true
    comment text,
    check (
        (ingredient_id is not null and sub_recipe_id is null)
        or (ingredient_id is null and sub_recipe_id is not null)
    )
);

-- Мероприятия: под каждое мероприятие — своя барная карта (можно хранить историю).
create table events (
    id uuid primary key default gen_random_uuid(),
    name text not null,             -- напр. "Свадьба 12.07.2026"
    event_date date,
    guests_count integer,
    comment text,
    created_at timestamptz not null default now()
);

-- Барная карта мероприятия: что подаём и в каком количестве.
create table event_menu_items (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null references events(id) on delete cascade,
    recipe_id uuid not null references recipes(id),
    included boolean not null default true,
    qty_portions numeric not null default 0,
    unique (event_id, recipe_id)
);

-- Индексы для быстрого поиска состава по рецепту и обратных ссылок.
create index on recipe_items (recipe_id);
create index on recipe_items (sub_recipe_id);
create index on event_menu_items (event_id);

-- Пока один пользователь — RLS (построчную защиту) не включаем.
-- Когда понадобится пускать персонал с ограниченным доступом, добавим политики отдельно.

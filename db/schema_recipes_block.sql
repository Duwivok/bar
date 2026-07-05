-- Дополнение схемы под блок "Рецепты" (v1).
-- Выполняется один раз в Supabase: SQL Editor -> New query -> вставить весь файл -> Run.
-- Применяется поверх уже накатанного schema.sql.

alter table recipes add column if not exists subtype text;              -- Шот/Лонг/Сауэр/... или Пена/Гарниш/Кордиал/...
alter table recipes add column if not exists main_spirit text;         -- название основного алкоголя (свободный текст — это может быть и сырьё, и своя настойка/кастом-алкоголь)
alter table recipes add column if not exists description text;         -- инструкция приготовления
alter table recipes add column if not exists notes text;                -- заметки/рекомендации
alter table recipes add column if not exists image_url text;            -- ссылка на картинку
alter table recipes add column if not exists source_url text;           -- ссылка на источник рецепта

create table if not exists tags (
    id uuid primary key default gen_random_uuid(),
    name text not null unique
);

create table if not exists recipe_tags (
    recipe_id uuid not null references recipes(id) on delete cascade,
    tag_id uuid not null references tags(id) on delete cascade,
    primary key (recipe_id, tag_id)
);

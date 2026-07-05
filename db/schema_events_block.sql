-- Дополнение схемы под блок "Мероприятия" (v1).
-- Выполняется один раз в Supabase: SQL Editor -> New query -> вставить весь файл -> Run.
-- Применяется поверх уже накатанного schema.sql + schema_recipes_block.sql.

alter table events add column if not exists plan_budget numeric;

-- Чек-лист закупки под конкретное мероприятие: какие позиции сырья уже куплены.
create table if not exists event_ingredient_state (
    event_id uuid not null references events(id) on delete cascade,
    ingredient_id uuid not null references ingredients(id) on delete cascade,
    is_checked boolean not null default false,
    primary key (event_id, ingredient_id)
);

-- Чек-лист заготовок под мероприятие: тара (ад-хок, мл), готовность, разворот вложенных заготовок.
create table if not exists event_prep_state (
    event_id uuid not null references events(id) on delete cascade,
    recipe_id uuid not null references recipes(id) on delete cascade,
    container_size numeric,
    is_checked boolean not null default false,
    expand_nested boolean not null default false,
    primary key (event_id, recipe_id)
);

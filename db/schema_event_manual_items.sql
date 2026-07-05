-- Ручные позиции в списке покупок мероприятия — то, что не выводится из состава рецептов
-- (лёд, салфетки, разовая посуда, что угодно ещё), но всё равно нужно учитывать в закупке и смете.
-- Выполняется один раз в Supabase: SQL Editor -> New query -> вставить весь файл -> Run.
-- Применяется поверх уже накатанного schema.sql + schema_events_block.sql.

create table if not exists event_manual_items (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null references events(id) on delete cascade,
    name text not null,
    qty numeric,
    unit text,
    category text,
    cost numeric,
    is_checked boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists event_manual_items_event_id_idx on event_manual_items (event_id);

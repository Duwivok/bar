-- Дополнение схемы: возможность "купить готовое" вместо приготовления заготовки.
-- Выполняется один раз в Supabase: SQL Editor -> New query -> вставить весь файл -> Run.
-- Применяется поверх schema.sql + schema_recipes_block.sql + schema_events_block.sql.

-- Закупочные реквизиты заготовки — на случай, если её проще купить готовой, чем готовить самим.
-- Заполняются один раз в карточке рецепта (аналогично упаковке/цене у сырья в номенклатуре).
alter table recipes add column if not exists purchase_unit text;
alter table recipes add column if not exists purchase_package_size numeric;
alter table recipes add column if not exists purchase_package_price numeric;
alter table recipes add column if not exists purchase_category text;   -- категория для группировки в списке покупок
alter table recipes add column if not exists purchase_link text;

-- Решение "готовим сами / покупаем готовое" принимается отдельно на каждое мероприятие.
alter table event_prep_state add column if not exists buy_ready boolean not null default false;

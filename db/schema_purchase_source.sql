-- Источник закупки (Маркетплейс / Магазин / Другое) — отдельное измерение от "категории"
-- товара (Алкоголь/Соки/...): категория — что это, источник — где закупаем.
-- Выполняется один раз в Supabase: SQL Editor -> New query -> вставить весь файл -> Run.
-- Применяется поверх schema.sql + schema_ingredient_packages.sql + schema_buy_ready.sql.

alter table ingredient_packages add column if not exists purchase_source text;
alter table recipes add column if not exists purchase_source text;

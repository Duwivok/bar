-- Автообновление цен для вариантов упаковки.
-- Выполняется в Supabase SQL Editor поверх schema.sql + schema_ingredient_packages.sql + schema_purchase_source.sql.

alter table ingredient_packages add column if not exists price_source_type text not null default 'manual';
alter table ingredient_packages add column if not exists price_source_query text;
alter table ingredient_packages add column if not exists price_source_external_id text;
alter table ingredient_packages add column if not exists price_source_enabled boolean not null default true;
alter table ingredient_packages add column if not exists price_last_checked_at timestamptz;
alter table ingredient_packages add column if not exists price_last_status text;
alter table ingredient_packages add column if not exists price_last_error text;

create index if not exists ingredient_packages_price_source_enabled_idx
on ingredient_packages (price_source_enabled);

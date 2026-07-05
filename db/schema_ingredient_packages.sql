-- Варианты упаковки для позиции номенклатуры (напр. водка 0.5л / 0.7л / 1.0л по разным ценам).
-- Выполняется один раз в Supabase: SQL Editor -> New query -> вставить весь файл -> Run.
-- Применяется поверх уже накатанных schema.sql / schema_recipes_block.sql.

create table if not exists ingredient_packages (
    id uuid primary key default gen_random_uuid(),
    ingredient_id uuid not null references ingredients(id) on delete cascade,
    package_size numeric,          -- напр. 0.7
    package_price numeric,         -- цена за эту упаковку
    purchase_unit text,            -- бутылка / канистра / упаковка ...
    purchase_link text
);

create index if not exists ingredient_packages_ingredient_id_idx on ingredient_packages (ingredient_id);

-- Переносим уже заполненные упаковку/цену с самих ингредиентов как первый вариант.
insert into ingredient_packages (ingredient_id, package_size, package_price, purchase_unit, purchase_link)
select id, package_size, package_price, purchase_unit, purchase_link
from ingredients
where package_size is not null and package_price is not null;

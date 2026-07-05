-- Дата создания позиции номенклатуры — нужна для вкладки "новые" на странице Сырьё v2
-- (по updated_at нельзя было отличить свежедобавленную позицию от просто отредактированной).
-- Выполняется один раз в Supabase: SQL Editor -> New query -> вставить весь файл -> Run.

alter table ingredients add column if not exists created_at timestamptz not null default now();

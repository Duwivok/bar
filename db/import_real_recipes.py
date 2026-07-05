"""
Переносит реальные рецепты (реф. файл "Барный_калькулятор_заполненный_рецептами")
из reference-data/*.csv в Supabase.

Запуск:  python import_real_recipes.py
"""

import csv
import json
import re
import urllib.request
import urllib.error
from pathlib import Path

SUPABASE_URL = "https://pkjbepsvqrdvqluydmpr.supabase.co"
SUPABASE_KEY = "sb_publishable_A1RIxLYkJmqRj2m7U0a4NA_G20D63VJ"

BASE = Path(__file__).resolve().parent.parent / "reference-data"
PREFIX = "Барный_калькулятор_заполненный_рецептами -- "

NOMENKLATURA_CSV = BASE / f"{PREFIX}01_Номенклатура.csv"
VYHODY_CSV = BASE / f"{PREFIX}02_Выходы_рецептов.csv"
RECEPTY_CSV = BASE / f"{PREFIX}03_Рецепты.csv"

TOPUP_DEFAULT_QTY = 100  # мл — плейсхолдер, поправите позже в интерфейсе на реальную цифру
flags = []  # лог всего, что требует ручной проверки


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def to_number(raw):
    if raw is None:
        return None
    raw = raw.strip().replace(",", ".")
    if raw == "":
        return None
    match = re.match(r"^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$", raw)
    if match:
        low, high = float(match.group(1)), float(match.group(2))
        mid = round((low + high) / 2, 3)
        flags.append(f"Диапазон '{raw}' заменён серединой: {mid}")
        return mid
    try:
        return float(raw)
    except ValueError:
        flags.append(f"Не смог разобрать число: '{raw}' — импортировано как пусто")
        return None


def api_request(path, method="GET", body=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", SUPABASE_KEY)
    req.add_header("Authorization", f"Bearer {SUPABASE_KEY}")
    req.add_header("Content-Type", "application/json")
    if method in ("POST", "PATCH"):
        req.add_header("Prefer", "return=representation")
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else []
    except urllib.error.HTTPError as e:
        print(f"  ! Ошибка {method} {path}: {e.code} {e.read().decode('utf-8', 'ignore')}")
        raise


def insert_batch(table, rows):
    if not rows:
        return {}
    inserted = api_request(table, "POST", rows)
    return {row["name"]: row["id"] for row in inserted}


def fetch_existing_map(table):
    existing = api_request(f"{table}?select=id,name", "GET")
    return {row["name"]: row["id"] for row in existing}


def table_row_count(table):
    existing = api_request(f"{table}?select=id", "GET")
    return len(existing)


def main():
    nomenklatura = read_csv(NOMENKLATURA_CSV)
    vyhody = read_csv(VYHODY_CSV)
    recepty = read_csv(RECEPTY_CSV)

    vyhody_by_name = {row["Рецепт"]: row for row in vyhody}

    # 1. Ингредиенты (только "Сырьё" — заготовки пойдут в recipes)
    ingredient_rows = []
    seen_ingredients = set()
    for row in nomenklatura:
        name = row["Номенклатура"].strip()
        if not name or row["Тип"].strip() != "Сырьё" or name in seen_ingredients:
            continue
        seen_ingredients.add(name)
        ingredient_rows.append({
            "name": name,
            "base_unit": row["Базовая ед."].strip() or None,
            "purchase_unit": row["Закупочная ед."].strip() or None,
            "package_size": to_number(row["Размер упаковки"]),
            "package_price": to_number(row["Цена упаковки"]),
            "comment": row["Комментарий"].strip() or None,
        })
    print(f"Ингредиентов в файле: {len(ingredient_rows)}")
    if table_row_count("ingredients") > 0:
        print("  В базе уже есть ингредиенты — пропускаю вставку, использую существующие.")
        ingredient_ids = fetch_existing_map("ingredients")
    else:
        ingredient_ids = insert_batch("ingredients", ingredient_rows)

    # 2. Рецепты (коктейли/шоты/настойки/заготовки), уникальные по названию
    recipe_rows = []
    seen_recipes = set()
    for row in recepty:
        name = row["Рецепт"].strip()
        rtype = row["Тип рецепта"].strip()
        if not name or name in seen_recipes:
            continue
        seen_recipes.add(name)
        vy = vyhody_by_name.get(name, {})
        recipe_rows.append({
            "name": name,
            "type": rtype,
            "is_prep": rtype == "Заготовка",
            "yield_qty": to_number(vy.get("Выход рецепта", "")),
            "yield_unit": (vy.get("Ед. выхода") or "").strip() or None,
            "labor_minutes": None,
            "comment": (vy.get("Комментарий") or "").strip() or None,
        })
    print(f"Рецептов/техкарт в файле: {len(recipe_rows)}")
    if table_row_count("recipes") > 0:
        print("  В базе уже есть рецепты — пропускаю вставку, использую существующие.")
        recipe_ids = fetch_existing_map("recipes")
    else:
        recipe_ids = insert_batch("recipes", recipe_rows)

    # 3. Состав рецептов
    item_rows = []
    for row in recepty:
        recipe_name = row["Рецепт"].strip()
        recipe_id = recipe_ids.get(recipe_name)
        if not recipe_id:
            flags.append(f"Пропущена строка — не найден рецепт '{recipe_name}'")
            continue

        ing_name = row["Ингредиент"].strip()
        ing_type = row["Тип ингредиента"].strip()
        comment_parts = [row["Комментарий"].strip()] if row["Комментарий"].strip() else []

        is_topup = row["Комментарий"].strip() == "топом"
        qty = None if is_topup else to_number(row["Кол-во"])
        unit = row["Ед."].strip() or None

        if not unit and not is_topup:
            comment_parts.append("единица не указана в исходных данных — требует уточнения")
            flags.append(f"{recipe_name} / {ing_name}: нет единицы измерения")

        item = {
            "recipe_id": recipe_id,
            "ingredient_id": None,
            "sub_recipe_id": None,
            "qty": qty,
            "unit": unit,
            "is_topup": is_topup,
            "topup_default_qty": TOPUP_DEFAULT_QTY if is_topup else None,
            "comment": "; ".join(comment_parts) or None,
        }

        if ing_type == "Заготовка":
            sub_id = recipe_ids.get(ing_name)
            if not sub_id:
                flags.append(f"{recipe_name}: не нашёл заготовку '{ing_name}' среди рецептов — строка пропущена")
                continue
            item["sub_recipe_id"] = sub_id
        else:
            ing_id = ingredient_ids.get(ing_name)
            if not ing_id:
                flags.append(f"{recipe_name}: не нашёл сырьё '{ing_name}' в номенклатуре — строка пропущена")
                continue
            item["ingredient_id"] = ing_id

        if qty is not None and qty > 5000:
            flags.append(f"{recipe_name} / {ing_name}: подозрительно большое количество {qty} {unit} — похоже на опечатку, проверьте вручную")

        item_rows.append(item)

    print(f"Строк состава в файле: {len(item_rows)}")
    if table_row_count("recipe_items") > 0:
        print("  В базе уже есть строки состава — пропускаю, чтобы не задублировать. Удалите их вручную, если нужно перезалить.")
    else:
        api_request("recipe_items", "POST", item_rows)

    print("\nГотово.")
    if flags:
        print(f"\nТребует внимания ({len(flags)}):")
        for f in flags:
            print(" -", f)
    else:
        print("Флагов нет.")


if __name__ == "__main__":
    main()

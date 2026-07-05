# Price service

Небольшой независимый backend для проверки цен упаковок. Запускается отдельно от статического сайта.

```powershell
cd price-service
npm start
```

По умолчанию сервис слушает `http://localhost:8787`.

Проверка:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:8787/check-prices -ContentType 'application/json' -Body '{"items":[{"itemId":"lime","itemName":"Лайм","packageId":"pkg1","currentPricePackage":340,"currentPackageSize":1,"currentPackageUnit":"кг","source":{"id":"pkg1","type":"mock","query":"лайм","enabled":true}}]}'
```

Рабочие адаптеры MVP: `mock`, `manual`, `genericHtml`. Магазинные адаптеры пока возвращают `adapter_not_implemented`, кроме `ozon`/`vkusvill` с URL: они осторожно пробуют `genericHtml`.

# Тестирование

Оперативная дока: тестовые учётки, фикстуры, точки проверки. Обновлять при добавлении/смене тестовых данных.

## Тестовый пользователь (локальная БД)

| Поле   | Значение                               |
| ------ | -------------------------------------- |
| Email  | `test@uyutno.dev`                      |
| Пароль | `test1234`                             |
| ID     | `01900000-0000-7000-8000-000000000001` |

Используется для ручной проверки `/login`, session-cookie, гардов, `/auth/me` и т.п. Живёт только в локальной dev-БД (`postgres://uyutno:uyutno@localhost:5432/uyutno`), в проде отсутствует.

### Сброс/обновление пароля

Если хэш в БД разошёлся с этим паролем, пересобрать argon2id теми же параметрами, что в [`src/server/auth/lib/passwords.ts`](../apps/platform/src/server/auth/lib/passwords.ts), и обновить строку:

```bash
# сгенерировать хэш
node --input-type=module -e "import argon2 from 'argon2'; \
  const h = await argon2.hash('test1234', { type: argon2.argon2id, memoryCost: 19*1024, timeCost: 2, parallelism: 1 }); \
  process.stdout.write(h);"

# записать в БД
PGPASSWORD=uyutno psql -h localhost -U uyutno -d uyutno \
  -c "UPDATE users SET password_hash = '<hash>' WHERE email = 'test@uyutno.dev';"
```

### Если пользователя нет

После `docker compose down -v` / пересоздания БД пользователя не будет. Восстановить:

```bash
PGPASSWORD=uyutno psql -h localhost -U uyutno -d uyutno -c \
  "INSERT INTO users (id, email, password_hash) VALUES (
     '01900000-0000-7000-8000-000000000001',
     'test@uyutno.dev',
     '<argon2id-хэш пароля test1234>'
   );"
```

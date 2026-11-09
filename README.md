# CampusSpace

Учебный проект по бронированию аудиторий, коворкингов, переговорных и компьютерных классов. Данные кампуса и учётные записи вымышлены.

Для локального запуска нужны Node.js 24 LTS и pnpm.

```sh
pnpm install
pnpm db:init
```

SQLite создаётся в `data/campusspace.sqlite`. Связи и ограничения описаны в [схеме](src/schema.sql), диаграмма находится в [docs/database.md](docs/database.md).

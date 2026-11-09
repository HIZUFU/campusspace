# Модель данных CampusSpace

SQLite содержит 13 сущностей. Заявка на согласовании удерживает слот до решения администратора или отмены. Время хранится в UTC. Соседние интервалы могут соприкасаться, поскольку конец интервала в него не входит.

```mermaid
erDiagram
    ROLES ||--o{ USERS : grants
    USERS ||--o{ SESSIONS : opens
    BUILDINGS ||--o{ ROOMS : contains
    ROOM_TYPES ||--o{ ROOMS : classifies
    ROOMS ||--o{ ROOM_EQUIPMENT : has
    EQUIPMENT ||--o{ ROOM_EQUIPMENT : links
    ROOMS ||--o{ ROOM_PHOTOS : illustrates
    ROOMS ||--o{ BOOKINGS : reserves
    ROOMS ||--o{ BOOKING_SERIES : repeats
    USERS ||--o{ BOOKINGS : requests
    USERS o|--o{ BOOKINGS : decides
    USERS ||--o{ BOOKING_SERIES : owns
    BOOKING_SERIES o|--|{ BOOKINGS : groups
    BOOKINGS ||--o| REVIEWS : receives
    USERS ||--o{ NOTIFICATIONS : receives
    BOOKINGS ||--o{ NOTIFICATIONS : triggers

    ROLES {
        text id PK
        text name
    }
    USERS {
        int id PK
        text role_id FK
        text email UK
        text name
        text password_hash
        int reminders_enabled
    }
    SESSIONS {
        text token_hash PK
        int user_id FK
        text expires_at
    }
    BUILDINGS {
        int id PK
        text name
        text address
    }
    ROOM_TYPES {
        int id PK
        text name
    }
    ROOMS {
        int id PK
        int building_id FK
        int type_id FK
        text number
        text name
        int floor
        int capacity
        text access_level
        int approval_required
    }
    EQUIPMENT {
        int id PK
        text name
    }
    ROOM_EQUIPMENT {
        int room_id PK,FK
        int equipment_id PK,FK
    }
    ROOM_PHOTOS {
        int id PK
        int room_id FK
        text url
        text alt
    }
    BOOKING_SERIES {
        int id PK
        int user_id FK
        int room_id FK
        int interval_weeks
    }
    BOOKINGS {
        int id PK
        int user_id FK
        int room_id FK
        int series_id FK
        int decision_by FK
        text start_at
        text end_at
        text purpose
        text status
    }
    REVIEWS {
        int id PK
        int booking_id FK,UK
        int cleanliness
        int equipment
        int comfort
        text comment
    }
    NOTIFICATIONS {
        int id PK
        int user_id FK
        int booking_id FK
        text kind
        text created_at
        text read_at
    }
```

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  role_id TEXT NOT NULL REFERENCES roles(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  reminders_enabled INTEGER NOT NULL DEFAULT 1 CHECK (reminders_enabled IN (0, 1))
) STRICT;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS buildings (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS room_types (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
) STRICT;

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY,
  building_id INTEGER NOT NULL REFERENCES buildings(id),
  type_id INTEGER NOT NULL REFERENCES room_types(id),
  number TEXT NOT NULL,
  name TEXT NOT NULL,
  floor INTEGER NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  description TEXT NOT NULL,
  access_notes TEXT NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'all' CHECK (access_level IN ('all', 'staff')),
  approval_required INTEGER NOT NULL DEFAULT 0 CHECK (approval_required IN (0, 1)),
  UNIQUE (building_id, number)
) STRICT;

CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
) STRICT;

CREATE TABLE IF NOT EXISTS room_equipment (
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id),
  PRIMARY KEY (room_id, equipment_id)
) STRICT;

CREATE TABLE IF NOT EXISTS room_photos (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt TEXT NOT NULL,
  UNIQUE (room_id, url)
) STRICT;

CREATE TABLE IF NOT EXISTS booking_series (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  interval_weeks INTEGER NOT NULL DEFAULT 1 CHECK (interval_weeks = 1),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  series_id INTEGER REFERENCES booking_series(id),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected', 'cancelled')),
  decision_by INTEGER REFERENCES users(id),
  decision_note TEXT,
  created_at TEXT NOT NULL,
  CHECK (end_at > start_at)
) STRICT;

CREATE INDEX IF NOT EXISTS bookings_room_schedule ON bookings(room_id, status, start_at, end_at);
CREATE INDEX IF NOT EXISTS bookings_user_schedule ON bookings(user_id, start_at);

CREATE TRIGGER IF NOT EXISTS bookings_prevent_overlap
BEFORE INSERT ON bookings
WHEN NEW.status IN ('pending', 'confirmed') AND EXISTS (
  SELECT 1 FROM bookings
  WHERE room_id = NEW.room_id
    AND status IN ('pending', 'confirmed')
    AND start_at < NEW.end_at AND end_at > NEW.start_at
)
BEGIN
  SELECT RAISE(ABORT, 'slot_taken');
END;

CREATE TRIGGER IF NOT EXISTS bookings_prevent_overlap_on_update
BEFORE UPDATE OF room_id, start_at, end_at, status ON bookings
WHEN NEW.status IN ('pending', 'confirmed') AND EXISTS (
  SELECT 1 FROM bookings
  WHERE id != NEW.id AND room_id = NEW.room_id
    AND status IN ('pending', 'confirmed')
    AND start_at < NEW.end_at AND end_at > NEW.start_at
)
BEGIN
  SELECT RAISE(ABORT, 'slot_taken');
END;

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
  cleanliness INTEGER NOT NULL CHECK (cleanliness BETWEEN 1 AND 5),
  equipment INTEGER NOT NULL CHECK (equipment BETWEEN 1 AND 5),
  comfort INTEGER NOT NULL CHECK (comfort BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  kind TEXT NOT NULL CHECK (kind IN ('pending', 'confirmed', 'rejected', 'cancelled', 'reminder')),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE (user_id, booking_id, kind)
) STRICT;

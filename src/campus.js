import { randomBytes } from 'node:crypto';
import { hashToken, transaction, verifyPassword } from './db.js';
import { campusDate, dayMs, daySlots, hoursFor, iso, slotMs, timezone } from './schedule.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function assert(condition, status, message) {
  if (!condition) throw new HttpError(status, message);
}

const active = "status IN ('pending', 'confirmed')";
const profile = 'id, name, email, role_id AS role, reminders_enabled AS reminders';
const bookingSelect = `
  SELECT b.id, b.series_id AS seriesId, b.room_id AS roomId, b.start_at AS startAt,
    b.end_at AS endAt, b.status, b.purpose, b.decision_note AS decisionNote,
    r.name AS room, r.number, buildings.name AS building, u.name AS requester,
    EXISTS (SELECT 1 FROM reviews WHERE booking_id = b.id) AS reviewed
  FROM bookings b JOIN rooms r ON r.id = b.room_id JOIN buildings ON buildings.id = r.building_id
  JOIN users u ON u.id = b.user_id
`;
const roomSelect = `
  SELECT r.id, r.name, r.number, r.floor, r.capacity, r.description, r.access_notes AS accessNotes,
    r.access_level AS accessLevel, r.approval_required AS approvalRequired,
    b.name AS building, b.address, t.name AS type,
    (SELECT url FROM room_photos WHERE room_id = r.id ORDER BY id LIMIT 1) AS photo,
    (SELECT alt FROM room_photos WHERE room_id = r.id ORDER BY id LIMIT 1) AS photoAlt,
    (SELECT ROUND(AVG((v.cleanliness + v.equipment + v.comfort) / 3.0), 1)
       FROM reviews v JOIN bookings k ON k.id = v.booking_id WHERE k.room_id = r.id) AS rating
  FROM rooms r JOIN buildings b ON b.id = r.building_id JOIN room_types t ON t.id = r.type_id
`;

function fold(value) {
  return value.toLocaleLowerCase('ru').replaceAll('ё', 'е');
}

export class Campus {
  constructor(db) {
    this.db = db;
    db.function('fold', fold);
  }

  user(token) {
    if (!token) return null;
    return this.db.prepare(`
      SELECT u.id, u.name, u.email, u.role_id AS role, u.reminders_enabled AS reminders
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(hashToken(token), iso(Date.now())) ?? null;
  }

  login({ email, password }) {
    assert(typeof email === 'string' && typeof password === 'string' && email.length <= 180
      && password.length <= 200, 400, 'Укажите почту и пароль.');
    const found = this.db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email.trim());
    assert(found && verifyPassword(password, found.password_hash), 401, 'Неверная почта или пароль.');
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(iso(now));
    this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hashToken(token), found.id, iso(now + dayMs));
    return { token, user: this.user(token) };
  }

  logout(token) {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }

  updateUser(user, { name, reminders }) {
    assert(typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 80
      && typeof reminders === 'boolean', 400, 'Введите имя от 2 до 80 символов.');
    this.db.prepare('UPDATE users SET name = ?, reminders_enabled = ? WHERE id = ?')
      .run(name.trim(), Number(reminders), user.id);
    return this.db.prepare(`SELECT ${profile} FROM users WHERE id = ?`).get(user.id);
  }

  equipment(roomId) {
    return this.db.prepare(`
      SELECT e.id, e.name FROM equipment e JOIN room_equipment re ON re.equipment_id = e.id
      WHERE re.room_id = ? ORDER BY e.id
    `).all(roomId);
  }

  listRooms(params) {
    const query = (params.get('q') ?? '').trim().slice(0, 120);
    const capacity = Number(params.get('capacity') || 0);
    const type = Number(params.get('type') || 0);
    const building = Number(params.get('building') || 0);
    const equipment = Number(params.get('equipment') || 0);
    const numbers = [capacity, type, building, equipment];
    assert(numbers.every(number => Number.isSafeInteger(number) && number >= 0), 400, 'Проверьте фильтры.');
    const rooms = this.db.prepare(`
      ${roomSelect}
      WHERE (? = 0 OR r.capacity >= ?)
        AND (? = 0 OR r.type_id = ?)
        AND (? = 0 OR r.building_id = ?)
        AND (? = 0 OR EXISTS (SELECT 1 FROM room_equipment WHERE room_id = r.id AND equipment_id = ?))
        AND instr(fold(r.name || ' ' || r.number || ' ' || r.description || ' ' || b.name || ' ' || t.name), ?) > 0
      ORDER BY r.id
    `).all(capacity, capacity, type, type, building, building, equipment, equipment, fold(query));
    return rooms.map(room => ({ ...room, equipment: this.equipment(room.id) }));
  }

  filters() {
    return {
      buildings: this.db.prepare('SELECT id, name FROM buildings ORDER BY id').all(),
      types: this.db.prepare('SELECT id, name FROM room_types ORDER BY id').all(),
      equipment: this.db.prepare('SELECT id, name FROM equipment ORDER BY id').all(),
      timezone,
      today: campusDate()
    };
  }

  room(id) {
    const room = this.db.prepare(`${roomSelect} WHERE r.id = ?`).get(id);
    assert(room, 404, 'Помещение не найдено.');
    return { ...room, equipment: this.equipment(id) };
  }

  calendar(id, date) {
    this.room(id);
    const hours = hoursFor(date);
    assert(hours, 400, 'Укажите дату в формате ГГГГ-ММ-ДД.');
    const reserved = this.db.prepare(`
      SELECT start_at, end_at FROM bookings WHERE room_id = ? AND ${active}
        AND start_at < ? AND end_at > ?
    `).all(id, iso(hours.close), iso(hours.open));
    return { date, timezone, slots: daySlots(date, reserved) };
  }

  createBookings(user, { roomId, startAt, endAt, purpose, weeks = 1 }) {
    assert(Number.isSafeInteger(roomId) && roomId > 0, 400, 'Выберите помещение.');
    const room = this.room(roomId);
    assert(room.accessLevel === 'all' || user.role !== 'student', 403, 'Помещение доступно преподавателям.');
    assert(typeof purpose === 'string' && purpose.trim().length >= 3 && purpose.trim().length <= 180,
      400, 'Укажите цель бронирования от 3 до 180 символов.');
    assert(Number.isInteger(weeks) && weeks >= 1 && weeks <= 12, 400, 'В серии может быть от 1 до 12 встреч.');
    const utcInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?Z$/;
    assert(typeof startAt === 'string' && typeof endAt === 'string'
      && utcInstant.test(startAt) && utcInstant.test(endAt), 400, 'Выберите время в календаре.');
    const start = Date.parse(startAt);
    const end = Date.parse(endAt);
    assert(Number.isFinite(start) && Number.isFinite(end)
      && iso(start).replace('.000Z', 'Z') === startAt.replace('.000Z', 'Z')
      && iso(end).replace('.000Z', 'Z') === endAt.replace('.000Z', 'Z'), 400, 'Выберите время в календаре.');
    const now = Date.now();
    const hours = hoursFor(campusDate(start));
    assert(start > now && start >= hours.open && end <= hours.close && end - start >= slotMs
      && (start - hours.open) % slotMs === 0 && (end - hours.open) % slotMs === 0,
    400, 'Выберите будущий интервал от 30 минут в пределах одного дня, с 08:00 до 22:00.');
    assert(end + (weeks - 1) * 7 * dayMs <= now + 120 * dayMs,
      400, 'Бронировать можно не более чем на 120 дней вперёд.');
    const status = room.approvalRequired ? 'pending' : 'confirmed';
    try {
      return transaction(this.db, () => {
        const seriesId = weeks > 1 ? this.db.prepare(`
          INSERT INTO booking_series (user_id, room_id, created_at) VALUES (?, ?, ?)
        `).run(user.id, room.id, iso(now)).lastInsertRowid : null;
        const insert = this.db.prepare(`
          INSERT INTO bookings (user_id, room_id, series_id, start_at, end_at, purpose, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const ids = [];
        for (let week = 0; week < weeks; week += 1) {
          const offset = week * 7 * dayMs;
          const { lastInsertRowid } = insert.run(user.id, room.id, seriesId, iso(start + offset),
            iso(end + offset), purpose.trim(), status, iso(now));
          this.notify(user.id, lastInsertRowid, status, room.name);
          ids.push(lastInsertRowid);
        }
        return { bookings: ids.map(id => this.booking(id)) };
      });
    } catch (error) {
      if (error.message === 'slot_taken') throw new HttpError(409, 'Один из интервалов уже занят. Выберите другое время.');
      throw error;
    }
  }

  booking(id) {
    return this.db.prepare(`${bookingSelect} WHERE b.id = ?`).get(id);
  }

  bookings(user) {
    return this.db.prepare(`${bookingSelect} WHERE b.user_id = ? ORDER BY b.start_at DESC, b.id DESC`).all(user.id);
  }

  cancelBooking(user, id) {
    return transaction(this.db, () => {
      const row = this.db.prepare('SELECT user_id, start_at, status FROM bookings WHERE id = ?').get(id);
      assert(row && row.user_id === user.id, 404, 'Бронирование не найдено.');
      assert(row.start_at > iso(Date.now()) && ['pending', 'confirmed'].includes(row.status),
        409, 'Эту бронь уже нельзя отменить.');
      this.db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(id);
      const booking = this.booking(id);
      this.notify(user.id, id, 'cancelled', booking.room);
      return booking;
    });
  }

  cancelSeries(user, id) {
    return transaction(this.db, () => {
      const series = this.db.prepare('SELECT user_id FROM booking_series WHERE id = ?').get(id);
      assert(series && series.user_id === user.id, 404, 'Серия не найдена.');
      const rows = this.db.prepare(`
        UPDATE bookings SET status = 'cancelled' WHERE series_id = ? AND user_id = ?
          AND start_at > ? AND ${active} RETURNING id
      `).all(id, user.id, iso(Date.now()));
      for (const row of rows) this.notify(user.id, row.id, 'cancelled', this.booking(row.id).room);
      return { cancelled: rows.length };
    });
  }

  requests() {
    return this.db.prepare(`
      ${bookingSelect} WHERE b.status = 'pending' AND b.start_at > ? ORDER BY b.start_at
    `).all(iso(Date.now()));
  }

  decide(user, id, { decision, note = '' }) {
    assert(['confirmed', 'rejected'].includes(decision) && typeof note === 'string' && note.length <= 180,
      400, 'Укажите решение и комментарий до 180 символов.');
    return transaction(this.db, () => {
      const row = this.db.prepare('SELECT user_id, status, start_at FROM bookings WHERE id = ?').get(id);
      assert(row, 404, 'Заявка не найдена.');
      assert(row.status === 'pending' && row.start_at > iso(Date.now()), 409, 'Заявка уже закрыта.');
      this.db.prepare('UPDATE bookings SET status = ?, decision_by = ?, decision_note = ? WHERE id = ?')
        .run(decision, user.id, note.trim() || null, id);
      const booking = this.booking(id);
      this.notify(row.user_id, id, decision, booking.room);
      return booking;
    });
  }

  reviews(roomId) {
    this.room(roomId);
    return this.db.prepare(`
      SELECT r.id, r.cleanliness, r.equipment, r.comfort, r.comment, r.created_at AS createdAt, u.name
      FROM reviews r JOIN bookings b ON b.id = r.booking_id JOIN users u ON u.id = b.user_id
      WHERE b.room_id = ? ORDER BY r.created_at DESC
    `).all(roomId);
  }

  addReview(user, id, { cleanliness, equipment, comfort, comment }) {
    assert([cleanliness, equipment, comfort].every(value => Number.isInteger(value) && value >= 1 && value <= 5)
      && typeof comment === 'string' && comment.trim().length <= 500, 400, 'Проверьте оценки и текст отзыва.');
    const row = this.db.prepare('SELECT user_id, status, end_at FROM bookings WHERE id = ?').get(id);
    assert(row && row.user_id === user.id, 404, 'Бронирование не найдено.');
    assert(row.status === 'confirmed' && row.end_at <= iso(Date.now()), 409, 'Отзыв доступен после посещения.');
    const result = this.db.prepare(`
      INSERT INTO reviews (booking_id, cleanliness, equipment, comfort, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (booking_id) DO NOTHING
    `).run(id, cleanliness, equipment, comfort, comment.trim(), iso(Date.now()));
    assert(result.changes, 409, 'Отзыв уже оставлен.');
    return { id: result.lastInsertRowid };
  }

  notify(userId, bookingId, kind, room) {
    const messages = {
      pending: 'Заявка отправлена на согласование',
      confirmed: 'Бронирование подтверждено',
      rejected: 'В бронировании отказано',
      cancelled: 'Бронирование отменено'
    };
    this.db.prepare(`
      INSERT INTO notifications (user_id, booking_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)
    `).run(userId, bookingId, kind, messages[kind] + ' · ' + room, iso(Date.now()));
  }

  reminders() {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO notifications (user_id, booking_id, kind, message, created_at)
      SELECT b.user_id, b.id, 'reminder', 'Скоро бронирование · ' || r.name, ?
      FROM bookings b JOIN rooms r ON r.id = b.room_id JOIN users u ON u.id = b.user_id
      WHERE b.status = 'confirmed' AND u.reminders_enabled = 1 AND b.start_at > ? AND b.start_at <= ?
      ON CONFLICT (user_id, booking_id, kind) DO NOTHING
    `).run(iso(now), iso(now), iso(now + 60 * 60 * 1000));
  }

  notifications(user) {
    this.reminders();
    return this.db.prepare(`
      SELECT n.id, n.booking_id AS bookingId, n.message, n.created_at AS createdAt, n.read_at AS readAt,
             b.start_at AS bookingStartAt, b.end_at AS bookingEndAt
      FROM notifications n JOIN bookings b ON b.id = n.booking_id
      WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 100
    `).all(user.id);
  }

  markNotifications(user) {
    this.db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
      .run(iso(Date.now()), user.id);
  }
}

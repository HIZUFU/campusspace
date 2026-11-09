import { once } from 'node:events';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openDatabase } from '../src/db.js';
import { createCampusServer } from '../src/server.js';
import { campusDate, dayMs } from '../src/schedule.js';

let db;
let server;
let base;
let student;
let teacher;
let admin;
const futureDate = campusDate(Date.now() + 2 * dayMs);

async function api(path, { method = 'GET', cookie, data } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (data) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + '/api' + path, {
    method, headers, body: data && JSON.stringify(data)
  });
  return {
    status: response.status, data: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0]
  };
}

async function login(role) {
  const response = await api('/session', {
    method: 'POST', data: { email: role + '@campus.test', password: 'campus-demo' }
  });
  assert.equal(response.status, 200);
  return response.cookie;
}

async function interval(roomId, date = futureDate) {
  const { data } = await api(`/rooms/${roomId}/calendar?date=${date}`);
  assert.equal(data.slots.length, 28);
  assert.equal(data.slots[0].status, 'free');
  return {
    roomId, startAt: data.slots[0].startAt, endAt: data.slots[1].endAt, purpose: 'Разбор командного проекта'
  };
}

before(async () => {
  db = openDatabase(':memory:');
  server = createCampusServer(db).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;
  [student, teacher, admin] = await Promise.all(['student', 'teacher', 'admin'].map(login));
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

test('каталог сочетает поиск с четырьмя фильтрами', async () => {
  const query = encodeURIComponent('КОМПЬЮТЕРНЫЙ');
  const response = await api(`/rooms?q=${query}&capacity=20&type=4&building=2&equipment=4`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.rooms.map(room => room.id), [4]);
  assert.equal((await api('/rooms/1/calendar?date=2026-02-31')).status, 400);
});

test('бронь появляется в кабинете, конфликт отклоняется, отмена освобождает слот', async () => {
  const data = await interval(1);
  assert.equal((await api('/bookings', { method: 'POST', data })).status, 401);
  const results = await Promise.all([student, teacher].map(cookie =>
    api('/bookings', { method: 'POST', cookie, data })));
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  const winner = results.findIndex(result => result.status === 201);
  const owner = [student, teacher][winner];
  const other = [teacher, student][winner];
  const booking = results[winner].data.bookings[0];
  assert.equal(booking.status, 'confirmed');
  assert.ok((await api('/bookings', { cookie: owner })).data.bookings.some(row => row.id === booking.id));
  assert.equal((await api(`/bookings/${booking.id}/cancel`, { method: 'POST', cookie: other })).status, 404);
  assert.equal((await api(`/bookings/${booking.id}/cancel`, { method: 'POST', cookie: owner })).status, 200);
  assert.equal((await api('/bookings', { method: 'POST', cookie: other, data })).status, 201);
});

test('студент не бронирует лекционную, администратор одобряет заявку преподавателя', async () => {
  const data = await interval(5);
  assert.equal((await api('/bookings', { method: 'POST', cookie: student, data })).status, 403);
  const created = await api('/bookings', { method: 'POST', cookie: teacher, data });
  assert.equal(created.status, 201);
  const [booking] = created.data.bookings;
  assert.equal(booking.status, 'pending');
  assert.equal((await api('/admin/requests', { cookie: teacher })).status, 403);
  assert.ok((await api('/admin/requests', { cookie: admin })).data.requests.some(row => row.id === booking.id));
  const decision = await api(`/admin/requests/${booking.id}/decision`, {
    method: 'POST', cookie: admin, data: { decision: 'confirmed' }
  });
  assert.equal(decision.data.status, 'confirmed');
  const { notifications } = (await api('/notifications', { cookie: teacher })).data;
  assert.ok(notifications.some(item => item.bookingId === booking.id && item.message.includes('подтверждено')));
});

test('конфликт во второй неделе откатывает всю серию', async () => {
  const later = await interval(3, campusDate(Date.now() + 9 * dayMs));
  assert.equal((await api('/bookings', { method: 'POST', cookie: teacher, data: later })).status, 201);
  const data = await interval(3);
  assert.equal((await api('/bookings', { method: 'POST', cookie: student, data: { ...data, weeks: 2 } })).status, 409);
  await interval(3);
  const created = await api('/bookings', { method: 'POST', cookie: student, data: { ...data, weeks: 2,
    startAt: new Date(Date.parse(data.endAt) + 30 * 60_000).toISOString(),
    endAt: new Date(Date.parse(data.endAt) + 60 * 60_000).toISOString() } });
  assert.equal(created.status, 201);
  const [{ seriesId }] = created.data.bookings;
  assert.equal(created.data.bookings.length, 2);
  assert.equal((await api(`/series/${seriesId}/cancel`, { method: 'POST', cookie: student })).data.cancelled, 2);
});

test('рабочий день бронируется целиком, отзыв меняет рейтинг помещения', async () => {
  const { data: calendar } = await api(`/rooms/6/calendar?date=${futureDate}`);
  const data = { roomId: 6, startAt: calendar.slots[0].startAt, endAt: calendar.slots.at(-1).endAt,
    purpose: 'Интенсив по учебному проекту' };
  const created = await api('/bookings', { method: 'POST', cookie: student, data });
  assert.equal(created.status, 201);
  const [booking] = created.data.bookings;
  const review = { cleanliness: 5, equipment: 4, comfort: 3, comment: 'Достаточно места для команды.' };
  assert.equal((await api(`/bookings/${booking.id}/review`, { method: 'POST', cookie: student, data: review })).status, 409);

  const { data: dashboard } = await api('/bookings', { cookie: student });
  const completed = dashboard.bookings.find(row => row.roomId === 3 && Date.parse(row.endAt) < Date.now());
  const path = `/bookings/${completed.id}/review`;
  assert.equal((await api(path, { method: 'POST', cookie: student, data: review })).status, 201);
  assert.equal((await api(path, { method: 'POST', cookie: student, data: review })).status, 409);
  assert.equal((await api('/rooms/3')).data.rating, 4);
});

test('напоминание отправляется один раз и отмечается прочитанным', async () => {
  const now = Date.now();
  const iso = offset => new Date(now + offset).toISOString();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO bookings (user_id, room_id, start_at, end_at, purpose, status, created_at)
    VALUES (1, 4, ?, ?, 'Подготовка к лабораторной', 'confirmed', ?)
  `).run(iso(30 * 60_000), iso(90 * 60_000), iso(0));
  const matching = async () => (await api('/notifications', { cookie: student })).data.notifications
    .filter(item => item.bookingId === lastInsertRowid && item.message.includes('Скоро бронирование'));
  assert.equal((await matching()).length, 1);
  assert.equal((await matching()).length, 1);
  assert.equal((await api('/notifications', { method: 'PATCH', cookie: student })).status, 200);
  assert.ok((await matching())[0].readAt);
});

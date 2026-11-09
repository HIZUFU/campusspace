import { hashPassword, transaction } from './db.js';
import { campusDate, dayMs, hoursFor, iso, slotMs } from './schedule.js';

export function seed(db) {
  transaction(db, () => {
    if (db.prepare('SELECT 1 FROM roles LIMIT 1').get()) return;
    db.exec(`
      INSERT INTO roles VALUES ('student', 'Студент'), ('teacher', 'Преподаватель'), ('admin', 'Администратор');
      INSERT INTO buildings VALUES
        (1, 'Главный корпус', 'ул. Университетская, 12'),
        (2, 'Инженерный корпус', 'ул. Университетская, 16'),
        (3, 'Научная библиотека', 'пер. Академический, 4');
      INSERT INTO room_types VALUES
        (1, 'Переговорная'), (2, 'Аудитория'), (3, 'Коворкинг'), (4, 'Компьютерный класс');
      INSERT INTO equipment VALUES
        (1, 'Wi-Fi'), (2, 'Проектор'), (3, 'Маркерная доска'), (4, 'ПК'),
        (5, 'Видеосвязь'), (6, 'Розетки'), (7, 'Экран');
      INSERT INTO rooms VALUES
        (1, 3, 1, 'Б-204', 'Переговорная «Диалог»', 2, 8,
          'Закрытая комната для коротких проектных встреч, консультаций и обсуждения диплома.',
          'Вход по студенческому или пропуску. На стойке библиотеки назовите номер бронирования.', 'all', 0),
        (2, 1, 2, 'А-312', 'Семинарская аудитория', 3, 26,
          'Ряды столов, место для ведущего и проектор для семинаров и групповой подготовки.',
          'Вход по пропуску. Пульт от проектора хранится у дежурного на этаже.', 'all', 0),
        (3, 3, 3, 'Б-108', 'Коворкинг «Орбита»', 1, 16,
          'Гибкая рассадка и рабочие столы для учебных команд.',
          'Бронируется целиком. По окончании верните столы на место.', 'all', 0),
        (4, 2, 4, 'И-406', 'Компьютерный класс', 4, 24,
          '24 рабочих места с Windows для программирования и практикумов.',
          'После согласования дежурный инженер откроет класс. Для установки ПО свяжитесь с ним заранее.', 'all', 1),
        (5, 1, 2, 'А-216', 'Аудитория для лекций', 2, 46,
          'Ступенчатая рассадка и большой экран для лекций и открытых занятий.',
          'Доступ для преподавателей и администраторов по заявке.', 'staff', 1),
        (6, 2, 1, 'И-202', 'Переговорная «Вектор»', 2, 10,
          'Стол на десять участников и экран для встреч со смешанным участием.',
          'Для видеосвязи выберите в настройках аудио переговорной.', 'all', 0);
      INSERT INTO room_equipment VALUES
        (1,1),(1,3),(1,6),(1,7),
        (2,1),(2,2),(2,3),(2,6),
        (3,1),(3,3),(3,6),
        (4,1),(4,2),(4,3),(4,4),(4,6),
        (5,1),(5,2),(5,5),(5,7),
        (6,1),(6,3),(6,5),(6,7);
    `);

    const users = [
      [1, 'student', 'Алина Смирнова', 'student@campus.test'],
      [2, 'teacher', 'Илья Воронов', 'teacher@campus.test'],
      [3, 'admin', 'Марина Белова', 'admin@campus.test'],
      [4, 'student', 'Денис Романов', 'denis@campus.test']
    ];
    const insertUser = db.prepare('INSERT INTO users (id, role_id, name, email, password_hash) VALUES (?, ?, ?, ?, ?)');
    for (const user of users) insertUser.run(...user, hashPassword('campus-demo'));

    const insertBooking = db.prepare(`
      INSERT INTO bookings (user_id, room_id, start_at, end_at, purpose, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'confirmed', ?)
    `);
    const now = Date.now();
    const yesterday = hoursFor(campusDate(now - dayMs)).open;
    const tomorrow = hoursFor(campusDate(now + dayMs)).open;
    const first = insertBooking.run(4, 1, iso(yesterday + 8 * slotMs), iso(yesterday + 10 * slotMs),
      'Разбор презентации по курсовому проекту', iso(now - 3 * dayMs));
    const second = insertBooking.run(2, 2, iso(yesterday + 4 * slotMs), iso(yesterday + 6 * slotMs),
      'Семинар по архитектуре информационных систем', iso(now - 4 * dayMs));
    insertBooking.run(4, 1, iso(tomorrow + 6 * slotMs), iso(tomorrow + 8 * slotMs),
      'Встреча команды перед защитой', iso(now - dayMs));
    insertBooking.run(2, 2, iso(tomorrow + 10 * slotMs), iso(tomorrow + 13 * slotMs),
      'Консультация по учебной практике', iso(now - dayMs));
    const review = db.prepare(`
      INSERT INTO reviews (booking_id, cleanliness, equipment, comfort, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    review.run(first.lastInsertRowid, 5, 4, 5, 'Тихо даже в обед, экран подключился с первого раза.', iso(now - dayMs / 3));
    review.run(second.lastInsertRowid, 5, 5, 4, 'Проектор яркий, за последними столами хорошо видно.', iso(now - dayMs / 4));
  });
}

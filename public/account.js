import { $, api, announce, badge, button, closeButton, dateText, e, empty, onSubmit,
  rangeText, secondary, state, statusBadge, timeText } from './ui.js';

const actionDialog = $('#action-dialog');
const active = booking => ['pending', 'confirmed'].includes(booking.status) && Date.parse(booking.endAt) > Date.now();
const access = {
  student: ['Студент', 'Бронируйте общие учебные пространства.'],
  teacher: ['Преподаватель', 'Вам доступны общие помещения и аудитории для преподавателей.'],
  admin: ['Администратор', 'Проверяйте заявки на специализированные помещения в разделе «Заявки».']
};

function bookingCard(row, admin = false) {
  const upcoming = Date.parse(row.startAt) > Date.now();
  const actions = [];
  if (admin) {
    actions.push(`<button class="${button} btn-sm" data-decision="confirmed">Одобрить</button>`,
      `<button class="${secondary} btn-sm" data-decision="rejected">Отклонить</button>`);
  } else if (upcoming && active(row)) {
    actions.push(`<button class="${secondary} btn-sm" data-cancel>Отменить бронь</button>`);
    if (row.seriesId) actions.push(`<button class="${secondary} btn-sm" data-series="${row.seriesId}">Отменить серию</button>`);
  } else if (row.status === 'confirmed' && !row.reviewed && Date.parse(row.endAt) <= Date.now()) {
    actions.push(`<button class="${secondary} btn-sm" data-review>Оставить отзыв</button>`);
  }
  return `<article class="booking" data-booking="${row.id}">
    <div class="booking-heading"><h3>${e(row.room)} · ${e(row.number)}</h3>${statusBadge(row.status)}</div>
    <p class="muted">${rangeText(row)} · ${e(row.building)}</p>
    <p>${e(row.purpose)}</p>
    ${admin ? `<p class="muted">Заявитель · ${e(row.requester)}</p>` : ''}
    ${row.decisionNote ? `<p class="muted">Комментарий администратора · ${e(row.decisionNote)}</p>` : ''}
    ${row.seriesId ? badge('Еженедельная серия №' + row.seriesId, 'neutral') : ''}
    ${actions.length ? `<div class="d-flex gap-2 flex-wrap mt-2">${actions.join('')}</div>` : ''}
  </article>`;
}

function openAction(title, content, submit, handler) {
  actionDialog.innerHTML = `<div class="dialog-content">
    <div class="section-heading align-items-start"><h2 id="action-title" class="dialog-title">${e(title)}</h2>${closeButton}</div>
    <form class="stack">
      ${content}<p class="form-error" role="alert"></p>
      <button class="${button}" type="submit">${e(submit)}</button>
    </form>
  </div>`;
  const form = actionDialog.querySelector('form.stack');
  onSubmit(form, async values => {
    await handler(values);
    actionDialog.close();
  });
  actionDialog.showModal();
}

function connectBookingActions(container, refresh) {
  container.querySelectorAll('[data-booking] button').forEach(element => {
    element.addEventListener('click', () => {
      const id = element.closest('[data-booking]').dataset.booking;
      const { series, decision } = element.dataset;
      if (Object.hasOwn(element.dataset, 'review')) {
        const fields = [['cleanliness', 'Чистота'], ['equipment', 'Оснащение'], ['comfort', 'Комфорт']];
        const ratings = fields.map(([name, label]) => `<label><span class="form-label">${label}</span>
          <select name="${name}" class="form-select" required>
            <option value="">Выберите оценку</option>${[5, 4, 3, 2, 1].map(value =>
              `<option value="${value}">${value} из 5</option>`).join('')}
          </select></label>`).join('');
        openAction('Оцените помещение', `${ratings}<label><span class="form-label">Комментарий</span>
          <textarea class="form-control" name="comment" maxlength="500" rows="3"></textarea></label>`,
        'Опубликовать отзыв', async values => {
          const scores = Object.fromEntries(fields.map(([name]) => [name, Number(values.get(name))]));
          await api(`/bookings/${id}/review`, 'POST', { ...scores, comment: values.get('comment') });
          announce('Отзыв опубликован.');
          await refresh();
        });
      } else if (decision) {
        const approve = decision === 'confirmed';
        openAction(approve ? 'Одобрить заявку' : 'Отклонить заявку',
          `<label><span class="form-label">Комментарий для заявителя</span>
            <textarea class="form-control" name="note" maxlength="180" rows="2"></textarea></label>`,
          approve ? 'Одобрить' : 'Отклонить', async values => {
            await api(`/admin/requests/${id}/decision`, 'POST', { decision, note: values.get('note') });
            announce(approve ? 'Заявка одобрена.' : 'Заявка отклонена.');
            await refresh();
          });
      } else {
        const text = series ? 'Все будущие брони в серии будут отменены.' : 'Слот станет доступен другим пользователям.';
        openAction(series ? 'Отменить серию' : 'Отменить бронирование', `<p>${text}</p>`, 'Подтвердить отмену', async () => {
          const path = series ? `/series/${series}/cancel` : `/bookings/${id}/cancel`;
          await api(path, 'POST');
          announce(series ? 'Будущие брони серии отменены.' : 'Бронирование отменено.');
          await refresh();
        });
      }
    });
  });
}

function renderBookings(target, rows) {
  const current = rows.filter(active).sort((first, second) => first.startAt.localeCompare(second.startAt));
  const past = rows.filter(row => !active(row));
  const list = (items, message) => items.length ? items.map(row => bookingCard(row)).join('') : empty(message);
  target.innerHTML = `<section class="panel">
    <h2 class="mb-3">Активные бронирования</h2><div class="stack">${list(current, 'У вас нет активных бронирований.')}</div>
  </section>
  <section class="panel">
    <h2 class="mb-3">История</h2><div class="stack">${list(past, 'Завершённые и отменённые брони появятся здесь.')}</div>
  </section>`;
}

function bookingFilters(rows) {
  const rooms = new Map(rows.map(row => [row.roomId, row.room]));
  return `<form id="booking-filters" class="panel">
    <h2 class="mb-3">Фильтры бронирований</h2><div class="row g-2">
      <label class="col-12"><span class="form-label">Поиск</span>
        <input class="form-control" name="q" type="search" placeholder="Помещение или цель"></label>
      <label class="col-sm-6"><span class="form-label">Помещение</span><select class="form-select" name="roomId">
        <option value="">Все</option>${[...rooms].map(([id, name]) => `<option value="${id}">${e(name)}</option>`).join('')}
      </select></label>
      <label class="col-sm-6"><span class="form-label">Статус</span><select class="form-select" name="status">
        <option value="">Все</option><option value="confirmed">Подтверждено</option><option value="pending">На согласовании</option>
        <option value="rejected">Отклонено</option><option value="cancelled">Отменено</option>
      </select></label>
      <label class="col-sm-6"><span class="form-label">Дата</span><input class="form-control" name="date" type="date"></label>
      <label class="col-sm-6"><span class="form-label">Повторение</span><select class="form-select" name="recurrence">
        <option value="">Любое</option><option value="series">Серия</option><option value="single">Разовое</option>
      </select></label>
    </div>
    <button class="${secondary} btn-sm mt-3" type="reset">Сбросить фильтры</button>
  </form>`;
}

export async function loadAccount(showLogin, refreshIdentity) {
  const target = $('#account-content');
  const userId = state.user?.id;
  if (!userId) {
    target.innerHTML = `<div class="panel"><h2>Войдите в личный кабинет</h2>
      <p class="muted">Здесь появятся ваши заявки и уведомления.</p><button class="${button}" type="button">Войти</button></div>`;
    target.querySelector('button').addEventListener('click', showLogin);
    return;
  }
  target.innerHTML = empty('Загружаем личный кабинет…');
  try {
    const [{ bookings }, { notifications }] = await Promise.all([api('/bookings'), api('/notifications')]);
    if (userId !== state.user?.id) return;
    const refresh = () => loadAccount(showLogin, refreshIdentity);
    const [role, permissions] = access[state.user.role];
    target.innerHTML = `<div class="panel mb-3">
      <h2>${role}</h2><p class="muted mb-0">${permissions}</p>
    </div><div class="account-layout">
      <div class="stack">${bookingFilters(bookings)}<div id="bookings" class="stack"></div></div>
      <aside class="stack">
        <section class="panel">
          <h2 class="mb-3">Уведомления</h2>
          ${notifications.length ? notifications.map(notice => `<div class="notice">
            <div class="${notice.readAt ? '' : 'notice-unread'}">${e(notice.message)}</div>
            <span class="muted">${dateText(notice.createdAt)} · ${timeText(notice.createdAt)}</span>
          </div>`).join('') : empty('Новых уведомлений пока нет.')}
          ${notifications.some(notice => !notice.readAt)
            ? `<button id="mark-read" class="${secondary} btn-sm mt-2" type="button">Прочитать все</button>` : ''}
        </section>
        <section class="panel">
          <h2 class="mb-3">Настройки профиля</h2>
          <form id="profile-form" class="stack">
            <label><span class="form-label">Имя</span><input class="form-control" name="name"
              minlength="2" maxlength="80" value="${e(state.user.name)}" required></label>
            <div class="muted">${e(state.user.email)}</div>
            <label class="form-check"><input class="form-check-input" type="checkbox" name="reminders"
              ${state.user.reminders ? 'checked' : ''}><span class="form-check-label">Напоминать за час до начала</span></label>
            <p class="form-error" role="alert"></p>
            <button class="${button}" type="submit">Сохранить</button>
          </form>
        </section>
      </aside>
    </div>`;
    const filters = $('#booking-filters');
    const updateBookings = () => {
      const form = new FormData(filters);
      const query = String(form.get('q')).trim().toLocaleLowerCase('ru');
      const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: state.timezone });
      const rows = bookings.filter(row =>
        (!query || `${row.room} ${row.number} ${row.purpose}`.toLocaleLowerCase('ru').includes(query))
        && (!form.get('roomId') || String(row.roomId) === form.get('roomId'))
        && (!form.get('status') || row.status === form.get('status'))
        && (!form.get('date') || dayFormat.format(new Date(row.startAt)) === form.get('date'))
        && (!form.get('recurrence') || Boolean(row.seriesId) === (form.get('recurrence') === 'series')));
      const list = $('#bookings');
      renderBookings(list, rows);
      connectBookingActions(list, refresh);
    };
    filters.addEventListener('submit', event => event.preventDefault());
    filters.addEventListener('input', updateBookings);
    filters.addEventListener('reset', () => setTimeout(updateBookings));
    updateBookings();
    $('#mark-read')?.addEventListener('click', async event => {
      event.target.disabled = true;
      try {
        await api('/notifications', 'PATCH');
        await refresh();
      } catch (error) {
        event.target.disabled = false;
        announce(error.message, true);
      }
    });
    onSubmit($('#profile-form'), async values => {
      const result = await api('/me', 'PATCH', { name: values.get('name'), reminders: values.has('reminders') });
      state.user = result.user;
      refreshIdentity();
      announce('Настройки сохранены.');
    });
  } catch (error) {
    if (userId === state.user?.id) target.innerHTML = empty(error.message);
  }
}

export async function loadAdmin() {
  const target = $('#admin-content');
  if (state.user?.role !== 'admin') {
    target.innerHTML = empty('Раздел доступен администратору.');
    return;
  }
  target.innerHTML = empty('Загружаем заявки…');
  try {
    const { requests } = await api('/admin/requests');
    if (state.user?.role !== 'admin') return;
    target.innerHTML = `<div class="stack">${requests.length ? requests.map(row => bookingCard(row, true)).join('')
      : empty('Нет заявок, ожидающих решения.')}</div>`;
    connectBookingActions(target, loadAdmin);
  } catch (error) {
    target.innerHTML = empty(error.message);
  }
}

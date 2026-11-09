import { $, api, announce, badge, button, closeButton, dateText, e, empty, equipment,
  onSubmit, secondary, shiftDay, state, timeText } from './ui.js';

const dialog = $('#room-dialog');
let room;
let date;
let slots = [];
let startIndex = -1;
let requestId = 0;
let showLogin;

export function refreshBookingControls() {
  if (dialog.open && room) renderSlots();
}

function renderRoom(reviews) {
  const roomPhoto = room.photo ? `<img src="${e(room.photo)}" alt="${e(room.photoAlt)}">` : '';
  const reviewsHtml = reviews.length ? reviews.map(review => `<article class="booking">
    <div class="booking-heading"><h4 class="h6 mb-0">${e(review.name)}</h4>
      <span class="muted">${dateText(review.createdAt)}</span></div>
    <p>Чистота ${review.cleanliness}/5 · Оснащение ${review.equipment}/5 · Комфорт ${review.comfort}/5</p>
    ${review.comment ? `<p>${e(review.comment)}</p>` : ''}
  </article>`).join('') : empty('У этого помещения пока нет отзывов.');
  dialog.innerHTML = `<div class="dialog-content">
    <div class="section-heading align-items-start">
      <div><p class="section-kicker mb-1">${e(room.type.toLocaleUpperCase('ru'))} · ${e(room.number)}</p>
      <h2 id="room-title" class="dialog-title">${e(room.name)}</h2></div>${closeButton}
    </div>
    <div class="room-summary">
      <div>${roomPhoto}</div>
      <div>
        <p class="room-location mb-2">${e(room.building)} · ${e(room.address)} · этаж ${room.floor}</p>
        <div class="room-details mb-2"><span>До ${room.capacity} человек</span>
          ${room.rating === null ? '' : `<span class="rating">★ ${room.rating.toFixed(1).replace('.', ',')}</span>`}
          ${room.approvalRequired ? badge('По согласованию', 'wait') : badge('Мгновенная бронь')}
        </div>
        <p class="room-description mb-2">${e(room.description)}</p>
        ${equipment(room.equipment)}
        <p class="muted mt-2 mb-0"><strong>Условия доступа.</strong> ${e(room.accessNotes)}</p>
      </div>
    </div>
    <section class="section-divider" aria-labelledby="calendar-title">
      <div class="section-heading flex-wrap align-items-center">
        <div><h3 id="calendar-title" class="mb-1">Календарь занятости</h3><p class="muted">Екатеринбург · 08:00–22:00</p></div>
        <div class="date-controls">
          <button class="${secondary} btn-sm" type="button" id="prev-date" aria-label="Предыдущий день">←</button>
          <input class="form-control" type="date" id="calendar-date" min="${state.today}" max="${shiftDay(state.today, 119)}"
            value="${date}" aria-label="Дата бронирования">
          <button class="${secondary} btn-sm" type="button" id="next-date" aria-label="Следующий день">→</button>
        </div>
      </div>
      <div id="calendar" aria-live="polite"></div>
    </section>
    <section class="section-divider" aria-labelledby="reviews-title">
      <h3 id="reviews-title">Отзывы</h3><div class="stack">${reviewsHtml}</div>
    </section>
  </div>`;
  $('#prev-date').addEventListener('click', () => setDate(shiftDay(date, -1)));
  $('#next-date').addEventListener('click', () => setDate(shiftDay(date, 1)));
  $('#calendar-date').addEventListener('change', event => {
    if (event.target.value && event.target.checkValidity()) setDate(event.target.value);
    else event.target.value = date;
  });
}

export async function openRoom(id, login) {
  const currentRequest = ++requestId;
  showLogin = login;
  room = null;
  date = shiftDay(state.today, 1);
  dialog.innerHTML = `<div class="dialog-content section-heading align-items-center">
    <h2 id="room-title" class="dialog-title">Загружаем помещение…</h2>${closeButton}</div>`;
  if (!dialog.open) dialog.showModal();
  try {
    const [details, { reviews }] = await Promise.all([api('/rooms/' + id), api('/rooms/' + id + '/reviews')]);
    if (currentRequest !== requestId || !dialog.open) return;
    room = details;
    renderRoom(reviews);
    await setDate(date);
  } catch (error) {
    if (currentRequest === requestId && dialog.open) dialog.innerHTML = `<div class="dialog-content">
      <div class="section-heading"><h2 id="room-title" class="dialog-title">Помещение</h2>${closeButton}</div>
      ${empty(error.message)}</div>`;
  }
}

async function setDate(nextDate) {
  const input = $('#calendar-date');
  if (nextDate < input.min || nextDate > input.max) return;
  date = nextDate;
  startIndex = -1;
  slots = [];
  input.value = date;
  $('#prev-date').disabled = date === input.min;
  $('#next-date').disabled = date === input.max;
  const currentRequest = ++requestId;
  const calendar = $('#calendar');
  calendar.innerHTML = empty('Загружаем слоты…');
  try {
    const result = await api(`/rooms/${room.id}/calendar?date=${date}`);
    if (currentRequest !== requestId || !dialog.open) return;
    slots = result.slots;
    renderSlots();
  } catch (error) {
    if (currentRequest === requestId && dialog.open) calendar.innerHTML = empty(error.message);
  }
}

function renderSlots(focusIndex) {
  if (!slots.length) return;
  const calendar = $('#calendar');
  calendar.innerHTML = `<div class="slot-grid" role="group" aria-label="Время начала">
    ${slots.map((slot, index) => {
      const label = { free: 'свободно', busy: 'занято', past: 'прошло' }[slot.status];
      return `<button class="btn slot" type="button" data-slot="${index}" data-state="${slot.status}"
        aria-label="${slot.label}, ${label}" aria-pressed="${startIndex === index}" ${slot.status === 'free' ? '' : 'disabled'}>
        ${slot.label}</button>`;
    }).join('')}
  </div><p class="muted mt-2 mb-2">${slots.some(slot => slot.status === 'free')
    ? 'Выберите свободное время начала. Розовым отмечены занятые слоты.' : 'На эту дату нет свободных слотов.'}</p>
    <div id="booking-controls"></div>`;
  calendar.querySelectorAll('[data-slot]:enabled').forEach(element => {
    element.addEventListener('click', () => {
      startIndex = Number(element.dataset.slot);
      renderSlots(startIndex);
    });
  });
  if (focusIndex !== undefined) calendar.querySelector(`[data-slot="${focusIndex}"]`)?.focus();
  const controls = $('#booking-controls');
  if (!state.user) {
    controls.innerHTML = `<button type="button" class="${button}">Войти для бронирования</button>`;
    controls.querySelector('button').addEventListener('click', showLogin);
    return;
  }
  if (room.accessLevel === 'staff' && state.user.role === 'student') {
    controls.innerHTML = empty('Бронирование этого помещения доступно преподавателям и администраторам.');
    return;
  }
  if (startIndex < 0) return;
  const available = [];
  for (const slot of slots.slice(startIndex)) {
    if (slot.status !== 'free') break;
    available.push(slot);
  }
  const endOptions = available.map((slot, index) => {
    const fullDay = startIndex === 0 && index === slots.length - 1;
    const label = fullDay ? 'Весь день (до 22:00)' : `${timeText(slot.endAt)} · ${(index + 1) * 30} мин`;
    return `<option value="${slot.endAt}">${label}</option>`;
  }).join('');
  controls.innerHTML = `<form id="book-form" class="stack panel mt-3">
    <div class="row g-2">
      <label class="col-sm-6"><span class="form-label">До какого времени</span>
        <select name="endAt" class="form-select" required>${endOptions}</select></label>
      <label class="col-sm-6"><span class="form-label">Повторение</span>
        <select name="weeks" class="form-select">
          <option value="1">Один раз</option>
          ${Array.from({ length: 11 }, (_, index) =>
            `<option value="${index + 2}">Раз в неделю · ${index + 2} встреч</option>`).join('')}
        </select></label>
    </div>
    <label><span class="form-label">Цель бронирования</span>
      <input class="form-control" name="purpose" required minlength="3" maxlength="180" placeholder="Например, подготовка к семинару"></label>
    <p class="form-error" role="alert"></p>
    <button class="${button}" type="submit">
      ${room.approvalRequired ? 'Отправить на согласование' : 'Подтвердить бронирование'}
    </button>
  </form>`;
  onSubmit($('#book-form'), async values => {
    const result = await api('/bookings', 'POST', {
      roomId: room.id, startAt: slots[startIndex].startAt, endAt: values.get('endAt'),
      weeks: Number(values.get('weeks')), purpose: values.get('purpose')
    });
    const [booking] = result.bookings;
    dialog.close();
    const text = booking.status === 'pending' ? 'Заявка отправлена на согласование.' : 'Бронирование подтверждено.';
    announce(text + (result.bookings.length > 1 ? ` В серии ${result.bookings.length} встреч.` : ''));
    location.hash = 'account';
  });
}

export const $ = selector => document.querySelector(selector);
export const state = { user: null, today: '', timezone: 'Asia/Yekaterinburg' };
const escapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const e = value => String(value ?? '').replace(/[&<>"']/g, character => escapes[character]);
export const button = 'btn btn-campus';
export const secondary = 'btn btn-outline-secondary';
export const closeButton = `<form method="dialog"><button class="${secondary} btn-sm dialog-close" aria-label="Закрыть окно">Закрыть</button></form>`;

export async function api(path, method = 'GET', body) {
  const options = { method };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const response = await fetch('/api' + path, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Запрос не выполнен.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export function shiftDay(date, count) {
  const next = Date.parse(date + 'T12:00:00Z') + count * 86_400_000;
  return new Date(next).toISOString().slice(0, 10);
}

export function dateText(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: state.timezone, day: 'numeric', month: 'long', year: 'numeric'
  }).format(new Date(value));
}

export function timeText(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: state.timezone, hour: '2-digit', minute: '2-digit'
  }).format(new Date(value));
}

export const rangeText = booking =>
  `${dateText(booking.startAt)} · ${timeText(booking.startAt)}–${timeText(booking.endAt)}`;

const statuses = {
  confirmed: ['Подтверждено', 'soft'], pending: ['На согласовании', 'wait'],
  rejected: ['Отклонено', 'off'], cancelled: ['Отменено', 'neutral']
};
export function badge(label, color = 'soft') {
  return `<span class="badge badge-${color}">${e(label)}</span>`;
}
export const statusBadge = status => badge(...statuses[status]);
export const equipment = items => `<div class="equipment">${items.map(item => `<span>${e(item.name)}</span>`).join('')}</div>`;
export const empty = text => `<div class="empty">${e(text)}</div>`;

let messageTimer;
export function announce(text, isError = false) {
  const message = $('#message');
  clearTimeout(messageTimer);
  message.textContent = text;
  message.classList.toggle('error', isError);
  message.hidden = false;
  messageTimer = setTimeout(() => { message.hidden = true; }, 6500);
}

export function onSubmit(form, action) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const trigger = event.submitter;
    if (form.dataset.sending) return;
    form.dataset.sending = 'true';
    if (trigger) trigger.disabled = true;
    const error = form.querySelector('.form-error');
    if (error) error.textContent = '';
    try {
      await action(new FormData(form), trigger);
    } catch (problem) {
      if (error) error.textContent = problem.message;
      else announce(problem.message, true);
    } finally {
      delete form.dataset.sending;
      if (trigger) trigger.disabled = false;
    }
  });
}

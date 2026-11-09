import { loadAccount, loadAdmin } from './account.js';
import { openRoom, refreshBookingControls } from './room.js';
import { $, api, announce, badge, button, closeButton, e, empty, equipment, onSubmit, secondary, state } from './ui.js';

const roles = { student: 'Студент', teacher: 'Преподаватель', admin: 'Администратор' };
const filters = $('#filters');
const loginDialog = $('#login-dialog');
let catalogRequest = 0;
let inputTimer;

function refreshIdentity() {
  const user = state.user;
  const identity = $('#identity');
  $('[data-view="admin"]').hidden = user?.role !== 'admin';
  identity.innerHTML = user
    ? `<span class="identity-name" title="${e(roles[user.role])}">${e(user.name)}</span>
       <button class="${secondary} btn-sm" type="button">Выйти</button>`
    : `<button class="${button} btn-sm" type="button">Войти</button>`;
  identity.querySelector('button').addEventListener('click', user ? logout : login);
}

async function logout(event) {
  event.target.disabled = true;
  try {
    await api('/session', 'DELETE');
    state.user = null;
    refreshIdentity();
    if (location.hash === '#admin') location.hash = 'catalog';
    else renderView();
    announce('Вы вышли из учётной записи.');
  } catch (error) {
    event.target.disabled = false;
    announce(error.message, true);
  }
}

function login() {
  if (loginDialog.open) return;
  loginDialog.innerHTML = `<div class="dialog-content">
    <div class="section-heading align-items-start"><h2 id="login-title" class="dialog-title">Вход в CampusSpace</h2>${closeButton}</div>
    <form id="login-form" class="stack">
      <div><p class="muted mb-2">Выберите демо-роль, чтобы заполнить данные для входа.</p>
        <div class="demo-options">${Object.entries(roles).map(([key, label]) =>
          `<button type="button" class="${secondary} btn-sm" data-demo="${key}">${label}</button>`).join('')}</div></div>
      <label><span class="form-label">Электронная почта</span>
        <input class="form-control" type="email" name="email" required maxlength="180" autocomplete="username"></label>
      <label><span class="form-label">Пароль</span>
        <input class="form-control" type="password" name="password" required maxlength="200" autocomplete="current-password"></label>
      <p class="form-error" role="alert"></p>
      <button class="${button}" type="submit">Войти</button>
    </form>
  </div>`;
  const form = $('#login-form');
  form.querySelectorAll('[data-demo]').forEach(element => element.addEventListener('click', () => {
    form.elements.email.value = element.dataset.demo + '@campus.test';
    form.elements.password.value = 'campus-demo';
  }));
  onSubmit(form, async data => {
    const { user } = await api('/session', 'POST', { email: data.get('email'), password: data.get('password') });
    state.user = user;
    loginDialog.close();
    refreshIdentity();
    refreshBookingControls();
    renderView();
    announce('Вход выполнен · ' + roles[user.role]);
  });
  loginDialog.showModal();
}

function renderView() {
  const requested = location.hash.slice(1);
  const view = ['catalog', 'account', 'admin'].includes(requested) ? requested : 'catalog';
  for (const section of ['catalog', 'account', 'admin']) {
    const selected = section === view;
    $('#' + section).hidden = !selected;
    const navLink = $(`[data-view="${section}"]`);
    if (selected) navLink.setAttribute('aria-current', 'page');
    else navLink.removeAttribute('aria-current');
  }
  if (view === 'account') loadAccount(login, refreshIdentity);
  if (view === 'admin') loadAdmin();
  if (view === 'catalog' && state.today) loadRooms();
}

function roomCard(room) {
  const photo = room.photo ? `<img src="${e(room.photo)}" alt="${e(room.photoAlt)}" loading="lazy">` : '';
  return `<article class="room-card">
    <div class="room-media">${photo}${badge(room.type, 'type')}</div>
    <div class="room-card-body">
      <h3>${e(room.name)}</h3>
      <p class="room-location">${e(room.building)} · ${e(room.number)} · этаж ${room.floor}</p>
      <div class="room-details"><span>До ${room.capacity} человек</span>
        ${room.rating === null ? '' : `<span class="rating" aria-label="Рейтинг ${room.rating} из пяти">★ ${room.rating.toFixed(1).replace('.', ',')}</span>`}
      </div>
      ${equipment(room.equipment)}
      <div>${room.approvalRequired ? badge('По согласованию', 'wait') : badge('Мгновенная бронь')}
        ${room.accessLevel === 'staff' ? badge('Для преподавателей', 'neutral') : ''}
      </div>
      <button class="${button} btn-sm" type="button" data-room="${room.id}">Посмотреть слоты</button>
    </div>
  </article>`;
}

async function loadRooms() {
  const id = ++catalogRequest;
  const params = new URLSearchParams(new FormData(filters));
  const target = $('#rooms');
  target.setAttribute('aria-busy', 'true');
  try {
    const { rooms } = await api('/rooms?' + params);
    if (id !== catalogRequest) return;
    const noun = { one: 'помещение', few: 'помещения', many: 'помещений' }[new Intl.PluralRules('ru').select(rooms.length)];
    $('#room-count').textContent = `${rooms.length} ${noun}`;
    target.innerHTML = rooms.length ? rooms.map(roomCard).join('') : empty('По этим фильтрам помещений нет.');
    target.querySelectorAll('[data-room]').forEach(element =>
      element.addEventListener('click', () => openRoom(Number(element.dataset.room), login)));
  } catch (error) {
    if (id !== catalogRequest) return;
    target.innerHTML = empty(error.message);
    $('#room-count').textContent = 'Каталог недоступен';
  } finally {
    if (id === catalogRequest) target.removeAttribute('aria-busy');
  }
}

filters.addEventListener('submit', event => {
  event.preventDefault();
  clearTimeout(inputTimer);
  loadRooms();
});
filters.addEventListener('input', () => {
  clearTimeout(inputTimer);
  inputTimer = setTimeout(loadRooms, 200);
});
filters.addEventListener('reset', () => {
  clearTimeout(inputTimer);
  inputTimer = setTimeout(loadRooms);
});
window.addEventListener('hashchange', renderView);

try {
  const [{ user }, catalog] = await Promise.all([api('/me'), api('/filters')]);
  state.user = user;
  state.today = catalog.today;
  state.timezone = catalog.timezone;
  for (const [name, list] of [['building', catalog.buildings], ['type', catalog.types], ['equipment', catalog.equipment]]) {
    for (const entry of list) filters.elements[name].add(new Option(entry.name, entry.id));
  }
  refreshIdentity();
  renderView();
} catch (error) {
  $('#room-count').textContent = 'Каталог недоступен';
  $('#rooms').innerHTML = empty(error.message);
}

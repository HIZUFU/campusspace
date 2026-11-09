import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Campus, HttpError } from './campus.js';
import { openDatabase } from './db.js';
import { seed } from './seed.js';

const publicDir = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const bootstrap = fileURLToPath(new URL('../node_modules/bootstrap/dist/css/bootstrap.min.css', import.meta.url));
const openApi = fileURLToPath(new URL('../docs/openapi.json', import.meta.url));
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8'
};

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': mime['.json'], 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function body(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new HttpError(415, 'Отправьте данные в формате JSON.');
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > 16 * 1024) {
      request.resume();
      throw new HttpError(413, 'Слишком большой запрос.');
    }
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error();
    return data;
  } catch {
    throw new HttpError(400, 'Тело запроса должно быть объектом JSON.');
  }
}

const cookie = 'campus_session';
function sessionToken(request) {
  return (request.headers.cookie ?? '').match(/(?:^|;\s*)campus_session=([\w-]+)(?:;|$)/)?.[1];
}

function setSession(response, token = '', maxAge = 0) {
  response.setHeader('Set-Cookie', `${cookie}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

const routes = [
  ['GET', '/api/health', null, () => ({ ok: true })],
  ['GET', '/api/filters', null, ({ campus }) => campus.filters()],
  ['GET', '/api/rooms', null, ({ campus, url }) => ({ rooms: campus.listRooms(url.searchParams) })],
  ['GET', '/api/rooms/:id', null, ({ campus, id }) => campus.room(id)],
  ['GET', '/api/rooms/:id/calendar', null, ({ campus, id, url }) => campus.calendar(id, url.searchParams.get('date'))],
  ['GET', '/api/rooms/:id/reviews', null, ({ campus, id }) => ({ reviews: campus.reviews(id) })],
  ['GET', '/api/me', null, ({ user }) => ({ user })],
  ['POST', '/api/session', null, async ({ campus, request, response, token }) => {
    const result = campus.login(await body(request));
    campus.logout(token);
    setSession(response, result.token, 86_400);
    return { user: result.user };
  }],
  ['DELETE', '/api/session', null, ({ campus, response, token }) => {
    campus.logout(token);
    setSession(response);
    return { ok: true };
  }],
  ['PATCH', '/api/me', 'member', async ({ campus, user, request }) => ({
    user: campus.updateUser(user, await body(request))
  })],
  ['GET', '/api/bookings', 'member', ({ campus, user }) => ({ bookings: campus.bookings(user) })],
  ['POST', '/api/bookings', 'member', async ({ campus, user, request }) => campus.createBookings(user, await body(request)), 201],
  ['POST', '/api/bookings/:id/cancel', 'member', ({ campus, user, id }) => campus.cancelBooking(user, id)],
  ['POST', '/api/series/:id/cancel', 'member', ({ campus, user, id }) => campus.cancelSeries(user, id)],
  ['POST', '/api/bookings/:id/review', 'member', async ({ campus, user, id, request }) =>
    campus.addReview(user, id, await body(request)), 201],
  ['GET', '/api/admin/requests', 'admin', ({ campus }) => ({ requests: campus.requests() })],
  ['POST', '/api/admin/requests/:id/decision', 'admin', async ({ campus, user, id, request }) =>
    campus.decide(user, id, await body(request))],
  ['GET', '/api/notifications', 'member', ({ campus, user }) => ({ notifications: campus.notifications(user) })],
  ['PATCH', '/api/notifications', 'member', ({ campus, user }) => {
    campus.markNotifications(user);
    return { ok: true };
  }]
].map(([method, path, role, handler, status = 200]) => ({
  method, pattern: new RegExp('^' + path.replace(':id', '([1-9][0-9]*)') + '$'), role, handler, status
}));

async function serveApi(request, response, url, campus) {
  const route = routes.find(item => item.method === request.method && item.pattern.test(url.pathname));
  if (!route) throw new HttpError(404, 'Маршрут API не найден.');
  const token = sessionToken(request);
  const user = campus.user(token);
  if (route.role && !user) throw new HttpError(401, 'Войдите в учётную запись.');
  if (route.role === 'admin' && user.role !== 'admin') throw new HttpError(403, 'Доступно администратору.');
  const matched = route.pattern.exec(url.pathname)[1];
  const id = matched === undefined ? null : Number(matched);
  if (id !== null && !Number.isSafeInteger(id)) throw new HttpError(404, 'Объект не найден.');
  const result = await route.handler({ campus, request, response, url, user, token, id });
  json(response, route.status, result);
}

function serveStatic(request, response, path) {
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'Метод не поддерживается.');
  const special = { '/vendor/bootstrap.css': bootstrap, '/api-spec.json': openApi };
  const publicFile = resolve(publicDir, '.' + (path === '/' ? '/index.html' : path));
  const file = Object.hasOwn(special, path) ? special[path] : publicFile;
  if (!Object.hasOwn(special, path) && !file.startsWith(publicDir + sep)) throw new HttpError(404, 'Страница не найдена.');
  const stat = statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile()) throw new HttpError(404, 'Страница не найдена.');
  response.writeHead(200, {
    'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
    'Content-Length': stat.size
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on('error', error => response.destroy(error));
  response.on('close', () => stream.destroy());
  stream.pipe(response);
}

export function createCampusServer(db = openDatabase()) {
  seed(db);
  const campus = new Campus(db);
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) await serveApi(request, response, url, campus);
      else serveStatic(request, response, decodeURIComponent(url.pathname));
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof HttpError) json(response, error.status, { error: error.message });
      else if (error instanceof URIError) json(response, 400, { error: 'Некорректный адрес.' });
      else {
        console.error(error);
        json(response, 500, { error: 'Ошибка сервера.' });
      }
    }
  });
  const timer = setInterval(() => {
    try { campus.reminders(); }
    catch (error) { console.error(error); }
  }, 60_000).unref();
  server.once('close', () => {
    clearInterval(timer);
    db.close();
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createCampusServer();
  const host = process.env.HOST || '127.0.0.1';
  server.listen(Number(process.env.PORT || 3000), host, () => {
    console.log(`CampusSpace открыт на http://${host}:${server.address().port}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}

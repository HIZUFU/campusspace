import { $, badge, e, empty } from './ui.js';

const target = $('#endpoints');

function details(path, method, endpoint) {
  const input = endpoint.requestBody?.content['application/json'];
  return `<details class="endpoint">
    <summary>${badge(method.toUpperCase())} <code>${e(path)}</code> · ${e(endpoint.summary)}</summary>
    <div class="pt-2">
      ${endpoint.description ? `<p>${e(endpoint.description)}</p>` : ''}
      ${endpoint.security ? '<p class="muted">Нужна активная сессия campus_session.</p>' : ''}
      ${endpoint.parameters?.length ? `<h3 class="h6">Параметры</h3><ul>${endpoint.parameters.map(parameter => `
        <li><code>${e(parameter.name)}</code> · ${parameter.required ? 'обязательный' : 'необязательный'}.
        ${e(parameter.description)}</li>`).join('')}</ul>` : ''}
      ${input ? `<h3 class="h6">Тело запроса JSON</h3><pre>${e(JSON.stringify(input.example ?? input.schema, null, 2))}</pre>` : ''}
      <h3 class="h6">Ответы</h3><ul>${Object.entries(endpoint.responses).map(([code, response]) => `
        <li><code>${e(code)}</code> · ${e(response.description)}</li>`).join('')}</ul>
    </div>
  </details>`;
}

try {
  const response = await fetch('/api-spec.json');
  if (!response.ok) throw new Error();
  const { paths } = await response.json();
  target.innerHTML = Object.entries(paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, endpoint]) => details(path, method, endpoint))).join('');
} catch {
  target.innerHTML = empty('Спецификация временно недоступна.');
}

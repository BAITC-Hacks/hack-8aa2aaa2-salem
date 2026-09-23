export async function readApiResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let value: unknown;
  try {
    value = text.trim() ? JSON.parse(text) : undefined;
  } catch {
    // Infrastructure errors can contain HTML or no body. Never expose that
    // document or a JSON parser exception as a user-facing message.
  }
  if (!response.ok) {
    const detail = value && typeof value === 'object' && 'error' in value
      ? (value as { error?: { message?: unknown } }).error?.message
      : undefined;
    if (typeof detail === 'string') throw new Error(detail);
    if (response.status === 401 || response.status === 403) {
      throw new Error('Не удалось подтвердить доступ. Обновите страницу и войдите в аккаунт.');
    }
    throw new Error(`Сервис временно недоступен (HTTP ${response.status}). Повторите подключение.`);
  }
  if (!value || typeof value !== 'object') {
    throw new Error('Сервер вернул пустой или некорректный ответ. Повторите подключение.');
  }
  return value as T;
}

export async function api<T>(path: string, data?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  } catch {
    throw new Error('Не удалось связаться с сервером. Проверьте соединение и повторите запрос.');
  }
  return readApiResponse<T>(response);
}

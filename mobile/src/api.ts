import * as SecureStore from 'expo-secure-store';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 0) { super(message); }
}
let baseUrl = '';
let token = '';
let onUnauthorized: () => void = () => undefined;

export const store = {
  async load() { return { url: (await SecureStore.getItemAsync('server_url')) ?? '', token: (await SecureStore.getItemAsync('token')) ?? '', user: (await SecureStore.getItemAsync('username')) ?? '' }; },
  async save(k: 'server_url' | 'token' | 'username', v: string) { await SecureStore.setItemAsync(k, v); },
  async clearToken() { await SecureStore.deleteItemAsync('token'); },
};
export const configure = (o: { url?: string; token?: string; onUnauthorized?: () => void }) => {
  if (o.url !== undefined) baseUrl = normalizeUrl(o.url);
  if (o.token !== undefined) token = o.token;
  if (o.onUnauthorized) onUnauthorized = o.onUnauthorized;
};
export const getBaseUrl = () => baseUrl;
export const getToken = () => token;
export function normalizeUrl(u: string) { let s = u.trim().replace(/\/+$/, ''); if (s && !/^https?:\/\//i.test(s)) s = 'https://' + s; return s; }
export const wsUrl = () => baseUrl.replace(/^http/i, 'ws') + '/api/ws';

async function request<T>(method: string, path: string, body?: unknown, form?: FormData, timeoutMs = 30000): Promise<T> {
  if (!baseUrl) throw new ApiError('NO_SERVER', 'No hosting server configured. Enter your server URL first.');
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(baseUrl + path, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined), signal: ctl.signal });
  } catch (e) {
    throw new ApiError('SERVER_UNREACHABLE', ctl.signal.aborted ? `The server at ${baseUrl} did not answer in time.` : `Cannot reach the hosting server at ${baseUrl}. Check the URL, your internet connection and that the backend is running.`);
  } finally { clearTimeout(timer); }
  const text = await res.text();
  let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    if (res.status === 401 && token && path !== '/api/auth/login') onUnauthorized();
    throw new ApiError(json?.error?.code ?? 'HTTP_' + res.status, json?.error?.message ?? `Server returned HTTP ${res.status}.`, res.status);
  }
  return json as T;
}
export const api = {
  get: <T,>(p: string) => request<T>('GET', p),
  post: <T,>(p: string, b?: unknown, ms?: number) => request<T>('POST', p, b ?? {}, undefined, ms),
  put: <T,>(p: string, b: unknown) => request<T>('PUT', p, b),
  patch: <T,>(p: string, b: unknown) => request<T>('PATCH', p, b),
  del: <T,>(p: string) => request<T>('DELETE', p),
  upload: <T,>(p: string, f: FormData) => request<T>('POST', p, undefined, f, 300000),
};

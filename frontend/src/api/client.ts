import type {
  AuthResponse,
  LinkPublic,
  LinkAnalytics,
  ApiKeySummary,
  CreateLinkOptions,
  ApiErrorBody,
} from './types';

/**
 * In local development / the docker-compose stack, the frontend and API
 * share an origin (nginx proxies /api to the API container — see
 * frontend/nginx.conf), so a relative path works and no CORS is ever
 * involved. When deployed separately (frontend on Vercel, API on Render
 * or elsewhere), VITE_API_BASE_URL points at the API's own domain and the
 * backend's ALLOWED_ORIGINS must include the Vercel domain — see
 * frontend/.env.example and the root README's deployment section.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

const ACCESS_TOKEN_KEY = 'shortlink_access_token';
const REFRESH_TOKEN_KEY = 'shortlink_refresh_token';

/**
 * Tokens live in localStorage rather than an in-memory-only store: this is
 * a real multi-page app (not a single embedded widget), and without
 * persistence a page refresh would silently log the user out — worse UX
 * than the (mitigated) XSS-exfiltration risk localStorage carries, given
 * this app has no third-party script injection surface (no user-supplied
 * HTML is ever rendered unescaped — see LinkRow's use of plain text
 * nodes throughout). Access tokens are short-lived (15 min, see backend
 * config) specifically so this tradeoff stays reasonable.
 */
export const tokenStore = {
  getAccess: () => localStorage.getItem(ACCESS_TOKEN_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_TOKEN_KEY),
  set: (accessToken: string, refreshToken: string) => {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  },
  setAccessOnly: (accessToken: string) => localStorage.setItem(ACCESS_TOKEN_KEY, accessToken),
  clear: () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number
  ) {
    super(message);
  }
}

let refreshInFlight: Promise<string | null> | null = null;

/**
 * If the access token has expired mid-session, transparently exchange the
 * refresh token for a new one and retry — once. De-duplicated via
 * `refreshInFlight` so N concurrent 401s (e.g. a dashboard firing several
 * requests at once) trigger exactly one refresh call, not N.
 */
async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = tokenStore.getRefresh();
    if (!refreshToken) return null;
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        tokenStore.clear();
        return null;
      }
      const { accessToken } = (await res.json()) as { accessToken: string };
      tokenStore.setAccessOnly(accessToken);
      return accessToken;
    } catch {
      return null;
    }
  })();

  const result = await refreshInFlight;
  refreshInFlight = null;
  return result;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean; // defaults to true; set false for public endpoints (register/login/quick-create)
  headers?: Record<string, string>;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, headers = {} } = opts;

  const doFetch = async (): Promise<Response> => {
    const finalHeaders: Record<string, string> = { ...headers };
    if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
    if (auth) {
      const token = tokenStore.getAccess();
      if (token) finalHeaders['Authorization'] = `Bearer ${token}`;
    }
    return fetch(`${API_BASE}/api/v1${path}`, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let res = await doFetch();

  if (res.status === 401 && auth && tokenStore.getRefresh()) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await doFetch();
    }
  }

  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      // response had no JSON body (e.g. a raw 5xx from a proxy) — fall through
    }
    throw new ApiError(
      body?.error?.message ?? `Request failed with status ${res.status}`,
      body?.error?.code ?? 'UNKNOWN_ERROR',
      res.status
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  // ── Auth ─────────────────────────────────────────────────────────────
  register: (email: string, password: string, displayName?: string) =>
    request<AuthResponse>('/auth/register', { method: 'POST', auth: false, body: { email, password, displayName } }),

  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', { method: 'POST', auth: false, body: { email, password } }),

  logoutAll: () => request<void>('/auth/logout-all', { method: 'POST' }),

  // ── Anonymous quick-shorten (the homepage hero box) ─────────────────
  quickShorten: (url: string) =>
    request<{ link: LinkPublic }>('/links/quick', { method: 'POST', auth: false, body: { url } }),

  // ── Links (authenticated) ───────────────────────────────────────────
  createLink: (input: CreateLinkOptions) => request<{ link: LinkPublic }>('/links', { method: 'POST', body: input }),

  listLinks: (params: { cursor?: string; tag?: string; status?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.cursor) qs.set('cursor', params.cursor);
    if (params.tag) qs.set('tag', params.tag);
    if (params.status) qs.set('status', params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ links: LinkPublic[]; nextCursor: string | null }>(`/links${suffix}`);
  },

  updateLink: (code: string, input: Partial<CreateLinkOptions & { status: 'active' | 'disabled' }>) =>
    request<{ link: LinkPublic }>(`/links/${encodeURIComponent(code)}`, { method: 'PATCH', body: input }),

  deleteLink: (code: string) => request<void>(`/links/${encodeURIComponent(code)}`, { method: 'DELETE' }),

  getAnalytics: (code: string, days = 30) =>
    request<{ analytics: LinkAnalytics }>(`/links/${encodeURIComponent(code)}/analytics?days=${days}`),

  // ── API keys ─────────────────────────────────────────────────────────
  listApiKeys: () => request<{ apiKeys: ApiKeySummary[] }>('/api-keys'),
  createApiKey: (name: string) => request<{ apiKey: ApiKeySummary & { key: string } }>('/api-keys', { method: 'POST', body: { name } }),
  revokeApiKey: (id: string) => request<void>(`/api-keys/${id}`, { method: 'DELETE' }),
};

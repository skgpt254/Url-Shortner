export interface LinkPublic {
  shortCode: string;
  shortUrl: string;
  destinationUrl: string;
  status: 'active' | 'disabled' | 'expired' | 'pending_review' | 'blocked';
  isCustomAlias: boolean;
  hasPassword: boolean;
  maxClicks: number | null;
  clickCount: number;
  expiresAt: string | null;
  redirectType: number;
  tags: string[];
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface LinkAnalytics {
  totalClicks: number;
  uniqueVisitors: number;
  byDay: Array<{ day: string; clicks: number; uniqueVisitors: number }>;
  topReferrers: Array<{ referrerHost: string | null; clicks: number }>;
  topCountries: Array<{ countryCode: string | null; clicks: number }>;
  deviceBreakdown: Array<{ deviceType: string; clicks: number }>;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPreview: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
  revoked: boolean;
}

export interface CreateLinkOptions {
  url: string;
  customAlias?: string;
  expiresAt?: string;
  password?: string;
  maxClicks?: number;
  redirectType?: 301 | 302 | 307 | 308;
  tags?: string[];
  title?: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

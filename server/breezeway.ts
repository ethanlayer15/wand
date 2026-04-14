import { ENV } from "./_core/env";
import { getDb, logBreezewayAudit, getLatestBreezewayToken } from "./db";
import { breezewayTokens } from "../drizzle/schema";

// Auth URL: trailing slash is required — /public/auth/v1/client-login returns 404
const BREEZEWAY_AUTH_URL = "https://api.breezeway.io/public/auth/v1/";
// Refresh URL: uses the same base with refresh suffix
const BREEZEWAY_REFRESH_URL =
  "https://api.breezeway.io/public/auth/v1/refresh";
const BREEZEWAY_API_BASE = "https://api.breezeway.io/public/inventory/v1";

export interface BreezewayTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

class BreezewayAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BreezewayAuthError";
  }
}

class BreezewayDeleteBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BreezewayDeleteBlockedError";
  }
}

/**
 * Breezeway API client with JWT auth, auto-refresh, and strict safeguards
 * - Read-only by default
 * - DELETE operations are hard-blocked
 * - All API calls are audit-logged
 */
export class BreezewayClient {
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiresAt: number | null = null;
  private userId: number | undefined;

  constructor(clientId: string, clientSecret: string, userId?: number) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.userId = userId;
  }

  /**
   * Get or refresh the access token.
   * Priority: in-memory cache → DB-persisted token → refresh → full login
   */
  private async ensureValidToken(): Promise<string> {
    const now = Date.now();

    // 1. If we have a valid in-memory token, use it
    if (this.accessToken && this.tokenExpiresAt && now < this.tokenExpiresAt) {
      return this.accessToken;
    }

    // 2. Try loading from DB (another instance may have logged in recently)
    if (!this.accessToken) {
      try {
        const stored = await getLatestBreezewayToken();
        if (stored && stored.expiresAt && new Date(stored.expiresAt).getTime() > now + 60_000) {
          this.accessToken = stored.accessToken;
          this.refreshToken = stored.refreshToken;
          this.tokenExpiresAt = new Date(stored.expiresAt).getTime();
          console.log("[Breezeway] Loaded valid token from DB (expires in " + Math.round((this.tokenExpiresAt - now) / 60_000) + " min)");
          return this.accessToken;
        }
      } catch (err) {
        console.error("[Breezeway] Failed to load token from DB:", err);
      }
    }

    // 3. If we have a refresh token, try to refresh
    if (this.refreshToken) {
      try {
        const tokens = await this.refreshAccessToken(this.refreshToken);
        this.accessToken = tokens.access_token;
        this.refreshToken = tokens.refresh_token;
        this.tokenExpiresAt = now + (tokens.expires_in || 86400) * 1000;
        await this.persistTokens();
        return this.accessToken;
      } catch (error) {
        console.error("[Breezeway] Token refresh failed:", error);
        // Fall through to full login
      }
    }

    // 4. Full login (with 429 retry)
    const tokens = await this.login();
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
    this.tokenExpiresAt = now + (tokens.expires_in || 86400) * 1000;
    await this.persistTokens();

    return this.accessToken;
  }

  /**
   * Persist tokens to database for sharing across client instances
   */
  private async persistTokens(): Promise<void> {
    const db = await getDb();
    if (db && this.accessToken && this.refreshToken && this.tokenExpiresAt) {
      try {
        await db.delete(breezewayTokens);
        await db.insert(breezewayTokens).values({
          accessToken: this.accessToken,
          refreshToken: this.refreshToken,
          expiresAt: new Date(this.tokenExpiresAt),
        });
      } catch (err) {
        console.error("[Breezeway] Failed to persist tokens:", err);
      }
    }
  }

  /**
   * Initial login with client credentials (with 429 retry)
   */
  private async login(retryCount = 0): Promise<BreezewayTokenResponse> {
    const startTime = Date.now();
    try {
      const response = await fetch(BREEZEWAY_AUTH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }),
      });

      const responseTime = Date.now() - startTime;

      // Handle 429 rate limit on login with retry
      if (response.status === 429) {
        const errorText = await response.text();
        await logBreezewayAudit(
          this.userId, "POST", "/public/auth/v1/",
          { client_id: this.clientId }, 429, responseTime, errorText
        );

        if (retryCount >= 2) {
          throw new BreezewayAuthError(`Login rate limited after ${retryCount} retries: ${errorText}`);
        }

        // Parse retry_after from response
        let waitMs = 30_000;
        try {
          const parsed = JSON.parse(errorText);
          if (parsed?.details?.retry_after) {
            const retryAfter = new Date(parsed.details.retry_after);
            waitMs = Math.max(retryAfter.getTime() - Date.now() + 1000, 5000);
          }
        } catch { /* ignore */ }

        console.warn(`[Breezeway] Login 429 rate limit (retry ${retryCount + 1}/2), waiting ${Math.round(waitMs / 1000)}s...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        return this.login(retryCount + 1);
      }

      if (!response.ok) {
        const error = await response.text();
        await logBreezewayAudit(
          this.userId,
          "POST",
          "/public/auth/v1/",
          { client_id: this.clientId },
          response.status,
          responseTime,
          error
        );
        throw new BreezewayAuthError(
          `Login failed: ${response.status} ${error}`
        );
      }

      const data = (await response.json()) as BreezewayTokenResponse;

      await logBreezewayAudit(
        this.userId,
        "POST",
        "/public/auth/v1/",
        { client_id: this.clientId },
        response.status,
        responseTime
      );

      return data;
    } catch (error) {
      if (error instanceof BreezewayAuthError) throw error;
      throw new BreezewayAuthError(`Login error: ${error}`);
    }
  }

  /**
   * Refresh access token using refresh token
   * NOTE: Breezeway requires the refresh token in the Authorization header,
   * not in the request body.
   */
  private async refreshAccessToken(
    refreshToken: string
  ): Promise<BreezewayTokenResponse> {
    const startTime = Date.now();
    try {
      const response = await fetch(BREEZEWAY_REFRESH_URL, {
        method: "POST",
        headers: {
          // Refresh token goes in Authorization header, not body
          Authorization: `JWT ${refreshToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        const error = await response.text();
        await logBreezewayAudit(
          this.userId,
          "POST",
          "/public/auth/v1/client-refresh",
          {},
          response.status,
          responseTime,
          error
        );
        throw new BreezewayAuthError(
          `Token refresh failed: ${response.status} ${error}`
        );
      }

      const data = (await response.json()) as BreezewayTokenResponse;

      await logBreezewayAudit(
        this.userId,
        "POST",
        "/public/auth/v1/client-refresh",
        {},
        response.status,
        responseTime
      );

      return data;
    } catch (error) {
      if (error instanceof BreezewayAuthError) throw error;
      throw new BreezewayAuthError(`Token refresh error: ${error}`);
    }
  }

  /**
   * Make a GET request (read-only) with automatic 429 retry/backoff
   */
  async get<T>(endpoint: string, params?: Record<string, any>, retryCount = 0): Promise<T> {
    const token = await this.ensureValidToken();
    const url = new URL(`${BREEZEWAY_API_BASE}${endpoint}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const startTime = Date.now();
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `JWT ${token}`,
        Accept: "application/json",
      },
    });

    const responseTime = Date.now() - startTime;

    // Handle 429 rate limit with retry
    if (response.status === 429) {
      const errorText = await response.text();
      await logBreezewayAudit(this.userId, "GET", endpoint, params, 429, responseTime, errorText);

      if (retryCount >= 3) {
        throw new Error(`GET ${endpoint} rate limited after ${retryCount} retries: ${errorText}`);
      }

      // Parse retry_after from response body
      let waitMs = 30_000; // default 30s
      try {
        const parsed = JSON.parse(errorText);
        if (parsed?.details?.retry_after) {
          const retryAfter = new Date(parsed.details.retry_after);
          const now = Date.now();
          waitMs = Math.max(retryAfter.getTime() - now + 1000, 5000); // +1s buffer
        }
      } catch { /* ignore parse errors */ }

      console.warn(`[Breezeway] 429 rate limit on ${endpoint} (retry ${retryCount + 1}/3), waiting ${Math.round(waitMs / 1000)}s...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return this.get<T>(endpoint, params, retryCount + 1);
    }

    if (!response.ok) {
      const error = await response.text();
      await logBreezewayAudit(this.userId, "GET", endpoint, params, response.status, responseTime, error);
      throw new Error(`GET ${endpoint} failed: ${response.status} ${error.slice(0, 200)}`);
    }

    const data = await response.json();
    await logBreezewayAudit(this.userId, "GET", endpoint, params, response.status, responseTime);
    return data as T;
  }

  /**
   * Make a POST request (write)
   */
  async post<T>(
    endpoint: string,
    body: Record<string, any>
  ): Promise<T> {
    const token = await this.ensureValidToken();

    const startTime = Date.now();
    try {
      const response = await fetch(`${BREEZEWAY_API_BASE}${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `JWT ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });

      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        const error = await response.text();
        await logBreezewayAudit(
          this.userId,
          "POST",
          endpoint,
          body,
          response.status,
          responseTime,
          error
        );
        throw new Error(`POST ${endpoint} failed: ${response.status}`);
      }

      const data = await response.json();

      await logBreezewayAudit(
        this.userId,
        "POST",
        endpoint,
        body,
        response.status,
        responseTime
      );

      return data as T;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Make a PATCH request (write)
   */
  async patch<T>(
    endpoint: string,
    body: Record<string, any>
  ): Promise<T> {
    const token = await this.ensureValidToken();

    const startTime = Date.now();
    try {
      const response = await fetch(`${BREEZEWAY_API_BASE}${endpoint}`, {
        method: "PATCH",
        headers: {
          Authorization: `JWT ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });

      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        const error = await response.text();
        await logBreezewayAudit(
          this.userId,
          "PATCH",
          endpoint,
          body,
          response.status,
          responseTime,
          error
        );
        throw new Error(`PATCH ${endpoint} failed: ${response.status}`);
      }

      const data = await response.json();

      await logBreezewayAudit(
        this.userId,
        "PATCH",
        endpoint,
        body,
        response.status,
        responseTime
      );

      return data as T;
    } catch (error) {
      throw error;
    }
  }

  /**
   * DELETE is hard-blocked - throws immediately
   */
  async delete(_endpoint: string, _body?: Record<string, any>): Promise<never> {
    throw new BreezewayDeleteBlockedError(
      "DELETE operations are not allowed on Breezeway API"
    );
  }

  /**
   * Hard-delete a Breezeway TASK. This bypasses the generic DELETE block and
   * is the only whitelisted destructive action — used for user-confirmed
   * "Ignore" in Wand. Properties, reservations, etc. stay blocked.
   */
  async deleteTask(taskId: number | string): Promise<void> {
    const token = await this.ensureValidToken();
    const endpoint = `/task/${taskId}/`;
    const startTime = Date.now();
    const response = await fetch(`${BREEZEWAY_API_BASE}${endpoint}`, {
      method: "DELETE",
      headers: {
        Authorization: `JWT ${token}`,
        Accept: "application/json",
      },
    });
    const responseTime = Date.now() - startTime;
    if (!response.ok && response.status !== 204) {
      const error = await response.text();
      await logBreezewayAudit(
        this.userId,
        "DELETE",
        endpoint,
        undefined,
        response.status,
        responseTime,
        error
      );
      throw new Error(`DELETE ${endpoint} failed: ${response.status}`);
    }
    await logBreezewayAudit(
      this.userId,
      "DELETE",
      endpoint,
      undefined,
      response.status,
      responseTime
    );
  }

  /**
   * Load tokens from database (for server startup)
   */
  async loadTokensFromDb(): Promise<void> {
    const latestToken = await getLatestBreezewayToken();
    if (latestToken) {
      this.accessToken = latestToken.accessToken;
      this.refreshToken = latestToken.refreshToken;
      this.tokenExpiresAt = latestToken.expiresAt.getTime();
    }
  }
}

/**
 * Factory to create a Breezeway client with credentials from env
 */
export function createBreezewayClient(userId?: number): BreezewayClient {
  const clientId = process.env.BREEZEWAY_CLIENT_ID || "";
  const clientSecret = process.env.BREEZEWAY_CLIENT_SECRET || "";

  if (!clientId || !clientSecret) {
    throw new Error(
      "BREEZEWAY_CLIENT_ID and BREEZEWAY_CLIENT_SECRET must be set"
    );
  }

  return new BreezewayClient(clientId, clientSecret, userId);
}

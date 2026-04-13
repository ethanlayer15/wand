/**
 * Hostaway API client.
 *
 * NOTE: This file was truncated during Manus zip export.
 * Core class and methods have been reconstructed from usage patterns.
 */

import axios, { type AxiosInstance } from "axios";
import { ENV } from "./_core/env";

export interface HostawayPaginatedResponse<T> {
  status: string;
  result: T[];
  count: number;
}

export interface HostawayConversation {
  id: number;
  reservationId?: number;
  listingMapId?: number;
  guestName?: string;
  conversationMessages?: HostawayMessage[];
  [key: string]: any;
}

export interface HostawayMessage {
  id: number;
  body?: string;
  senderName?: string;
  isIncoming?: boolean;
  insertedOn?: string;
  [key: string]: any;
}

class HostawayClient {
  private client: AxiosInstance;
  private accountId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(accountId: string, clientSecret: string) {
    this.accountId = accountId;
    this.clientSecret = clientSecret;
    this.client = axios.create({
      baseURL: "https://api.hostaway.com/v1",
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });
  }

  /**
   * Exchange the account_id + client_secret for a short-lived access token via
   * Hostaway's OAuth 2.0 client_credentials flow. Cached in memory until ~5 min
   * before expiry.
   *
   * Hostaway's /accessTokens endpoint:
   *   POST /accessTokens
   *   content-type: application/x-www-form-urlencoded
   *   body: grant_type=client_credentials&client_id=<accountId>&client_secret=<secret>&scope=general
   */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAt - 5 * 60 * 1000) {
      return this.accessToken;
    }
    if (!this.accountId || !this.clientSecret) {
      throw new Error(
        "[Hostaway] Missing credentials — HOSTAWAY_ACCOUNT_ID and HOSTAWAY_API_KEY must be set"
      );
    }
    try {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.accountId,
        client_secret: this.clientSecret,
        scope: "general",
      }).toString();
      const resp = await axios.post(
        "https://api.hostaway.com/v1/accessTokens",
        body,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Cache-Control": "no-cache",
          },
          timeout: 30000,
        }
      );
      const data = resp.data as {
        access_token: string;
        token_type?: string;
        expires_in?: number;
      };
      this.accessToken = data.access_token;
      // Hostaway tokens live ~24 months by default but respect the returned
      // expires_in when present.
      const expiresInMs = (data.expires_in ?? 60 * 60 * 24) * 1000;
      this.tokenExpiresAt = now + expiresInMs;
      console.log(
        `[Hostaway] Obtained access token (expires in ${Math.round(expiresInMs / 1000 / 60)} min)`
      );
      return this.accessToken;
    } catch (err: any) {
      const status = err?.response?.status;
      const body = err?.response?.data;
      const bodyStr =
        typeof body === "string"
          ? body.slice(0, 500)
          : body
            ? JSON.stringify(body).slice(0, 500)
            : "(no body)";
      console.error(
        `[Hostaway] Token exchange failed: status=${status ?? "?"} body=${bodyStr}`
      );
      throw err;
    }
  }

  async get<T>(path: string, params?: Record<string, any>): Promise<T> {
    try {
      const token = await this.getAccessToken();
      const resp = await this.client.get(path, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });
      return resp.data;
    } catch (err: any) {
      // Surface the actual Hostaway error body so we can diagnose 4xx/5xx
      // failures. Axios buries the response body under err.response.data.
      const status = err?.response?.status;
      const body = err?.response?.data;
      const bodyStr =
        typeof body === "string"
          ? body.slice(0, 500)
          : body
            ? JSON.stringify(body).slice(0, 500)
            : "(no body)";
      console.error(
        `[Hostaway] GET ${path} failed: status=${status ?? "?"} params=${JSON.stringify(params ?? {})} body=${bodyStr}`
      );
      // On 401/403, force a token refresh on the next call in case our
      // cached token was revoked server-side.
      if (status === 401 || status === 403) {
        this.accessToken = null;
        this.tokenExpiresAt = 0;
      }
      throw err;
    }
  }

  async getListings(): Promise<any[]> {
    // First, try a single no-param call — that matches the legacy behaviour
    // that we know returned ~100-114 rows without any 4xx errors.
    const firstResp = await this.get<{ result: any[]; count?: number }>("/listings");
    const first = firstResp.result || [];
    console.log(`[Hostaway] /listings single call returned ${first.length} rows (count=${firstResp.count ?? "?"})`);

    // If fewer than 100, there's no pagination to do.
    if (first.length < 100) return first;

    // Otherwise attempt paginated fetch using limit+offset (same pattern as
    // /conversations which is known to work). If pagination 4xxs, fall back
    // to whatever the single call gave us rather than failing the whole sync.
    try {
      const all: any[] = [...first];
      const limit = 100;
      let offset = first.length;
      const maxPages = 50;
      for (let page = 0; page < maxPages; page++) {
        const resp = await this.get<{ result: any[] }>("/listings", { limit, offset });
        const batch = resp.result || [];
        if (batch.length === 0) break;
        all.push(...batch);
        if (batch.length < limit) break;
        offset += limit;
      }
      console.log(`[Hostaway] /listings paginated total: ${all.length} rows`);
      return all;
    } catch (err: any) {
      console.error(
        `[Hostaway] /listings pagination failed (${err?.response?.status ?? "?"}) — falling back to single-page result of ${first.length}`
      );
      return first;
    }
  }

  async getReservations(listingId?: number): Promise<any[]> {
    const params: Record<string, any> = { limit: 100 };
    if (listingId) params.listingId = listingId;
    const resp = await this.get<{ result: any[] }>("/reservations", params);
    return resp.result || [];
  }

  async getConversations(
    limit = 100,
    offset = 0,
    sortOrder?: string
  ): Promise<HostawayPaginatedResponse<HostawayConversation>> {
    const params: Record<string, string | number> = { limit, offset };
    if (sortOrder) params.sortOrder = sortOrder;
    return this.get<HostawayPaginatedResponse<HostawayConversation>>(
      "/conversations",
      params
    );
  }

  async getRecentConversations(maxConversations = 500): Promise<HostawayConversation[]> {
    const all: HostawayConversation[] = [];
    let offset = 0;
    const limit = 100;
    const maxPages = Math.ceil(maxConversations / limit);
    let page = 0;

    while (page < maxPages) {
      const resp = await this.getConversations(limit, offset, "latestActivity");
      all.push(...resp.result);
      page++;
      if (resp.result.length < limit || all.length >= maxConversations) break;
      offset += limit;
    }

    return all.slice(0, maxConversations);
  }

  async getReservation(reservationId: number): Promise<any | null> {
    try {
      const resp = await this.get<{ result: any }>(`/reservations/${reservationId}`);
      return resp.result || null;
    } catch {
      return null;
    }
  }

  async getConversationMessages(
    conversationId: number,
    limit = 100,
    offset = 0
  ): Promise<HostawayPaginatedResponse<HostawayMessage>> {
    return this.get<HostawayPaginatedResponse<HostawayMessage>>(
      `/conversations/${conversationId}/messages`,
      { limit, offset }
    );
  }

  async getAllConversationMessages(conversationId: number): Promise<HostawayMessage[]> {
    const all: HostawayMessage[] = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const page = await this.getConversationMessages(conversationId, limit, offset);
      all.push(...page.result);
      if (page.result.length < limit) break;
      offset += limit;
    }
    return all;
  }

  async getReviews(listingId?: number, limit = 100, offset = 0): Promise<{ result: any[] }> {
    const params: Record<string, any> = { limit, offset };
    if (listingId) params.listingId = listingId;
    const resp = await this.get<{ result: any[] }>("/reviews", params);
    return { result: resp.result || [] };
  }

  async getAllReviews(maxReviews = 30000): Promise<any[]> {
    const all: any[] = [];
    let offset = 0;
    const limit = 100;
    const maxPages = Math.ceil(maxReviews / limit);
    let page = 0;

    while (page < maxPages) {
      const resp = await this.getReviews(undefined, limit, offset);
      all.push(...resp.result);
      page++;
      if (resp.result.length < limit || all.length >= maxReviews) break;
      offset += limit;
    }

    console.log(`[Hostaway] Fetched ${all.length} reviews total (${page} pages)`);
    return all.slice(0, maxReviews);
  }
}

let cachedClient: HostawayClient | null = null;

export function getHostawayClient(): HostawayClient {
  if (!cachedClient) {
    cachedClient = new HostawayClient(ENV.hostawayAccountId, ENV.hostawayApiKey);
  }
  return cachedClient;
}

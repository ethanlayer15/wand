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

  constructor(apiKey: string) {
    this.client = axios.create({
      baseURL: "https://api.hostaway.com/v1",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });
  }

  async get<T>(path: string, params?: Record<string, any>): Promise<T> {
    try {
      const resp = await this.client.get(path, { params });
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

  async getAllReviews(maxReviews = 5000): Promise<any[]> {
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
    cachedClient = new HostawayClient(ENV.hostawayApiKey);
  }
  return cachedClient;
}

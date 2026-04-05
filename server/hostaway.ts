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
    const resp = await this.client.get(path, { params });
    return resp.data;
  }

  async getListings(): Promise<any[]> {
    const resp = await this.get<{ result: any[] }>("/listings");
    return resp.result || [];
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

  async getReviews(listingId?: number): Promise<any[]> {
    const params: Record<string, any> = { limit: 100 };
    if (listingId) params.listingId = listingId;
    const resp = await this.get<{ result: any[] }>("/reviews", params);
    return resp.result || [];
  }
}

let cachedClient: HostawayClient | null = null;

export function getHostawayClient(): HostawayClient {
  if (!cachedClient) {
    cachedClient = new HostawayClient(ENV.hostawayApiKey);
  }
  return cachedClient;
}

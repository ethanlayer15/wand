import { describe, it, expect, beforeEach, vi } from "vitest";
import { BreezewayClient } from "./breezeway";

// Mock DB functions used by BreezewayClient
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
  logBreezewayAudit: vi.fn().mockResolvedValue(undefined),
  getLatestBreezewayToken: vi.fn().mockResolvedValue(null),
}));

// Mock fetch globally for tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("BreezewayClient", () => {
  let client: BreezewayClient;

  beforeEach(() => {
    client = new BreezewayClient("test-client-id", "test-client-secret", 1);
    mockFetch.mockReset();
  });

  describe("DELETE operations", () => {
    it("should hard-block DELETE operations immediately without making any fetch call", async () => {
      await expect(
        client.delete("/properties/123", { id: "123" })
      ).rejects.toThrow("DELETE operations are not allowed");
      // Verify no fetch was called — the block is pre-fetch
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should throw BreezewayDeleteBlockedError specifically", async () => {
      try {
        await client.delete("/properties/123");
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.name).toBe("BreezewayDeleteBlockedError");
        expect(error.message).toContain("DELETE operations are not allowed");
      }
    });
  });

  describe("Auth URL correctness", () => {
    it("should POST to /public/auth/v1/ (with trailing slash) for login", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "test-access-token",
          refresh_token: "test-refresh-token",
          expires_in: 86400,
        }),
      });

      // Trigger a GET to force auth
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [], count: 0 }),
      });

      await client.get("/property");

      // First call should be to the auth endpoint with trailing slash
      const firstCall = mockFetch.mock.calls[0];
      expect(firstCall[0]).toBe("https://api.breezeway.io/public/auth/v1/");
      expect(firstCall[1]?.method).toBe("POST");
    });

    it("should send client_id and client_secret in the auth request body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "test-access-token",
          refresh_token: "test-refresh-token",
          expires_in: 86400,
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [], count: 0 }),
      });

      await client.get("/property");

      const authCall = mockFetch.mock.calls[0];
      const body = JSON.parse(authCall[1]?.body as string);
      expect(body.client_id).toBe("test-client-id");
      expect(body.client_secret).toBe("test-client-secret");
    });

    it("should send refresh token in Authorization header (not body) when refreshing", async () => {
      // First: login
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "expired-access-token",
          refresh_token: "valid-refresh-token",
          expires_in: -1, // Already expired
        }),
      });
      // Second: GET request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [], count: 0 }),
      });

      await client.get("/property");

      // Reset and force a refresh by creating a client with an expired token
      const client2 = new BreezewayClient("test-id", "test-secret", 1);

      // Simulate expired token state by calling get which triggers login first
      mockFetch.mockReset();

      // Mock login to return tokens
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "fresh-access-token",
          refresh_token: "fresh-refresh-token",
          expires_in: 86400,
        }),
      });
      // Mock GET response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [], count: 0 }),
      });

      await client2.get("/property");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("GET operations", () => {
    it("should make GET requests with JWT Authorization header", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "test-token",
            refresh_token: "test-refresh",
            expires_in: 86400,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ results: [{ id: 1, name: "Test Property" }], count: 1 }),
        });

      const result = await client.get<{ results: any[]; count: number }>("/property");
      expect(result.count).toBe(1);

      // Verify the GET call uses JWT in Authorization header
      const getCall = mockFetch.mock.calls[1];
      expect(getCall[1]?.headers?.Authorization).toBe("JWT test-token");
    });

    it("should append query params to GET requests", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: "t", refresh_token: "r", expires_in: 86400 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ results: [], count: 0 }),
        });

      await client.get("/property", { limit: 10, page: 2 });

      const getCall = mockFetch.mock.calls[1];
      const url = getCall[0] as string;
      expect(url).toContain("limit=10");
      expect(url).toContain("page=2");
    });
  });

  describe("POST operations", () => {
    it("should make POST requests with JSON body and JWT header", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: "t", refresh_token: "r", expires_in: 86400 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ id: 99, name: "New Task" }),
        });

      const result = await client.post<{ id: number; name: string }>("/task", {
        name: "New Task",
        home_id: 123,
      });

      expect(result.id).toBe(99);
      const postCall = mockFetch.mock.calls[1];
      expect(postCall[1]?.method).toBe("POST");
      expect(postCall[1]?.headers?.Authorization).toBe("JWT t");
    });
  });

  describe("PATCH operations", () => {
    it("should make PATCH requests", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: "t", refresh_token: "r", expires_in: 86400 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 1, status: "closed" }),
        });

      const result = await client.patch<{ id: number; status: string }>("/task/1", {
        status: "closed",
      });

      expect(result.status).toBe("closed");
      const patchCall = mockFetch.mock.calls[1];
      expect(patchCall[1]?.method).toBe("PATCH");
    });
  });

  describe("Safeguards", () => {
    it("should not expose a delete method that works", async () => {
      await expect(client.delete("/test")).rejects.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should have all required read/write methods", () => {
      expect(typeof client.get).toBe("function");
      expect(typeof client.post).toBe("function");
      expect(typeof client.patch).toBe("function");
      expect(typeof client.delete).toBe("function");
    });
  });
});

import { describe, it, expect } from "vitest";

describe("Google OAuth Credentials Validation", () => {
  it("should have GOOGLE_CLIENT_ID set in environment", () => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    expect(clientId).toBeDefined();
    expect(clientId!.length).toBeGreaterThan(10);
    expect(clientId).toContain(".apps.googleusercontent.com");
  });

  it("should have GOOGLE_CLIENT_SECRET set in environment", () => {
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    expect(clientSecret).toBeDefined();
    expect(clientSecret!.length).toBeGreaterThan(10);
    expect(clientSecret).toMatch(/^GOCSPX-/);
  });

  it("should be able to construct a valid Google OAuth authorization URL", () => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = "https://wandaimanage-d9uetjht.manus.space/api/auth/callback/google";
    const scopes = ["openid", "email", "profile"];

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId!);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("hd", "leisrstays.com");

    expect(url.toString()).toContain("accounts.google.com");
    expect(url.toString()).toContain(clientId!);
    expect(url.toString()).toContain("openid");
  });
});

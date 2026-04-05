/**
 * Google OAuth 2.0 routes for GSuite team login.
 *
 * Flow:
 * 1. GET /api/auth/google — redirects to Google consent screen
 * 2. GET /api/auth/callback/google — handles callback, creates session
 *
 * Only @leisrstays.com accounts with a valid team invitation (or existing user) can sign in.
 */
import { OAuth2Client } from "google-auth-library";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import * as db from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { ENV } from "./_core/env";

const ALLOWED_DOMAIN = "leisrstays.com";
const SCOPES = ["openid", "email", "profile"];

function getOAuth2Client(redirectUri: string) {
  return new OAuth2Client(
    ENV.googleClientId,
    ENV.googleClientSecret,
    redirectUri
  );
}

export function registerGoogleAuthRoutes(app: Express) {
  // ── Initiate Google OAuth ──────────────────────────────────────────
  app.get("/api/auth/google", (req: Request, res: Response) => {
    const origin = req.query.origin as string || `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${origin}/api/auth/callback/google`;

    const client = getOAuth2Client(redirectUri);

    // Generate CSRF state token
    const statePayload = JSON.stringify({
      csrf: crypto.randomBytes(16).toString("hex"),
      origin,
    });
    const state = Buffer.from(statePayload).toString("base64url");

    const authUrl = client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      state,
      hd: ALLOWED_DOMAIN, // Restrict to GSuite domain
      prompt: "select_account",
    });

    res.redirect(302, authUrl);
  });

  // ── Google OAuth Callback ──────────────────────────────────────────
  app.get("/api/auth/callback/google", async (req: Request, res: Response) => {
    const code = req.query.code as string;
    const state = req.query.state as string;
    const error = req.query.error as string;

    if (error) {
      console.error("[GoogleAuth] OAuth error:", error);
      res.redirect("/?error=google_auth_denied");
      return;
    }

    if (!code || !state) {
      res.status(400).json({ error: "Missing code or state parameter" });
      return;
    }

    try {
      // Parse state to get origin
      let origin: string;
      try {
        const statePayload = JSON.parse(Buffer.from(state, "base64url").toString());
        origin = statePayload.origin;
      } catch {
        origin = `${req.protocol}://${req.get("host")}`;
      }

      const redirectUri = `${origin}/api/auth/callback/google`;
      const client = getOAuth2Client(redirectUri);

      // Exchange code for tokens
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);

      // Verify the ID token
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token!,
        audience: ENV.googleClientId,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        res.redirect(`${origin}/?error=google_auth_failed`);
        return;
      }

      const { email, name, picture, sub: googleId, hd } = payload;

      // Server-side domain enforcement
      if (!email || !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        console.warn(`[GoogleAuth] Rejected non-${ALLOWED_DOMAIN} email: ${email}`);
        res.redirect(`${origin}/login?error=domain_restricted`);
        return;
      }

      // Check if user already exists by email
      const existingUser = await db.getUserByEmail(email);

      if (existingUser) {
        // Existing user — update last sign-in and avatar
        await db.upsertUser({
          openId: existingUser.openId,
          name: name || existingUser.name,
          avatarUrl: picture || undefined,
          loginMethod: "google",
          lastSignedIn: new Date(),
        });

        const sessionToken = await sdk.createSessionToken(existingUser.openId, {
          name: name || existingUser.name || "",
          expiresInMs: ONE_YEAR_MS,
        });

        const cookieOptions = getSessionCookieOptions(req);
        res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        res.redirect(`${origin}/`);
        return;
      }

      // New user — check for a valid invitation
      const invitation = await db.getValidInvitationByEmail(email);

      if (!invitation) {
        console.warn(`[GoogleAuth] No invitation found for: ${email}`);
        res.redirect(`${origin}/login?error=not_invited`);
        return;
      }

      // Create the new user from the invitation
      const openId = `google_${googleId}`;
      await db.upsertUser({
        openId,
        name: name || email.split("@")[0],
        email,
        avatarUrl: picture || undefined,
        loginMethod: "google",
        role: invitation.role as "admin" | "manager" | "member",
        lastSignedIn: new Date(),
      });

      // Mark invitation as accepted
      await db.acceptInvitation(invitation.id);

      // Create session
      const sessionToken = await sdk.createSessionToken(openId, {
        name: name || email.split("@")[0],
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(`${origin}/`);
    } catch (err: any) {
      console.error("[GoogleAuth] Callback failed:", err.message);
      res.redirect("/?error=google_auth_failed");
    }
  });
}

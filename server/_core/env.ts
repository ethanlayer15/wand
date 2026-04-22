export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  // Anthropic (Wand AI agents — Phase 1)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
  // S3 storage
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  awsS3Bucket: process.env.AWS_S3_BUCKET ?? "",
  awsRegion: process.env.AWS_REGION ?? "us-east-1",
  // Hostaway
  hostawayAccountId: process.env.HOSTAWAY_ACCOUNT_ID ?? "",
  hostawayApiKey: process.env.HOSTAWAY_API_KEY ?? "",
  // Breezeway
  breezewayClientId: process.env.BREEZEWAY_CLIENT_ID ?? "",
  breezewayClientSecret: process.env.BREEZEWAY_CLIENT_SECRET ?? "",
  // Stripe - STRIPE_LIVE_KEY takes precedence over the platform default STRIPE_SECRET_KEY
  stripeSecretKey: process.env.STRIPE_LIVE_KEY ?? process.env.STRIPE_SECRET_KEY ?? "",
  // Gmail (Viv email concierge)
  gmailUser: process.env.GMAIL_USER ?? "",
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD ?? "",
  // Quo (OpenPhone) SMS
  quoApiKey: process.env.QUO_API_KEY ?? "",
  quoPhoneNumber: process.env.QUO_PHONE_NUMBER ?? "+18287823571",
  // Slack
  //  SLACK_WEBHOOK_URL          — legacy / global fallback (cleaning reports with no per-listing webhook, etc.)
  //  OPS_SLACK_WEBHOOK_URL      — ops alerts: SDT + last-minute reservation changes
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL ?? "",
  opsSlackWebhookUrl:
    process.env.OPS_SLACK_WEBHOOK_URL ?? process.env.SLACK_WEBHOOK_URL ?? "",
  // Google OAuth
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  // Slack agent apps (Phase 1) — one app per agent, separate bot user + secret.
  slackWandaBotToken: process.env.SLACK_WANDA_BOT_TOKEN ?? "",
  slackWandaSigningSecret: process.env.SLACK_WANDA_SIGNING_SECRET ?? "",
  slackStarryBotToken: process.env.SLACK_STARRY_BOT_TOKEN ?? "",
  slackStarrySigningSecret: process.env.SLACK_STARRY_SIGNING_SECRET ?? "",
  // Channel Wanda uses for daily urgent-task digest posts
  leisrOpsSlackChannelId: process.env.LEISR_OPS_SLACK_CHANNEL_ID ?? "",
};

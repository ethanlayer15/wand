-- Phase 4 — Escalation routing
-- Tracks private group DMs opened by Wanda/Starry so we can dedupe
-- same-issue follow-ups within a 60-min window and audit fallback tiers.

CREATE TABLE `escalationGroupDms` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `agent` ENUM('wanda','starry') NOT NULL,
  `triggerSlackUserId` VARCHAR(64) NOT NULL,
  `intent` VARCHAR(64) NOT NULL,
  `listingId` INT NULL,
  `breezewayTaskId` VARCHAR(128) NULL,
  `groupDmChannelId` VARCHAR(64) NOT NULL,
  `onCallUserIds` JSON NULL,
  `fallbackTier` VARCHAR(32) NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expiresAt` TIMESTAMP NOT NULL,
  INDEX `idx_escal_dedupe` (`agent`, `triggerSlackUserId`, `intent`, `expiresAt`),
  INDEX `idx_escal_task` (`breezewayTaskId`)
);

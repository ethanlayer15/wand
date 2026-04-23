-- Onboarding — property-onboarding projects with staged handoffs.
-- Anyone can create a project; stages can run in parallel; per-project
-- ad-hoc checklist items + fields live inside the JSON columns so we
-- never need a schema migration to extend a single property.

-- ── Templates ───────────────────────────────────────────────────────────
CREATE TABLE `onboardingTemplates` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `slug` VARCHAR(64) NOT NULL UNIQUE,
  `name` VARCHAR(128) NOT NULL,
  `description` TEXT NULL,
  `kickoffFieldSchema` JSON NOT NULL,
  `stagesConfig` JSON NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ── Projects ────────────────────────────────────────────────────────────
CREATE TABLE `onboardingProjects` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `templateId` INT NOT NULL,
  `propertyName` VARCHAR(256) NOT NULL,
  `address` TEXT NULL,
  `listingId` INT NULL,
  `currentStageIndex` INT NOT NULL DEFAULT 0,
  `status` ENUM('active','blocked','done','cancelled') NOT NULL DEFAULT 'active',
  `kickoffData` JSON NULL,
  `createdBy` INT NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_onboarding_projects_template` (`templateId`),
  INDEX `idx_onboarding_projects_status` (`status`),
  INDEX `idx_onboarding_projects_listing` (`listingId`)
);

-- ── Stage Instances ─────────────────────────────────────────────────────
CREATE TABLE `onboardingStageInstances` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `projectId` INT NOT NULL,
  `stageIndex` INT NOT NULL,
  `stageKey` VARCHAR(64) NOT NULL,
  `ownerUserId` INT NULL,
  `state` ENUM('not_started','in_progress','done') NOT NULL DEFAULT 'not_started',
  `startedAt` TIMESTAMP NULL,
  `completedAt` TIMESTAMP NULL,
  `checklistState` JSON NULL,
  `stageData` JSON NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_onboarding_project_stage` (`projectId`, `stageIndex`),
  INDEX `idx_onboarding_stage_owner` (`ownerUserId`),
  INDEX `idx_onboarding_stage_state` (`state`)
);

-- ── Events (audit trail) ────────────────────────────────────────────────
CREATE TABLE `onboardingEvents` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `projectId` INT NOT NULL,
  `stageInstanceId` INT NULL,
  `eventType` ENUM(
    'project_created',
    'stage_started',
    'stage_completed',
    'stage_reopened',
    'notify_next',
    'reminder_sent',
    'comment_added',
    'field_updated',
    'checklist_item_added',
    'checklist_item_toggled',
    'owner_reassigned',
    'status_changed'
  ) NOT NULL,
  `actorUserId` INT NULL,
  `data` JSON NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_onboarding_events_project` (`projectId`),
  INDEX `idx_onboarding_events_type` (`eventType`)
);

CREATE TABLE `billingAuditLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`action` varchar(64) NOT NULL,
	`stripeCustomerId` varchar(128),
	`stripePaymentIntentId` varchar(128),
	`stripeInvoiceId` varchar(128),
	`amount` decimal(10,2),
	`details` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `billingAuditLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `billingRecord` (
	`id` int AUTO_INCREMENT NOT NULL,
	`breezewayTaskId` varchar(128) NOT NULL,
	`breezewayTaskName` varchar(256),
	`propertyId` varchar(128),
	`propertyName` varchar(256),
	`stripeCustomerId` varchar(128),
	`stripePaymentIntentId` varchar(128),
	`stripeInvoiceId` varchar(128),
	`amount` decimal(10,2) NOT NULL,
	`billingMethod` enum('card_on_file','invoice') NOT NULL,
	`billingStatus` enum('pending','charged','invoiced','failed') NOT NULL DEFAULT 'pending',
	`billedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `billingRecord_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `breezewayAuditLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`httpMethod` enum('GET','POST','PATCH','DELETE') NOT NULL,
	`endpoint` varchar(512) NOT NULL,
	`requestPayload` json,
	`responseStatus` int,
	`responseTime` int,
	`error` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `breezewayAuditLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `breezewayProperties` (
	`id` int AUTO_INCREMENT NOT NULL,
	`breezewayId` varchar(64) NOT NULL,
	`referencePropertyId` varchar(64),
	`name` text NOT NULL,
	`address` text,
	`city` varchar(128),
	`state` varchar(64),
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`photoUrl` text,
	`tags` text,
	`syncedAt` timestamp DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `breezewayProperties_id` PRIMARY KEY(`id`),
	CONSTRAINT `breezewayProperties_breezewayId_unique` UNIQUE(`breezewayId`)
);
--> statement-breakpoint
CREATE TABLE `breezewayTeam` (
	`id` int AUTO_INCREMENT NOT NULL,
	`breezewayId` varchar(64) NOT NULL,
	`firstName` varchar(128),
	`lastName` varchar(128),
	`email` varchar(320),
	`role` varchar(64),
	`active` boolean DEFAULT true,
	`syncedAt` timestamp DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `breezewayTeam_id` PRIMARY KEY(`id`),
	CONSTRAINT `breezewayTeam_breezewayId_unique` UNIQUE(`breezewayId`)
);
--> statement-breakpoint
CREATE TABLE `breezewayTokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accessToken` text NOT NULL,
	`refreshToken` text NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `breezewayTokens_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cleanerReceipts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerId` int NOT NULL,
	`month` varchar(7) NOT NULL,
	`receiptType` enum('cell_phone','vehicle_maintenance') NOT NULL,
	`fileUrl` text NOT NULL,
	`fileKey` varchar(512) NOT NULL,
	`fileName` varchar(512),
	`receiptStatus` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`notes` text,
	`uploadedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cleanerReceipts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cleanerReviewAttributions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reviewId` int NOT NULL,
	`cleanerId` int NOT NULL,
	`breezewayTaskId` varchar(128),
	`listingId` int NOT NULL,
	`reviewRating` int,
	`reviewSubmittedAt` timestamp,
	`taskCompletedAt` timestamp,
	`attributionConfidence` varchar(32) DEFAULT 'high',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cleanerReviewAttributions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cleanerScoreHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerId` int NOT NULL,
	`rollingScore` decimal(4,2) NOT NULL,
	`multiplier` decimal(3,1) NOT NULL,
	`reviewCount` int DEFAULT 0,
	`calculatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cleanerScoreHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cleaners` (
	`id` int AUTO_INCREMENT NOT NULL,
	`breezewayTeamId` int,
	`name` varchar(256) NOT NULL,
	`email` varchar(320),
	`quickbooksEmployeeId` varchar(128),
	`podId` int,
	`currentRollingScore` decimal(4,2),
	`currentMultiplier` decimal(3,1),
	`scoreLastCalculatedAt` timestamp,
	`dashboardToken` varchar(64),
	`active` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cleaners_id` PRIMARY KEY(`id`),
	CONSTRAINT `cleaners_dashboardToken_unique` UNIQUE(`dashboardToken`)
);
--> statement-breakpoint
CREATE TABLE `cleaningReportRecipients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listingId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`name` varchar(256),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cleaningReportRecipients_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cleaningReportsSent` (
	`id` int AUTO_INCREMENT NOT NULL,
	`completedCleanId` int NOT NULL,
	`breezewayTaskId` varchar(128) NOT NULL,
	`recipientEmails` text NOT NULL,
	`reportStatus` enum('sent','failed','no_recipients') NOT NULL DEFAULT 'sent',
	`errorMessage` text,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cleaningReportsSent_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `completedCleans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`breezewayTaskId` varchar(128) NOT NULL,
	`cleanerId` int,
	`listingId` int,
	`propertyName` varchar(256),
	`scheduledDate` timestamp,
	`completedDate` timestamp,
	`cleaningFee` decimal(10,2),
	`distanceMiles` decimal(6,2),
	`weekOf` varchar(10),
	`pairedCleanerId` int,
	`splitRatio` decimal(3,2) DEFAULT '1.00',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `completedCleans_id` PRIMARY KEY(`id`),
	CONSTRAINT `completedCleans_breezewayTaskId_unique` UNIQUE(`breezewayTaskId`)
);
--> statement-breakpoint
CREATE TABLE `customerMapping` (
	`id` int AUTO_INCREMENT NOT NULL,
	`breezewayOwnerId` varchar(128) NOT NULL,
	`breezewayOwnerName` varchar(256),
	`stripeCustomerId` varchar(128),
	`preferredBillingMethod` enum('card_on_file','invoice','ask_each_time') NOT NULL DEFAULT 'ask_each_time',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customerMapping_id` PRIMARY KEY(`id`),
	CONSTRAINT `customerMapping_breezewayOwnerId_unique` UNIQUE(`breezewayOwnerId`)
);
--> statement-breakpoint
CREATE TABLE `guestMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`hostawayMessageId` varchar(128),
	`hostawayConversationId` varchar(128) NOT NULL,
	`hostawayReservationId` varchar(128),
	`listingId` int,
	`guestName` varchar(256),
	`body` text,
	`isIncoming` boolean DEFAULT true,
	`sentAt` timestamp,
	`channelName` varchar(64),
	`reservationStatus` varchar(64),
	`aiAnalyzed` boolean DEFAULT false,
	`aiCategory` enum('cleaning','maintenance','improvement','compliment','question','complaint','other'),
	`aiSentiment` enum('positive','neutral','negative'),
	`aiUrgency` enum('low','medium','high','critical'),
	`aiSummary` text,
	`aiIssues` json,
	`aiActionItems` json,
	`taskId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `guestMessages_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_hostaway_msg` UNIQUE(`hostawayMessageId`)
);
--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` enum('hostaway','breezeway','amazon','slack') NOT NULL,
	`connected` boolean DEFAULT false,
	`status` enum('not_connected','connected','error','ready') NOT NULL DEFAULT 'not_connected',
	`lastSyncAt` timestamp,
	`errorMessage` text,
	`config` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integrations_id` PRIMARY KEY(`id`),
	CONSTRAINT `integrations_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `listings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`hostawayId` varchar(64) NOT NULL,
	`name` text NOT NULL,
	`internalName` text,
	`address` text,
	`city` varchar(128),
	`state` varchar(64),
	`country` varchar(64),
	`guestCapacity` int,
	`status` enum('active','inactive','archived') NOT NULL DEFAULT 'active',
	`photoUrl` text,
	`avgRating` decimal(3,2),
	`reviewCount` int DEFAULT 0,
	`bedroomTier` int,
	`distanceFromStorage` decimal(6,2),
	`cleaningFeeCharge` decimal(10,2),
	`podId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `listings_id` PRIMARY KEY(`id`),
	CONSTRAINT `listings_hostawayId_unique` UNIQUE(`hostawayId`)
);
--> statement-breakpoint
CREATE TABLE `podVendors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`podId` int NOT NULL,
	`name` varchar(256) NOT NULL,
	`phone` varchar(32),
	`email` varchar(320),
	`company` varchar(256),
	`specialty` enum('plumber','electrician','hvac','handyman','pest_control','landscaper','appliance_repair') NOT NULL,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `podVendors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pods` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`region` text,
	`storageAddress` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pods_id` PRIMARY KEY(`id`),
	CONSTRAINT `pods_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `propertyVendors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listingId` int NOT NULL,
	`name` varchar(256) NOT NULL,
	`phone` varchar(32),
	`email` varchar(320),
	`company` varchar(256),
	`propertyVendorSpecialty` enum('plumber','electrician','hvac','handyman','pest_control','landscaper','appliance_repair') NOT NULL,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `propertyVendors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rateCard` (
	`id` int AUTO_INCREMENT NOT NULL,
	`propertyId` varchar(128) NOT NULL,
	`propertyName` varchar(256),
	`csvName` varchar(256),
	`matchConfidence` varchar(32),
	`matchScore` int,
	`taskType` varchar(128) NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `rateCard_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reviewAnalysis` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reviewId` int NOT NULL,
	`listingId` int NOT NULL,
	`categories` json,
	`sentimentScore` int,
	`issues` json,
	`highlights` json,
	`cleanerMentioned` varchar(256),
	`summary` text,
	`analyzedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reviewAnalysis_id` PRIMARY KEY(`id`),
	CONSTRAINT `reviewAnalysis_reviewId_unique` UNIQUE(`reviewId`)
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`hostawayReviewId` varchar(64) NOT NULL,
	`listingId` int NOT NULL,
	`hostawayReservationId` varchar(128),
	`rating` int,
	`cleanlinessRating` int,
	`text` text,
	`privateFeedback` text,
	`guestName` varchar(256),
	`source` enum('airbnb','vrbo','booking','direct') NOT NULL DEFAULT 'airbnb',
	`flagged` boolean DEFAULT false,
	`flagReason` text,
	`sentiment` enum('positive','neutral','negative'),
	`reviewStatus` varchar(32),
	`reviewType` varchar(32),
	`submittedAt` timestamp,
	`isAnalyzed` boolean DEFAULT false,
	`aiActionable` boolean DEFAULT false,
	`aiConfidence` varchar(16),
	`aiSummary` text,
	`aiIssues` json,
	`aiSentimentScore` int,
	`aiCategories` json,
	`aiHighlights` json,
	`aiCleanerMentioned` varchar(256),
	`taskId` int,
	`arrivalDate` timestamp,
	`departureDate` timestamp,
	`channelId` int,
	`hostResponse` text,
	`hostResponseSubmittedAt` timestamp,
	`hostResponseDraft` text,
	`hostResponseStatus` enum('none','draft','submitted','failed') DEFAULT 'none',
	`hostResponseError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `reviews_hostawayReviewId_unique` UNIQUE(`hostawayReviewId`)
);
--> statement-breakpoint
CREATE TABLE `taskAttachments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`url` text NOT NULL,
	`fileKey` varchar(512) NOT NULL,
	`fileName` varchar(512) NOT NULL,
	`mimeType` varchar(128) NOT NULL,
	`size` int NOT NULL,
	`uploadedBy` int,
	`uploadedByName` varchar(256),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `taskAttachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `taskComments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`userId` int NOT NULL,
	`userName` varchar(256) NOT NULL,
	`content` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `taskComments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`externalId` varchar(128),
	`externalSource` enum('hostaway','breezeway'),
	`listingId` int,
	`title` text NOT NULL,
	`description` text,
	`priority` enum('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
	`isUrgent` boolean NOT NULL DEFAULT false,
	`status` enum('created','needs_review','up_next','in_progress','completed','ignored','ideas_for_later') NOT NULL DEFAULT 'created',
	`category` enum('maintenance','cleaning','improvements') NOT NULL DEFAULT 'maintenance',
	`source` enum('airbnb_review','guest_message','manual','breezeway','wand_manual','review') NOT NULL DEFAULT 'wand_manual',
	`taskType` enum('maintenance','housekeeping','inspection','safety','improvements','other'),
	`syncStatus` enum('synced','pending_push','sync_error'),
	`lastSyncedAt` timestamp,
	`breezewayUpdatedAt` timestamp,
	`breezewayCreatedAt` timestamp,
	`hiddenFromBoard` boolean DEFAULT false,
	`statusOverridden` boolean DEFAULT false,
	`dueDate` timestamp,
	`assignedTo` varchar(256),
	`breezewayTaskId` varchar(128),
	`breezewayPushedAt` timestamp,
	`breezewayHomeId` int,
	`breezewayCreatorName` varchar(256),
	`hostawayReservationId` varchar(128),
	`arrivalDate` timestamp,
	`departureDate` timestamp,
	`resolutionStatus` enum('monitoring','likely_resolved','auto_resolved','reopened') DEFAULT 'monitoring',
	`resolutionConfidence` int,
	`resolutionReason` text,
	`resolvedAt` timestamp,
	`resolutionMessageId` int,
	`monitoringExpiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `teamInvitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`inviteRole` enum('manager','member') NOT NULL DEFAULT 'member',
	`invitedBy` int NOT NULL,
	`inviteStatus` enum('pending','accepted','revoked') NOT NULL DEFAULT 'pending',
	`token` varchar(128) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`acceptedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `teamInvitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `teamInvitations_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('admin','manager','member') NOT NULL DEFAULT 'member',
	`avatarUrl` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE TABLE `vivAirbnbBookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` varchar(512) NOT NULL,
	`uid` int NOT NULL,
	`confirmationCode` varchar(64),
	`propertyName` varchar(512),
	`guestName` varchar(256),
	`checkIn` varchar(32),
	`checkOut` varchar(32),
	`numGuests` int,
	`status` varchar(64) DEFAULT 'confirmed',
	`nightlyRate` varchar(64),
	`numNights` int,
	`autoArchived` boolean DEFAULT false,
	`rawSubject` text,
	`rawSnippet` text,
	`emailDate` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vivAirbnbBookings_id` PRIMARY KEY(`id`),
	CONSTRAINT `vivAirbnbBookings_messageId_unique` UNIQUE(`messageId`)
);
--> statement-breakpoint
CREATE TABLE `vivAirbnbReviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` varchar(512) NOT NULL,
	`uid` int NOT NULL,
	`propertyName` varchar(512),
	`guestName` varchar(256),
	`rating` int,
	`reviewSnippet` text,
	`highlights` json,
	`improvements` json,
	`aiProcessed` boolean DEFAULT false,
	`rawSubject` text,
	`rawSnippet` text,
	`emailDate` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vivAirbnbReviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `vivAirbnbReviews_messageId_unique` UNIQUE(`messageId`)
);
--> statement-breakpoint
CREATE TABLE `vivArchived` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` varchar(512) NOT NULL,
	`uid` int NOT NULL,
	`archivedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vivArchived_id` PRIMARY KEY(`id`),
	CONSTRAINT `vivArchived_messageId_unique` UNIQUE(`messageId`)
);
--> statement-breakpoint
CREATE TABLE `vivDraftCorrections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`originalDraft` text NOT NULL,
	`editedDraft` text NOT NULL,
	`emailSubject` text,
	`emailFrom` varchar(512),
	`emailSnippet` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vivDraftCorrections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vivLabels` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` varchar(512) NOT NULL,
	`label` varchar(128) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vivLabels_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vivSnooze` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` varchar(512) NOT NULL,
	`uid` int NOT NULL,
	`snoozeUntil` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vivSnooze_id` PRIMARY KEY(`id`),
	CONSTRAINT `vivSnooze_messageId_unique` UNIQUE(`messageId`)
);
--> statement-breakpoint
CREATE TABLE `vivTriageCache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` varchar(512) NOT NULL,
	`uid` int NOT NULL,
	`priority` enum('urgent','important','fyi','noise','high','low') NOT NULL DEFAULT 'low',
	`category` enum('owner_comms','guest_messages','vendor_maintenance','booking_platforms','financial_invoices','marketing_newsletters','team_internal','other') NOT NULL DEFAULT 'other',
	`summary` text,
	`suggestedAction` text,
	`needsReply` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vivTriageCache_id` PRIMARY KEY(`id`),
	CONSTRAINT `vivTriageCache_messageId_unique` UNIQUE(`messageId`)
);
--> statement-breakpoint
CREATE TABLE `vivVoiceProfile` (
	`id` int AUTO_INCREMENT NOT NULL,
	`profile` json NOT NULL,
	`sampleCount` int DEFAULT 0,
	`lastUpdated` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vivVoiceProfile_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `weeklyPaySnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerId` int NOT NULL,
	`weekOf` varchar(10) NOT NULL,
	`totalCleans` int DEFAULT 0,
	`totalCleaningFees` decimal(10,2) DEFAULT '0',
	`basePay` decimal(10,2) DEFAULT '0',
	`qualityScore` decimal(4,2),
	`qualityMultiplier` decimal(3,2) DEFAULT '1.00',
	`qualityTierLabel` varchar(64),
	`weeklyRevenue` decimal(10,2) DEFAULT '0',
	`volumeMultiplier` decimal(3,2) DEFAULT '1.00',
	`volumeTierLabel` varchar(32),
	`totalMileage` decimal(8,2) DEFAULT '0',
	`mileageRate` decimal(4,3) DEFAULT '0.700',
	`mileagePay` decimal(10,2) DEFAULT '0',
	`cellPhoneReimbursement` decimal(10,2) DEFAULT '0',
	`vehicleReimbursement` decimal(10,2) DEFAULT '0',
	`totalPay` decimal(10,2) DEFAULT '0',
	`calculatedAt` timestamp NOT NULL DEFAULT (now()),
	`emailSentAt` timestamp,
	CONSTRAINT `weeklyPaySnapshots_id` PRIMARY KEY(`id`)
);

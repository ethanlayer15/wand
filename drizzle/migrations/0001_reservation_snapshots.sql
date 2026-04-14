CREATE TABLE `reservationSnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`breezewayReservationId` varchar(64) NOT NULL,
	`homeId` int NOT NULL,
	`checkIn` varchar(32),
	`checkOut` varchar(32),
	`status` varchar(64),
	`guestName` text,
	`lastChangeHash` varchar(128),
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reservationSnapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `reservationSnapshots_breezewayReservationId_unique` UNIQUE(`breezewayReservationId`)
);

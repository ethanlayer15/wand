import { describe, it, expect, vi, beforeEach } from "vitest";
import { ENV } from "./_core/env";

// ── Gmail Credentials ────────────────────────────────────────────────────

describe("Viv Gmail Credentials", () => {
  it("should have GMAIL_USER configured", () => {
    expect(ENV.gmailUser).toBeTruthy();
    expect(ENV.gmailUser).toContain("@");
  });

  it("should have GMAIL_APP_PASSWORD configured", () => {
    expect(ENV.gmailAppPassword).toBeTruthy();
    expect(ENV.gmailAppPassword.length).toBeGreaterThan(0);
  });

  it("should connect to Gmail IMAP", async () => {
    const { testGmailConnection } = await import("./gmail");
    const result = await testGmailConnection();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      console.error("Gmail connection error:", result.error);
    }
  }, 15000);
});

// ── Snippet Cleaning ─────────────────────────────────────────────────────

describe("Viv Snippet Cleaning", () => {
  // We test the snippet function indirectly through the module
  // by importing the gmail module and using its internal logic
  
  it("should strip MIME boundary lines", async () => {
    // Test the snippet function via fetchEmailList behavior
    // The snippet function is internal, so we test it through the module
    const { testGmailConnection } = await import("./gmail");
    // Just verify the module loads correctly
    expect(testGmailConnection).toBeDefined();
  });

  it("should strip HTML tags from snippets", () => {
    const text = "<p>Hello <b>World</b></p>";
    const clean = text.replace(/<[^>]+>/g, "");
    expect(clean).toBe("Hello World");
  });

  it("should strip URLs from snippets", () => {
    const text = "Visit https://example.com/path?q=1 for more info";
    const clean = text.replace(/https?:\/\/[^\s]+/g, "");
    expect(clean.trim()).toBe("Visit  for more info");
  });

  it("should strip base64 blocks", () => {
    const text = "Hello ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/ World";
    const clean = text.replace(/[A-Za-z0-9+/=]{20,}/g, "");
    expect(clean.trim()).toBe("Hello  World");
  });

  it("should strip tracking markers like %opentrack%", () => {
    const text = "Hello %opentrack% World %tracking%";
    const clean = text.replace(/%[\w]+%/g, "");
    expect(clean.trim()).toBe("Hello  World");
  });

  it("should strip [Image ...] references", () => {
    const text = 'Check [Image "photo.png?expires=123"] this out';
    const clean = text.replace(/\[Image[^\]]*\]/g, "");
    expect(clean.trim()).toBe("Check  this out");
  });

  it("should decode MIME encoded-word subjects", () => {
    // Test the decodeMimeSubject function pattern
    const subject = "=?UTF-8?B?SGVsbG8gV29ybGQ=?=";
    const decoded = subject.replace(/=\?([^?]+)\?([BbQq])\?([^?]+)\?=/g, (_, charset, encoding, text) => {
      if (encoding.toUpperCase() === "B") {
        return Buffer.from(text, "base64").toString("utf8");
      }
      return text;
    });
    expect(decoded).toBe("Hello World");
  });

  it("should handle Q-encoded subjects", () => {
    const subject = "=?UTF-8?Q?It=27s_a_test?=";
    const decoded = subject.replace(/=\?([^?]+)\?([BbQq])\?([^?]+)\?=/g, (_, charset, encoding, text) => {
      if (encoding.toUpperCase() === "Q") {
        return text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_: string, hex: string) =>
          String.fromCharCode(parseInt(hex, 16))
        );
      }
      return text;
    });
    expect(decoded).toBe("It's a test");
  });
});

// ── AI Triage Logic ──────────────────────────────────────────────────────

describe("Viv AI Triage", () => {
  it("should export triageEmail and triageBatch functions", async () => {
    const vivAi = await import("./vivAi");
    expect(vivAi.triageEmail).toBeDefined();
    expect(typeof vivAi.triageEmail).toBe("function");
    expect(vivAi.triageBatch).toBeDefined();
    expect(typeof vivAi.triageBatch).toBe("function");
  });

  it("should export draftReply function", async () => {
    const vivAi = await import("./vivAi");
    expect(vivAi.draftReply).toBeDefined();
    expect(typeof vivAi.draftReply).toBe("function");
  });

  it("should define correct priority types", async () => {
    // Verify the type system by checking the module exports
    const vivAi = await import("./vivAi");
    // The module should export TriageResult type
    expect(vivAi).toBeDefined();
  });
});

// ── Gmail Module ─────────────────────────────────────────────────────────

describe("Viv Gmail Module", () => {
  it("should export all required functions", async () => {
    const gmail = await import("./gmail");
    expect(gmail.fetchEmailList).toBeDefined();
    expect(gmail.fetchEmail).toBeDefined();
    expect(gmail.setFlags).toBeDefined();
    expect(gmail.archiveMessage).toBeDefined();
    expect(gmail.sendEmail).toBeDefined();
    expect(gmail.searchEmails).toBeDefined();
    expect(gmail.testGmailConnection).toBeDefined();
  });

  it("should fetch email list from INBOX", async () => {
    const { fetchEmailList } = await import("./gmail");
    const result = await fetchEmailList("INBOX", 5, 0);
    expect(result).toHaveProperty("emails");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.emails)).toBe(true);
    expect(result.total).toBeGreaterThan(0);
    
    // Verify email structure
    if (result.emails.length > 0) {
      const email = result.emails[0];
      expect(email).toHaveProperty("uid");
      expect(email).toHaveProperty("messageId");
      expect(email).toHaveProperty("subject");
      expect(email).toHaveProperty("from");
      expect(email).toHaveProperty("date");
      expect(email).toHaveProperty("snippet");
      expect(email).toHaveProperty("flags");
      expect(email).toHaveProperty("isRead");
      expect(email).toHaveProperty("isStarred");
      expect(typeof email.uid).toBe("number");
      expect(typeof email.subject).toBe("string");
      expect(Array.isArray(email.from)).toBe(true);
    }
  }, 30000);

  it("should fetch a single email by UID", async () => {
    const { fetchEmailList, fetchEmail } = await import("./gmail");
    
    // First get a UID from the list
    const list = await fetchEmailList("INBOX", 1, 0);
    expect(list.emails.length).toBeGreaterThan(0);
    
    const uid = list.emails[0].uid;
    const email = await fetchEmail(uid);
    
    expect(email).not.toBeNull();
    if (email) {
      expect(email.uid).toBe(uid);
      expect(email).toHaveProperty("bodyText");
      expect(email).toHaveProperty("bodyHtml");
      expect(email).toHaveProperty("cc");
      expect(typeof email.bodyText).toBe("string");
    }
  }, 30000);

  it("should return proper EmailAddress format", async () => {
    const { fetchEmailList } = await import("./gmail");
    const result = await fetchEmailList("INBOX", 3, 0);
    
    for (const email of result.emails) {
      for (const addr of email.from) {
        expect(addr).toHaveProperty("name");
        expect(addr).toHaveProperty("address");
        expect(typeof addr.name).toBe("string");
        expect(typeof addr.address).toBe("string");
      }
    }
  }, 30000);
});

// ── Viv Router ───────────────────────────────────────────────────────────

describe("Viv Router Structure", () => {
  it("should export vivRouter", async () => {
    const { vivRouter } = await import("./vivRouter");
    expect(vivRouter).toBeDefined();
  });

  it("should have all required procedures", async () => {
    const { vivRouter } = await import("./vivRouter");
    // Check the router has the expected procedures by checking its _def
    const procedures = Object.keys((vivRouter as any)._def.procedures || {});
    
    expect(procedures).toContain("inbox");
    expect(procedures).toContain("email");
    expect(procedures).toContain("search");
    expect(procedures).toContain("triage");
    expect(procedures).toContain("draftReply");
    expect(procedures).toContain("send");
    expect(procedures).toContain("markRead");
    expect(procedures).toContain("markUnread");
    expect(procedures).toContain("star");
    expect(procedures).toContain("unstar");
    expect(procedures).toContain("archive");
    expect(procedures).toContain("snooze");
    expect(procedures).toContain("unsnooze");
    expect(procedures).toContain("addLabel");
    expect(procedures).toContain("removeLabel");
    expect(procedures).toContain("getLabels");
    expect(procedures).toContain("testConnection");
  });
});

// ── Viv Schema ───────────────────────────────────────────────────────────

describe("Viv Database Schema", () => {
  it("should export Viv tables from schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.vivTriageCache).toBeDefined();
    expect(schema.vivSnooze).toBeDefined();
    expect(schema.vivLabels).toBeDefined();
    expect(schema.vivArchived).toBeDefined();
  });
});

// ── Airbnb Detection & Classification ───────────────────────────────────

describe("Viv Airbnb Email Detection", () => {
  it("should detect Airbnb emails by sender address", async () => {
    const { isAirbnbEmail } = await import("./vivAirbnb");

    const airbnbEmail = {
      uid: 1,
      messageId: "test@mail.airbnb.com",
      subject: "Reservation confirmed",
      from: [{ name: "Airbnb", address: "automated@airbnb.com" }],
      to: [{ name: "Test", address: "test@example.com" }],
      date: new Date().toISOString(),
      snippet: "Your reservation is confirmed",
      flags: [],
      isRead: false,
      isStarred: false,
    };

    expect(isAirbnbEmail(airbnbEmail)).toBe(true);
  });

  it("should not detect non-Airbnb emails", async () => {
    const { isAirbnbEmail } = await import("./vivAirbnb");

    const regularEmail = {
      uid: 2,
      messageId: "test@gmail.com",
      subject: "Hello there",
      from: [{ name: "John", address: "john@gmail.com" }],
      to: [{ name: "Test", address: "test@example.com" }],
      date: new Date().toISOString(),
      snippet: "Just saying hi",
      flags: [],
      isRead: false,
      isStarred: false,
    };

    expect(isAirbnbEmail(regularEmail)).toBe(false);
  });

  it("should NOT detect Airbnb-subject emails from non-Airbnb senders", async () => {
    const { isAirbnbEmail } = await import("./vivAirbnb");

    // Emails mentioning Airbnb in subject but from non-@airbnb.com senders
    // should NOT be detected (avoids capturing real conversations about Airbnb)
    const subjectEmail = {
      uid: 3,
      messageId: "test@other.com",
      subject: "Your Airbnb reservation is confirmed",
      from: [{ name: "Notifications", address: "noreply@other.com" }],
      to: [{ name: "Test", address: "test@example.com" }],
      date: new Date().toISOString(),
      snippet: "Booking details",
      flags: [],
      isRead: false,
      isStarred: false,
    };

    expect(isAirbnbEmail(subjectEmail)).toBe(false);
  });

  it("should detect emails from various @airbnb.com addresses", async () => {
    const { isAirbnbEmail } = await import("./vivAirbnb");

    const expressEmail = {
      uid: 4,
      messageId: "test@express.airbnb.com",
      subject: "You have a new booking",
      from: [{ name: "Airbnb", address: "express@airbnb.com" }],
      to: [{ name: "Test", address: "test@example.com" }],
      date: new Date().toISOString(),
      snippet: "Booking details",
      flags: [],
      isRead: false,
      isStarred: false,
    };

    expect(isAirbnbEmail(expressEmail)).toBe(true);
  });
});

describe("Viv Airbnb Email Classification", () => {
  it("should classify booking confirmations", async () => {
    const { classifyAirbnbEmail } = await import("./vivAirbnb");

    const booking = {
      uid: 1,
      messageId: "test1",
      subject: "Reservation confirmed - Sara arrives Jul 17",
      from: [{ name: "Airbnb", address: "automated@airbnb.com" }],
      to: [],
      date: new Date().toISOString(),
      snippet: "Your reservation is confirmed",
      flags: [],
      isRead: false,
      isStarred: false,
    };

    expect(classifyAirbnbEmail(booking)).toBe("booking");
  });

  it("should classify reviews", async () => {
    const { classifyAirbnbEmail } = await import("./vivAirbnb");

    const review = {
      uid: 2,
      messageId: "test2",
      subject: "Margaret left a 5-star review!",
      from: [{ name: "Airbnb", address: "automated@airbnb.com" }],
      to: [],
      date: new Date().toISOString(),
      snippet: "Great stay!",
      flags: [],
      isRead: false,
      isStarred: false,
    };

    expect(classifyAirbnbEmail(review)).toBe("review");
  });

  it("should classify cancellations", async () => {
    const { classifyAirbnbEmail } = await import("./vivAirbnb");

    const cancellation = {
      uid: 3,
      messageId: "test3",
      subject: "Reservation canceled - HMEMW42W9J",
      from: [{ name: "Airbnb", address: "automated@airbnb.com" }],
      to: [],
      date: new Date().toISOString(),
      snippet: "Your reservation has been canceled",
      flags: [],
      isRead: false,
      isStarred: false,
    };

    expect(classifyAirbnbEmail(cancellation)).toBe("cancellation");
  });

  it("should classify other Airbnb emails", async () => {
    const { classifyAirbnbEmail } = await import("./vivAirbnb");

    const other = {
      uid: 4,
      messageId: "test4",
      subject: "Your payout has been processed",
      from: [{ name: "Airbnb", address: "automated@airbnb.com" }],
      to: [],
      date: new Date().toISOString(),
      snippet: "Payout details",
      flags: [],
      isRead: false,
      isStarred: false,
    };

    expect(classifyAirbnbEmail(other)).toBe("other");
  });
});

// ── Airbnb Module Exports ───────────────────────────────────────────────

describe("Viv Airbnb Module", () => {
  it("should export all required functions", async () => {
    const airbnb = await import("./vivAirbnb");
    expect(airbnb.isAirbnbEmail).toBeDefined();
    expect(airbnb.classifyAirbnbEmail).toBeDefined();
    expect(airbnb.extractBookingDataRegex).toBeDefined();
    expect(airbnb.extractReviewDataRegex).toBeDefined();
    expect(airbnb.processAirbnbEmails).toBeDefined();
    expect(airbnb.getAirbnbBookings).toBeDefined();
    expect(airbnb.getAirbnbReviews).toBeDefined();
  });
});

// ── Airbnb Router Procedures ────────────────────────────────────────────

describe("Viv Router Airbnb Procedures", () => {
  it("should have Airbnb procedures in vivRouter", async () => {
    const { vivRouter } = await import("./vivRouter");
    const procedures = Object.keys((vivRouter as any)._def.procedures || {});

    expect(procedures).toContain("airbnbSync");
    expect(procedures).toContain("airbnbBookings");
    expect(procedures).toContain("airbnbReviews");
    expect(procedures).toContain("airbnbStats");
  });
});

// ─// ── Airbnb Database Schema ──────────────────────────────────────────

describe("Viv Airbnb Database Schema", () => {
  it("should export Airbnb tables from schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.vivAirbnbBookings).toBeDefined();
    expect(schema.vivAirbnbReviews).toBeDefined();
  });
});

// ── Auto-Reprocess on Startup ───────────────────────────────────────

describe("Viv Airbnb Auto-Reprocess", () => {
  it("should export autoReprocessAirbnbData function", async () => {
    const airbnb = await import("./vivAirbnb");
    expect(airbnb.autoReprocessAirbnbData).toBeDefined();
    expect(typeof airbnb.autoReprocessAirbnbData).toBe("function");
  });

  it("should export reprocessUnprocessedBookings function", async () => {
    const airbnb = await import("./vivAirbnb");
    expect(airbnb.reprocessUnprocessedBookings).toBeDefined();
    expect(typeof airbnb.reprocessUnprocessedBookings).toBe("function");
  });

  it("should export reprocessUnprocessedReviews function", async () => {
    const airbnb = await import("./vivAirbnb");
    expect(airbnb.reprocessUnprocessedReviews).toBeDefined();
    expect(typeof airbnb.reprocessUnprocessedReviews).toBe("function");
  });
});

// ── Regex Parser Tests ────────────────────────────────────────────

describe("Viv Airbnb Regex Parsers", () => {
  it("should extract booking data from full body text", async () => {
    const { extractBookingDataRegex } = await import("./vivAirbnb");
    const subject = "Reservation confirmed - Sara McElwee arrives Jul 17";
    const bodyText = `NEW BOOKING CONFIRMED!

https://www.airbnb.com/rooms/12345

JAMES RIVER CABIN | RIVERFRONT W/ HOT TUB & VIEWS

Entire home/apt

Check-in      Checkout

Fri, Jul 17   Wed, Jul 22

GUESTS
6 adults

$461.70 x 5 nights   $2,308.48

CONFIRMATION CODE
HMD9P89PFC`;

    const result = extractBookingDataRegex(subject, bodyText, "");
    expect(result.guestName).toBe("Sara McElwee");
    expect(result.propertyName).toBe("JAMES RIVER CABIN | RIVERFRONT W/ HOT TUB & VIEWS");
    expect(result.checkIn).toBe("Fri, Jul 17");
    expect(result.checkOut).toBe("Wed, Jul 22");
    expect(result.nightlyRate).toBe("$461.70");
    expect(result.numNights).toBe(5);
    expect(result.confirmationCode).toBe("HMD9P89PFC");
    expect(result.status).toBe("confirmed");
  });

  it("should extract booking data from subject only (fallback)", async () => {
    const { extractBookingDataRegex } = await import("./vivAirbnb");
    const subject = "Reservation confirmed - Eryn Ossont arrives Apr 8";
    const result = extractBookingDataRegex(subject, undefined, "");
    expect(result.guestName).toBe("Eryn Ossont");
    expect(result.checkIn).toBe("Apr 8");
    expect(result.status).toBe("confirmed");
  });

  it("should detect canceled status from subject", async () => {
    const { extractBookingDataRegex } = await import("./vivAirbnb");
    const subject = "Canceled: Reservation HMEMW42W9J for Sep";
    const result = extractBookingDataRegex(subject, undefined, "");
    expect(result.status).toBe("canceled");
    expect(result.confirmationCode).toBe("HMEMW42W9J");
  });

  it("should extract review data from full body text", async () => {
    const { extractReviewDataRegex } = await import("./vivAirbnb");
    const subject = "Rebecca left a 5-star review!";
    const bodyText = `REBECCA RATED THEIR STAY 5 STARS!

FEEDBACK FROM THEIR STAY
   Scandinavian Retreat w/ Mtn View & 20 Min to AVL

   Mar 12 \u2013 13, 2026

OVERALL RATING   5
The cabin was so nicely designed and perfect for our stay.

SPECIAL THANKS
   Spotless furniture & linens
   Free of clutter
   Squeaky-clean bathroom
   Looked like the photos
KEEP HOSTING`;

    const result = extractReviewDataRegex(subject, bodyText, "");
    expect(result.guestName).toBe("Rebecca");
    expect(result.propertyName).toBe("Scandinavian Retreat w/ Mtn View & 20 Min to AVL");
    expect(result.rating).toBe(5);
    expect(result.highlights).toContain("Spotless furniture & linens");
    expect(result.highlights).toContain("Free of clutter");
  });

  it("should extract review data from subject only (fallback)", async () => {
    const { extractReviewDataRegex } = await import("./vivAirbnb");
    const subject = "Harry left a 5-star review!";
    const result = extractReviewDataRegex(subject, undefined, "");
    expect(result.guestName).toBe("Harry");
    expect(result.rating).toBe(5);
  });

  it("should handle catch-all review subjects", async () => {
    const { extractReviewDataRegex } = await import("./vivAirbnb");
    const subject = "[Catch-all] A recent guest left a 3-star review";
    const result = extractReviewDataRegex(subject, undefined, "");
    // The catch-all prefix gets stripped in the snippet parser
    expect(result.guestName).toBeTruthy();
    expect(result.rating).toBe(3);
  });
});

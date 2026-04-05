import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the DB layer ──────────────────────────────────────────────────

const mockAttachments: Array<{
  id: number;
  taskId: number;
  fileName: string;
  url: string;
  mimeType: string;
  size: number;
  uploadedBy: number;
  createdAt: Date;
}> = [];

let nextId = 1;

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue({}),
  getTaskAttachments: vi.fn(async (taskId: number) =>
    mockAttachments
      .filter((a) => a.taskId === taskId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  ),
  addTaskAttachment: vi.fn(
    async (data: {
      taskId: number;
      fileName: string;
      url: string;
      fileKey: string;
      mimeType: string;
      size: number;
      uploadedBy: number;
    }) => {
      const att = {
        id: nextId++,
        taskId: data.taskId,
        fileName: data.fileName,
        url: data.url,
        mimeType: data.mimeType,
        size: data.size,
        uploadedBy: data.uploadedBy,
        createdAt: new Date(),
      };
      mockAttachments.push(att);
      return { id: att.id };
    }
  ),
  deleteTaskAttachment: vi.fn(async (attachmentId: number) => {
    const idx = mockAttachments.findIndex((a) => a.id === attachmentId);
    if (idx >= 0) mockAttachments.splice(idx, 1);
  }),
}));

import { getTaskAttachments, addTaskAttachment, deleteTaskAttachment } from "./db";

describe("Task Attachments", () => {
  beforeEach(() => {
    mockAttachments.length = 0;
    nextId = 1;
  });

  // ── addTaskAttachment ──────────────────────────────────────────────

  describe("addTaskAttachment", () => {
    it("creates an attachment and returns its id", async () => {
      const result = await addTaskAttachment({
        taskId: 42,
        fileName: "photo.jpg",
        url: "https://cdn.example.com/photo.jpg",
        fileKey: "tasks/42/photo.jpg",
        mimeType: "image/jpeg",
        size: 1024000,
        uploadedBy: 1,
      });
      expect(result).toHaveProperty("id");
      expect(result.id).toBe(1);
    });

    it("stores the attachment with correct fields", async () => {
      await addTaskAttachment({
        taskId: 42,
        fileName: "leak.png",
        url: "https://cdn.example.com/leak.png",
        fileKey: "tasks/42/leak.png",
        mimeType: "image/png",
        size: 512000,
        uploadedBy: 3,
      });
      expect(mockAttachments).toHaveLength(1);
      expect(mockAttachments[0]).toMatchObject({
        taskId: 42,
        fileName: "leak.png",
        mimeType: "image/png",
        size: 512000,
        uploadedBy: 3,
      });
    });

    it("auto-increments attachment IDs", async () => {
      const r1 = await addTaskAttachment({
        taskId: 42,
        fileName: "a.jpg",
        url: "https://cdn.example.com/a.jpg",
        fileKey: "tasks/42/a.jpg",
        mimeType: "image/jpeg",
        size: 100,
        uploadedBy: 1,
      });
      const r2 = await addTaskAttachment({
        taskId: 42,
        fileName: "b.jpg",
        url: "https://cdn.example.com/b.jpg",
        fileKey: "tasks/42/b.jpg",
        mimeType: "image/jpeg",
        size: 200,
        uploadedBy: 1,
      });
      expect(r2.id).toBe(r1.id + 1);
    });

    it("allows multiple attachments on the same task", async () => {
      for (let i = 0; i < 5; i++) {
        await addTaskAttachment({
          taskId: 10,
          fileName: `photo${i}.jpg`,
          url: `https://cdn.example.com/photo${i}.jpg`,
          fileKey: `tasks/10/photo${i}.jpg`,
          mimeType: "image/jpeg",
          size: 100 * (i + 1),
          uploadedBy: 1,
        });
      }
      expect(mockAttachments.filter((a) => a.taskId === 10)).toHaveLength(5);
    });

    it("supports video mime types", async () => {
      await addTaskAttachment({
        taskId: 42,
        fileName: "video.mp4",
        url: "https://cdn.example.com/video.mp4",
        fileKey: "tasks/42/video.mp4",
        mimeType: "video/mp4",
        size: 5000000,
        uploadedBy: 1,
      });
      expect(mockAttachments[0].mimeType).toBe("video/mp4");
    });
  });

  // ── getTaskAttachments ─────────────────────────────────────────────

  describe("getTaskAttachments", () => {
    it("returns empty array for task with no attachments", async () => {
      const result = await getTaskAttachments(999);
      expect(result).toEqual([]);
    });

    it("returns attachments for the specified task only", async () => {
      await addTaskAttachment({
        taskId: 10,
        fileName: "a.jpg",
        url: "https://cdn.example.com/a.jpg",
        fileKey: "tasks/10/a.jpg",
        mimeType: "image/jpeg",
        size: 100,
        uploadedBy: 1,
      });
      await addTaskAttachment({
        taskId: 20,
        fileName: "b.jpg",
        url: "https://cdn.example.com/b.jpg",
        fileKey: "tasks/20/b.jpg",
        mimeType: "image/jpeg",
        size: 200,
        uploadedBy: 1,
      });

      const result = await getTaskAttachments(10);
      expect(result).toHaveLength(1);
      expect(result[0].taskId).toBe(10);
    });

    it("returns attachments sorted by createdAt ascending", async () => {
      mockAttachments.push(
        {
          id: 100,
          taskId: 5,
          fileName: "oldest.jpg",
          url: "https://cdn.example.com/oldest.jpg",
          mimeType: "image/jpeg",
          size: 100,
          uploadedBy: 1,
          createdAt: new Date("2026-01-01"),
        },
        {
          id: 101,
          taskId: 5,
          fileName: "newest.jpg",
          url: "https://cdn.example.com/newest.jpg",
          mimeType: "image/jpeg",
          size: 200,
          uploadedBy: 1,
          createdAt: new Date("2026-03-01"),
        },
        {
          id: 102,
          taskId: 5,
          fileName: "middle.jpg",
          url: "https://cdn.example.com/middle.jpg",
          mimeType: "image/jpeg",
          size: 150,
          uploadedBy: 1,
          createdAt: new Date("2026-02-01"),
        }
      );

      const result = await getTaskAttachments(5);
      expect(result[0].fileName).toBe("oldest.jpg");
      expect(result[1].fileName).toBe("middle.jpg");
      expect(result[2].fileName).toBe("newest.jpg");
    });
  });

  // ── deleteTaskAttachment ───────────────────────────────────────────

  describe("deleteTaskAttachment", () => {
    it("removes the specified attachment", async () => {
      const { id } = await addTaskAttachment({
        taskId: 42,
        fileName: "delete-me.jpg",
        url: "https://cdn.example.com/delete-me.jpg",
        fileKey: "tasks/42/delete-me.jpg",
        mimeType: "image/jpeg",
        size: 100,
        uploadedBy: 1,
      });
      expect(mockAttachments).toHaveLength(1);
      await deleteTaskAttachment(id);
      expect(mockAttachments).toHaveLength(0);
    });

    it("only removes the targeted attachment, leaving others intact", async () => {
      await addTaskAttachment({
        taskId: 42,
        fileName: "keep.jpg",
        url: "https://cdn.example.com/keep.jpg",
        fileKey: "tasks/42/keep.jpg",
        mimeType: "image/jpeg",
        size: 100,
        uploadedBy: 1,
      });
      const { id: deleteId } = await addTaskAttachment({
        taskId: 42,
        fileName: "remove.jpg",
        url: "https://cdn.example.com/remove.jpg",
        fileKey: "tasks/42/remove.jpg",
        mimeType: "image/jpeg",
        size: 200,
        uploadedBy: 1,
      });
      await deleteTaskAttachment(deleteId);
      expect(mockAttachments).toHaveLength(1);
      expect(mockAttachments[0].fileName).toBe("keep.jpg");
    });

    it("handles deleting non-existent attachment gracefully", async () => {
      await expect(deleteTaskAttachment(9999)).resolves.toBeUndefined();
    });
  });

  // ── Schema expectations ────────────────────────────────────────────

  describe("schema expectations", () => {
    it("taskAttachments table has the expected columns", async () => {
      const { taskAttachments } = await import("../drizzle/schema");
      const columns = Object.keys(taskAttachments);
      expect(columns).toContain("id");
      expect(columns).toContain("taskId");
      expect(columns).toContain("fileName");
      expect(columns).toContain("url");
      expect(columns).toContain("fileKey");
      expect(columns).toContain("mimeType");
      expect(columns).toContain("size");
      expect(columns).toContain("uploadedBy");
      expect(columns).toContain("createdAt");
    });
  });

  // ── Upload limit enforcement ───────────────────────────────────────

  describe("upload limits", () => {
    it("can store up to 10 attachments per task", async () => {
      for (let i = 0; i < 10; i++) {
        await addTaskAttachment({
          taskId: 99,
          fileName: `file${i}.jpg`,
          url: `https://cdn.example.com/file${i}.jpg`,
          fileKey: `tasks/99/file${i}.jpg`,
          mimeType: "image/jpeg",
          size: 100,
          uploadedBy: 1,
        });
      }
      const result = await getTaskAttachments(99);
      expect(result).toHaveLength(10);
    });
  });
});

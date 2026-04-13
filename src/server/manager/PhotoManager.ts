import type { User } from "../session/User";
import { promises as fs } from "fs";
import { existsSync } from "fs";
import path from "path";

export interface StoredPhoto {
  requestId: string;
  buffer: Buffer;
  timestamp: Date;
  userId: string;
  mimeType: string;
  filename: string;
  size: number;
}

interface SSEWriter {
  write: (data: string) => void;
  userId: string;
  close: () => void;
}

/**
 * PhotoManager — captures, stores, and broadcasts photos.
 * Saves a physical copy to the local RecordManager folder.
 */
export class PhotoManager {
  private photos: Map<string, StoredPhoto> = new Map();
  private sseClients: Set<SSEWriter> = new Set();

  constructor(private user: User) {}

  /**
   * Capture a photo from the glasses, save to disk, and broadcast to UI.
   * Requests 1080p images for better quality on site surveys.
   */
  async takePhoto(): Promise<void> {
    const session = this.user.appSession;
    if (!session) {
      console.warn(`⚠️ Cannot take photo — no active session for ${this.user.userId}`);
      return;
    }

    try {
      // 1. Request a high-res photo from the glasses
      const photo = await session.camera.requestPhoto({ size: "large" });

      // CONVERT: Turn the SDK's ArrayBuffer into a standard Node.js Buffer
      const nodeBuffer = Buffer.from(photo.buffer);

      const stored: StoredPhoto = {
        requestId: photo.requestId,
        buffer: nodeBuffer,
        timestamp: photo.timestamp,
        userId: this.user.userId,
        mimeType: photo.mimeType,
        filename: photo.filename,
        size: photo.size,
      };

      // 2. Save a physical copy to your MacBook (async — doesn't block)
      const sessionDir = this.user.recordManager.getFolder();
      if (sessionDir && existsSync(sessionDir)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const localFilename = `Photo_${timestamp}.jpg`;
        const filePath = path.join(sessionDir, localFilename);

        await fs.writeFile(filePath, nodeBuffer);
        console.log(`💾 File Saved: ${filePath} (${photo.size} bytes)`);
      }

      // 3. Keep in memory and broadcast to the Web Dashboard
      this.photos.set(photo.requestId, stored);
      this.broadcastPhoto(stored);

      // Log to transcript so the photo appears inline in the Google Doc
      this.user.transcript.addPhoto(nodeBuffer, photo.filename);

      console.log(`📸 Photo captured for ${this.user.userId} (${photo.size} bytes)`);
    } catch (error: any) {
      console.error(`❌ Photo capture failed: ${error.message}`);
      // Re-throw so callers (SurveyApp) can notify the technician
      throw error;
    }
  }

  /** Push a photo to all connected SSE clients (Web Dashboard) */
  broadcastPhoto(photo: StoredPhoto): void {
    const base64Data = photo.buffer.toString("base64");
    const payload = JSON.stringify({
      requestId: photo.requestId,
      timestamp: photo.timestamp.getTime(),
      mimeType: photo.mimeType,
      filename: photo.filename,
      size: photo.size,
      userId: photo.userId,
      base64: base64Data,
      dataUrl: `data:${photo.mimeType};base64,${base64Data}`,
    });

    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  getPhoto(requestId: string): StoredPhoto | undefined {
    return this.photos.get(requestId);
  }

  /** All photos for this user, sorted newest-first */
  getAll(): StoredPhoto[] {
    return Array.from(this.photos.values()).sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    );
  }

  removeAll(): void {
    this.photos.clear();
  }

  addSSEClient(client: SSEWriter): void {
    this.sseClients.add(client);
  }

  removeSSEClient(client: SSEWriter): void {
    this.sseClients.delete(client);
  }

  /** Tear down — clear photos and SSE clients */
  destroy(): void {
    this.photos.clear();
    this.sseClients.clear();
  }
}

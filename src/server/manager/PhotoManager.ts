import type { User } from "../session/User";
import fs from "fs";
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
 * Updated: Now saves a physical copy to the local RecordManager folder.
 */
export class PhotoManager {
  private photos: Map<string, StoredPhoto> = new Map();
  private sseClients: Set<SSEWriter> = new Set();

  constructor(private user: User) {}

  /** Capture a photo from the glasses, save to disk, and broadcast to UI */
  async takePhoto(): Promise<void> {
    const session = this.user.appSession;
    if (!session) throw new Error("No active glasses session");

    try {
      // 1. Request the photo from the glasses
      const photo = await session.camera.requestPhoto();

      // CONVERT: Turn the SDK's ArrayBuffer into a standard Node.js Buffer
      const nodeBuffer = Buffer.from(photo.buffer);

      const stored: StoredPhoto = {
        requestId: photo.requestId,
        buffer: nodeBuffer, // <-- Use the converted buffer here
        timestamp: photo.timestamp,
        userId: this.user.userId,
        mimeType: photo.mimeType,
        filename: photo.filename,
        size: photo.size,
      };

      // 2. Save a physical copy to your MacBook for the Audit Trail
      const sessionDir = this.user.recordManager.getFolder();
      if (sessionDir && fs.existsSync(sessionDir)) {
        // Create a clear filename: Photo_Timestamp.jpg
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const localFilename = `Photo_${timestamp}.jpg`;
        const filePath = path.join(sessionDir, localFilename);
        
        // Write the converted Node buffer to the file system
        fs.writeFileSync(filePath, nodeBuffer);
        console.log(`💾 File Saved: ${filePath}`);
      }

      // 3. Keep in memory and broadcast to the Web Dashboard
      this.photos.set(photo.requestId, stored);
      this.broadcastPhoto(stored);
      
      console.log(
        `📸 Photo broadcast to UI for ${this.user.userId} (${photo.size} bytes)`,
      );
    } catch (error) {
      console.error("❌ Photo Capture/Save Error:", error);
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
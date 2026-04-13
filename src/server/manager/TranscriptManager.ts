import { JWT } from "google-auth-library";
import path from "path";
import { promises as fs } from "fs";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TranscriptEntry {
  timestamp: Date;
  type: "APP" | "USER" | "PHOTO";
  text: string;
  /** For PHOTO entries: the raw image buffer (JPEG) */
  imageBuffer?: Buffer;
  /** For PHOTO entries: original filename from the camera */
  imageFilename?: string;
}

// ─── TranscriptManager ──────────────────────────────────────────────────────

/**
 * TranscriptManager — accumulates a chronological transcript of the entire
 * survey session (system prompts, user speech, and captured photos) then
 * generates an HTML document and uploads it to Google Drive as a native
 * Google Doc with inline images.
 */
export class TranscriptManager {
  private entries: TranscriptEntry[] = [];
  private jobId: string = "";
  private startTime: Date | null = null;

  /** Record an APP (TTS) entry */
  addApp(text: string): void {
    this.entries.push({ timestamp: new Date(), type: "APP", text });
  }

  /** Record a USER (STT) entry */
  addUser(text: string): void {
    this.entries.push({ timestamp: new Date(), type: "USER", text });
  }

  /** Record a PHOTO entry with its image buffer */
  addPhoto(buffer: Buffer, filename: string): void {
    this.entries.push({
      timestamp: new Date(),
      type: "PHOTO",
      text: `[Photo: ${filename}]`,
      imageBuffer: buffer,
      imageFilename: filename,
    });
  }

  /** Set the job ID (called when survey starts) */
  setJobId(jobId: string): void {
    this.jobId = jobId;
    this.startTime = new Date();
  }

  /** Reset for a new survey */
  reset(): void {
    this.entries = [];
    this.jobId = "";
    this.startTime = null;
  }

  // ─── HTML Generation ────────────────────────────────────────────────────

  /**
   * Builds a self-contained HTML document with the full transcript.
   * Photos are embedded as base64 inline images so the single HTML file
   * contains everything needed for the Google Drive import.
   */
  private generateHTML(): string {
    const date = this.startTime
      ? this.startTime.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : new Date().toLocaleDateString();

    const timeStr = (d: Date) =>
      d.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });

    let body = "";

    for (const entry of this.entries) {
      const ts = timeStr(entry.timestamp);

      switch (entry.type) {
        case "APP":
          body += `<p><strong>${ts} &middot; System:</strong> ${escapeHtml(entry.text)}</p>\n`;
          break;

        case "USER":
          body += `<p><strong>${ts} &middot; Technician:</strong> ${escapeHtml(entry.text)}</p>\n`;
          break;

        case "PHOTO":
          if (entry.imageBuffer) {
            const b64 = entry.imageBuffer.toString("base64");
            body += `<p><strong>${ts} &middot; Photo captured:</strong> ${escapeHtml(entry.imageFilename || "photo.jpg")}</p>\n`;
            body += `<p><img src="data:image/jpeg;base64,${b64}" width="600" alt="${escapeHtml(entry.imageFilename || "photo")}" /></p>\n`;
          }
          break;
      }
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Survey Report — ${escapeHtml(this.jobId)} — ${escapeHtml(date)}</title>
</head>
<body>
  <h1>Kitchen Appliance Survey Report</h1>
  <h2>${escapeHtml(this.jobId)}</h2>
  <p><em>${escapeHtml(date)}</em></p>
  <hr>
  ${body}
  <hr>
  <p><em>End of survey transcript</em></p>
</body>
</html>`;
  }

  // ─── Save & Upload ──────────────────────────────────────────────────────

  /**
   * Saves the transcript as a local HTML file AND uploads it to Google Drive
   * as a native Google Doc.
   *
   * @param localFolder — the RecordManager session folder (for the local copy)
   * @returns The Google Drive URL of the created document
   */
  async finalize(localFolder: string): Promise<string | null> {
    if (this.entries.length === 0) {
      console.warn("⚠️ No transcript entries to save.");
      return null;
    }

    const html = this.generateHTML();

    // 1. Save local HTML copy
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const localFilename = `Transcript_${this.jobId}_${timestamp}.html`;
    const localPath = path.join(localFolder, localFilename);
    await fs.writeFile(localPath, html, "utf-8");
    console.log(`📝 Local transcript saved: ${localPath}`);

    // 2. Upload to Google Drive as a native Google Doc
    try {
      const driveUrl = await this.uploadToGoogleDrive(html);
      console.log(`📄 Google Doc created: ${driveUrl}`);
      return driveUrl;
    } catch (error: any) {
      console.error(`❌ Google Drive upload failed: ${error.message}`);
      console.log("💡 Local HTML transcript is still available at:", localPath);
      return null;
    }
  }

  /**
   * Uploads HTML content to Google Drive, converting it to a native Google Doc.
   * Uses the same service account credentials as SheetManager.
   */
  private async uploadToGoogleDrive(html: string): Promise<string> {
    const serviceAccountPath = path.join(process.cwd(), "service-account.json");
    const credsRaw = await fs.readFile(serviceAccountPath, "utf-8");
    const creds = JSON.parse(credsRaw);

    // Impersonate the project owner so the file is created in their Drive
    const impersonateEmail = process.env.GOOGLE_DRIVE_SHARE_EMAIL || undefined;

    const auth = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
      ...(impersonateEmail ? { subject: impersonateEmail } : {}),
    });

    await auth.authorize();

    const date = this.startTime
      ? this.startTime.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
      : new Date().toLocaleDateString();

    const docTitle = `Survey Report — ${this.jobId} — ${date}`;

    // Multipart upload: metadata + HTML content, requesting conversion to Google Doc
    const boundary = "transcript_upload_boundary";
    // Upload into the shared "Survey Reports" folder in Tom's Drive
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || undefined;

    const metadata = JSON.stringify({
      name: docTitle,
      mimeType: "application/vnd.google-apps.document",
      ...(folderId ? { parents: [folderId] } : {}),
    });

    const multipartBody =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/html; charset=UTF-8\r\n\r\n` +
      `${html}\r\n` +
      `--${boundary}--`;

    const accessToken = (await auth.getAccessToken()).token;

    const response = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Drive API ${response.status}: ${errText}`);
    }

    const result = (await response.json()) as { id: string; name: string };
    const docUrl = `https://docs.google.com/document/d/${result.id}/edit`;

    // Share with the project owner so it's accessible
    // (The service account owns it by default — share with Tom's email)
    await this.shareWithOwner(auth, result.id);

    return docUrl;
  }

  /**
   * Transfers ownership of the created Google Doc to the project owner.
   * This moves the file's storage quota from the service account to the owner.
   * Uses the GOOGLE_DRIVE_SHARE_EMAIL env var, or falls back to writer access.
   */
  private async shareWithOwner(auth: JWT, fileId: string): Promise<void> {
    const shareEmail = process.env.GOOGLE_DRIVE_SHARE_EMAIL;
    if (!shareEmail) {
      console.log(
        "💡 Set GOOGLE_DRIVE_SHARE_EMAIL in .env to auto-share survey reports with your account."
      );
      return;
    }

    try {
      const accessToken = (await auth.getAccessToken()).token;

      // Transfer ownership so the file counts against the owner's quota, not the service account's
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?transferOwnership=true`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            role: "owner",
            type: "user",
            emailAddress: shareEmail,
          }),
        }
      );

      if (response.ok) {
        console.log(`📧 Ownership transferred to ${shareEmail}`);
      } else {
        const errText = await response.text();
        console.warn(`⚠️ Ownership transfer failed, falling back to writer: ${errText}`);
        // Fallback: grant writer access if ownership transfer fails
        await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              role: "writer",
              type: "user",
              emailAddress: shareEmail,
            }),
          }
        );
      }
    } catch (e: any) {
      console.warn(`⚠️ Sharing failed: ${e.message}`);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

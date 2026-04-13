import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export class RecordManager {
  private sessionDir: string = "";
  private rawAudioPath: string = "";
  private finalMp3Path: string = "";
  private ffmpegProcess: any = null;

  constructor(private user: any) {}

  /**
   * Starts a new recording session. 
   * Creates a folder named after the Job Number or Timestamp.
   */
  async startRecording(jobId: string) {
    // Create a unique folder for this survey
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const folderName = `${jobId}_${timestamp}`;
    this.sessionDir = path.join(process.cwd(), "captures", folderName);
    
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }

    this.rawAudioPath = path.join(this.sessionDir, "raw_stream.pcm");
    this.finalMp3Path = path.join(this.sessionDir, "full_conversation.mp3");

    console.log(`🎙️ Recording started: ${this.rawAudioPath}`);
  }

  /**
   * Appends a chunk of raw audio data to the file.
   * This will be called whenever the glasses send audio or Gemini speaks.
   */
  appendAudioChunk(chunk: Buffer) {
    if (!this.rawAudioPath) return;
    fs.appendFileSync(this.rawAudioPath, chunk);
  }

  /**
   * Uses FFmpeg to convert the raw PCM stream into a high-quality MP3.
   * Skips gracefully if no audio data was recorded (Phase 2 feature).
   */
  async finalizeRecording(): Promise<string> {
    // Skip MP3 conversion if no audio data exists yet (Phase 2 placeholder)
    if (!this.rawAudioPath || !fs.existsSync(this.rawAudioPath) || fs.statSync(this.rawAudioPath).size === 0) {
      console.log("⏭️ No raw audio data to convert — skipping MP3 finalization.");
      return "";
    }

    return new Promise((resolve, reject) => {
      console.log("Merging and converting audio to MP3...");

      // Mentra Live typically streams 16-bit PCM at 16kHz or 24kHz.
      // We will assume 16kHz for now, which is standard for speech.
      const args = [
        "-f", "s16le",
        "-ar", "16000",
        "-ac", "1",
        "-i", this.rawAudioPath,
        "-y",
        this.finalMp3Path
      ];

      const ffmpeg = spawn("ffmpeg", args);

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          console.log(`✅ Audio finalized: ${this.finalMp3Path}`);
          resolve(this.finalMp3Path);
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });
    });
  }

  getFolder() {
    return this.sessionDir;
  }
}
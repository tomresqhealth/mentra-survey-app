import type { AppSession, TranscriptionData } from "@mentra/sdk";
import type { User } from "../session/User";

interface SSEWriter {
  write: (data: string) => void;
  userId: string;
  close: () => void;
}

/**
 * TranscriptionManager — handles speech-to-text and SSE broadcasting.
 * Updated to pipe raw audio to the RecordManager.
 */
export class TranscriptionManager {
  private sseClients: Set<SSEWriter> = new Set();
  private transcriptUnsubscribe: (() => void) | null = null;
  private audioUnsubscribe: (() => void) | null = null;

  constructor(private user: User) {}

  /** Wire up the transcription listener AND the raw audio stream */
  setup(session: AppSession): void {
    // 1. Text Transcription (Existing logic for Gemini/UI)
    this.transcriptUnsubscribe = session.events.onTranscription(
      (data: TranscriptionData) => {
        if (data.isFinal) {
          console.log(
            `✅ Final transcription (${this.user.userId}): ${data.text}`,
          );
        }
        this.broadcast(data.text, data.isFinal);
      },
    );

    // 2. Raw Audio Capture (New logic for the Master Record)
    // This catches the raw PCM audio chunks coming from the glasses
    this.audioUnsubscribe = session.audio.subscribeToStream((chunk: Buffer) => {
      if (this.user.recordManager) {
        this.user.recordManager.appendAudioChunk(chunk);
      }
    });
    
    console.log("🎙️ Audio stream and transcription listeners active.");
  }

  /** Push a transcription event to all connected SSE clients */
  broadcast(text: string, isFinal: boolean): void {
    const payload = JSON.stringify({
      text,
      isFinal,
      timestamp: Date.now(),
      userId: this.user.userId,
    });

    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  addSSEClient(client: SSEWriter): void {
    this.sseClients.add(client);
  }

  removeSSEClient(client: SSEWriter): void {
    this.sseClients.delete(client);
  }

  /** Tear down listeners and drop all SSE clients */
  destroy(): void {
    this.transcriptUnsubscribe?.();
    this.audioUnsubscribe?.();
    this.transcriptUnsubscribe = null;
    this.audioUnsubscribe = null;
    this.sseClients.clear();
  }
}
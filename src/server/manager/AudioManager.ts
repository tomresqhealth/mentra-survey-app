import type { User } from "../session/User";

/**
 * AudioManager — handles text-to-speech and audio control.
 * Updated to support the "Unified Audio Record" requirement.
 */
export class AudioManager {
  constructor(private user: User) {}

  /** * Speak text aloud on the glasses.
   * * ARCHITECTURE NOTE: The standard 'session.audio.speak' method generates 
   * audio on the glasses locally. To include the AI voice in your master 
   * MP3 file, we will later swap this for a 'play(buffer)' approach.
   */
  async speak(text: string): Promise<void> {
    const session = this.user.appSession;
    if (!session) throw new Error("No active glasses session");

    // 1. Play the voice on the glasses
    // (This uses the built-in Mentra TTS)
    await session.audio.speak(text);

    // 2. Logging for the session
    console.log(`🗣️ AI Response: "${text}"`);

    /**
     * HOOK FOR UNIFIED RECORD:
     * Once we implement Phase 2 (Manual TTS), we will use:
     * * const audioBuffer = await this.generateTTSBuffer(text);
     * await session.audio.play(audioBuffer);
     * this.user.recordManager.appendAudioChunk(audioBuffer);
     */
  }

  /** Stop any currently playing audio */
  async stopAudio(): Promise<void> {
    const session = this.user.appSession;
    if (!session) throw new Error("No active glasses session");
    await session.audio.stopAudio();
  }
}
import type { User } from "../session/User";

/**
 * TTS voice settings — optimized for clarity and volume on Mentra Live glasses.
 * Uses Mentra's default voice but tweaks the ElevenLabs parameters for
 * higher stability, speaker boost, and slower speed.
 */
const TTS_OPTIONS = {
  voice_id: "pVnrL6sighQX7hVz89cp", // ElevenLabs "Henry"
  volume: 1.0,
  voice_settings: {
    stability: 0.75,
    similarity_boost: 0.75,
    style: 0,
    use_speaker_boost: true,
    speed: 1.1,
  },
};

/** A timestamped set of TTS words with an expiry. */
interface TtsWordGeneration {
  words: Set<string>;
  expiresAt: number;
}

/**
 * AudioManager — handles text-to-speech and audio control.
 * Tracks speaking state so SurveyApp can handle interruptions.
 */
export class AudioManager {
  /** True while TTS is actively playing. Used by SurveyApp to detect interruptions. */
  isSpeaking: boolean = false;

  /**
   * True for a short window after TTS finishes.
   * The mic transcription of TTS audio lags by ~0.5-1s after the SDK
   * promise resolves. During cooldown we use content matching (not a
   * blanket block) to filter echo while letting real speech through.
   */
  isCoolingDown: boolean = false;

  /**
   * Rolling history of TTS word sets, each with an expiry timestamp.
   * Words from older TTS outputs remain available for echo detection even
   * after a new step prompt plays. Entries expire individually after
   * TTS_WORD_TTL_MS milliseconds from when they were spoken.
   */
  private ttsWordHistory: TtsWordGeneration[] = [];

  /**
   * Flattened view of all non-expired TTS words — rebuilt on each echo check.
   * This replaces the old single `recentTtsWords` Set.
   */
  private getActiveTtsWords(): Set<string> {
    const now = Date.now();
    // Prune expired generations
    this.ttsWordHistory = this.ttsWordHistory.filter(g => g.expiresAt > now);
    // Merge all remaining words
    const merged = new Set<string>();
    for (const gen of this.ttsWordHistory) {
      for (const w of gen.words) merged.add(w);
    }
    return merged;
  }

  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;

  /** Cooldown duration in ms after TTS ends */
  private static readonly COOLDOWN_MS = 750;

  /** How long TTS words remain available for echo detection after being spoken.
   *  Set to 8s to cover late-arriving echoes (especially when a new step prompt
   *  plays immediately after photo feedback). */
  private static readonly TTS_WORD_TTL_MS = 8000;

  /** Overlap threshold: if this fraction of a transcription's words appear
   *  in the recent TTS output, it's considered echo and should be dropped. */
  private static readonly ECHO_OVERLAP_THRESHOLD = 0.5;

  /**
   * Words that can interrupt TTS mid-speech. Short utterances (1-2 words)
   * during TTS must contain one of these to pass. Longer utterances (3+
   * words) with low echo overlap are allowed through regardless.
   */
  private static readonly INTERRUPT_WORDS = new Set([
    "stop", "pause", "skip", "hold", "wait", "quiet", "cancel", "capture",
    "next", "ready", "finish", "done", "resume", "continue",
  ]);

  /**
   * Minimum word count for a non-command utterance to pass during TTS.
   * Short fragments like "That." or "the." are likely noise, but longer
   * phrases like "I want to make some notes" are real user speech.
   */
  private static readonly MIN_WORDS_FOR_NOVEL_PASSTHROUGH = 3;

  /**
   * After the main cooldown ends, we keep TTS words in memory for this
   * additional window. Late-arriving echoes (which often contain trigger
   * words like "next") are caught with a higher overlap threshold.
   */
  private static readonly ECHO_MEMORY_MS = 1500;

  /**
   * During the post-cooldown echo memory window, a higher overlap threshold
   * is used — only very obvious echoes are dropped. Real speech with a few
   * common-word matches passes through.
   */
  private static readonly ECHO_MEMORY_OVERLAP_THRESHOLD = 0.7;

  /** True during the extended echo memory window after cooldown ends */
  isInEchoMemory: boolean = false;
  private echoMemoryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private user: User) {}

  /**
   * Speak text aloud on the glasses.
   * Sets isSpeaking flag so the survey state machine knows when TTS is active.
   */
  async speak(text: string): Promise<void> {
    const session = this.user.appSession;
    if (!session) {
      console.warn(`⚠️ Cannot speak — no active session for ${this.user.userId}: "${text}"`);
      return;
    }

    try {
      this.isSpeaking = true;
      // Cancel any pending cooldown/echo memory timers so state flags
      // (isCoolingDown, isInEchoMemory) don't change mid-speech.
      if (this.cooldownTimer) {
        clearTimeout(this.cooldownTimer);
        this.cooldownTimer = null;
        this.isCoolingDown = false;
      }
      if (this.echoMemoryTimer) {
        clearTimeout(this.echoMemoryTimer);
        this.echoMemoryTimer = null;
        this.isInEchoMemory = false;
      }
      this.trackTtsWords(text);
      await session.audio.speak(text, TTS_OPTIONS);
      this.user.transcript.addApp(text);
      console.log(`🗣️ AI Response: "${text}"`);
    } catch (e: any) {
      console.warn(`⚠️ TTS failed for "${text}": ${e.message}`);
    } finally {
      this.sealActiveGeneration(); // Start the real TTL from NOW (after audio finishes)
      this.isSpeaking = false;
      this.startCooldown();
    }

    /**
     * HOOK FOR UNIFIED RECORD:
     * Once we implement Phase 2 (Manual TTS), we will use:
     * * const audioBuffer = await this.generateTTSBuffer(text);
     * await session.audio.play(audioBuffer);
     * this.user.recordManager.appendAudioChunk(audioBuffer);
     */
  }

  /** Stop any currently playing audio and clear the speaking flag */
  async stopAudio(): Promise<void> {
    const session = this.user.appSession;
    if (!session) return;
    try {
      session.audio.stopAudio();
      this.isSpeaking = false;
      this.startCooldown();
      console.log("🔇 Audio stopped");
    } catch (e: any) {
      console.warn(`⚠️ stopAudio failed: ${e.message}`);
      this.isSpeaking = false;
      this.startCooldown();
    }
  }

  /**
   * Start the post-TTS cooldown window.
   * Any existing cooldown is reset (e.g., back-to-back speak calls).
   */
  private startCooldown(): void {
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    if (this.echoMemoryTimer) {
      clearTimeout(this.echoMemoryTimer);
      this.echoMemoryTimer = null;
    }
    this.isCoolingDown = true;
    this.isInEchoMemory = false;
    console.log(`🧊 Cooldown started (${AudioManager.COOLDOWN_MS}ms) — echo filter active`);
    this.cooldownTimer = setTimeout(() => {
      this.isCoolingDown = false;
      this.cooldownTimer = null;
      // Don't clear TTS words yet — enter echo memory window
      this.isInEchoMemory = true;
      console.log(`🧊 Cooldown ended — entering echo memory (${AudioManager.ECHO_MEMORY_MS}ms)`);
      this.echoMemoryTimer = setTimeout(() => {
        this.isInEchoMemory = false;
        this.echoMemoryTimer = null;
        // Words expire naturally via TTL — no manual clear needed
        console.log(`🧊 Echo memory ended — mic fully open (${this.ttsWordHistory.length} word gen(s) still in TTL buffer)`);
      }, AudioManager.ECHO_MEMORY_MS);
    }, AudioManager.COOLDOWN_MS);
  }

  /** Cancel cooldown and echo memory immediately (words still expire via TTL) */
  cancelCooldown(): void {
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    if (this.echoMemoryTimer) {
      clearTimeout(this.echoMemoryTimer);
      this.echoMemoryTimer = null;
    }
    this.isCoolingDown = false;
    this.isInEchoMemory = false;
    // Don't clear ttsWordHistory — words expire naturally via TTL
  }

  /** Reference to the generation currently being spoken, so we can
   *  set its real TTL after audio finishes (not when it starts). */
  private activeGeneration: TtsWordGeneration | null = null;

  /**
   * Extract and store words from TTS text for echo detection.
   * Each speak() call creates a new generation. The expiry is set to
   * a far-future placeholder during TTS; the real TTL is applied in
   * speak()'s finally block via `sealActiveGeneration()`.
   */
  private trackTtsWords(text: string): void {
    const words = text.toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z]/g, '')).filter(Boolean);
    const wordSet = new Set(words);
    const gen: TtsWordGeneration = {
      words: wordSet,
      expiresAt: Date.now() + 120_000, // placeholder — never expires during TTS
    };
    this.ttsWordHistory.push(gen);
    this.activeGeneration = gen;
  }

  /** Set the real TTL on the active generation (called when TTS ends). */
  private sealActiveGeneration(): void {
    if (this.activeGeneration) {
      this.activeGeneration.expiresAt = Date.now() + AudioManager.TTS_WORD_TTL_MS;
      this.activeGeneration = null;
    }
  }

  /**
   * Check whether a transcription is likely echo of recent TTS output.
   * Returns true if the transcription should be treated as echo (drop it).
   *
   * Logic: compute the fraction of transcription words that appear in the
   * recent TTS word set. If >= ECHO_OVERLAP_THRESHOLD, it's echo.
   */
  isLikelyEcho(transcription: string): boolean {
    const activeTtsWords = this.getActiveTtsWords();
    if (activeTtsWords.size === 0) return false;

    const words = transcription.toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z]/g, '')).filter(Boolean);
    if (words.length === 0) return true; // empty = noise

    const matchCount = words.filter(w => activeTtsWords.has(w)).length;
    const overlap = matchCount / words.length;

    console.log(`🔍 Echo check: "${transcription}" → ${matchCount}/${words.length} words match TTS (${(overlap * 100).toFixed(0)}% overlap, ${this.ttsWordHistory.length} gen(s))`);

    return overlap >= AudioManager.ECHO_OVERLAP_THRESHOLD;
  }

  /**
   * Check whether a transcription contains a recognized interrupt command.
   * Used during isSpeaking to gate what passes through — only explicit
   * interrupt words are allowed; everything else (noise, echo fragments
   * that slipped past the overlap check) gets dropped.
   */
  isInterruptCommand(transcription: string): boolean {
    const words = transcription.toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z]/g, '')).filter(Boolean);
    return words.some(w => AudioManager.INTERRUPT_WORDS.has(w));
  }

  /**
   * Check whether a transcription is long enough to be considered "novel speech"
   * even during TTS. Short fragments (1-2 words) are usually noise or echo
   * fragments; longer utterances that passed the echo overlap check are likely
   * real user speech (e.g., "I want to make some notes. Can I do that?").
   */
  isNovelSpeech(transcription: string): boolean {
    const words = transcription.toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z]/g, '')).filter(Boolean);
    return words.length >= AudioManager.MIN_WORDS_FOR_NOVEL_PASSTHROUGH;
  }

  /**
   * Soft echo check for the post-cooldown echo memory window.
   * Uses a higher overlap threshold than the normal check — only very
   * obvious echoes (70%+ overlap) are dropped. This catches late-arriving
   * echoes that contain trigger words like "next" while letting real
   * user speech through.
   */
  /**
   * "Always-on" echo check for transcriptions that arrive after all echo
   * windows have closed. Uses the TTL-based word history to catch very
   * late-arriving echoes that would otherwise hit Gemini classification.
   * Uses the standard (50%) overlap threshold.
   */
  isLateEcho(transcription: string): boolean {
    const activeTtsWords = this.getActiveTtsWords();
    if (activeTtsWords.size === 0) return false;

    const words = transcription.toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z]/g, '')).filter(Boolean);
    if (words.length === 0) return true;

    const matchCount = words.filter(w => activeTtsWords.has(w)).length;
    const overlap = matchCount / words.length;

    if (overlap >= AudioManager.ECHO_OVERLAP_THRESHOLD) {
      console.log(`🔍 Late echo caught: "${transcription}" → ${matchCount}/${words.length} words match TTS history (${(overlap * 100).toFixed(0)}% overlap, ${this.ttsWordHistory.length} gen(s))`);
      return true;
    }
    return false;
  }

  isLikelyEchoSoft(transcription: string): boolean {
    const activeTtsWords = this.getActiveTtsWords();
    if (activeTtsWords.size === 0) return false;

    const words = transcription.toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z]/g, '')).filter(Boolean);
    if (words.length === 0) return true;

    const matchCount = words.filter(w => activeTtsWords.has(w)).length;
    const overlap = matchCount / words.length;

    console.log(`🔍 Soft echo check: "${transcription}" → ${matchCount}/${words.length} words match TTS (${(overlap * 100).toFixed(0)}% overlap, threshold: ${(AudioManager.ECHO_MEMORY_OVERLAP_THRESHOLD * 100).toFixed(0)}%, ${this.ttsWordHistory.length} gen(s))`);

    return overlap >= AudioManager.ECHO_MEMORY_OVERLAP_THRESHOLD;
  }
}

import { User } from "./session/User";
import { SurveyStep } from "./manager/SheetManager";
import { GeminiClassifier, Intent } from "./manager/GeminiClassifier";

export class SurveyApp {
  private steps: SurveyStep[] = [];
  private currentStepIndex: number = 0;
  private isSurveyActive: boolean = false;
  private isPaused: boolean = false;
  private classifier: GeminiClassifier;

  /** Timestamp of the last photo capture. Used to suppress cascading CAPTURE
   *  intents caused by echo of the photo feedback TTS message. */
  private lastCaptureTime: number = 0;

  /** Minimum ms between captures. Prevents echo-triggered cascade loops. */
  private static readonly CAPTURE_COOLDOWN_MS = 6000;

  /** Processing lock — prevents concurrent handleTranscription calls from
   *  interleaving actions (e.g., two echoes both advancing the step). */
  private isProcessing: boolean = false;
  private pendingTranscription: { text: string; isFinal: boolean } | null = null;

  constructor(private user: User) {
    this.classifier = new GeminiClassifier();
  }

  /**
   * Initializes the survey by fetching the script from Google Sheets.
   * Resets state if called again (e.g., when user closes and reopens the app).
   */
  async startSurvey(jobId: string) {
    // Reset state in case this is a restart
    this.isSurveyActive = false;
    this.isPaused = false;
    this.currentStepIndex = 0;
    this.steps = [];

    const MAX_RETRIES = 2;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // 1. Load the steps from Google Sheets
        this.steps = await this.user.sheetManager.loadSurveySteps();

        if (this.steps.length === 0) {
          await this.user.audio.speak("I couldn't find any survey steps in the Google Sheet. Please check the permissions.");
          return;
        }

        // 2. Start the local recording session and transcript
        await this.user.recordManager.startRecording(jobId);
        this.user.transcript.setJobId(jobId);

        this.isSurveyActive = true;
        this.currentStepIndex = 0;

        await this.runCurrentStep();
        return; // success

      } catch (error) {
        console.error(`❌ Survey startup failed (attempt ${attempt}/${MAX_RETRIES}):`, error);
        if (attempt < MAX_RETRIES) {
          console.log("🔄 Retrying survey startup in 2s...");
          await new Promise(r => setTimeout(r, 2000));
        } else {
          await this.user.audio.speak("There was an error loading the survey. Please reconnect and try again.");
        }
      }
    }
  }

  /** Reset survey state (called on disconnect/stop) */
  reset() {
    this.isSurveyActive = false;
    this.isPaused = false;
    this.currentStepIndex = 0;
    this.steps = [];
    this.user.transcript.reset();
    console.log("🔄 Survey state reset");
  }

  /**
   * Reads the current step's voice prompt
   */
  private async runCurrentStep() {
    const step = this.steps[this.currentStepIndex];
    if (!step) return;

    console.log(`Current Step: ${step.stepCode} - ${step.appliance}`);
    await this.user.audio.speak(step.voicePrompt);
  }

  /**
   * The "Ear" of the app. Processes every final transcription through a two-tier system:
   *
   * 1. FAST PATH: Check exact wake words (capture, skip, step-specific trigger).
   *    These are instant — no API call needed.
   *
   * 2. SLOW PATH: If no wake word matches, send to Gemini for intent classification.
   *    Handles natural language like "what did you say?", "hold on", "I didn't catch that".
   *
   * Supports interruption: if the user speaks while TTS is playing, we stop the audio
   * and process the command immediately.
   */
  async handleTranscription(text: string, isFinal: boolean) {
    if (!this.isSurveyActive || !isFinal) return;

    // ── CONCURRENCY GUARD ────────────────────────────────────────────
    // Multiple transcriptions can arrive while the previous one is still
    // processing (e.g., awaiting Gemini or TTS). Without a lock, they
    // interleave — causing double step advances, spurious captures, etc.
    if (this.isProcessing) {
      // Keep only the LATEST pending transcription (older ones are stale)
      this.pendingTranscription = { text, isFinal };
      console.log(`⏳ Queued transcription (busy): "${text}"`);
      return;
    }
    this.isProcessing = true;
    try {
      await this._processTranscription(text, isFinal);
    } finally {
      this.isProcessing = false;
      // Process the most recent queued transcription, if any
      if (this.pendingTranscription) {
        const pending = this.pendingTranscription;
        this.pendingTranscription = null;
        // Fire-and-forget — it will acquire the lock itself
        this.handleTranscription(pending.text, pending.isFinal).catch(e =>
          console.error("❌ Queued transcription error:", e)
        );
      }
    }
  }

  /** Inner implementation of handleTranscription (always runs under lock). */
  private async _processTranscription(text: string, isFinal: boolean) {
    const lowerText = text.toLowerCase().trim();
    const currentStep = this.steps[this.currentStepIndex];
    if (!currentStep) return;

    // Log every final user utterance to the transcript
    this.user.transcript.addUser(text);
    const audio = this.user.audio;
    console.log(`🎧 Heard: "${lowerText}" (step: ${currentStep.stepCode}, speaking: ${audio.isSpeaking}, cooling: ${audio.isCoolingDown}, echoMem: ${audio.isInEchoMemory}, paused: ${this.isPaused})`);

    // ── ECHO FILTER (content-aware, three-tier) ──────────────────────
    // MentraOS doesn't provide echo cancellation — the mic picks up the
    // glasses speaker and transcribes it. We use three tiers of filtering:
    //
    // DURING TTS (isSpeaking):
    //   1. Content match: high overlap with TTS text → echo → drop
    //   2. Short utterances (1-2 words): must be an interrupt command
    //      ("stop", "pause", "capture", etc.) or dropped as noise
    //   3. Longer utterances (3+ words) with low overlap: treated as
    //      real user speech and allowed through (e.g., "I want to make
    //      some notes. Can I do that?")
    //
    // DURING COOLDOWN (after TTS ends):
    //   Content match only. Novel speech passes through.
    //
    // ECHO MEMORY (after cooldown, extra 1.5s):
    //   Soft content match (70% threshold) to catch late-arriving echoes
    //   that contain trigger words like "next". Real speech passes.
    //
    // AFTER ECHO MEMORY: fully open mic — everything passes.
    if (audio.isSpeaking) {
      if (audio.isLikelyEcho(text)) {
        console.log("🔇 Dropped as echo (during TTS)");
        return;
      }
      // Low overlap — could be real speech or noise. Check length:
      if (audio.isInterruptCommand(text)) {
        // Explicit interrupt command — stop audio and process
        console.log(`⚡ Interrupt command detected during TTS: "${lowerText}"`);
        await audio.stopAudio();
      } else if (audio.isNovelSpeech(text)) {
        // 3+ words with low echo overlap — real user speech
        console.log(`✅ Novel speech detected during TTS (${text.split(/\s+/).length} words, low overlap) — processing`);
      } else {
        // Short non-command fragment (e.g., "That.", "the.") — likely noise
        console.log(`🔇 Dropped during TTS — short non-command fragment: "${lowerText}"`);
        return;
      }
    } else if (audio.isCoolingDown) {
      if (audio.isLikelyEcho(text)) {
        console.log("🔇 Dropped as echo (during cooldown)");
        return;
      }
      // Extra guard: long phrases (4+ words) arriving during cooldown are
      // almost always echoes whose words didn't match (e.g., TTS words
      // expired or the echo is a partial/garbled version). Only short
      // commands (1-3 words) are real user speech during cooldown.
      const cooldownWordCount = text.split(/\s+/).length;
      if (cooldownWordCount >= 4) {
        console.log(`🔇 Dropped during cooldown — long phrase (${cooldownWordCount} words) likely echo: "${text.substring(0, 60)}..."`);
        return;
      }
      console.log(`✅ Passed echo filter (during cooldown) — processing as real speech`);
    } else if (audio.isInEchoMemory) {
      // During echo memory, SHORT recognized commands (1-2 words like "next",
      // "capture") bypass the soft echo check — a single command word is user
      // intent, not echo. But LONG phrases that happen to contain a command
      // word (e.g., "take another photo or say next to continue") must still
      // go through the soft echo check, since real echoes arrive as full phrases.
      const wordCount = text.split(/\s+/).length;
      if (audio.isInterruptCommand(text) && wordCount <= 2) {
        console.log(`✅ Short command detected during echo memory: "${lowerText}" — processing as user intent`);
      } else if (audio.isLikelyEchoSoft(text)) {
        console.log("🔇 Dropped as echo (during echo memory — late arrival)");
        return;
      } else {
        console.log(`✅ Passed soft echo filter (echo memory) — processing as real speech`);
      }
    }

    // ── LATE ECHO CHECK (always-on, TTL-based) ───────────────────────
    // After all echo windows close, late-arriving echoes can still slip
    // through. The TTL-based word history in AudioManager catches these.
    // EXCEPTION: Short (1-2 word) interrupt commands bypass this check.
    // By the time all echo windows have closed, a deliberate single-word
    // command like "finish" or "next" is real user intent — not a late echo.
    if (!audio.isSpeaking && !audio.isCoolingDown && !audio.isInEchoMemory) {
      const wordCount = text.split(/\s+/).length;
      const isShortCommand = audio.isInterruptCommand(text) && wordCount <= 2;
      if (!isShortCommand && audio.isLateEcho(text)) {
        console.log("🔇 Dropped as late echo (TTL buffer match)");
        return;
      }
    }

    // Strip punctuation for word-boundary matching
    const words = lowerText.split(/\s+/).map(w => w.replace(/[^a-z]/g, ''));

    // ── FAST PATH: Exact wake word matching ──────────────────────────

    // "pause" / "hold on" — pause the survey
    if (words.includes("pause") || lowerText.includes("hold on")) {
      if (!this.isPaused) {
        this.isPaused = true;
        await this.user.audio.speak("Survey paused. Say continue when you're ready.");
      }
      return;
    }

    // "resume" — unpause only
    if (words.includes("resume")) {
      if (this.isPaused) {
        this.isPaused = false;
        await this.user.audio.speak("Resuming survey.");
        await this.runCurrentStep();
      }
      return;
    }

    // "continue" — resume if paused, otherwise advance
    if (words.includes("continue")) {
      if (this.isPaused) {
        this.isPaused = false;
        await this.user.audio.speak("Resuming survey.");
        await this.runCurrentStep();
      } else {
        await this.advanceStep();
      }
      return;
    }

    // If paused, don't process any other wake words or Gemini
    if (this.isPaused) {
      console.log("⏸️ Survey paused — ignoring non-resume command");
      return;
    }

    // "capture" / "take photo"
    if (words.includes("capture") || lowerText.includes("take photo")) {
      const timeSinceCapture = Date.now() - this.lastCaptureTime;
      if (timeSinceCapture < SurveyApp.CAPTURE_COOLDOWN_MS) {
        console.log(`🔇 Capture wake word suppressed — only ${(timeSinceCapture / 1000).toFixed(1)}s since last capture`);
        return;
      }
      await this.handleCapture();
      return;
    }

    // "skip" — advance without completing the step
    if (words.includes("skip")) {
      await this.advanceStep();
      return;
    }

    // Step-specific next trigger (e.g., "ready", "finish") or generic "next"
    const nextTriggerWord = currentStep.nextTrigger
      ? currentStep.nextTrigger.toLowerCase().replace(/[^a-z\s]/g, '').trim()
      : "next";

    if (words.includes(nextTriggerWord) || words.includes("next")) {
      await this.advanceStep();
      return;
    }

    // ── SLOW PATH: Gemini intent classification ──────────────────────

    const result = await this.classifier.classify(
      text,
      {
        stepCode: currentStep.stepCode,
        voicePrompt: currentStep.voicePrompt,
        appliance: currentStep.appliance,
        stepIndex: this.currentStepIndex,
        totalSteps: this.steps.length,
      },
      this.isPaused
    );

    await this.executeIntent(result.intent, result.answer);
  }

  /**
   * Execute a classified intent.
   */
  private async executeIntent(intent: Intent, answer?: string) {
    switch (intent) {
      case "CAPTURE": {
        // Guard against echo-triggered cascading captures
        const timeSinceCapture = Date.now() - this.lastCaptureTime;
        if (timeSinceCapture < SurveyApp.CAPTURE_COOLDOWN_MS) {
          console.log(`🔇 CAPTURE suppressed — only ${(timeSinceCapture / 1000).toFixed(1)}s since last capture (cooldown: ${SurveyApp.CAPTURE_COOLDOWN_MS / 1000}s)`);
          break;
        }
        await this.handleInterrupt();
        await this.handleCapture();
        break;
      }

      case "NEXT":
      case "SKIP":
        await this.handleInterrupt();
        await this.advanceStep();
        break;

      case "REPEAT":
        await this.handleInterrupt();
        await this.runCurrentStep();
        break;

      case "GO_BACK":
        await this.handleInterrupt();
        await this.goBack();
        break;

      case "PAUSE":
        await this.handleInterrupt();
        this.isPaused = true;
        await this.user.audio.speak("Survey paused. Say resume or continue when you're ready.");
        break;

      case "RESUME":
        if (this.isPaused) {
          this.isPaused = false;
          await this.user.audio.speak("Resuming survey.");
          await this.runCurrentStep();
        }
        break;

      case "QUESTION":
        await this.handleInterrupt();
        if (answer) {
          await this.user.audio.speak(answer);
        } else {
          await this.user.audio.speak("Sorry, I didn't understand the question.");
        }
        break;

      case "NONE":
        // Background noise or irrelevant — ignore silently
        break;
    }
  }

  /**
   * If TTS is currently playing, stop it immediately.
   * This allows users to interrupt the agent mid-speech.
   */
  private async handleInterrupt() {
    if (this.user.audio.isSpeaking) {
      console.log("⚡ Interrupting current audio");
      await this.user.audio.stopAudio();
    }
  }

  /**
   * Take a photo with two-phase feedback.
   */
  private async handleCapture() {
    try {
      this.lastCaptureTime = Date.now();
      await this.user.photo.takePhoto();
      await this.user.audio.speak('Image saved. Add more verbal notes and take more photos. If you\'re ready, say "next" to continue to the next step.');
    } catch (e: any) {
      console.error(`❌ Photo failed: ${e.message}`);
      await this.user.audio.speak("Photo failed. Please try again.");
    }
  }

  /**
   * Go back to the previous step, or replay the first step if already at the beginning.
   */
  private async goBack() {
    this.isPaused = false;
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      await this.user.audio.speak("Going back to the previous step.");
    } else {
      await this.user.audio.speak("Starting over from the beginning.");
    }
    await this.runCurrentStep();
  }

  /**
   * Advance to the next step, or finish the survey if we're at the end.
   */
  private async advanceStep() {
    this.isPaused = false;
    this.currentStepIndex++;

    if (this.currentStepIndex < this.steps.length) {
      await this.runCurrentStep();
    } else {
      await this.finishSurvey();
    }
  }

  private async finishSurvey() {
    this.isSurveyActive = false;
    await this.user.audio.speak("Survey complete. Finalizing audio record and saving files.");

    // Convert the raw stream to MP3
    await this.user.recordManager.finalizeRecording();

    // Generate transcript HTML → save locally + upload to Google Drive as Doc
    const sessionFolder = this.user.recordManager.getFolder();
    if (sessionFolder) {
      const docUrl = await this.user.transcript.finalize(sessionFolder);
      if (docUrl) {
        await this.user.audio.speak("Survey report uploaded to Google Drive.");
      }
    }

    console.log("🏁 Survey finished successfully.");
  }
}

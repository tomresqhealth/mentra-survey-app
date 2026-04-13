import { AppSession } from "@mentra/sdk";
import { PhotoManager } from "../manager/PhotoManager";
import { TranscriptionManager } from "../manager/TranscriptionManager";
import { AudioManager } from "../manager/AudioManager";
import { StorageManager } from "../manager/StorageManager";
import { InputManager } from "../manager/InputManager";
import { SheetManager } from "../manager/SheetManager"; 
import { RecordManager } from "../manager/RecordManager"; // <--- NEW
import { TranscriptManager as TranscriptLog } from "../manager/TranscriptManager"; // <--- NEW
import { SurveyApp } from "../SurveyApp"; // <--- NEW

/**
 * User — per-user state container.
 * Composes all managers and holds the glasses AppSession.
 */
export class User {
  /** Active glasses connection, null when webview-only */
  appSession: AppSession | null = null;

  /** Photo capture, storage, and SSE broadcasting */
  photo: PhotoManager;

  /** Speech-to-text listener and SSE broadcasting */
  transcription: TranscriptionManager;

  /** Text-to-speech and audio control */
  audio: AudioManager;

  /** User preferences via MentraOS Simple Storage */
  storage: StorageManager;

  /** Button presses and touchpad gestures */
  input: InputManager;

  /** Google Sheets integration for survey script */
  sheetManager: SheetManager;

  /** Local audio recording and folder management */
  recordManager: RecordManager; // <--- NEW

  /** Chronological transcript of TTS, STT, and photos → Google Doc */
  transcript: TranscriptLog;

  /** The brain that handles the survey steps */
  surveyApp: SurveyApp; // <--- NEW

  constructor(public readonly userId: string) {
    this.photo = new PhotoManager(this);
    this.transcription = new TranscriptionManager(this);
    this.audio = new AudioManager(this);
    this.storage = new StorageManager(this);
    this.input = new InputManager(this);
    this.sheetManager = new SheetManager();
    this.recordManager = new RecordManager(this); // <--- Initialize
    this.transcript = new TranscriptLog();
    this.surveyApp = new SurveyApp(this); // <--- Initialize
  }

  /** Wire up a glasses connection — sets up managers but does NOT auto-start survey.
   *  The survey is started explicitly from onSession after the greeting. */
  setAppSession(session: AppSession): void {
    this.appSession = session;
    this.input.setup(session);
    // NOTE: transcription listener is set up in onSession to avoid duplicates
    console.log(`📋 Session wired for ${this.userId}`);
  }

  /** Disconnect glasses but keep user alive (photos stay) */
  clearAppSession(): void {
    this.transcription.destroy();
    this.appSession = null;
  }

  /** Nuke everything — call on full disconnect */
  cleanup(): void {
    this.transcription.destroy();
    this.photo.destroy();
    this.appSession = null;
  }
}
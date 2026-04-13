import { AppServer, AppSession, TranscriptionData, createMentraAuthRoutes } from '@mentra/sdk';
import { sessions } from './server/manager/SessionManager';
import { api } from './server/routes/routes';
import dotenv from 'dotenv';
import indexHtml from './frontend/index.html';

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────
const PACKAGE_NAME = process.env.PACKAGE_NAME || "appliancesurvey.mentra.glass";
const API_KEY = process.env.MENTRAOS_API_KEY!;
const PORT = parseInt(process.env.PORT || "4000", 10);
const COOKIE_SECRET = process.env.COOKIE_SECRET || "kitchen-survey-dev-secret";

// ─── App Server ──────────────────────────────────────────────────────
class KitchenSurveyApp extends AppServer {

  protected async onSession(session: AppSession, sessionId: string, userId: string) {
    console.log(`🚀 Session started: ${userId} (${sessionId})`);
    try {
      // NOTE: Settings like bypassVad and sensingEnabled are managed by MentraOS Cloud.
      // They can be configured in the Developer Console or react to changes via session.settings.onChange().

      // Get or create the user state container.
      // If user already exists (app restarted), reset their survey state.
      const user = sessions.getOrCreate(userId);
      user.surveyApp.reset();
      user.setAppSession(session);

      // Greet — runs after setAppSession so the audio manager is wired
      await session.audio.speak("Survey system online.", { volume: 1.0 });

      // Start the survey in the background — don't block onSession
      // (Google Sheets fetch + multiple TTS calls take too long and cause disconnects)
      user.surveyApp.startSurvey("JOB-DEMO-001").catch((e) => {
        console.error("❌ Survey startup error:", e);
      });

      // Single transcription listener: broadcasts to SSE AND routes to SurveyApp
      session.events.onTranscription(async (data: TranscriptionData) => {
        // 1. Broadcast to webview SSE clients
        user.transcription.broadcast(data.text, data.isFinal);
        // 2. Route to survey state machine
        if (user.surveyApp) {
          await user.surveyApp.handleTranscription(data.text, data.isFinal);
        }
      });

      // Cleanup on disconnect
      session.events.onDisconnected(() => {
        console.log(`👋 Session disconnected: ${userId}`);
        user.clearAppSession();
      });

      // Handle reconnection (e.g. user closes and reopens the miniapp)
      session.events.onConnected(() => {
        console.log(`🔄 Session reconnected: ${userId}`);
        user.setAppSession(session);
        user.surveyApp.reset();
        user.surveyApp.startSurvey("JOB-DEMO-001").catch((e) => {
          console.error("❌ Survey restart on reconnect failed:", e);
        });
      });

    } catch (e) {
      console.error("❌ Session setup failed:", e);
    }
  }

  protected async onStop(sessionId: string, userId: string, reason: string) {
    console.log(`🛑 Session stopped: ${userId} — ${reason}`);
    sessions.remove(userId);
  }
}

// ─── Create the app ──────────────────────────────────────────────────
const app = new KitchenSurveyApp({
  packageName: PACKAGE_NAME,
  apiKey: API_KEY,
  port: PORT,
  cookieSecret: COOKIE_SECRET,
});

// Mount auth routes (webview token exchange)
app.route(
  "/api/mentra/auth",
  createMentraAuthRoutes({
    apiKey: API_KEY,
    packageName: PACKAGE_NAME,
    cookieSecret: COOKIE_SECRET,
  })
);

// Mount custom API routes (health, SSE streams, audio, photos, etc.)
app.route("/api", api);

// Let the SDK register its webhook handler, version check, etc.
await app.start();

// ─── Bun HTTP server ─────────────────────────────────────────────────
Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  idleTimeout: 255, // Max value (seconds) — prevents Bun from killing long-lived SSE connections
  routes: {
    "/webview": indexHtml,
    "/webview/*": indexHtml,
  },
  async fetch(req) {
    // Everything else goes through the SDK's Hono router
    return app.fetch(req);
  },
});

console.log(`✅ Kitchen Survey running on port ${PORT}`);
console.log(`   Package: ${PACKAGE_NAME}`);
console.log(`   Webview: http://localhost:${PORT}/webview`);

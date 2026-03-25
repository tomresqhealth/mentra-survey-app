import { AppServer, AppSession, TranscriptionData } from '@mentra/sdk';
import { sessions } from './server/manager/SessionManager'; 
import { api } from './server/routes/routes'; 
import dotenv from 'dotenv';

dotenv.config();

/**
 * KitchenSurveyApp
 * Conducts the survey logic and session management.
 */
class KitchenSurveyApp extends AppServer {
  protected async onSession(session: AppSession, sessionId: string, userId: string) {
    try {
        console.log(`🚀 SURVEY SESSION STARTED: ${userId}`);
        const user = sessions.getOrCreate(userId);
        
        // If anything inside setAppSession crashes, it will be caught below!
        user.setAppSession(session);

        session.events.onTranscription(async (data: TranscriptionData) => {
          await user.surveyApp.handleTranscription(data.text, data.isFinal);
        });

        session.events.onDisconnected(() => {
          console.log(`📴 Session ended: ${userId}`);
          user.clearAppSession();
        });
    } catch (error) {
        // This prevents the SDK from returning a 500 error to the cloud!
        console.error(`🔥 CRITICAL ERROR IN onSession for ${userId}:`, error);
    }
  }
}

// 1. THE CONSTANTS (Ensuring consistency)
const PACKAGE_NAME = "appliancesurvey.mentra.glass";

const mentraApp = new KitchenSurveyApp({
  packageName: PACKAGE_NAME, 
  apiKey: process.env.MENTRAOS_API_KEY!,
  port: 4000
});

/**
 * --- APP SERVER GATEWAY ---
 * Routes webhooks to the SDK, API calls to your React frontend, 
 * and serves the WebView placeholder.
 */
Bun.serve({
  port: 4000,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);

    // 1. WEBHOOK GATEWAY 
    // Catches the "Start App" command from the Global Cloud
    if (req.method === "POST" && url.pathname === "/webhook") {
        return mentraApp.fetch(req);
    }

    // 2. API ROUTER
    if (url.pathname.startsWith("/api")) {
        // This powers your React frontend (SSE streams, audio, photos)
        return api.fetch(req);
    }

    // 3. DASHBOARD / WEBVIEW
    if (url.pathname.includes("/webview") || url.pathname.includes("/dashboard")) {
        return new Response(`<html><body style="background:black;color:#00e5ff;text-align:center;padding-top:100px;font-family:sans-serif;">
            <h1>KITCHEN SURVEY</h1><p>V2.7.0 CONNECTED</p></body></html>`, 
            { status: 200, headers: { "Content-Type": "text/html" } });
    }

    // 4. CATCH-ALL
    return new Response(JSON.stringify({ status: "online" }), { status: 200 });
  },
});

console.log(`✅ APP SERVER ACTIVE: ${PACKAGE_NAME}`);
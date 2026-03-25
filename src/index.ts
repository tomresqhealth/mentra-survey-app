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
    console.log(`🚀 SURVEY SESSION STARTED: ${userId}`);
    const user = sessions.getOrCreate(userId);
    user.setAppSession(session);

    // 🚨 Explicit error listener to catch hidden SDK connection failures
    session.events.onError((error) => {
      console.error(`❌ SDK SESSION ERROR [${userId}]:`, error);
    });

    session.events.onTranscription(async (data: TranscriptionData) => {
      await user.surveyApp.handleTranscription(data.text, data.isFinal);
    });

    session.events.onDisconnected(() => {
      console.log(`📴 Session ended: ${userId}`);
      user.clearAppSession();
    });
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
 * --- APP SERVER GATEWAY (DIAGNOSTIC MODE) ---
 * Routes webhooks to the SDK and catches all hidden errors.
 */
Bun.serve({
  port: 4000,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);

    // 1. WEBHOOK GATEWAY 
    if (req.method === "POST" && url.pathname === "/webhook") {
        try {
            // Clone the request so we can read the body without starving the SDK
            const clonedReq = req.clone();
            const bodyText = await clonedReq.text();
            console.log(`\n📥 INCOMING WEBHOOK:\n${bodyText}\n`);

            // Pass the original request to the SDK
            const response = await mentraApp.fetch(req);
            console.log(`📤 WEBHOOK RESPONSE STATUS: ${response.status}`);
            return response;
        } catch (error) {
            // Catch and print the exact error causing the 500s!
            console.error("❌ CRITICAL WEBHOOK ERROR:", error);
            return new Response("Internal Server Error", { status: 500 });
        }
    }

    // 2. API ROUTER
    if (url.pathname.startsWith("/api")) {
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

console.log(`✅ DIAGNOSTIC SERVER ACTIVE: ${PACKAGE_NAME}`);
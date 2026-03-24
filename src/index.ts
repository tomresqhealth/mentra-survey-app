import { AppServer, AppSession, TranscriptionData } from '@mentra/sdk';
import { sessions } from './server/manager/SessionManager'; 
import dotenv from 'dotenv';

dotenv.config();

/**
 * KitchenSurveyApp
 * The high-level conductor that connects Mentra glasses to our modular Survey Logic.
 */
class KitchenSurveyApp extends AppServer {
  protected async onSession(session: AppSession, sessionId: string, userId: string) {
    console.log(`🚀 SURVEY SESSION STARTED: ${userId}`);
    
    // 1. Get or Create the User session using our Manager
    const user = sessions.getOrCreate(userId);
    
    // 2. Link the glasses to the user (this triggers the Sheet load and Voice start)
    user.setAppSession(session);

    // 3. Route all voice transcriptions to the SurveyApp logic
    session.events.onTranscription(async (data: TranscriptionData) => {
      // This checks for "Next", "Capture", etc., based on your Google Sheet
      await user.surveyApp.handleTranscription(data.text, data.isFinal);
    });

    // 4. Handle disconnection
    session.events.onDisconnected(() => {
      console.log(`📴 Session ended for user: ${userId}`);
      user.clearAppSession();
    });
  }
}

// Initialize the Mentra Server
const mentraApp = new KitchenSurveyApp({
  packageName: "kitchen-survey.mentra.glass", 
  apiKey: process.env.MENTRAOS_API_KEY!,
  port: 4000, 
});

/**
 * --- THE STABLE BRIDGE (Nuclear Protocol) ---
 * This custom Bun server handles Mentra v2.7's specific health checks
 * and security handshakes that keep the connection stable.
 */
Bun.serve({
  port: 4000,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, x-mentra-signature, x-mentra-frontend-token, Sec-WebSocket-Protocol",
    };

    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // 1. App List Manifest: Prevents the "Vanishing Icon" on your iPhone
    if (url.pathname.includes("/apps/list")) {
        return new Response(JSON.stringify([{ 
          id: "survey-1", 
          name: "Kitchen Survey", 
          packageName: "kitchen-survey.mentra.glass"
        }]), { 
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
    }

    // 2. Webview / Dashboard: For monitoring from your MacBook browser
    if (url.pathname.includes("/webview") || url.pathname.includes("/dashboard")) {
        return new Response(`<html><body style="background:#000;color:#00e5ff;text-align:center;padding-top:100px;font-family:sans-serif;">
            <h1>KITCHEN SURVEY ACTIVE</h1><p>V1.0.0 - Modular Architecture</p></body></html>`, 
            { headers: { ...corsHeaders, "Content-Type": "text/html" } });
    }

    // 3. Version & Health Checks
    if (url.pathname === "/apps/version" || url.pathname === "/") {
        return new Response(JSON.stringify({ status: "online", app: "kitchen-survey" }), { 
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
    }

    // 4. WebSocket Upgrade: The "Red Icon" fix for stable voice streaming
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const protocol = req.headers.get("Sec-WebSocket-Protocol");
        const respOptions: any = { 
          headers: { 
            ...corsHeaders,
            "x-mentra-signature": "bypass", 
            "x-mentra-frontend-token": "bypass" 
          } 
        };
        if (protocol) respOptions.headers["Sec-WebSocket-Protocol"] = protocol;
        return mentraApp.fetch(req, respOptions);
    }

    return mentraApp.fetch(req);
  },
});

console.log(`✅ SURVEY APP BRIDGE ACTIVE: kitchen-survey.mentra.glass`);

/** Tom Testing Git */
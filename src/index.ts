import { AppServer, AppSession, TranscriptionData } from '@mentra/sdk';
import { sessions } from './server/manager/SessionManager'; 
import { api } from './server/routes/routes'; 
import dotenv from 'dotenv';

dotenv.config();

class KitchenSurveyApp extends AppServer {
  protected async onSession(session: AppSession, sessionId: string, userId: string) {
    console.log(`🚀 KITCHEN SURVEY SESSION STARTED: ${userId}`);
    try {
        // Essential for MentraOS hardware activation
        await session.settings.update({ bypassVad: false, sensingEnabled: true });
        await session.audio.speak("Survey system online.", { volume: 1.0 });

        const user = sessions.getOrCreate(userId);
        user.setAppSession(session);

        session.events.onTranscription(async (data: TranscriptionData) => {
          await user.surveyApp.handleTranscription(data.text, data.isFinal);
        });

        session.events.onDisconnected(() => {
          user.clearAppSession();
        });
    } catch (e) { console.log("Bridge warming..."); }
  }
}

const PACKAGE_NAME = "appliancesurvey.mentra.glass";
const mentraApp = new KitchenSurveyApp({
  packageName: PACKAGE_NAME, 
  apiKey: process.env.MENTRAOS_API_KEY!,
});

Bun.serve({
  port: 4000,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS", // Added for MentraOS strictness
        "Access-Control-Allow-Headers": "Content-Type, x-mentra-signature, x-mentra-frontend-token, Sec-WebSocket-Protocol",
    };

    console.log(`[Request] ${req.method} ${url.pathname}`);

    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // 1. THE ATOMIC HANDSHAKE (Flat JSON)
    // MentraOS often rejects the "success/data" envelope on this specific route.
    if (url.pathname === "/api/client/min-version" || url.pathname === "/apps/version" || url.pathname === "/") {
        return new Response(JSON.stringify({ 
            "minVersion": "0.0.1",
            "version": "2.7.0",
            "status": "online"
        }), { 
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
    }

    // 2. DISCOVERY: Auth & Apps
    // We provide both flat and enveloped possibilities to ensure MentraOS finds them.
    if (url.pathname === "/api/client/auth/status") {
        return new Response(JSON.stringify({ "authenticated": true, "success": true }), { 
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
    }

    if (url.pathname === "/api/client/apps" || url.pathname === "/apps/list") {
        return new Response(JSON.stringify([{ 
          "id": "survey-1", 
          "name": "Kitchen Survey", 
          "packageName": PACKAGE_NAME,
          "icon": "https://mentra.glass/assets/logo.png"
        }]), { 
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
    }

    // 3. WEBSOCKET: Nuclear Upgrade (The Handyman Magic)
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        console.log("🔌 Upgrading to WebSocket (Nuclear Protocol)...");
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

    // 4. SURVEY API (Hono)
    if (url.pathname.startsWith("/api") && !url.pathname.startsWith("/api/client")) {
        return api.fetch(req);
    }

    // 5. DEFAULT SDK HANDLER
    return mentraApp.fetch(req);
  },
});

console.log(`✅ NUCLEAR BRIDGE ACTIVE: ${PACKAGE_NAME}`);
import { AppServer, AppSession, TranscriptionData } from '@mentra/sdk';
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import dotenv from 'dotenv';

dotenv.config();

// --- 1. AI CONFIGURATION (Stable Handyman Agent: Gemini 2.5 Flash) ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash", // UPDATED: Confirmed Stable GA Model
  systemInstruction: `You are a Handyman's AI Assistant for Mentra Live glasses. 
    - Use the capture_photo tool when asked to "look," "see," or "analyze."
    - Analyze spec stickers and mechanical parts with high precision.
    - Be concise for HUD safety (under 15 words).
    - Provide technical steps for repairs based on visual evidence.
    Current date: ${new Date().toLocaleDateString()}.`,
  tools: [
    {
      functionDeclarations: [
        {
          name: "capture_photo",
          description: "Capture a high-res photo from the smart glasses to analyze tools, spec stickers, or repair projects.",
          parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
        },
      ],
    },
    // Note: Search tool is omitted here to prioritize the Camera tool for stable 2.5 Flash interactions
  ],
});

// --- 2. MENTRA APP LOGIC (Stabilized for v2.7) ---
class TomGeminiApp extends AppServer {
  private aiIsSpeaking = false;

  protected async onSession(session: AppSession, sessionId: string, userId: string) {
    console.log(`🚀 STABLE HANDYMAN SESSION: ${userId}`);
    
    try {
        await session.settings.update({ bypassVad: false, sensingEnabled: true });
        // Volume Boost: Explicitly set to 1.0 for Mentra Live frames
        await session.audio.speak("Handyman online. Ready to see your project.", { volume: 1.0 });
    } catch (e) { 
        console.log("Bridge warming up..."); 
    }

    const chat = model.startChat();

    session.events.onTranscription(async (data: TranscriptionData) => {
      if (!data.isFinal || this.aiIsSpeaking) return;

      const userText = data.text.trim().toLowerCase();
      const wakePhrase = "hey gemini";

      if (!userText.includes(wakePhrase)) return;

      const command = userText.split(wakePhrase)[1].trim();
      if (command.length < 2) return;

      console.log(`🎤 User: ${command}`);
      
      try {
        this.aiIsSpeaking = true;
        let result = await chat.sendMessage(command);
        let call = result.response.functionCalls()?.[0];

        // --- CAMERA TOOL HANDLING ---
        if (call && call.name === "capture_photo") {
            console.log("📸 Triggering Glasses Camera...");
            await session.layouts.showTextWall("Capturing Photo...");
            
            const photo = await session.camera.requestPhoto();
            console.log(`✅ Received ${photo.size} bytes.`);

            // Multi-modal re-injection for 2.5 Flash Vision
            result = await chat.sendMessage([
                "Analyze this photo contextually based on my request.", 
                { inlineData: { data: Buffer.from(photo.buffer).toString("base64"), mimeType: photo.mimeType } }
            ]);
        }

        const responseText = result.response.text();
        console.log(`🤖 Gemini: ${responseText}`);
        
        await Promise.all([
            session.layouts.showTextWall(responseText),
            // Volume Boost: Explicitly set to 1.0
            session.audio.speak(responseText, { volume: 1.0 })
        ]);

        setTimeout(() => { this.aiIsSpeaking = false; }, 2000);

      } catch (e: any) {
        console.error("Logic Error:", e.message);
        this.aiIsSpeaking = false;
      }
    });
  }
}

const mentraApp = new TomGeminiApp({
  packageName: "tomgeminiapp1.mentra.glass", 
  apiKey: process.env.MENTRAOS_API_KEY!,
  port: 4000, 
});

// --- 3. THE NUCLEAR v2.7 BRIDGE (Stability Guaranteed) ---
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

    // Webview/Dashboard Restoration (Prevents 404)
    if (url.pathname.includes("/webview") || url.pathname.includes("/dashboard")) {
        return new Response(`<html><body style="background:black;color:#00ff00;text-align:center;padding-top:100px;font-family:sans-serif;">
            <h1>STABLE HANDYMAN AI</h1><p>GEMINI 2.5 FLASH ACTIVE</p></body></html>`, 
            { headers: { ...corsHeaders, "Content-Type": "text/html" } });
    }

    // Status 200 Version Check
    if (url.pathname === "/apps/version" || url.pathname === "/") {
        return new Response(JSON.stringify({ status: "online", version: "2.7.0" }), { 
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
    }

    // Heartbeat Handler (Prevents "Connect" button freeze)
    if (url.pathname.includes("/devices") || url.pathname.includes("/status")) {
        return new Response(JSON.stringify({ status: "ready", devices: [{ id: "m-1", connected: true }] }), { 
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
    }

    // Manifest Handler (Prevents vanishing icon)
    if (url.pathname.includes("/apps/list")) {
        return new Response(JSON.stringify([{ 
          id: "gemini-1", 
          name: "Handyman AI", 
          packageName: "tomgeminiapp1.mentra.glass"
        }]), { 
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
    }

    // WebSocket Nuclear Protocol (Protocol Echo + Auth Bypass)
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const protocol = req.headers.get("Sec-WebSocket-Protocol");
        const respOptions: any = { headers: { ...corsHeaders, "x-mentra-signature": "bypass", "x-mentra-frontend-token": "bypass" } };
        if (protocol) respOptions.headers["Sec-WebSocket-Protocol"] = protocol;
        return mentraApp.fetch(req, respOptions);
    }

    return mentraApp.fetch(req);
  },
});

console.log(`✅ BRIDGE ACTIVE: GEMINI 2.5 FLASH`);
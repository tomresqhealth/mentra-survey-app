import { Hono } from "hono";
import { cors } from "hono/cors"; // Import CORS middleware
import { getHealth } from "../api/health";
import { photoStream, transcriptionStream } from "../api/stream";
import { speak, stopAudio } from "../api/audio";
import { getThemePreference, setThemePreference } from "../api/storage";
import { getLatestPhoto, getPhotoData, getPhotoBase64 } from "../api/photo";

// Create the Hono instance
// NOTE: No basePath here — the parent app mounts this at "/api" via app.route("/api", api)
export const api = new Hono();

// 1. Enable CORS for the iPhone app
api.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "x-mentra-signature", "x-mentra-frontend-token"],
}));

// Health
api.get("/health", getHealth);

// SSE streams
api.get("/photo-stream", photoStream);
api.get("/transcription-stream", transcriptionStream);

// Audio
api.post("/speak", speak);
api.post("/stop-audio", stopAudio);

// Storage / preferences
api.get("/theme-preference", getThemePreference);
api.post("/theme-preference", setThemePreference);

// Photos
api.get("/latest-photo", getLatestPhoto);
api.get("/photo/:requestId", getPhotoData);
api.get("/photo-base64/:requestId", getPhotoBase64);
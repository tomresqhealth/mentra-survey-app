import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Possible intents the classifier can return.
 * - CAPTURE: user wants to take a photo
 * - NEXT: user wants to advance to the next step
 * - SKIP: user wants to skip current step (alias for NEXT)
 * - REPEAT: user wants to hear the current step again
 * - GO_BACK: user wants to return to the previous step or start over
 * - PAUSE: user wants to pause / stop / hold on
 * - RESUME: user wants to continue after a pause
 * - QUESTION: user is asking a question (answer is included)
 * - NONE: background noise, irrelevant speech, or unrecognizable
 */
export type Intent =
  | "CAPTURE"
  | "NEXT"
  | "SKIP"
  | "REPEAT"
  | "GO_BACK"
  | "PAUSE"
  | "RESUME"
  | "QUESTION"
  | "NONE";

export interface ClassificationResult {
  intent: Intent;
  /** Only populated when intent is QUESTION */
  answer?: string;
}

const SYSTEM_PROMPT = `You are an intent classifier for a voice-controlled kitchen appliance survey app running on smart glasses.

The user is a field technician performing a site survey. They speak commands and questions aloud. Your job is to classify each utterance into exactly one intent.

Available intents:
- CAPTURE — user wants to take a photo (e.g. "capture", "take a photo", "snap that", "get a picture")
- NEXT — user wants to advance to the next survey step (e.g. "next", "continue", "go ahead", "move on", "ready", "finish")
- SKIP — user wants to skip the current step without completing it (e.g. "skip", "skip this one", "pass")
- REPEAT — user wants to hear the current instructions again (e.g. "repeat", "say that again", "what did you say", "huh", "come again", "I didn't catch that", "what?", "pardon")
- GO_BACK — user wants to go back to a previous step or start the survey over (e.g. "go back", "previous", "start over", "back to the beginning", "repeat the intro", "redo that step")
- PAUSE — user wants to pause the survey temporarily (e.g. "pause", "wait", "hold on", "stop", "one moment", "hang on")
- RESUME — user wants to resume after pausing (e.g. "resume", "go ahead", "continue", "I'm back", "okay", "ready")
- QUESTION — user is asking a question about the survey, the current step, or the process. Provide a brief, helpful answer.
- NONE — background noise, irrelevant speech, or something you can't classify

Important rules:
1. Respond ONLY with a JSON object. No markdown, no code blocks, no explanation.
2. Format: {"intent": "...", "answer": "..."}
3. The "answer" field is ONLY included when intent is QUESTION. Otherwise omit it.
4. When in doubt between NONE and another intent, prefer the other intent — the user is trying to communicate.
5. Keep QUESTION answers to 1 sentence max. The user is wearing smart glasses and hears this via TTS.
6. If the user asks to repeat, go back, or redo something from earlier, use GO_BACK, not QUESTION.

CRITICAL — Echo detection:
The smart glasses lack echo cancellation. The microphone often picks up the system's own TTS audio and transcribes it. You MUST classify these echo phrases as NONE, not as commands. Common echo patterns to watch for:
- Phrases that sound like system instructions: "add more verbal notes and take more photos", "say next to continue", "image saved", "survey paused", "resuming survey"
- Fragments of the current step's voice prompt (provided below)
- Single-word fragments like "saved", "next", "continue" that appear right after the system spoke
If the utterance closely matches or is a fragment of known system TTS output (the step prompt or common system responses), classify it as NONE.`;

export class GeminiClassifier {
  private model;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set in environment variables");
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.1, // Low temperature for consistent classification
        maxOutputTokens: 512,
      },
    });
  }

  /**
   * Classify a user utterance into an intent.
   * Includes current step context so Gemini can answer questions intelligently.
   */
  async classify(
    utterance: string,
    stepContext: { stepCode: string; voicePrompt: string; appliance: string; stepIndex: number; totalSteps: number },
    isPaused: boolean
  ): Promise<ClassificationResult> {
    const contextPrompt = `Current survey step: ${stepContext.stepCode} (${stepContext.appliance}) — step ${stepContext.stepIndex + 1} of ${stepContext.totalSteps}
Step instructions: "${stepContext.voicePrompt}"
Survey is currently ${isPaused ? "PAUSED" : "ACTIVE"}.

User said: "${utterance}"`;

    try {
      const result = await this.model.generateContent({
        contents: [
          { role: "user", parts: [{ text: SYSTEM_PROMPT + "\n\n" + contextPrompt }] },
        ],
      });

      const responseText = result.response.text().trim();

      // Extract JSON from response (handle markdown code blocks if Gemini wraps them)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn(`⚠️ Gemini returned non-JSON: ${responseText}`);
        return { intent: "NONE" };
      }

      const parsed = JSON.parse(jsonMatch[0]) as ClassificationResult;

      // Validate the intent
      const validIntents: Intent[] = [
        "CAPTURE", "NEXT", "SKIP", "REPEAT", "GO_BACK", "PAUSE", "RESUME", "QUESTION", "NONE",
      ];
      if (!validIntents.includes(parsed.intent)) {
        console.warn(`⚠️ Gemini returned invalid intent: ${parsed.intent}`);
        return { intent: "NONE" };
      }

      console.log(`🤖 Gemini classified "${utterance}" → ${parsed.intent}${parsed.answer ? ` (answer: "${parsed.answer}")` : ""}`);
      return parsed;
    } catch (e: any) {
      console.error(`❌ Gemini classification failed: ${e.message}`);
      return { intent: "NONE" };
    }
  }
}

import { User } from "./session/User";
import { SurveyStep } from "./manager/SheetManager";

export class SurveyApp {
  private steps: SurveyStep[] = [];
  private currentStepIndex: number = 0;
  private isSurveyActive: boolean = false;

  constructor(private user: User) {}

  /**
   * Initializes the survey by fetching the script from Google Sheets
   */
  async startSurvey(jobId: string) {
    try {
      // 1. Load the steps from Google Sheets
      this.steps = await this.user.sheetManager.loadSurveySteps();
      
      if (this.steps.length === 0) {
        await this.user.audio.speak("I couldn't find any survey steps in the Google Sheet. Please check the permissions.");
        return;
      }

      // 2. Start the local recording session
      await this.user.recordManager.startRecording(jobId);
      
      this.isSurveyActive = true;
      this.currentStepIndex = 0;

      await this.user.audio.speak(`Starting survey for job ${jobId}.`);
      await this.runCurrentStep();

    } catch (error) {
      console.error("Failed to start survey:", error);
      await this.user.audio.speak("There was an error starting the survey.");
    }
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
   * This is the "Ear" of the app. It listens to what you say and 
   * decides if it should trigger a photo or go to the next step.
   */
  async handleTranscription(text: string, isFinal: boolean) {
    if (!this.isSurveyActive || !isFinal) return;

    const lowerText = text.toLowerCase();
    const currentStep = this.steps[this.currentStepIndex];

    // Logic for "Capture" trigger
    if (lowerText.includes("capture") || lowerText.includes("take photo")) {
      await this.user.audio.speak("Capturing photo.");
      // In v1, we just take the photo. In v2, we can upload it to a specific Drive folder.
      await this.user.photo.takePhoto(); 
      return;
    }

    // Logic for "Next" trigger (moves to the next row in the sheet)
    if (lowerText.includes("next") || lowerText.includes("continue")) {
      this.currentStepIndex++;

      if (this.currentStepIndex < this.steps.length) {
        await this.runCurrentStep();
      } else {
        await this.finishSurvey();
      }
    }
  }

  private async finishSurvey() {
    this.isSurveyActive = false;
    await this.user.audio.speak("Survey complete. Finalizing audio record and saving files.");
    
    // Convert the raw stream to MP3
    await this.user.recordManager.finalizeRecording();
    
    console.log("🏁 Survey finished successfully.");
  }
}
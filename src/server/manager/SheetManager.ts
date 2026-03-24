import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import path from 'path';

export interface SurveyStep {
  id: string;
  appliance: string;
  stepCode: string;
  voicePrompt: string;
  captureRequirement: string;
  wakeWord: string;
  nextTrigger: string;
}

export class SheetManager {
  private doc: GoogleSpreadsheet;
  // This is the ID from the URL you shared
  private spreadsheetId = "1gVo4zV7Acxe5gEpcQmM0_Rne_MmuFjay7GJKZE5lzcw";

  constructor() {
    // This looks for your service-account.json in the main folder
    const serviceAccountPath = path.join(process.cwd(), 'service-account.json');
    const creds = require(serviceAccountPath);

    const auth = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file'
      ],
    });

    this.doc = new GoogleSpreadsheet(this.spreadsheetId, auth);
  }

  /**
   * Fetches the survey script from the Google Sheet
   */
  async loadSurveySteps(): Promise<SurveyStep[]> {
    try {
      console.log("Fetching survey steps from Google Sheets...");
      await this.doc.loadInfo();
      const sheet = this.doc.sheetsByIndex[0]; // The first tab
      const rows = await sheet.getRows();

      const steps = rows.map(row => ({
        id: row.get('Unique Step ID'),
        appliance: row.get('Appliance'),
        stepCode: row.get('Step'),
        voicePrompt: row.get('Voice Prompt'),
        captureRequirement: row.get('Capture Requirement'),
        wakeWord: row.get('Wake Word'),
        nextTrigger: row.get('Next Step Trigger Word'),
      }));

      console.log(`Successfully loaded ${steps.length} steps.`);
      return steps;
    } catch (error) {
      console.error("Failed to fetch Google Sheet steps. Check your service-account.json and Sheet sharing permissions.", error);
      return [];
    }
  }
}
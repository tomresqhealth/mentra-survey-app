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

      // Timeout guard — Google Sheets API can hang silently
      const SHEET_TIMEOUT_MS = 15_000;
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Google Sheets fetch timed out after ${SHEET_TIMEOUT_MS / 1000}s`)), SHEET_TIMEOUT_MS)
      );

      await Promise.race([this.doc.loadInfo(), timeout]);
      const sheet = this.doc.sheetsByIndex[0];
      const rows = await Promise.race([sheet.getRows(), timeout]);

      // Log headers so we can debug column mismatches
      const headerValues = sheet.headerValues;
      console.log(`📊 Sheet headers: ${JSON.stringify(headerValues)}`);

      const steps = rows.map(row => ({
        // Map to whatever headers actually exist in the sheet.
        // Known headers from the Google Sheet: s, Appliance, Step, Voice Prompt,
        // Capture Requirement, Wake Word, Next Step Trigger Word
        id: row.get('s') || row.get('Unique Step ID') || '',
        appliance: row.get('Appliance') || '',
        stepCode: row.get('Step') || '',
        voicePrompt: row.get('Voice Prompt') || '',
        captureRequirement: row.get('Capture Requirement') || '',
        wakeWord: row.get('Wake Word') || '',
        nextTrigger: row.get('Next Step Trigger Word') || '',
      }));

      console.log(`Successfully loaded ${steps.length} steps.`);
      return steps;
    } catch (error) {
      console.error("Failed to fetch Google Sheet steps. Check your service-account.json and Sheet sharing permissions.", error);
      return [];
    }
  }
}
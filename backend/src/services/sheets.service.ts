import { createRequire } from "node:module";
import { getFreeAgentTeamSheetName, getValuesSheetName } from "../constants.js";


const require = createRequire(import.meta.url);
const PublicGoogleSheetsParser = require("public-google-sheets-parser") as new (
  spreadsheetId: string,
  option?: { sheetName?: string; sheetId?: string; useFormat?: boolean },
) => {
  parse(): Promise<unknown[]>;
  setOption(option: {
    sheetName?: string;
    sheetId?: string;
    useFormat?: boolean;
  }): void;
};

/** Extract the spreadsheet ID from a Google Sheets URL. */
function extractSpreadsheetId(sheetLink: string): string {
  const match = sheetLink.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error("Could not extract spreadsheet ID from link");
  return match[1];
}

export async function loadFreeAgentData(season: string, sheetLink: string) {
  const spreadsheetId = extractSpreadsheetId(sheetLink);

  const teamSheetName = getFreeAgentTeamSheetName(season);
  const valuesSheetName = getValuesSheetName(season);

  const parser = new PublicGoogleSheetsParser(spreadsheetId, {
    sheetName: teamSheetName,
  });
  const freeAgentsByTeam = await parser.parse();

  parser.setOption({ sheetName: valuesSheetName });
  const freeAgentValues = await parser.parse();

  return { freeAgentsByTeam, freeAgentValues };
}

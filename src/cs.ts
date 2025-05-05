import fs from "fs";
import { execSync } from "child_process";
import vdf from "vdf-parser";

export async function getCsVersion() {
  if (!fs.existsSync("/serverfiles/steamapps/appmanifest_730.acf")) {
    return;
  }

  const version = execSync(
    "cat /serverfiles/steamapps/appmanifest_730.acf",
  ).toString();

  const parsed = vdf.parse(version) as {
    AppState?: {
      buildid?: number;
    };
  };

  return parsed?.AppState?.buildid;
}

import fs from "fs";
import path from "path";
import { glob } from "glob";
import fetch from "node-fetch";

const DEMO_DIR = "/demos";
const HASURA_GRAPHQL_ADMIN_SECRET = process.env
  .HASURA_GRAPHQL_ADMIN_SECRET as string;

let isUploading = false;

type Demo = {
  name: string;
  size: number;
  mapId: string;
  matchId: string;
  fullPath: string;
};

export async function uploadDemos() {
  if (isUploading) {
    return;
  }

  isUploading = true;

  const demos = await getDemos();

  if (!demos.length) {
    isUploading = false;
    return;
  }

  console.info(`found ${demos.length} demos`);

  for (const demo of demos) {
    try {
      const presignedResponse = await fetch(
        `http://${process.env.API_SERVICE_HOST}:${process.env.API_SERVICE_PORT}/demos/${demo.matchId}/pre-signed`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "hasura-admin-secret": HASURA_GRAPHQL_ADMIN_SECRET,
          },
          body: JSON.stringify({
            demo: demo.name,
            mapId: demo.mapId,
          }),
        },
      );

      switch (presignedResponse.status) {
        case 409:
          console.info(`match map is not finished`);
          continue;
        case 406:
          console.info(`demo is already uploaded`);
          fs.unlinkSync(demo.fullPath);
          continue;
        case 410:
          console.info(`match map not found`);
          fs.unlinkSync(demo.fullPath);
          continue;
      }

      if (!presignedResponse.ok) {
        console.error(`unable to get presigned url`, presignedResponse.status);
        continue;
      }

      const { presignedUrl } = (await presignedResponse.json()) as {
        presignedUrl: string;
      };

      const uploadResponse = await fetch(presignedUrl, {
        method: "PUT",
        body: fs.createReadStream(demo.fullPath),
        headers: {
          "Content-Length": demo.size.toString(),
          "Content-Type": "application/octet-stream",
        },
      });

      if (!uploadResponse.ok) {
        console.error(`unable to upload demo`, uploadResponse.status);
        continue;
      }

      await fetch(
        `http://${process.env.API_SERVICE_HOST}:${process.env.API_SERVICE_PORT}/demos/${demo.matchId}/uploaded`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "hasura-admin-secret": HASURA_GRAPHQL_ADMIN_SECRET,
          },
          body: JSON.stringify({
            demo: demo.name,
            mapId: demo.mapId,
            size: demo.size,
          }),
        },
      );

      fs.unlinkSync(demo.fullPath);
    } catch (error) {
      console.error(`unable to get presigned url`, error);
    } finally {
      const matchDir = path.join(DEMO_DIR, demo.matchId);
      if (await checkIfPathEmpty(matchDir)) {
        fs.rmdirSync(matchDir, { recursive: true });
      }
    }
  }

  isUploading = false;
}

async function checkIfPathEmpty(path: string) {
  const files = await glob(`${path}/**/*.dem`, { dot: true });
  return files.length === 0;
}
async function getDemos(): Promise<Array<Demo>> {
  const availableDemos: Array<Demo> = [];

  const demoFiles = await glob(`${DEMO_DIR}/**/*.dem`, { dot: true });

  for (const demoPath of demoFiles) {
    const [matchId, mapId, name] = demoPath.split(path.sep).slice(-3);

    availableDemos.push({
      name,
      mapId,
      matchId,
      fullPath: demoPath,
      size: fs.statSync(demoPath).size,
    });
  }

  return availableDemos;
}

import fs from "fs";
import path from "path";
import fetch from "node-fetch";

const DEMO_DIR = "/demos";

export async function uploadDemos() {
  const demos = await getDemos();

  if (!demos.length) {
    return;
  }

  console.info(`found ${demos.length} demos`);

  for (const { demo, mapId, matchId } of demos) {
    try {
      const fullPath = path.join(DEMO_DIR, matchId, mapId, demo);
      const size = fs.statSync(fullPath).size;

      console.info(`uploading demo`, {
        matchId,
        mapId,
        size,
        demo,
      });

      const response = await fetch(
        `http://${process.env.API_SERVICE_HOST}:${process.env.API_SERVICE_PORT}/demos/${matchId}/pre-signed`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "hasura-admin-secret": process.env
              .HASURA_GRAPHQL_ADMIN_SECRET as string,
          },
          body: JSON.stringify({
            demo,
            mapId,
          }),
        },
      );

      switch (response.status) {
        case 409:
          console.info(`match map is not finished`);
          break;
        case 406:
          console.info(`demo is already uploaded`);
          fs.unlinkSync(fullPath);
          break;
        case 410:
          console.info(`match map not found`);
          fs.unlinkSync(fullPath);
          break;
      }

      if (!response.ok) {
        console.error(`unable to get presigned url`, response.status);
        continue;
      }

      const { presignedUrl } = (await response.json()) as {
        presignedUrl: string;
      };

      const success = await fetch(presignedUrl, {
        method: "PUT",
        body: fs.createReadStream(fullPath),
        headers: {
          "Content-Type": "application/octet-stream",
        },
      });

      if (!success) {
        console.error(`unable to upload demo`, matchId, mapId, demo);
        continue;
      }

      await fetch(
        `http://${process.env.API_SERVICE_HOST}:${process.env.API_SERVICE_PORT}/demos/${matchId}/uploaded`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            demo,
            mapId,
            size,
          }),
        },
      );

      fs.unlinkSync(fullPath);
    } catch (error) {
      console.error(`unable to get presigned url`, error);
    }
  }
}

async function getDemos() {
  const availableDemos: Array<{
    matchId: string;
    mapId: string;
    demo: string;
  }> = [];

  const demos = await fs.promises.readdir(DEMO_DIR, { withFileTypes: true });

  for (const demo of demos) {
    if (demo.isDirectory()) {
      const matchId = demo.name;
      const matchPath = path.join(DEMO_DIR, matchId);
      const maps = await fs.promises.readdir(matchPath, {
        withFileTypes: true,
      });

      for (const map of maps) {
        if (map.isDirectory()) {
          const mapPath = path.join(matchPath, map.name);
          const mapDemos = await fs.promises.readdir(mapPath);

          for (const demoFile of mapDemos) {
            if (demoFile.endsWith(".dem")) {
              availableDemos.push({
                matchId,
                mapId: map.name,
                demo: demoFile,
              });
            }
          }
        }
      }
    }
  }

  return availableDemos;
}

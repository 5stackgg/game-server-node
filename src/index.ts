import http from "http";
import { getPublicIP } from "./network";
import { uploadDemos } from "./upload-demos";
import { setupWebSocket, stopPing } from "./websocket";
import path from "path";
import fs from "fs";
import { getRandomPort } from "get-port-please";

const srcDirectory = process.env.DEV
  ? path.join(__dirname, "./../../src")
  : path.join(__dirname, "..");

// Helper function to replace placeholders in YAML template
function replacePlaceholders(
  template: string,
  replacements: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    const placeholder = `{{${key}}}`;
    result = result.replace(new RegExp(placeholder, "g"), value);
  }
  return result;
}

// Type definitions for match data
interface MatchMap {
  id: string;
  map: {
    name: string;
    workshop_map_id?: string;
  };
  order: number;
  status: string;
  lineup_1_side: string;
  lineup_2_side: string;
}

interface Player {
  captain: boolean;
  steam_id: string;
  match_lineup_id: string;
  placeholder_name?: string;
  name?: string;
  is_banned: boolean;
  is_gagged: boolean;
  is_muted: boolean;
}

interface Lineup {
  id: string;
  name: string;
  coach_steam_id?: string;
  lineup_players: Player[];
}

interface MatchOptions {
  mr: number;
  type: string;
  best_of: number;
  coaches: boolean;
  overtime: boolean;
  tv_delay: number;
  knife_round: boolean;
  ready_setting: string;
  timeout_setting: string;
  tech_timeout_setting: string;
  number_of_substitutes: number;
  cfg_override: string;
}

interface MatchData {
  id: string;
  password: string;
  lineup_1_id: string;
  lineup_2_id: string;
  current_match_map_id: string;
  options: MatchOptions;
  match_maps: MatchMap[];
  lineup_1: Lineup;
  lineup_2: Lineup;
  is_lan: boolean;
}

// Generate YAML files with actual values
async function generateYamlFiles(matchData: MatchData) {
  try {
    // Extract data from match request
    const jobName = `game-server-${matchData.id}`;
    const gameServerNodeId = process.env.NODE_NAME as string;

    if (!gameServerNodeId) {
      throw new Error("node name is not set");
    }

    // Get the first map from match_maps array
    const firstMap = matchData.match_maps[0];
    const mapName = firstMap?.map.name || "de_dust2";

    const serverPort = await getRandomPort();
    const tvPort = await getRandomPort();

    fs.writeFileSync(
      path.join(`/pod-manifests`, `${jobName}.yaml`),
      replacePlaceholders(
        fs.readFileSync(
          path.join(srcDirectory, "/resources/k8s/game-server-pod.yaml"),
          "utf8",
        ),
        {
          POD_NAME: jobName,
          NAMESPACE: "5stack",
          GAME_SERVER_NODE_ID: gameServerNodeId,
          PLUGIN_IMAGE: "ghcr.io/5stackgg/game-server:latest",
          SERVER_PORT: serverPort.toString(),
          TV_PORT: tvPort.toString(),
          RCON_PASSWORD: "default-rcon-password",
          MATCH_PASSWORD: matchData.password,
          MAP_NAME: mapName,
          SERVER_ID: matchData.id,
          SERVER_API_PASSWORD: "api-password",
          STEAM_RELAY: "false",
          CPUS: "1",
        },
      ),
    );
    console.info("started match", {
      serverPort,
      tvPort,
    });
  } catch (error) {
    console.error("Error generating YAML files:", error);
  }
}

const ipInterval = setInterval(async () => {
  await getPublicIP();
}, 5 * 1000);

const port = parseInt(process.env.HEALTH_PORT || "8080");

const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER || "5s";
const BASIC_AUTH_PASS = process.env.NODE_NAME;

function parseAuthHeader(authHeader: string | undefined) {
  if (!authHeader || !authHeader.startsWith("Basic ")) return null;
  const base64 = authHeader.slice(6);
  try {
    const [user, pass] = Buffer.from(base64, "base64").toString().split(":");
    return { user, pass };
  } catch (error) {
    console.error("Error parsing auth header", error);
  }
}

function validateAuth(req: http.IncomingMessage) {
  const auth = parseAuthHeader(req.headers.authorization);
  if (!auth || auth.user !== BASIC_AUTH_USER || auth.pass !== BASIC_AUTH_PASS) {
    return false;
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (req.url && req.url.startsWith("/assets")) {
    res.statusCode = 200;
    try {
      res.end(fs.readFileSync(path.join(srcDirectory, req.url)));
    } catch (e) {
      res.statusCode = 404;
      res.end();
    }
    return;
  }

  if (req.url === "/") {
    // Require valid auth for GET /
    if (req.method !== "GET" || !validateAuth(req)) {
      res.statusCode = 401;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.end(fs.readFileSync(path.join(srcDirectory, "./index.html")));
    return;
  }

  if (req.url === "/start-match") {
    // Require valid auth for POST /start-match
    if (req.method !== "POST" || !validateAuth(req)) {
      res.statusCode = 401;
      res.end();
      return;
    }
    const body = await new Promise<any>((resolve) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        resolve(JSON.parse(body));
      });
    });

    await generateYamlFiles(body);

    res.statusCode = 200;
    res.end();
    return;
  }

  res.statusCode = 404;
  res.end();
});

server.listen(port, () => {
  console.log(`http server listening on : ${port}`);
});

process.on(process.env.DEV ? "SIGUSR2" : "SIGTERM", () => {
  stopPing();
  clearInterval(ipInterval);
  process.exit(0);
});

setupWebSocket();

setInterval(async () => {
  await uploadDemos();
}, 1000 * 60);

uploadDemos();

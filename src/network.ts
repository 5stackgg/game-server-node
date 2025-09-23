import { spawn } from "child_process";
import os from "os";

export let publicIP;

export async function getLanIP() {
  const interfaces = getInterfaces();
  for (const { name, address } of interfaces) {
    if (name.startsWith("tailscale")) {
      continue;
    }
    return address;
  }
}

export async function getPublicIP() {
  try {
    const response = await fetch("https://checkip.amazonaws.com");

    publicIP = (await response.text()).replace(/\n/, "");
  } catch (error) {
    console.warn("unable to get ipv4 address", error);
  }
}

function getInterfaces(): Array<
  os.NetworkInterfaceInfoIPv4 & {
    name: string;
  }
> {
  const interfaces: Array<
    os.NetworkInterfaceInfoIPv4 & {
      name: string;
    }
  > = [];
  const _interfaces = os.networkInterfaces();
  for (const name of Object.keys(_interfaces)) {
    const ifaces = _interfaces[name];

    if (!ifaces) {
      continue;
    }

    for (const iface of ifaces) {
      if (iface.internal || iface.family !== "IPv4" || name.startsWith("cni")) {
        continue;
      }

      interfaces.push({ ...iface, name });
    }
  }

  for (const iface of interfaces) {
    captureNicStats(iface.name);
  }

  return interfaces;
}

const capturedNics = new Map<
  string,
  {
    tx: Map<string, number>;
    rx: Map<string, number>;
  }
>();

async function captureNicStats(nic: string) {
  if (capturedNics.has(nic)) {
    return;
  }

  const nicStats = {
    tx: new Map<string, number>(),
    rx: new Map<string, number>(),
  };

  capturedNics.set(nic, nicStats);

  capture(nic, "tx", (data) => {
    const tx = captureData(data);
    if (!tx) {
      return;
    }
    nicStats.tx.set(new Date().toISOString(), tx);
  });
  capture(nic, "rx", (data) => {
    const rx = captureData(data);
    if (!rx) {
      return;
    }
    nicStats.rx.set(new Date().toISOString(), rx);
  });
}

export function getNetworkStats() {
  const nics: Array<{ name: string; tx: number; rx: number }> = [];

  for (const [nic, nicStats] of capturedNics.entries()) {
    const txValues = Array.from(nicStats.tx.values());
    const rxValues = Array.from(nicStats.rx.values());

    const txAvg =
      txValues.length > 0
        ? txValues.reduce((a, b) => a + b, 0) / txValues.length
        : 0;
    const rxAvg =
      rxValues.length > 0
        ? rxValues.reduce((a, b) => a + b, 0) / rxValues.length
        : 0;

    nics.push({
      name: nic,
      tx: Math.ceil(txAvg),
      rx: Math.ceil(rxAvg),
    });

    nicStats.tx.clear();
    nicStats.rx.clear();
  }

  return nics;
}

function capture(
  nic: string,
  type: "tx" | "rx",
  onData: (data: string) => void,
) {
  return new Promise<string>((resolve, reject) => {
    let returnData = "";

    const monitor = spawn("bash", [
      "-c",
      `old="$(</sys/class/net/${nic}/statistics/${type}_bytes)"; while $(sleep 1);
  do now=$(</sys/class/net/${nic}/statistics/${type}_bytes); echo $(($now-$old)) B/s old=$old now=$now; old=$now;
  done`,
    ]);

    process.on(process.env.DEV ? "SIGUSR2" : "SIGTERM", () => {
      monitor.kill();
    });

    monitor.stdin.on("error", async (error) => {
      console.error("Error running processs", error);
      reject(error);
    });

    monitor.stderr.on("data", (error) => {
      reject(error.toString());
    });

    monitor.stdout.on("data", (data) => {
      if (onData && typeof onData === "function") {
        onData(data);
      } else {
        returnData += data.toString();
      }
    });

    monitor.on("close", () => {
      resolve(
        returnData || "No data written to memory due to onData() handler",
      );
    });
  });
}

function captureData(data: string) {
  try {
    data = data.toString();
    // Example line: "9709 B/s old=83628110721 now=83628120430"
    const match = data.match(/^(\d+)\s+B\/s/);
    if (match) {
      return parseInt(match[1], 10);
    } else {
      console.warn("Could not parse network data:", data);
      return 0;
    }
  } catch (error) {
    console.error("Error capturing metric", data, error);
  }
}

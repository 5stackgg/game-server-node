import {
  CoreV1Api,
  KubeConfig,
  Metrics,
  PodMetric,
  V1Node,
  FetchError,
} from "@kubernetes/client-node";
import * as child_process from "node:child_process";
import { getNetworkStats } from "./network";

const kc = new KubeConfig();
kc.loadFromDefault();

const nodeName = process.env.NODE_NAME;

const cpuInfo = getCpuInfo();

const apiClient = kc.makeApiClient(CoreV1Api);
const metricsClient = new Metrics(kc);

export async function getNodeIP(node: V1Node) {
  return node.status?.addresses?.find(
    (address) => address.type === "InternalIP",
  )?.address;
}

export async function getNodeSupportsCpuPinning(node: V1Node) {
  return node.metadata?.annotations?.["k3s.io/node-args"].includes(
    "cpu-manager-policy=static",
  );
}

export async function getNodeLabels(node: V1Node) {
  try {
    const _labels = node.metadata?.labels || {};

    const labels = {};

    for (const label in _labels) {
      if (label.includes("5stack")) {
        labels[label] = _labels[label];
      }
    }

    return labels;
  } catch (error) {
    console.error("error fetching node metadata:", error);
  }
}

export async function getNode() {
  const nodeName = process.env.NODE_NAME;
  if (!nodeName) {
    throw Error("NODE_NAME environment variable is not set");
  }

  return await apiClient.readNode({
    name: nodeName,
  });
}

export async function getNodeStats(node: V1Node) {
  try {
    const allocatable = node.status?.allocatable;
    const capacity = node.status?.capacity;

    if (!allocatable || !capacity) {
      throw new Error("Could not get node allocatable or capacity");
    }

    if (!node.metadata?.name) {
      throw new Error("Could not get node name");
    }

    const metrics = await metricsClient.getNodeMetrics();

    return {
      disks: getDiskStats(),
      network: getNetworkStats(),
      memoryAllocatable: allocatable.memory,
      memoryCapacity: capacity.memory,
      cpuInfo,
      cpuCapacity: parseInt(capacity.cpu),
      nvidiaGPU: allocatable["nvidia.com/gpu"] ? true : false,
      metrics: metrics.items.find(
        (nodeMetric) => nodeMetric.metadata.name === node.metadata?.name,
      ),
    };
  } catch (error) {
    if (error instanceof FetchError && error.code !== "404") {
      console.error("Error getting node metrics:", error.message);
    }
  }
}

export async function getPodStats() {
  if (!nodeName) {
    throw new Error("NODE_NAME environment variable is not set");
  }

  try {
    const podList = await apiClient.listNamespacedPod({
      namespace: "5stack",
      fieldSelector: `spec.nodeName=${nodeName}`,
    });

    const stats: Array<{
      name: string;
      metrics: PodMetric;
    }> = [];

    const { items: podMetrics } = await metricsClient.getPodMetrics("5stack");

    for (const pod of podList.items) {
      if (!pod.metadata?.namespace || !pod.metadata?.name) {
        continue;
      }

      const podMetric = podMetrics.find(
        (podMetric) => podMetric.metadata.name === pod.metadata?.name,
      );

      if (!podMetric) {
        continue;
      }

      stats.push({
        name: pod.metadata?.labels?.app!,
        metrics: podMetric,
      });
    }

    return stats;
  } catch (error) {
    console.error("Error listing pods:", error);
  }
}

export async function getNodeLowLatency(node: V1Node) {
  try {
    const nodeInfo = node.status?.nodeInfo;
    if (!nodeInfo) {
      throw new Error("Could not get node info");
    }

    return nodeInfo.kernelVersion.includes("lowlatency");
  } catch (error) {
    console.error("Error getting node kernel information:", error);
    throw error;
  }
}

function getDiskStats() {
  try {
    const output = child_process.execSync(
      "df -P / /demos 2>/dev/null || true",
      { encoding: "utf8" },
    );

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => {
        return line.length > 0 && !line.startsWith("Filesystem");
      })
      .map((line) => {
        const [filesystem, size, used, available, usedPercent, mountpoint] =
          line.split(/\s+/);
        return {
          filesystem,
          size,
          used,
          available,
          usedPercent,
          mountpoint,
        } as {
          filesystem: string;
          size: string;
          used: string;
          available: string;
          usedPercent: string;
          mountpoint: string;
        };
      })
      .filter((disk) => {
        return disk.mountpoint === "/" || disk.mountpoint === "/demos";
      });
  } catch (error) {
    console.error("Error getting disk summary:", error);
  }
}

function getCpuInfo() {
  const json = child_process.execSync("lscpu -J", { encoding: "utf8" });
  const parsed = JSON.parse(json) as {
    lscpu: Array<{ field: string; data: string }>;
  };

  const map: Record<string, string> = {};

  for (const item of parsed.lscpu) {
    map[item.field.replace(/:/g, "")] = item.data;
  }

  return {
    coresPerSocket: parseInt(map["Core(s) per socket"], 10),
    threadsPerCore: parseInt(map["Thread(s) per core"], 10),
  };
}

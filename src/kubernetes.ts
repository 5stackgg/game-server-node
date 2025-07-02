import {
  CoreV1Api,
  KubeConfig,
  Metrics,
  PodMetric,
  V1Node,
  FetchError,
} from "@kubernetes/client-node";

const kc = new KubeConfig();
kc.loadFromDefault();

const nodeName = process.env.NODE_NAME;

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
      memoryAllocatable: allocatable.memory,
      memoryCapacity: capacity.memory,
      cpuCapacity: parseInt(capacity.cpu),
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

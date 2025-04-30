import {
  CoreV1Api,
  HttpError,
  KubeConfig,
  Metrics,
  PodMetric,
} from "@kubernetes/client-node";

const kc = new KubeConfig();
kc.loadFromDefault();

const nodeName = process.env.NODE_NAME;

const apiClient = kc.makeApiClient(CoreV1Api);
const metricsClient = new Metrics(kc);

export async function getNodeIP() {
  const node = await getNode();
  return node.status?.addresses?.find(
    (address) => address.type === "InternalIP",
  )?.address;
}

export async function getNodeLabels() {
  try {
    const node = await getNode();

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

  const { body: node } = await apiClient.readNode(nodeName);

  return node;
}

export async function getNodeStats() {
  try {
    if (!nodeName) {
      throw Error("NODE_NAME environment variable is not set");
    }

    const node = await getNode();

    const allocatable = node.status?.allocatable;
    const capacity = node.status?.capacity;

    if (!allocatable || !capacity) {
      throw new Error("Could not get node allocatable or capacity");
    }

    const metrics = await metricsClient.getNodeMetrics(nodeName);

    return {
      memoryAllocatable: allocatable.memory,
      memoryCapacity: capacity.memory,
      cpuCapacity: parseInt(capacity.cpu),
      metrics,
    };
  } catch (error) {
    if (error instanceof HttpError && error.statusCode !== 404) {
      console.error(
        "Error getting node metrics:",
        error?.body || error.message,
      );
    }
  }
}

export async function getPodStats() {
  if (!nodeName) {
    throw new Error("NODE_NAME environment variable is not set");
  }

  try {
    const pods = await apiClient.listNamespacedPod(
      "5stack",
      undefined,
      undefined,
      undefined,
      `spec.nodeName=${nodeName}`,
    );

    const stats: Array<{
      name: string;
      metrics: PodMetric;
    }> = [];

    for (const pod of pods.body.items) {
      if (!pod.metadata?.namespace || !pod.metadata?.name) {
        continue;
      }
      try {
        const metrics = await metricsClient.getPodMetrics(
          pod.metadata?.namespace,
          pod.metadata?.name,
        );

        stats.push({
          name: pod.metadata?.labels?.app!,
          metrics,
        });
      } catch (error) {
        if (error instanceof HttpError && error?.statusCode !== 404) {
          console.error(
            "Error getting pod metrics:",
            error?.body || error.message,
          );
        }
      }
    }

    return stats;
  } catch (error) {
    console.error("Error listing pods:", error);
  }
}

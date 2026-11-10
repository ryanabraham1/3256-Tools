import { parseWPILog } from "@/lib/robot-logs/core/wpilog";
import { analyze } from "@/lib/robot-logs/core/analysis";
self.onmessage = async (
  event: MessageEvent<{
    id: number;
    buffer: ArrayBuffer;
    name: string;
    expectedHash?: string;
  }>,
) => {
  try {
    const { buffer, name, expectedHash } = event.data;
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const hash = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (expectedHash && hash !== expectedHash)
      throw new Error(
        "The recording checksum does not match. Download it again before trusting the analysis.",
      );
    const recording = parseWPILog(buffer, name);
    self.postMessage({
      id: event.data.id,
      hash,
      recording,
      analysis: analyze(recording),
    });
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

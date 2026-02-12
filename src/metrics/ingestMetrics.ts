// src/metrics/ingestMetrics.ts

export type IngestEventType =
  | 'run_started'
  | 'run_finished'
  | 'test_started'
  | 'test_finished'
  | string;

export interface RunMetrics {
  runId: string;
  applicationId: string;
  totalEvents: number;
  firstEventAt: number;
  lastEventAt: number;
  totalProcessingMs: number;
}

export interface IngestMetricsSnapshot {
  totalEvents: number;
  totalProcessingMs: number;
  avgProcessingMs: number;
  firstEventAt: number | null;
  lastEventAt: number | null;
  ingestRatePerSecond: number;
  runs: Record<
    string,
    {
      runId: string;
      applicationId: string;
      totalEvents: number;
      firstEventAt: string;
      lastEventAt: string;
      durationMs: number;
      avgProcessingMs: number;
    }
  >;
}

type RecordEventInput = {
  runId: string;
  applicationId: string;
  eventType: IngestEventType;
  receivedAt: number;
  processedAt: number;
  processingDurationMs: number;
};

// ---- internal state (in-memory, reset on restart) ----

let totalEvents = 0;
let totalProcessingMs = 0;
let firstEventAt: number | null = null;
let lastEventAt: number | null = null;

const runs = new Map<string, RunMetrics>();

// ---- mutation API ----

export function recordIngestEvent(input: RecordEventInput): void {
  totalEvents += 1;
  totalProcessingMs += input.processingDurationMs;

  if (firstEventAt === null) {
    firstEventAt = input.receivedAt;
  }
  lastEventAt = input.processedAt;

  const existing = runs.get(input.runId);
  if (!existing) {
    runs.set(input.runId, {
      runId: input.runId,
      applicationId: input.applicationId,
      totalEvents: 1,
      firstEventAt: input.receivedAt,
      lastEventAt: input.processedAt,
      totalProcessingMs: input.processingDurationMs,
    });
  } else {
    existing.totalEvents += 1;
    existing.lastEventAt = input.processedAt;
    existing.totalProcessingMs += input.processingDurationMs;
  }
}

export function resetIngestMetrics(): void {
  totalEvents = 0;
  totalProcessingMs = 0;
  firstEventAt = null;
  lastEventAt = null;
  runs.clear();
}

// Optional: for logging per run
export function getRunMetrics(runId: string): RunMetrics | undefined {
  return runs.get(runId);
}

// ---- read API ----

export function getIngestMetricsSnapshot(): IngestMetricsSnapshot {
  const avgProcessingMs =
    totalEvents > 0 ? totalProcessingMs / totalEvents : 0;

  let ingestRatePerSecond = 0;
  if (firstEventAt !== null && lastEventAt !== null) {
    const seconds =
      (lastEventAt - firstEventAt) / 1000 || 1; // avoid /0
    ingestRatePerSecond = totalEvents / seconds;
  }

  const runsObj: IngestMetricsSnapshot['runs'] = {};
  for (const [runId, m] of runs.entries()) {
    const durationMs = m.lastEventAt - m.firstEventAt;
    const avgPerEvent =
      m.totalEvents > 0 ? m.totalProcessingMs / m.totalEvents : 0;

    runsObj[runId] = {
      runId: m.runId,
      applicationId: m.applicationId,
      totalEvents: m.totalEvents,
      firstEventAt: new Date(m.firstEventAt).toISOString(),
      lastEventAt: new Date(m.lastEventAt).toISOString(),
      durationMs,
      avgProcessingMs: avgPerEvent,
    };
  }

  return {
    totalEvents,
    totalProcessingMs,
    avgProcessingMs,
    firstEventAt,
    lastEventAt,
    ingestRatePerSecond,
    runs: runsObj,
  };
}

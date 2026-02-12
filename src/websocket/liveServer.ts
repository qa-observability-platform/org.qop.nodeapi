// src/websocket/liveServer.ts
import { WebSocketServer, WebSocket } from 'ws';
import { logger } from '../utils/logger.js';
import { getApplicationIdByRunId } from '../repositories/testRuns.repository.js';

type LiveClient = {
  socket: WebSocket;
  runId?: string;
  appId?: string;
  subscriptionType: 'run' | 'app';
};

type UIUpdateEvent = {
  type: 'ui_update';
  runId: string;
  testCaseExecutionId: string;
  testKey: string;
  status: string;
  durationMs?: number;
  errorMessage?: string;
  timestamp: string;
  aiAnalysis?: {
    category: string;
    rootCause?: string;
    recommendation?: string;
    severity?: string;
    confidence?: number;
    isFlaky?: boolean;
  };
};

type RunSummaryEvent = {
  type: 'run_summary';
  runId: string;
  status: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests?: number;
  timeoutTests?: number;
  timestamp: string;
};

const liveClients = new Map<WebSocket, LiveClient>();

// In-memory cache: runId -> applicationId
// This prevents DB queries on every broadcast
// Cache is cleared when run completes
const runIdToAppIdCache = new Map<string, string>();

export function setupLiveWebSocket() {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  });

  wss.on('connection', async (socket, req) => {
    try {
      const url = new URL(req.url ?? '', 'http://localhost');
      const runId = url.searchParams.get('runId') ?? undefined;
      const appId = url.searchParams.get('appId') ?? undefined;

      if (!runId && !appId) {
        socket.send(JSON.stringify({ type: 'error', message: 'Provide runId or appId' }));
        socket.close();
        return;
      }

      if (runId && appId) {
        socket.send(JSON.stringify({ type: 'error', message: 'Cannot use both runId and appId' }));
        socket.close();
        return;
      }

      const client: LiveClient = {
        socket,
        runId,
        appId,
        subscriptionType: runId ? 'run' : 'app',
      };

      liveClients.set(socket, client);

      console.log(`[Live WS] ✅ Connected - runId: "${client.runId}", Total clients: ${liveClients.size}`);

      logger.info('Live WS connected', {
        subscriptionType: client.subscriptionType,
        runId: client.runId,
        appId: client.appId,
      });

      socket.send(JSON.stringify({
        type: 'connected',
        subscriptionType: client.subscriptionType,
        runId: client.runId,
        appId: client.appId,
        timestamp: new Date().toISOString(),
      }));

      socket.on('close', () => {
        liveClients.delete(socket);
        console.log(`[Live WS] 🔌 Disconnected - runId: "${client.runId}", Total clients: ${liveClients.size}`);
        
        logger.info('Live WS disconnected', {
          subscriptionType: client.subscriptionType,
          runId: client.runId,
        });
      });

      socket.on('error', (err) => {
        console.error(`[Live WS] ❌ Error:`, err);
        logger.error('Live WS error', {
          error: (err as any)?.message,
          runId: client.runId,
        });
      });
    } catch (err: any) {
      console.error('[Live WS] Connection failed:', err);
      logger.error('Live WS connection failed', { error: err?.message });
      socket.send(JSON.stringify({ type: 'error', message: 'Connection failed' }));
      socket.close();
    }
  });

  console.log('[Live WS] Server initialized');
  logger.info('Live WS server initialized');
  return wss;
}

export async function broadcastTestUpdate(event: UIUpdateEvent): Promise<void> {
  const message = JSON.stringify(event);
  let sentCount = 0;
  let applicationId: string | null = null;

  console.log(`\n=== BROADCAST TEST UPDATE ===`);
  console.log(`Event runId: "${event.runId}"`);
  console.log(`Test: "${event.testKey}" - Status: "${event.status}"`);
  console.log(`Active clients: ${liveClients.size}`);

  // Check if any clients are subscribed at app-level
  const hasAppLevelSubscribers = Array.from(liveClients.values()).some(
    client => client.subscriptionType === 'app'
  );

  // Only fetch applicationId if we have app-level subscribers
  if (hasAppLevelSubscribers) {
    // Check cache first
    applicationId = runIdToAppIdCache.get(event.runId) || null;

    if (!applicationId) {
      // Cache miss - fetch from DB
      applicationId = await getApplicationIdByRunId(event.runId);

      if (applicationId) {
        runIdToAppIdCache.set(event.runId, applicationId);
        console.log(`  📦 Cached applicationId for runId="${event.runId}": ${applicationId}`);
      }
    } else {
      console.log(`  ⚡ Cache hit for runId="${event.runId}": ${applicationId}`);
    }
  }

  for (const [socket, client] of liveClients.entries()) {
    let shouldSend = false;

    // Run-level subscription: exact runId match
    if (client.subscriptionType === 'run' && client.runId === event.runId) {
      shouldSend = true;
      console.log(`  ✅ RUN MATCH: client runId="${client.runId}"`);
    }

    // App-level subscription: applicationId match
    if (client.subscriptionType === 'app' && applicationId && client.appId === applicationId) {
      shouldSend = true;
      console.log(`  ✅ APP MATCH: client appId="${client.appId}", run appId="${applicationId}"`);
    }

    if (shouldSend && socket.readyState === WebSocket.OPEN) {
      socket.send(message);
      sentCount++;
    } else if (!shouldSend) {
      console.log(`  ❌ NO MATCH: type="${client.subscriptionType}", runId="${client.runId}", appId="${client.appId}"`);
    }
  }

  console.log(`Result: Sent to ${sentCount}/${liveClients.size} clients\n`);

  if (sentCount > 0) {
    logger.info('Broadcasted test update', {
      runId: event.runId,
      testKey: event.testKey,
      status: event.status,
      applicationId: applicationId || undefined,
      recipients: sentCount,
    });
  }
}

export async function broadcastRunSummary(event: RunSummaryEvent): Promise<void> {
  const message = JSON.stringify(event);
  let sentCount = 0;
  let applicationId: string | null = null;

  console.log(`[Broadcast] Run summary for runId: "${event.runId}"`);

  // Check if any clients are subscribed at app-level
  const hasAppLevelSubscribers = Array.from(liveClients.values()).some(
    client => client.subscriptionType === 'app'
  );

  // Fetch applicationId for app-level subscribers
  if (hasAppLevelSubscribers) {
    applicationId = runIdToAppIdCache.get(event.runId) || null;

    if (!applicationId) {
      applicationId = await getApplicationIdByRunId(event.runId);
    }
  }

  for (const [socket, client] of liveClients.entries()) {
    let shouldSend = false;

    // Run-level subscription
    if (client.subscriptionType === 'run' && client.runId === event.runId) {
      shouldSend = true;
    }

    // App-level subscription
    if (client.subscriptionType === 'app' && applicationId && client.appId === applicationId) {
      shouldSend = true;
    }

    if (shouldSend && socket.readyState === WebSocket.OPEN) {
      socket.send(message);
      sentCount++;
    }
  }

  // Clean up cache when run completes
  if (runIdToAppIdCache.has(event.runId)) {
    runIdToAppIdCache.delete(event.runId);
    console.log(`  🗑️ Cleaned cache for completed runId: "${event.runId}"`);
  }

  if (sentCount > 0) {
    logger.info('Broadcasted run summary', {
      runId: event.runId,
      status: event.status,
      applicationId: applicationId || undefined,
      recipients: sentCount,
    });
  }
}

export function getLiveConnectionCount(): number {
  return liveClients.size;
}

export function getCacheSize(): number {
  return runIdToAppIdCache.size;
}

/**
 * Broadcast AI analysis results for a test case
 * This is called after AI analysis completes (async, after test execution)
 */
export async function broadcastAIAnalysis(params: {
  runId: string;
  testCaseExecutionId: string;
  testKey: string;
  analysis: {
    category: string;
    root_cause?: string;
    recommendation?: string;
    severity?: string;
    confidence?: number;
    is_flaky?: boolean;
  };
}): Promise<void> {
  const { runId, testCaseExecutionId, testKey, analysis } = params;

  // Build AI analysis event
  const aiEvent = {
    type: 'ai_analysis' as const,
    runId,
    testCaseExecutionId,
    testKey,
    analysis: {
      category: analysis.category,
      rootCause: analysis.root_cause,
      recommendation: analysis.recommendation,
      severity: analysis.severity,
      confidence: analysis.confidence,
      isFlaky: analysis.is_flaky,
    },
    timestamp: new Date().toISOString(),
  };

  const message = JSON.stringify(aiEvent);
  let sentCount = 0;
  let applicationId: string | null = null;

  console.log(`\n=== BROADCAST AI ANALYSIS ===`);
  console.log(`Event runId: "${runId}"`);
  console.log(`Test: "${testKey}" - Category: "${analysis.category}"`);
  console.log(`Severity: "${analysis.severity}", Confidence: ${analysis.confidence}%`);

  // Check if any clients are subscribed at app-level
  const hasAppLevelSubscribers = Array.from(liveClients.values()).some(
    (client) => client.subscriptionType === 'app'
  );

  // Only fetch applicationId if we have app-level subscribers
  if (hasAppLevelSubscribers) {
    // Check cache first
    applicationId = runIdToAppIdCache.get(runId) || null;

    if (!applicationId) {
      // Cache miss - fetch from DB
      applicationId = await getApplicationIdByRunId(runId);

      if (applicationId) {
        runIdToAppIdCache.set(runId, applicationId);
        console.log(`  📦 Cached applicationId for runId="${runId}": ${applicationId}`);
      }
    } else {
      console.log(`  ⚡ Cache hit for runId="${runId}": ${applicationId}`);
    }
  }

  // Broadcast to subscribed clients
  for (const [socket, client] of liveClients.entries()) {
    let shouldSend = false;

    // Run-level subscription
    if (client.subscriptionType === 'run' && client.runId === runId) {
      shouldSend = true;
    }

    // App-level subscription
    if (
      client.subscriptionType === 'app' &&
      applicationId &&
      client.appId === applicationId
    ) {
      shouldSend = true;
    }

    if (shouldSend && socket.readyState === WebSocket.OPEN) {
      socket.send(message);
      sentCount++;
    }
  }

  console.log(`✅ AI analysis sent to ${sentCount} client(s)`);
  console.log(`===========================\n`);

  if (sentCount > 0) {
    logger.info('Broadcasted AI analysis', {
      runId,
      testKey,
      category: analysis.category,
      recipients: sentCount,
    });
  }
}
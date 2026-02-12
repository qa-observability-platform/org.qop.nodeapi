// src/websocket/browserStreamServer.ts
import { WebSocketServer, WebSocket } from 'ws';
import { logger } from '../utils/logger.js';

type BrowserStreamClient = {
  socket: WebSocket;
  runId: string;
  testCaseExecutionId?: string;
};

type ScreencastFrameEvent = {
  type: 'screencast_frame';
  runId: string;
  testCaseExecutionId?: string;
  frameData: string; // base64-encoded JPEG/PNG
  timestamp: string;
  metadata?: {
    width: number;
    height: number;
    deviceWidth: number;
    deviceHeight: number;
  };
};

type StreamControlEvent = {
  type: 'stream_started' | 'stream_stopped';
  runId: string;
  testCaseExecutionId?: string;
  timestamp: string;
};

const streamClients = new Map<WebSocket, BrowserStreamClient>();

// Active streams: runId -> set of client sockets
const activeStreams = new Map<string, Set<WebSocket>>();

// Last frame buffer: runId -> last frame JSON string (for late-joining viewers)
const lastFrameBuffer = new Map<string, string>();

// Frame counter per runId for periodic logging
const frameCounters = new Map<string, number>();

export function setupBrowserStreamWebSocket() {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: {
      // Enable compression for frame data
      zlibDeflateOptions: {
        chunkSize: 1024,
        memLevel: 7,
        level: 3, // Fast compression
      },
      zlibInflateOptions: {
        chunkSize: 10 * 1024,
      },
      threshold: 1024, // Only compress messages > 1KB
    },
  });

  wss.on('connection', async (socket, req) => {
    // Keep connection alive for long test runs
    socket.on('ping', () => socket.pong());

    const pingInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.ping();
      }
    }, 30000);

    try {
      const url = new URL(req.url ?? '', 'http://localhost');
      const runId = url.searchParams.get('runId');
      const testCaseExecutionId = url.searchParams.get('testCaseExecutionId') ?? undefined;

      if (!runId) {
        socket.send(JSON.stringify({ type: 'error', message: 'runId is required' }));
        socket.close();
        return;
      }

      const client: BrowserStreamClient = {
        socket,
        runId,
        testCaseExecutionId,
      };

      streamClients.set(socket, client);

      // Add to active streams
      if (!activeStreams.has(runId)) {
        activeStreams.set(runId, new Set());
      }
      activeStreams.get(runId)!.add(socket);

      console.log(`[Browser Stream] ✅ Connected - runId: "${runId}", testId: "${testCaseExecutionId}", Total viewers: ${streamClients.size}`);

      logger.info('Browser stream connected', {
        runId,
        testCaseExecutionId,
        totalViewers: streamClients.size,
      });

      socket.send(JSON.stringify({
        type: 'stream_connected',
        runId,
        testCaseExecutionId,
        timestamp: new Date().toISOString(),
      }));

      // Send the last buffered frame immediately so late-joining viewers see something right away
      const lastFrame = lastFrameBuffer.get(runId);
      if (lastFrame) {
        console.log(`[Browser Stream] Sending buffered frame to new viewer for runId: "${runId}"`);
        socket.send(lastFrame);
      }

      socket.on('close', () => {
        clearInterval(pingInterval);
        streamClients.delete(socket);

        // Remove from active streams
        const streamSet = activeStreams.get(runId);
        if (streamSet) {
          streamSet.delete(socket);
          if (streamSet.size === 0) {
            activeStreams.delete(runId);
          }
        }

        console.log(`[Browser Stream] 🔌 Disconnected - runId: "${runId}", Total viewers: ${streamClients.size}`);

        logger.info('Browser stream disconnected', {
          runId,
          testCaseExecutionId,
          remainingViewers: streamClients.size,
        });
      });

      socket.on('error', (err) => {
        console.error(`[Browser Stream] ❌ Error:`, err);
        logger.error('Browser stream error', {
          error: (err as any)?.message,
          runId,
        });
      });

      // Handle client messages (e.g., frames from broadcaster, quality adjustments from viewers)
      socket.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'screencast_frame') {
            // Broadcaster sending a frame - broadcast to all other viewers (excluding sender)
            broadcastScreencastFrame(message as ScreencastFrameEvent, socket);
          } else if (message.type === 'stream_started') {
            // Broadcaster starting stream - notify all viewers (excluding sender)
            console.log(`[Browser Stream] 📥 STREAM_STARTED - runId: ${runId}, viewers: ${streamClients.size}`);
            broadcastStreamControl(message as StreamControlEvent, socket);
          } else if (message.type === 'stream_stopped') {
            // Broadcaster stopping stream - notify all viewers (excluding sender)
            console.log(`[Browser Stream] 📥 STREAM_STOPPED - runId: ${runId}, viewers: ${streamClients.size}`);
            lastFrameBuffer.delete(runId);
            frameCounters.delete(runId);
            broadcastStreamControl(message as StreamControlEvent, socket);
          } else if (message.type === 'adjust_quality') {
            // Future: Allow clients to request quality changes
            logger.info('Quality adjustment requested', {
              runId,
              quality: message.quality,
            });
          } else {
            console.log(`[Browser Stream] Received message type: ${message.type} for runId: ${runId}`);
          }
        } catch (err) {
          console.error('[Browser Stream] ❌ Failed to parse client message:', err);
          logger.error('Failed to parse client message', {
            error: (err as any)?.message,
          });
        }
      });

    } catch (err: any) {
      clearInterval(pingInterval);
      console.error('[Browser Stream] Connection failed:', err);
      logger.error('Browser stream connection failed', { error: err?.message });
      socket.send(JSON.stringify({ type: 'error', message: 'Connection failed' }));
      socket.close();
    }
  });

  console.log('[Browser Stream] Server initialized');
  logger.info('Browser stream server initialized');
  return wss;
}

/**
 * Broadcast a screencast frame to all viewers watching this run
 */
export function broadcastScreencastFrame(event: ScreencastFrameEvent, excludeSocket?: WebSocket): void {
  const message = JSON.stringify(event);

  // Always buffer the latest frame for late-joining viewers
  lastFrameBuffer.set(event.runId, message);

  // Increment frame counter for periodic logging
  const count = (frameCounters.get(event.runId) ?? 0) + 1;
  frameCounters.set(event.runId, count);

  const streamSet = activeStreams.get(event.runId);

  if (!streamSet || streamSet.size === 0) {
    return;
  }

  let sentCount = 0;

  for (const socket of streamSet) {
    if (socket === excludeSocket) continue;

    if (socket.readyState === WebSocket.OPEN) {
      const client = streamClients.get(socket);

      // Send frame if client is watching this specific test or the entire run
      if (client && (!event.testCaseExecutionId || !client.testCaseExecutionId || client.testCaseExecutionId === event.testCaseExecutionId)) {
        socket.send(message);
        sentCount++;
      }
    }
  }

  // Log every 100th frame to reduce noise
  if (count % 100 === 0) {
    console.log(`[Browser Stream] Frame #${count} for runId: ${event.runId} (sent to ${sentCount} viewer(s), ${streamSet.size} total clients)`);
  }

  if (sentCount > 0) {
    logger.debug('Broadcasted screencast frame', {
      runId: event.runId,
      recipients: sentCount,
      frameSize: event.frameData.length,
    });
  }
}

/**
 * Broadcast stream control events (started/stopped)
 */
export function broadcastStreamControl(event: StreamControlEvent, excludeSocket?: WebSocket): void {
  const streamSet = activeStreams.get(event.runId);

  if (!streamSet || streamSet.size === 0) {
    return;
  }

  const message = JSON.stringify(event);
  let sentCount = 0;

  for (const socket of streamSet) {
    // Skip the sender socket (broadcaster) if provided
    if (socket === excludeSocket) {
      continue;
    }

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message);
      sentCount++;
    }
  }

  console.log(`[Browser Stream] ${event.type} broadcast to ${sentCount} viewer(s) for runId: "${event.runId}"`);

  if (sentCount > 0) {
    logger.info('Broadcasted stream control event', {
      type: event.type,
      runId: event.runId,
      testCaseExecutionId: event.testCaseExecutionId,
      recipients: sentCount,
    });
  }
}

/**
 * Get the number of active viewers for a specific run
 */
export function getViewerCount(runId: string): number {
  const streamSet = activeStreams.get(runId);
  return streamSet ? streamSet.size : 0;
}

/**
 * Get total number of connected stream viewers
 */
export function getTotalViewerCount(): number {
  return streamClients.size;
}

/**
 * Get all active stream run IDs
 */
export function getActiveStreamRunIds(): string[] {
  return Array.from(activeStreams.keys());
}

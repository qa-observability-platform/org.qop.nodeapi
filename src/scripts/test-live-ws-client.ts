// test-live-ws-client.ts
/**
 * Test client for S3-US1 live WebSocket subscription.
 * 
 * Usage:
 *   tsx test-live-ws-client.ts <runId>
 * 
 * Example:
 *   tsx test-live-ws-client.ts run-2024-12-08T10:30:00.000Z
 * 
 * This client connects to /ws/live and subscribes to updates for a specific run.
 * It will print all ui_update and run_summary events as they arrive in real-time.
 */

import WebSocket from 'ws';

function main() {
  const [, , runId] = process.argv;

  if (!runId) {
    console.error('Usage: tsx test-live-ws-client.ts <runId>');
    process.exit(1);
  }

  const wsUrl = process.env.QOP_WS_URL || 'ws://localhost:4000';
  const url = `${wsUrl}/ws/live?runId=${encodeURIComponent(runId)}`;

  console.log(`[Live WS Client] Connecting to: ${url}`);

  const ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('[Live WS Client] ✅ Connected to live updates');
    console.log('[Live WS Client] Subscribed to run:', runId);
    console.log('[Live WS Client] Waiting for events...\n');
  });

  ws.on('message', (data) => {
    try {
      const event = JSON.parse(data.toString());
      
      switch (event.type) {
        case 'connected':
          console.log('[Live WS Client] 🔗 Connection acknowledged');
          console.log('  Subscription Type:', event.subscriptionType);
          console.log('  Run ID:', event.runId);
          console.log('  Timestamp:', event.timestamp);
          console.log('');
          break;

        case 'ui_update':
          console.log('[Live WS Client] 📊 Test Update');
          console.log('  Test Key:', event.testKey);
          console.log('  Status:', event.status);
          if (event.durationMs !== undefined) {
            console.log('  Duration:', `${event.durationMs}ms`);
          }
          if (event.errorMessage) {
            console.log('  Error:', event.errorMessage);
          }
          console.log('  Timestamp:', event.timestamp);
          console.log('');
          break;

        case 'run_summary':
          console.log('[Live WS Client] 📈 Run Summary');
          console.log('  Status:', event.status);
          console.log('  Total Tests:', event.totalTests);
          console.log('  Passed:', event.passedTests);
          console.log('  Failed:', event.failedTests);
          console.log('  Timestamp:', event.timestamp);
          console.log('');
          break;

        case 'error':
          console.error('[Live WS Client] ❌ Error:', event.message);
          console.log('');
          break;

        default:
          console.log('[Live WS Client] Unknown event type:', event.type);
          console.log(JSON.stringify(event, null, 2));
          console.log('');
      }
    } catch (err) {
      console.error('[Live WS Client] Failed to parse message:', err);
    }
  });

  ws.on('error', (err) => {
    console.error('[Live WS Client] ❌ WebSocket error:', err.message);
  });

  ws.on('close', (code, reason) => {
    console.log('[Live WS Client] 🔌 Connection closed');
    console.log('  Code:', code);
    console.log('  Reason:', reason.toString() || '(no reason provided)');
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[Live WS Client] Shutting down...');
    ws.close();
    process.exit(0);
  });
}

main();
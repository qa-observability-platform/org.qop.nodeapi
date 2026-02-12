// src/index.ts
import http from 'http';
import { createApp } from './app.js';
import { config } from './config/env.js';
import { setupAutomationWebSocket } from './websocket/automationServer.js';
import { setupLiveWebSocket } from './websocket/liveServer.js';
import { setupBrowserStreamWebSocket } from './websocket/browserStreamServer.js';
import { scheduleFlakyTestAnalysis } from './jobs/flakyTestAnalysisJob.js';
import { patternLearningFeedbackJob } from './jobs/patternLearningFeedbackJob.js';
import { patternLearningAnalyticsJob } from './jobs/patternLearningAnalyticsJob.js';
import { pool } from './db/pool.js';

const app = createApp();
const server = http.createServer(app);

// Setup WebSocket servers
const ingestWss = setupAutomationWebSocket();
const liveWss = setupLiveWebSocket();
const browserStreamWss = setupBrowserStreamWebSocket();

// WebSocket upgrade handler
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', 'http://localhost').pathname;

  console.log(`[Upgrade] ${pathname}`);

  // Handle WebSocket upgrade based on path
  const handleUpgrade = (wss: any) => {
    wss.handleUpgrade(request, socket, head, (ws: any) => {
      wss.emit('connection', ws, request);
    });
  };

  if (pathname === '/ws/ingest') {
    handleUpgrade(ingestWss);
  } else if (pathname === '/ws/live') {
    handleUpgrade(liveWss);
  } else if (pathname === '/ws/browser-stream') {
    handleUpgrade(browserStreamWss);
  } else {
    console.log(`[Upgrade] Unknown path, destroying socket`);
    socket.destroy();
  }
});

server.listen(config.port, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║  QOP NodeAPI Server                                ║
║  Port: ${config.port}                                     ║
║  Environment: ${config.nodeEnv}                           ║
║                                                    ║
║  Authentication:                                   ║
║    POST http://localhost:${config.port}/auth/register     ║
║    POST http://localhost:${config.port}/auth/login        ║
║    GET  http://localhost:${config.port}/auth/me           ║
║                                                    ║
║  REST Endpoints:                                   ║
║    http://localhost:${config.port}/health                 ║
║    http://localhost:${config.port}/organizations          ║
║    http://localhost:${config.port}/projects               ║
║    http://localhost:${config.port}/runs                   ║
║    http://localhost:${config.port}/api/flaky-tests        ║
║                                                    ║
║  WebSocket Endpoints:                              ║
║    ws://localhost:${config.port}/ws/ingest (Reporters)    ║
║    ws://localhost:${config.port}/ws/live (UI updates)     ║
║    ws://localhost:${config.port}/ws/browser-stream        ║
╚════════════════════════════════════════════════════╝
  `);

  // Optional: Scheduled Jobs (can be disabled for testing/manual trigger mode)
  const enableScheduledJobs = process.env.ENABLE_SCHEDULED_JOBS !== 'false';

  if (enableScheduledJobs) {
    console.log('\n📅 SCHEDULED JOBS MODE (Automatic)');
    console.log('   Set ENABLE_SCHEDULED_JOBS=false to use manual triggers instead\n');

    // Start flaky test analysis job (runs every 6 hours)
    scheduleFlakyTestAnalysis(pool);
    console.log('   ✅ Flaky test analysis job scheduled (runs every 6 hours)');

    // Start pattern learning jobs
    patternLearningFeedbackJob.start();
    console.log('   🧠 Pattern learning feedback job started (runs every 5 minutes)');

    patternLearningAnalyticsJob.start();
    console.log('   📊 Pattern learning analytics job started (runs daily at midnight)');
  } else {
    console.log('\n🎯 MANUAL TRIGGER MODE (On-Demand)');
    console.log('   Use API endpoints to trigger jobs:');
    console.log('   POST http://localhost:${config.port}/api/pattern-learning-jobs/link-outcomes');
    console.log('   POST http://localhost:${config.port}/api/pattern-learning-jobs/aggregate-analytics');
    console.log('   POST http://localhost:${config.port}/api/pattern-learning-jobs/deprecate-underperforming');
    console.log('   POST http://localhost:${config.port}/api/pattern-learning-jobs/run-all\n');
  }

  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  Pattern Learning Jobs API                         ║');
  console.log('║    POST /api/pattern-learning-jobs/link-outcomes   ║');
  console.log('║    POST /api/pattern-learning-jobs/aggregate-...   ║');
  console.log('║    POST /api/pattern-learning-jobs/run-all         ║');
  console.log('╚════════════════════════════════════════════════════╝\n');
});
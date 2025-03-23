const createApp = require('./app');
const fs = require('fs').promises;
const Logger = require('./utils/logger');
const StreamManager = require('./services/streamManager');
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8787;

const app = createApp();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rtspUrl = url.searchParams.get('rtspUrl');

  // Heartbeat setup
  let isAlive = true;
  const heartbeatInterval = setInterval(() => {
    if (!isAlive) return ws.terminate();
    isAlive = false;
    ws.ping();
  }, 30000);
  ws.on('pong', () => {
    isAlive = true;
  });

  if (!rtspUrl) {
    ws.close(4000, 'RTSP URL required');
    return;
  }

  let streamId;

  const cleanup = async () => {
    clearInterval(heartbeatInterval);
    if (streamId) {
      await StreamManager.handleClientDisconnect(streamId);
    }
  };

  ws.on('close', async () => {
    await cleanup();
  });

  ws.on('error', async (error) => {
    console.error('WebSocket error:', error);
    await cleanup();
  });

  StreamManager.handleClientConnect(rtspUrl)
    .then(({ streamId: sid, streamUrl }) => {
      streamId = sid;
      ws.send(JSON.stringify({
        type: 'streamInfo',
        data: { streamId: sid, streamUrl }
      }));
    })
    .catch(error => {
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message
      }));
      ws.close();
    });

});

// Graceful shutdown handler
process.on("SIGINT", async () => {
  Logger.log("Caught interrupt signal, cleaning up streams...");

  const cleanupPromises = Array.from(StreamManager.streams.entries()).map(async ([streamId, { ffmpegProcess, outputDir }]) => {
    ffmpegProcess.kill("SIGINT");
    try {
      await fs.rm(outputDir, { recursive: true, force: true });
      Logger.log(`Deleted folder: ${outputDir}`);
    } catch (err) {
      Logger.error(`Cleanup error for stream ${streamId}`, err);
    }
  });

  await Promise.all(cleanupPromises);
  process.exit();
});


server.listen(PORT, () => {
  Logger.log(`Server running on port ${PORT}`);
});
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

process.on('SIGTERM', () => {
  Logger.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});
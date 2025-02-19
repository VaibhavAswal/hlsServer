const createApp = require('./app');
const fs = require('fs').promises;
const Logger = require('./utils/logger');
const StreamManager = require('./services/streamManager');
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8787;

const app = createApp();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rtspUrl = url.searchParams.get('rtspUrl');

  if (!rtspUrl) {
    ws.close(4000, 'RTSP URL required');
    return;
  }

  try {
    const streamInfo = await StreamManager.handleClientConnect(rtspUrl);
    ws.send(JSON.stringify({ type: 'streamInfo', data: streamInfo }));
    ws.streamId = streamInfo.streamId;
  } catch (error) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: `Failed to start stream: ${error.message}`
    }));
    ws.close();
    return;
  }

  ws.on('close', () => {
    if (ws.streamId) {
      StreamManager.handleClientDisconnect(ws.streamId);
    }
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

process.on('SIGTERM', () => {
  Logger.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});
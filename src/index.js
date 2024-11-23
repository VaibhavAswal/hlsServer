const createApp = require('./app');
const fs = require('fs').promises;
const Logger = require('./utils/logger');
const StreamManager = require('./services/streamManager');

const PORT = process.env.PORT || 8787;

const app = createApp();

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

const server = app.listen(PORT, () => {
  Logger.log(`HLS server running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  Logger.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});
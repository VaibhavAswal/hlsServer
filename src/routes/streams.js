const express = require('express');
const StreamManager = require('../services/streamManager');
const Logger = require('../utils/logger');

const router = express.Router();

router.post('/singlestream', async (req, res) => {
  const { rtspUrl } = req.body;
  if (!rtspUrl) return res.status(400).send("Missing RTSP URL");
  Logger.log(`received req for rtspUrl ${rtspUrl}`);
  
  try {
    const { streamId, streamUrl } = await StreamManager.startStream(rtspUrl);
    res.json({ streamId, streamUrl });
  } catch (error) {
    Logger.error("Stream start failed", error);
    res.status(500).send(`Failed to start stream: ${error.message}`);
  }
});

router.post('/stop', (req, res) => {
  const { streamId } = req.body;
  const stopped = StreamManager.stopStream(streamId);
  
  if (stopped) {
    res.send("Stream stopped");
  } else {
    res.status(404).send("Stream not found");
  }
});

router.get('/streams', (req, res) => {
  const activeStreams = StreamManager.getActiveStreams();
  res.json(activeStreams);
});

module.exports = router;
const express = require("express");
const StreamManager = require("../services/streamManager");
const academyConfig = require("../../config/academyConfig.json");
const Logger = require("../utils/logger");

const router = express.Router();

router.post("/academystream", async (req, res) => {
  const { academyId } = req.body;
  if (!academyId || !academyConfig[academyId]) {
    return res.status(400).send("Invalid academy ID");
  }

  Logger.log(`received req for academyId ${academyId}`);
  const rtspUrls = academyConfig[academyId];
  const hlsStreams = {};

  const streamPromises = Object.entries(rtspUrls).map(
    async ([engineType, url]) => {
      try {
        const { streamUrl } = await StreamManager.startStream(url);
        hlsStreams[engineType] = streamUrl;
      } catch (error) {
        Logger.error(`Stream start failed for ${engineType}`, error);
        hlsStreams[engineType] = null;
      }
    }
  );

  await Promise.all(streamPromises);
  res.set("Cache-Control", "no-cache").json(hlsStreams);
});

module.exports = router;

const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs").promises;
const path = require("path");
const Logger = require("../utils/logger");
const { waitForFile } = require("./fileUtils");

class StreamManager {
  constructor() {
    this.streams = new Map();          // Key: rtspUrl, Value: stream entry
    this.pendingStreams = new Map();   // Key: rtspUrl, Value: pending promise
    this.streamIdToRtspUrl = new Map();// Key: streamId, Value: rtspUrl
  }

  async handleClientConnect(rtspUrl) {
    let streamEntry = this.streams.get(rtspUrl);

    // Existing stream
    if (streamEntry) {
      streamEntry.clientCount++;
      return { streamId: streamEntry.streamId, streamUrl: streamEntry.streamUrl };
    }

    // Already pending stream
    if (this.pendingStreams.has(rtspUrl)) {
      return this.pendingStreams.get(rtspUrl);
    }

    // Create new stream
    const pendingPromise = this.createNewStream(rtspUrl);
    this.pendingStreams.set(rtspUrl, pendingPromise);

    try {
      const streamInfo = await pendingPromise;
      return streamInfo;
    } catch (error) {
      this.pendingStreams.delete(rtspUrl);
      throw error;
    }
  }

  async createNewStream(rtspUrl) {
    const streamId = uuidv4();
    const outputDir = path.join(__dirname, "../../hls_streams", streamId);
    await fs.mkdir(outputDir, { recursive: true });

    const m3u8Path = path.join(outputDir, "index.m3u8");
    const streamUrl = `https://hls-server.tap-ai.com/hls/${streamId}/index.m3u8`;

    const ffmpegArgs = [
      "-hide_banner", "-loglevel", "info",
      "-c:v", "libx264", "-preset", "veryfast",
      "-tune", "zerolatency", "-pix_fmt", "yuv420p",
      "-profile:v", "main", "-b:v", "500k",
      "-x264opts", "keyint=30:min-keyint=30:no-scenecut",
      "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
      "-f", "hls", "-hls_time", "2", "-hls_list_size", "5",
      "-hls_flags", "delete_segments+append_list",
      "-hls_segment_type", "fmp4",
      "-hls_segment_filename", path.join(outputDir, "segment_%03d.m4s").replace(/\\/g, "/")
    ];
    let ffmpegProcess;

    // Spawn FFmpeg with input-specific options. For RTSP streams, use TCP transport.
    if (rtspUrl.includes("rtsp://")) {
      ffmpegProcess = spawn("ffmpeg", [
        "-rtsp_transport", "tcp",
        "-i", rtspUrl,
        ...ffmpegArgs,
        m3u8Path.replace(/\\/g, "/")
      ], {
        shell: true,
        windowsHide: true
      });
    } else if (rtspUrl.includes("rtmp://")) {
      ffmpegProcess = spawn("ffmpeg", [
        "-i", rtspUrl,
        ...ffmpegArgs,
        m3u8Path.replace(/\\/g, "/")
      ], {
        shell: true,
        windowsHide: true
      });
    } else {
      // If the URL is not supported, throw an error.
      throw new Error("Unsupported stream URL protocol");
    }


    Logger.log(`FFmpeg process started for URL: ${rtspUrl}`);
    ffmpegProcess.on("error", (err) => {
      Logger.error(`FFmpeg error: ${err.message}`);
      this.cleanupStream(streamId, rtspUrl, outputDir);
    });

    ffmpegProcess.on("close", (code) => {
      if (code !== 0) {
        Logger.error(`FFmpeg exited with code ${code}`);
      }
      this.cleanupStream(streamId, rtspUrl, outputDir);
    });
    // ffmpegProcess.stderr.on("data", (data) => {
    //   Logger.error(`FFmpeg: ${data.toString()}`);
    // });
    // ffmpegProcess.stdout.on("data", (data) => {
    //   Logger.log(`FFmpeg output: ${data.toString()}`);
    // })

    await waitForFile(m3u8Path);

    const streamEntry = {
      streamId,
      ffmpegProcess,
      outputDir,
      clientCount: 1,
      streamUrl
    };

    this.streams.set(rtspUrl, streamEntry);
    this.streamIdToRtspUrl.set(streamId, rtspUrl);
    this.pendingStreams.delete(rtspUrl);

    return { streamId, streamUrl };
  }

  handleClientDisconnect(streamId) {
    const rtspUrl = this.streamIdToRtspUrl.get(streamId);
    if (!rtspUrl) return;

    const streamEntry = this.streams.get(rtspUrl);
    if (!streamEntry) return;

    streamEntry.clientCount--;

    if (streamEntry.clientCount <= 0) {
      Logger.log(`Stopping stream ${streamId}`);
      streamEntry.ffmpegProcess.kill("SIGTERM");
      this.streams.delete(rtspUrl);
      this.streamIdToRtspUrl.delete(streamId);
      this.cleanupStream(streamId, rtspUrl, streamEntry.outputDir);
    }
  }

  async cleanupStream(streamId, rtspUrl, outputDir) {
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch (err) {
      Logger.error(`Cleanup error: ${err.message}`);
    }
  }

  getActiveStreams() {
    return Array.from(this.streams.values()).map(entry => ({
      streamId: entry.streamId,
      streamUrl: entry.streamUrl,
      clients: entry.clientCount
    }));
  }
}

module.exports = new StreamManager();
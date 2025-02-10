const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs").promises;
const path = require("path");
const Logger = require("../utils/logger");
const { waitForFile } = require("./fileUtils");

class StreamManager {
  constructor() {
    this.streams = new Map();
    this.streamMap = new Map();
  }

  async startStream(rtspUrl) {
    const existingStream = this.streamMap.get(rtspUrl);
    if (existingStream) return existingStream;

    const streamId = uuidv4();
    // Use Windows-style path joining
    const outputDir = path.join(__dirname, "..", "..", "hls_streams", streamId);
    await fs.mkdir(outputDir, { recursive: true });

    const m3u8Path = path.join(outputDir, "index.m3u8");
    // Use backslashes for Windows paths in URLs
    const streamUrl = `http://localhost:8787/hls/${streamId}/index.m3u8`;

    let ffmpegProcess;
    // Common FFmpeg arguments
    const ffmpegArgs = [
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-tune", "zerolatency",
      "-f", "hls",
      "-hls_time", "0.5",
      "-hls_list_size", "2",
      "-hls_flags", "delete_segments+independent_segments+round_durations",
      "-hls_segment_type", "fmp4",
      "-b:v", "500k",
      "-bufsize", "500k",
      "-g", "15",
      "-sc_threshold", "0",
      "-vsync", "cfr"
    ];

    if (rtspUrl.includes("rtsp://")) {
      ffmpegProcess = spawn("ffmpeg", [
        "-rtsp_transport", "tcp",
        "-i", rtspUrl,
        ...ffmpegArgs,
        m3u8Path.replace(/\\/g, "/") // Convert Windows backslashes to forward slashes for FFmpeg
      ], {
        shell: true, // Use shell on Windows
        windowsHide: true // Prevent command window from showing
      });
    } else if (rtspUrl.includes("rtmp://")) {
      ffmpegProcess = spawn("ffmpeg", [
        "-i", rtspUrl,
        ...ffmpegArgs,
        m3u8Path.replace(/\\/g, "/") // Convert Windows backslashes to forward slashes for FFmpeg
      ], {
        shell: true,
        windowsHide: true
      });
    }

    Logger.log(`FFmpeg process started for rtspUrl ${rtspUrl}`);
    
    ffmpegProcess.on("error", (err) => {
      Logger.error(`Failed to start FFmpeg process: ${err.message}`);
      this.cleanupStream(streamId, rtspUrl, outputDir);
    });

    ffmpegProcess.on("close", (code) => {
      this.cleanupStream(streamId, rtspUrl, outputDir);
      if (code !== 0) Logger.error(`FFmpeg process exited with code ${code}`);
    });

    ffmpegProcess.stderr.on("data", (data) => {
      Logger.error(`FFmpeg error: ${data.toString()}`);
    });

    ffmpegProcess.stdout.on("data", (data) => {
      Logger.log(`FFmpeg output: ${data.toString()}`);
    });

    const streamInfo = { streamId, streamUrl };
    this.streams.set(streamId, { ffmpegProcess, outputDir });
    this.streamMap.set(rtspUrl, streamInfo);

    try {
      await waitForFile(m3u8Path);
      return streamInfo;
    } catch (error) {
      Logger.error(`Error waiting for m3u8 file: ${error.message}`);
      this.cleanupStream(streamId, rtspUrl, outputDir);
      throw error;
    }
  }

  async cleanupStream(streamId, rtspUrl, outputDir) {
    this.streams.delete(streamId);
    this.streamMap.delete(rtspUrl);

    try {
      // Add a delay before deleting to ensure files are not in use
      await new Promise(resolve => setTimeout(resolve, 1000));
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch (err) {
      Logger.error(`Error deleting folder: ${err.message}`);
    }
  }

  stopStream(streamId) {
    const stream = this.streams.get(streamId);

    if (stream) {
      const rtspUrl = Array.from(this.streamMap.entries()).find(
        ([, value]) => value.streamId === streamId
      )?.[0];

      if (rtspUrl) this.streamMap.delete(rtspUrl);
      
      // Use SIGTERM instead of SIGINT on Windows
      stream.ffmpegProcess.kill("SIGTERM");
      return true;
    }
    return false;
  }

  getActiveStreams() {
    return Array.from(this.streamMap.values());
  }
}

module.exports = new StreamManager();
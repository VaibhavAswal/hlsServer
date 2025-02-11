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
    // If a stream for this URL already exists, return it.
    const existingStream = this.streamMap.get(rtspUrl);
    if (existingStream) return existingStream;

    // Generate a unique stream ID and create an output directory.
    const streamId = uuidv4();
    const outputDir = path.join(__dirname, "..", "..", "hls_streams", streamId);
    await fs.mkdir(outputDir, { recursive: true });

    // Define the full path to the playlist file and the stream URL.
    const m3u8Path = path.join(outputDir, "index.m3u8");
    const streamUrl = `https://hls-server.tap-ai.com/hls/${streamId}/index.m3u8`;

    let ffmpegProcess;

    // Build the FFmpeg argument list with optimized video, audio, and HLS settings.
    // Note: We use an absolute path for the segment filename.
    const ffmpegArgs = [
      "-hide_banner", "-loglevel", "info",
      // Video encoding settings
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-tune", "zerolatency",
      "-pix_fmt", "yuv420p",
      "-profile:v", "main",
      "-b:v", "500k",
      "-x264opts", "keyint=30:min-keyint=30:no-scenecut",
      // Audio encoding settings
      "-c:a", "aac",
      "-b:a", "128k",
      "-ar", "44100",
      "-ac", "2",
      // HLS output settings
      "-f", "hls",
      "-hls_time", "2",              // 2-second segments for low latency
      "-hls_list_size", "5",         // Only the last 5 segments are listed in the playlist
      "-hls_flags", "delete_segments+append_list",
      "-hls_segment_type", "fmp4",
      // Absolute path for the segments so they are generated in the correct folder
      "-hls_segment_filename", path.join(outputDir, "segment_%03d.m4s").replace(/\\/g, "/")
    ];

    // Spawn FFmpeg with input-specific options. For RTSP streams, use TCP transport.
    if (rtspUrl.includes("rtsp://")) {
      ffmpegProcess = spawn("ffmpeg", [
        "-rtsp_transport", "tcp",
        "-i", rtspUrl,
        ...ffmpegArgs,
        m3u8Path.replace(/\\/g, "/") // Output playlist file (ensure forward slashes)
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

    // Handle process errors and termination.
    ffmpegProcess.on("error", (err) => {
      Logger.error(`Failed to start FFmpeg process: ${err.message}`);
      this.cleanupStream(streamId, rtspUrl, outputDir);
    });

    ffmpegProcess.on("close", (code) => {
      this.cleanupStream(streamId, rtspUrl, outputDir);
      if (code !== 0) {
        Logger.error(`FFmpeg process exited with code ${code}`);
      }
    });

    ffmpegProcess.stderr.on("data", (data) => {
      Logger.error(`FFmpeg error: ${data.toString()}`);
    });

    ffmpegProcess.stdout.on("data", (data) => {
      Logger.log(`FFmpeg output: ${data.toString()}`);
    });

    // Save the stream info and wait for the playlist file to be generated.
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
    // Remove stream from the maps.
    this.streams.delete(streamId);
    this.streamMap.delete(rtspUrl);

    try {
      // Delay deletion to ensure files are no longer in use.
      await new Promise(resolve => setTimeout(resolve, 1000));
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch (err) {
      Logger.error(`Error deleting folder ${outputDir}: ${err.message}`);
    }
  }

  stopStream(streamId) {
    const stream = this.streams.get(streamId);
    if (stream) {
      // Find the corresponding URL and remove it from the map.
      const rtspUrl = Array.from(this.streamMap.entries()).find(
        ([, value]) => value.streamId === streamId
      )?.[0];

      if (rtspUrl) {
        this.streamMap.delete(rtspUrl);
      }
      
      // Terminate the FFmpeg process using SIGTERM.
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
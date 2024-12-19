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
    const outputDir = path.join(__dirname, `../../hls_streams/${streamId}`);
    await fs.mkdir(outputDir, { recursive: true });

    const m3u8Path = path.join(outputDir, "index.m3u8");
    const streamUrl = `http://34.81.189.91:8787/hls/${streamId}/index.m3u8`;

    // const ffmpegProcess = spawn("ffmpeg", [
    //   "-rtsp_transport", "tcp",
    //   "-i", rtspUrl,
    //   "-c:v", "libx264",
    //   "-f", "hls",
    //   "-hls_time", "5",
    //   "-hls_list_size", "5",
    //   "-hls_flags", "delete_segments",
    //   m3u8Path,
    // ]);

    let ffmpegProcess;

    if (rtspUrl.includes("rtsp://")) {
      ffmpegProcess = spawn("ffmpeg", [
        "-hwaccel",
        "cuda", // Use NVIDIA CUDA for hardware acceleration
        "-rtsp_transport",
        "tcp",
        "-i",
        rtspUrl,
        "-c:v",
        "libx264", // NVIDIA GPU-based encoder
        "-preset",
        "veryfast", // Choose a preset for encoding 
        "tune",
        "zerolatency", // Optimize for low latency
        "-f",
        "hls",
        "-hls_time",
        "2",
        "-hls_list_size",
        "3",
        "-hls_flags",
        "delete_segments+independent_segments",
        "-b:v",
        "500k", // Set video bitrate
        "-bufsize",
        "1000k", // Set buffer size
        "force_key_frames",
        "expr:gte(t,n_forced*2)",
        m3u8Path,
      ]);
    }

    if (rtspUrl.includes("rtmp://")) {
      ffmpegProcess = spawn("ffmpeg", [
        "-hwaccel",
        "cuda", // Use NVIDIA CUDA for hardware acceleration
        "-i",
        rtspUrl,
        "-c:v",
        "libx264", // NVIDIA GPU-based encoder
        "-preset",
        "veryfast", // Choose a preset for encoding speed
        "tune",
        "zerolatency", // Optimize for low latency
        "-f",
        "hls",
        "-hls_time",
        "2",
        "-hls_list_size",
        "3",
        "-hls_flags",
        "delete_segments+independent_segments",
        "-b:v",
        "500k", // Set video bitrate
        "-bufsize",
        "1000k", // Set buffer size
        "force_key_frames",
        "expr:gte(t,n_forced*2)",
        m3u8Path,
      ]);
    }

    Logger.log(`FFmpeg process started for rtspUrl ${rtspUrl}`);
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

    await waitForFile(m3u8Path);

    return streamInfo;
  }

  cleanupStream(streamId, rtspUrl, outputDir) {
    this.streams.delete(streamId);
    this.streamMap.delete(rtspUrl);

    fs.rm(outputDir, { recursive: true, force: true }).catch((err) =>
      Logger.error(`Error deleting folder`, err)
    );
  }

  stopStream(streamId) {
    const stream = this.streams.get(streamId);

    if (stream) {
      const rtspUrl = Array.from(this.streamMap.entries()).find(
        ([, value]) => value.streamId === streamId
      )?.[0];

      if (rtspUrl) this.streamMap.delete(rtspUrl);
      stream.ffmpegProcess.kill("SIGINT");
      return true;
    }
    return false;
  }

  getActiveStreams() {
    return Array.from(this.streamMap.values());
  }
}

module.exports = new StreamManager();

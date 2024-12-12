const fs = require('fs').promises;

async function waitForFile(filePath, { interval = 500, timeout = 500000 } = {}) {
  const startTime = Date.now();
  
  while (Date.now() - startTime <= timeout) {
    try {
      await fs.access(filePath);
      return; // File exists, resolve the promise
    } catch {
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }
  
  throw new Error("Timeout waiting for .m3u8 file to be generated");
}

module.exports = {
  waitForFile
};
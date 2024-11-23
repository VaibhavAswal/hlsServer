class Logger {
  static error(message, error) {
    console.error(`[ERROR] ${message}`, error || "");
  }

  static log(message) {
    console.log(`[LOG] ${message}`);
  }
}

module.exports = Logger;

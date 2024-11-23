const express = require('express');
const cors = require('cors');
const path = require('path');

const singleStreamRoutes = require('./routes/streams');
const academyStreamRoutes = require('./routes/academyStreams');

function createApp() {
  const app = express();

  // Middlewares
  app.use(express.json());
  app.use(cors({ origin: "*" }));

  // Routes
  app.use(singleStreamRoutes);
  app.use(academyStreamRoutes);

  // Serve HLS streams statically
  app.use("/hls", express.static(path.join(__dirname, "../hls_streams")));

  return app;
}

module.exports = createApp;
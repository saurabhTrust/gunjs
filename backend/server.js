// const express = require('express');
// const Gun = require('gun');
// const path = require('path');

// const app = express();
// const PORT = process.env.PORT || 8080;

// // Serve frontend files
// app.use(express.static(path.join(__dirname, '../frontend')));

// // Optionally, you can add a route to check if the server is running
// app.get('/health', (req, res) => {
//   res.status(200).json({ status: 'OK' });
// });

// // Create HTTP server
// const server = app.listen(PORT, () => {
//   console.log(`Server running on http://localhost:${PORT}`);
// });

// // Initialize Gun
// const gun = Gun({
//   web: server,
//   file: 'data' // This will store the data in a directory named 'data'
// });

// // Attach Gun to the '/gun' endpoint
// app.use('/gun', (req, res) => {
//   gun.serve(req, res);
// });


const express = require('express');
const Gun = require('gun');
const path = require('path');
const https = require('https');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8443;

// Serve frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Read SSL certificate and key
const options = {
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
};

// Create HTTPS server
const server = https.createServer(options, app);

server.listen(PORT, () => {
  console.log(`Server running on https://localhost:${PORT}`);
});

// Initialize Gun
const gun = Gun({
  web: server,
  file: 'data' // This will store the data in a directory named 'data'
});

// Attach Gun to the '/gun' endpoint
app.use('/gun', (req, res) => {
  gun.serve(req, res);
});
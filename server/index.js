
const express  = require('express');
const http     = require('http');
const path     = require('path');
const { Server } = require('socket.io');
const registerSocketHandlers = require('./controllers/socketController');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

// ── Serve static frontend files from /public ──────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Attach all Socket.IO game logic ───────────────────────
registerSocketHandlers(io);

// ── Start listening ───────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`♟  Chess server running at http://localhost:${PORT}`);
  console.log(`   Open two browser tabs with the same Room ID to play!`);
});
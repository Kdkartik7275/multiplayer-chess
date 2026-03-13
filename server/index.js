const express  = require('express');
const http     = require('http');
const path     = require('path');
const { Server } = require('socket.io');
const registerSocketHandlers = require('./controllers/socketController');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, '..', 'public')));
registerSocketHandlers(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`♟  Chess server running at http://localhost:${PORT}`);
  console.log(`   Open two browser tabs or play vs the computer!`);
});
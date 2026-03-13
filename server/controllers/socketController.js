const { createRoom, getRoom, deleteRoom, findRoomByPlayer } = require('../utils/roomManager');
const { isValidMove } = require('../utils/moveValidator');
const { checkWinner, applyMove } = require('../utils/boardUtils');
const { getBestMove } = require('../utils/chessAI');

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`[+] Player connected: ${socket.id}`);

    // ── JOIN ROOM (2-player) ──────────────────────────────
    socket.on('joinRoom', ({ roomId }) => {
      if (!roomId || typeof roomId !== 'string') return;
      roomId = roomId.trim().toLowerCase();
      socket.join(roomId);
      const existingRoom = getRoom(roomId);

      if (!existingRoom) {
        createRoom(roomId, socket.id);
        socket.emit('playerAssigned', { color: 'white', roomId });
        socket.emit('waiting', { message: 'Waiting for an opponent to join…' });
        console.log(`[R] Room created: ${roomId}`);
      } else if (existingRoom.players.length === 1) {
        existingRoom.players.push(socket.id);
        socket.emit('playerAssigned', { color: 'black', roomId });
        io.to(roomId).emit('gameStart', {
          board: existingRoom.board,
          turn: existingRoom.turn,
          message: 'Game started! White moves first.',
          vsComputer: false,
        });
        console.log(`[G] Game started: ${roomId}`);
      } else {
        socket.emit('roomFull', { message: 'This room is full. Please try a different Room ID.' });
        socket.leave(roomId);
      }
    });

    // ── JOIN VS COMPUTER ──────────────────────────────────
    socket.on('joinComputer', ({ difficulty }) => {
      // Create a unique room for this solo game
      const roomId = `cpu_${socket.id}`;
      socket.join(roomId);
      const room = createRoom(roomId, socket.id);
      room.vsComputer = true;
      room.difficulty = difficulty || 'medium';
      // Player is always white
      socket.emit('playerAssigned', { color: 'white', roomId });
      socket.emit('gameStart', {
        board: room.board,
        turn: room.turn,
        message: `Playing vs Computer (${difficulty}). White moves first.`,
        vsComputer: true,
        difficulty,
      });
      console.log(`[CPU] Game started vs computer (${difficulty}): ${roomId}`);
    });

    // ── MAKE MOVE ─────────────────────────────────────────
    socket.on('makeMove', ({ roomId, fromRow, fromCol, toRow, toCol }) => {
      const room = getRoom(roomId);
      if (!room || room.winner) return;

      const playerIndex = room.players.indexOf(socket.id);
      if (playerIndex === -1) return;
      const playerColor = playerIndex === 0 ? 'white' : 'black';

      if (playerColor !== room.turn) {
        socket.emit('invalidMove', { message: "It's not your turn!" });
        return;
      }
      if (!isValidMove(room.board, fromRow, fromCol, toRow, toCol, room.turn)) {
        socket.emit('invalidMove', { message: 'Invalid move!' });
        return;
      }

      const movedPiece = room.board[fromRow][fromCol];
      applyMove(room.board, fromRow, fromCol, toRow, toCol);
      room.moveCount++;
      room.turn = room.turn === 'white' ? 'black' : 'white';
      room.winner = checkWinner(room.board);

      io.to(roomId).emit('boardUpdate', {
        board: room.board,
        turn: room.turn,
        winner: room.winner,
        moveCount: room.moveCount,
        lastMove: { fromRow, fromCol, toRow, toCol, piece: movedPiece },
      });

      if (room.winner) {
        console.log(`[W] Game over ${roomId} — Winner: ${room.winner}`);
        return;
      }

      // ── AI responds if vs computer and it's black's turn ──
      if (room.vsComputer && room.turn === 'black' && !room.winner) {
        // Small delay so UI updates first
        setTimeout(() => {
          if (!getRoom(roomId)) return; // room may have been deleted
          socket.emit('computerThinking', { thinking: true });

          const aiMove = getBestMove(room.board, room.difficulty);
          if (!aiMove) {
            // No moves = stalemate
            io.to(roomId).emit('boardUpdate', {
              board: room.board,
              turn: room.turn,
              winner: 'draw',
              moveCount: room.moveCount,
              lastMove: null,
            });
            return;
          }

          const aiPiece = room.board[aiMove.fromRow][aiMove.fromCol];
          applyMove(room.board, aiMove.fromRow, aiMove.fromCol, aiMove.toRow, aiMove.toCol);
          room.moveCount++;
          room.turn = 'white';
          room.winner = checkWinner(room.board);

          socket.emit('computerThinking', { thinking: false });
          io.to(roomId).emit('boardUpdate', {
            board: room.board,
            turn: room.turn,
            winner: room.winner,
            moveCount: room.moveCount,
            lastMove: { ...aiMove, piece: aiPiece },
            isComputerMove: true,
          });

          if (room.winner) console.log(`[W] CPU game over ${roomId} — Winner: ${room.winner}`);
        }, 400);
      }
    });

    // ── DISCONNECT ────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[-] Player disconnected: ${socket.id}`);
      const result = findRoomByPlayer(socket.id);
      if (result) {
        const { roomId, room } = result;
        if (!room.vsComputer) {
          io.to(roomId).emit('playerLeft', { message: 'Your opponent disconnected. The game has ended.' });
        }
        deleteRoom(roomId);
        console.log(`[R] Room deleted: ${roomId}`);
      }
    });
  });
}

module.exports = registerSocketHandlers;
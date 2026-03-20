const { createRoom, getRoom, deleteRoom, findRoomByPlayer } = require('../utils/roomManager');
const { isValidMove } = require('../utils/moveValidator');
const {
  applyMove, updateCastlingRights,
  isInCheck, getGameStatus, getLegalMoves, cloneBoard,
} = require('../utils/boardUtils');
const { getBestMove } = require('../utils/chessAI');

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`[+] Connected: ${socket.id}`);

    // ── JOIN ROOM ──────────────────────────────────────────
    socket.on('joinRoom', ({ roomId, timerSeconds }) => {
      if (!roomId || typeof roomId !== 'string') return;
      roomId = roomId.trim().toLowerCase();
      socket.join(roomId);
      const existing = getRoom(roomId);

      if (!existing) {
        const room = createRoom(roomId, socket.id);
        room.timerSeconds = timerSeconds || 0;
        socket.emit('playerAssigned', { color: 'white', roomId });
        socket.emit('waiting', { message: 'Waiting for an opponent…' });
      } else if (existing.players.length === 1) {
        existing.players.push(socket.id);
        socket.emit('playerAssigned', { color: 'black', roomId });
        io.to(roomId).emit('gameStart', {
          board: existing.board,
          turn: existing.turn,
          vsComputer: false,
          timerSeconds: existing.timerSeconds || 0,
        });
        console.log(`[G] Game started: ${roomId}`);
      } else {
        socket.emit('roomFull', { message: 'Room is full. Try a different Room ID.' });
        socket.leave(roomId);
      }
    });

    // ── JOIN VS COMPUTER ───────────────────────────────────
    socket.on('joinComputer', ({ difficulty, timerSeconds }) => {
      const roomId = `cpu_${socket.id}`;
      socket.join(roomId);
      const room = createRoom(roomId, socket.id);
      room.vsComputer   = true;
      room.difficulty   = difficulty || 'medium';
      room.timerSeconds = timerSeconds || 0;
      // Initialise move history for undo support
      room.moveHistory  = [];
      socket.emit('playerAssigned', { color: 'white', roomId });
      socket.emit('gameStart', {
        board: room.board,
        turn: room.turn,
        vsComputer: true,
        difficulty,
        timerSeconds: room.timerSeconds,
      });
    });

    // ── MAKE MOVE ──────────────────────────────────────────
    socket.on('makeMove', ({ roomId, fromRow, fromCol, toRow, toCol, promotion }) => {
      const room = getRoom(roomId);
      if (!room || room.winner || room.status === 'checkmate' || room.status === 'stalemate') return;

      const playerIndex = room.players.indexOf(socket.id);
      if (playerIndex === -1) return;
      const playerColor = playerIndex === 0 ? 'white' : 'black';

      if (playerColor !== room.turn) {
        socket.emit('invalidMove', { message: "It's not your turn!" });
        return;
      }

      if (!isValidMove(room.board, fromRow, fromCol, toRow, toCol, room.turn, room.gameState)) {
        socket.emit('invalidMove', { message: 'Invalid move!' });
        return;
      }

      const movedPiece = room.board[fromRow][fromCol];

      // Check if pawn promotion needs a choice
      const p = movedPiece.toLowerCase();
      const isWhite = movedPiece === movedPiece.toUpperCase();
      const needsPromoChoice = p === 'p' && ((isWhite && toRow === 0) || (!isWhite && toRow === 7));
      if (needsPromoChoice && !promotion) {
        socket.emit('promotionRequired', { fromRow, fromCol, toRow, toCol });
        return;
      }

      _executeMove(io, socket, room, roomId, fromRow, fromCol, toRow, toCol, movedPiece, promotion);
    });

    // ── UNDO MOVE (vs Computer only) ──────────────────────
    socket.on('undoMove', ({ roomId }) => {
      const room = getRoom(roomId);
      if (!room || !room.vsComputer || room.winner) return;

      // Need at least 2 history entries to undo (player move + AI response)
      if (!room.moveHistory || room.moveHistory.length < 2) {
        socket.emit('invalidMove', { message: 'Nothing to undo.' });
        return;
      }

      // Pop the last 2 history entries (AI move, then player move)
      room.moveHistory.pop(); // AI move
      room.moveHistory.pop(); // player move

      // Restore the board and gameState from the snapshot before those 2 moves
      const snapshot = room.moveHistory.length > 0
        ? room.moveHistory[room.moveHistory.length - 1]
        : room.initialSnapshot;

      room.board     = snapshot.board.map(r => [...r]);
      room.gameState = {
        castlingRights: {
          white: { ...snapshot.gameState.castlingRights.white },
          black: { ...snapshot.gameState.castlingRights.black },
        },
        enPassant: snapshot.gameState.enPassant
          ? { ...snapshot.gameState.enPassant }
          : null,
      };
      room.turn      = 'white'; // always player's turn after undo
      room.status    = null;
      room.moveCount = Math.max(0, room.moveCount - 2);

      const lastEntry = room.moveHistory.length > 0
        ? room.moveHistory[room.moveHistory.length - 1]
        : null;

      socket.emit('undoApplied', {
        board:     room.board,
        gameState: room.gameState,
        lastMove:  lastEntry ? lastEntry.lastMove : null,
      });

      console.log(`[U] Undo applied in ${roomId}`);
    });

    // ── RESIGN ─────────────────────────────────────────────
    socket.on('resign', ({ roomId }) => {
      const room = getRoom(roomId);
      if (!room || room.winner) return;
      const playerIndex = room.players.indexOf(socket.id);
      if (playerIndex === -1) return;
      const loserColor  = playerIndex === 0 ? 'white' : 'black';
      const winnerColor = loserColor === 'white' ? 'black' : 'white';
      room.winner = winnerColor;
      io.to(roomId).emit('boardUpdate', {
        board: room.board, turn: room.turn,
        winner: winnerColor, resigned: loserColor,
        moveCount: room.moveCount, lastMove: null,
        status: 'resigned',
      });
      console.log(`[R] ${loserColor} resigned in ${roomId}`);
    });

    // ── DRAW OFFER ─────────────────────────────────────────
    socket.on('offerDraw', ({ roomId }) => {
      const room = getRoom(roomId);
      if (!room || room.winner) return;
      const playerIndex = room.players.indexOf(socket.id);
      if (playerIndex === -1) return;
      const color = playerIndex === 0 ? 'white' : 'black';
      room.drawOffer = color;
      io.to(roomId).emit('drawOffered', { by: color });
    });

    socket.on('respondDraw', ({ roomId, accept }) => {
      const room = getRoom(roomId);
      if (!room || room.winner || !room.drawOffer) return;
      if (accept) {
        room.winner = 'draw';
        room.status = 'draw';
        io.to(roomId).emit('boardUpdate', {
          board: room.board, turn: room.turn,
          winner: 'draw', moveCount: room.moveCount,
          lastMove: null, status: 'draw',
        });
      } else {
        room.drawOffer = null;
        io.to(roomId).emit('drawDeclined');
      }
    });

    // ── DISCONNECT ─────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[-] Disconnected: ${socket.id}`);
      const result = findRoomByPlayer(socket.id);
      if (result) {
        const { roomId, room } = result;
        if (!room.vsComputer && !room.winner) {
          io.to(roomId).emit('playerLeft', { message: 'Opponent disconnected. Game ended.' });
        }
        deleteRoom(roomId);
      }
    });
  });
}

// ── Shared move execution logic ────────────────────────
function _executeMove(io, socket, room, roomId, fromRow, fromCol, toRow, toCol, movedPiece, promotion) {
  // Save snapshot BEFORE applying move (for undo)
  if (room.vsComputer) {
    if (!room.moveHistory) room.moveHistory = [];

    // Save initial snapshot on very first move
    if (!room.initialSnapshot) {
      room.initialSnapshot = {
        board: room.board.map(r => [...r]),
        gameState: {
          castlingRights: {
            white: { ...room.gameState.castlingRights.white },
            black: { ...room.gameState.castlingRights.black },
          },
          enPassant: room.gameState.enPassant ? { ...room.gameState.enPassant } : null,
        },
        lastMove: null,
      };
    }

    // Push pre-move snapshot for the player's move
    room.moveHistory.push({
      board: room.board.map(r => [...r]),
      gameState: {
        castlingRights: {
          white: { ...room.gameState.castlingRights.white },
          black: { ...room.gameState.castlingRights.black },
        },
        enPassant: room.gameState.enPassant ? { ...room.gameState.enPassant } : null,
      },
      lastMove: room.lastMove || null,
    });
  }

  // Compute en passant target before applying
  const p = movedPiece.toLowerCase();
  const isWhite = movedPiece === movedPiece.toUpperCase();
  let newEnPassant = null;
  if (p === 'p' && Math.abs(toRow - fromRow) === 2) {
    newEnPassant = { row: (fromRow + toRow) / 2, col: fromCol };
  }

  // Apply player move
  applyMove(room.board, fromRow, fromCol, toRow, toCol, room.gameState, promotion);
  updateCastlingRights(room.gameState.castlingRights, movedPiece, fromRow, fromCol);
  room.gameState.enPassant = newEnPassant;
  room.moveCount++;
  room.turn = room.turn === 'white' ? 'black' : 'white';
  room.drawOffer = null;
  room.lastMove  = { fromRow, fromCol, toRow, toCol, piece: movedPiece };

  // Check game status
  const status = getGameStatus(room.board, room.turn, room.gameState);
  room.status = status;

  let winner = null;
  if (status === 'checkmate') { winner = room.turn === 'white' ? 'black' : 'white'; room.winner = winner; }
  if (status === 'stalemate') { winner = 'draw'; room.winner = 'draw'; }

  let checkSquare = null;
  if (status === 'check' || status === 'checkmate') {
    const { findKing } = require('../utils/boardUtils');
    checkSquare = findKing(room.board, room.turn);
  }

  io.to(roomId).emit('boardUpdate', {
    board: room.board,
    turn: room.turn,
    winner,
    moveCount: room.moveCount,
    lastMove: { fromRow, fromCol, toRow, toCol, piece: movedPiece },
    status,
    checkSquare,
    isComputerMove: false,
  });

  if (winner) {
    console.log(`[W] ${roomId} — Winner: ${winner} (${status})`);
    return;
  }

  // ── AI move ──────────────────────────────────────────
  if (room.vsComputer && room.turn === 'black' && !winner) {
    setTimeout(() => {
      if (!getRoom(roomId)) return;
      socket.emit('computerThinking', { thinking: true });

      const aiMove = getBestMove(room.board, room.difficulty);
      if (!aiMove) {
        const aiStatus = getGameStatus(room.board, 'black', room.gameState);
        const aiWinner = aiStatus === 'checkmate' ? 'white' : 'draw';
        room.winner = aiWinner;
        socket.emit('computerThinking', { thinking: false });
        io.to(roomId).emit('boardUpdate', {
          board: room.board, turn: room.turn,
          winner: aiWinner, moveCount: room.moveCount,
          lastMove: null, status: aiStatus, isComputerMove: true,
        });
        return;
      }

      const aiPiece = room.board[aiMove.fromRow][aiMove.fromCol];
      const aiP = aiPiece.toLowerCase();

      let aiPromotion = null;
      if (aiP === 'p' && aiMove.toRow === 7) aiPromotion = 'q';

      let aiEnPassant = null;
      if (aiP === 'p' && Math.abs(aiMove.toRow - aiMove.fromRow) === 2) {
        aiEnPassant = { row: (aiMove.fromRow + aiMove.toRow) / 2, col: aiMove.fromCol };
      }

      // Save snapshot BEFORE AI move (for undo — we need to be able to remove AI move too)
      if (room.vsComputer) {
        room.moveHistory.push({
          board: room.board.map(r => [...r]),
          gameState: {
            castlingRights: {
              white: { ...room.gameState.castlingRights.white },
              black: { ...room.gameState.castlingRights.black },
            },
            enPassant: room.gameState.enPassant ? { ...room.gameState.enPassant } : null,
          },
          lastMove: { fromRow, fromCol, toRow, toCol, piece: movedPiece },
        });
      }

      applyMove(room.board, aiMove.fromRow, aiMove.fromCol, aiMove.toRow, aiMove.toCol, room.gameState, aiPromotion);
      updateCastlingRights(room.gameState.castlingRights, aiPiece, aiMove.fromRow, aiMove.fromCol);
      room.gameState.enPassant = aiEnPassant;
      room.moveCount++;
      room.turn = 'white';
      room.lastMove = { ...aiMove, piece: aiPiece };

      const afterStatus = getGameStatus(room.board, 'white', room.gameState);
      room.status = afterStatus;
      let afterWinner = null;
      if (afterStatus === 'checkmate') { afterWinner = 'black'; room.winner = 'black'; }
      if (afterStatus === 'stalemate') { afterWinner = 'draw';  room.winner = 'draw'; }

      let aiCheckSquare = null;
      if (afterStatus === 'check' || afterStatus === 'checkmate') {
        const { findKing } = require('../utils/boardUtils');
        aiCheckSquare = findKing(room.board, 'white');
      }

      socket.emit('computerThinking', { thinking: false });
      io.to(roomId).emit('boardUpdate', {
        board: room.board, turn: room.turn,
        winner: afterWinner, moveCount: room.moveCount,
        lastMove: { ...aiMove, piece: aiPiece },
        status: afterStatus, checkSquare: aiCheckSquare,
        isComputerMove: true,
      });

      if (afterWinner) console.log(`[W] CPU ${roomId} — Winner: ${afterWinner}`);
    }, 400);
  }
}

module.exports = registerSocketHandlers;
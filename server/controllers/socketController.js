const {
  createRoom,
  getRoom,
  deleteRoom,
  findRoomByPlayer,
} = require("../utils/roomManager");
const { isValidMove } = require("../utils/moveValidator");
const { checkWinner, applyMove } = require("../utils/boardUtils");

/**
 * Called once at startup with the Socket.IO server instance.
 * Registers all event listeners for every new connection.
 */
function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    console.log(`[+] Player connected:    ${socket.id}`);

    // ── JOIN ROOM ────────────────────────────────────────

    socket.on("joinRoom", ({ roomId }) => {
      if (!roomId || typeof roomId !== "string") return;
      roomId = roomId.trim().toLowerCase();

      socket.join(roomId);
      const existingRoom = getRoom(roomId);

      if (!existingRoom) {
        // ── First player → create room, assign White ──
        createRoom(roomId, socket.id);
        socket.emit("playerAssigned", { color: "white", roomId });
        socket.emit("waiting", { message: "Waiting for an opponent to join…" });
        console.log(`[R] Room created: ${roomId} by ${socket.id}`);
      } else if (existingRoom.players.length === 1) {
        // ── Second player → join room, assign Black ──
        existingRoom.players.push(socket.id);
        socket.emit("playerAssigned", { color: "black", roomId });

        // Tell BOTH players the game is starting
        io.to(roomId).emit("gameStart", {
          board: existingRoom.board,
          turn: existingRoom.turn,
          message: "Game started! White moves first.",
        });
        console.log(`[G] Game started in room: ${roomId}`);
      } else {
        // Room is full
        socket.emit("roomFull", {
          message: "This room is full. Please try a different Room ID.",
        });
        socket.leave(roomId);
      }
    });

    // ── MAKE MOVE ────────────────────────────────────────
    // Client sends: { roomId, fromRow, fromCol, toRow, toCol }
    socket.on("makeMove", ({ roomId, fromRow, fromCol, toRow, toCol }) => {
      const room = getRoom(roomId);
      if (!room || room.winner) return;

      // Verify it is this player's turn
      const playerIndex = room.players.indexOf(socket.id);
      if (playerIndex === -1) return; // Not in this room
      const playerColor = playerIndex === 0 ? "white" : "black";

      if (playerColor !== room.turn) {
        socket.emit("invalidMove", { message: "It's not your turn!" });
        return;
      }

      // Validate the move (server-side — cannot be bypassed)
      if (!isValidMove(room.board, fromRow, fromCol, toRow, toCol, room.turn)) {
        socket.emit("invalidMove", { message: "Invalid move!" });
        return;
      }

      // Store moved piece before applying (for move log on client)
      const movedPiece = room.board[fromRow][fromCol];

      // Apply the move to the board
      applyMove(room.board, fromRow, fromCol, toRow, toCol);
      room.moveCount++;

      // Switch turns
      room.turn = room.turn === "white" ? "black" : "white";

      // Check for winner
      room.winner = checkWinner(room.board);

      // Broadcast updated state to BOTH players in the room
      io.to(roomId).emit("boardUpdate", {
        board: room.board,
        turn: room.turn,
        winner: room.winner,
        moveCount: room.moveCount,
        lastMove: { fromRow, fromCol, toRow, toCol, piece: movedPiece },
      });

      if (room.winner) {
        console.log(`[W] Game over in room ${roomId} — Winner: ${room.winner}`);
      }
    });

    // ── DISCONNECT ───────────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`[-] Player disconnected: ${socket.id}`);

      const result = findRoomByPlayer(socket.id);
      if (result) {
        const { roomId } = result;
        io.to(roomId).emit("playerLeft", {
          message: "Your opponent disconnected. The game has ended.",
        });
        deleteRoom(roomId);
        console.log(`[R] Room deleted: ${roomId}`);
      }
    });
  });
}

module.exports = registerSocketHandlers;

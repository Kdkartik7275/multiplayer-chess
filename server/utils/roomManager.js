const { createInitialBoard } = require("./boardUtils");

// In-memory store: { roomId: Room }
const rooms = {};

/**
 * Creates a brand-new room with a fresh board.
 * @param {string} roomId
 * @param {string} firstPlayerId  - socket.id of the first player
 * @returns {Room}
 */
function createRoom(roomId, firstPlayerId) {
  rooms[roomId] = {
    id: roomId,
    players: [firstPlayerId], // index 0 = white, index 1 = black
    board: createInitialBoard(),
    turn: "white",
    winner: null,
    moveCount: 0,
  };
  return rooms[roomId];
}

/** Returns the room object or undefined */
function getRoom(roomId) {
  return rooms[roomId];
}

/** Removes a room from memory */
function deleteRoom(roomId) {
  delete rooms[roomId];
}

/**
 * Finds which room a socket belongs to.
 * Returns { roomId, room } or null.
 */
function findRoomByPlayer(socketId) {
  for (const [roomId, room] of Object.entries(rooms)) {
    if (room.players.includes(socketId)) return { roomId, room };
  }
  return null;
}

module.exports = { createRoom, getRoom, deleteRoom, findRoomByPlayer };

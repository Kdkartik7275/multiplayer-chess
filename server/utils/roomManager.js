const { createInitialBoard, createCastlingRights } = require('./boardUtils');
const rooms = {};

function createRoom(roomId, firstPlayerId) {
  rooms[roomId] = {
    id: roomId,
    players: [firstPlayerId],
    board: createInitialBoard(),
    turn: 'white',
    winner: null,
    status: null,
    moveCount: 0,
    vsComputer: false,
    difficulty: 'medium',
    timerSeconds: 0,
    drawOffer: null,
    gameState: {
      castlingRights: createCastlingRights(),
      enPassant: null,
    },
  };
  return rooms[roomId];
}

function getRoom(roomId)    { return rooms[roomId]; }
function deleteRoom(roomId) { delete rooms[roomId]; }

function findRoomByPlayer(socketId) {
  for (const [roomId, room] of Object.entries(rooms))
    if (room.players.includes(socketId)) return { roomId, room };
  return null;
}

module.exports = { createRoom, getRoom, deleteRoom, findRoomByPlayer };
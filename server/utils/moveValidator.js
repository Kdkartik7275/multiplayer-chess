const { isLegalMove } = require('./boardUtils');

function isValidMove(board, fr, fc, tr, tc, color, gameState) {
  return isLegalMove(board, fr, fc, tr, tc, color, gameState);
}

module.exports = { isValidMove };
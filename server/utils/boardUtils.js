function createInitialBoard() {
  return [
    ['r','n','b','q','k','b','n','r'],
    ['p','p','p','p','p','p','p','p'],
    [' ',' ',' ',' ',' ',' ',' ',' '],
    [' ',' ',' ',' ',' ',' ',' ',' '],
    [' ',' ',' ',' ',' ',' ',' ',' '],
    [' ',' ',' ',' ',' ',' ',' ',' '],
    ['P','P','P','P','P','P','P','P'],
    ['R','N','B','Q','K','B','N','R'],
  ];
}

function checkWinner(board) {
  let whiteKing = false;
  let blackKing = false;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === 'K') whiteKing = true;
      if (board[r][c] === 'k') blackKing = true;
    }
  if (!whiteKing) return 'black';
  if (!blackKing) return 'white';
  return null;
}

function applyMove(board, fromRow, fromCol, toRow, toCol) {
  board[toRow][toCol]     = board[fromRow][fromCol];
  board[fromRow][fromCol] = ' ';
  if (board[toRow][toCol] === 'P' && toRow === 0) board[toRow][toCol] = 'Q';
  if (board[toRow][toCol] === 'p' && toRow === 7) board[toRow][toCol] = 'q';
}

function cloneBoard(board) {
  return board.map(row => [...row]);
}

module.exports = { createInitialBoard, checkWinner, applyMove, cloneBoard };
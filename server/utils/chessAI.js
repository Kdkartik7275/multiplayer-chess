/**
 * Chess AI — Minimax + Alpha-Beta + Piece-Square Tables
 * Now uses getLegalMoves (respects check, castling, en passant)
 */

const { getLegalMoves, applyMove, cloneBoard } = require('./boardUtils');

const PIECE_VALUES = { p:100, n:320, b:330, r:500, q:900, k:20000 };

const PST = {
  p: [
    [ 0,  0,  0,  0,  0,  0,  0,  0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [ 5,  5, 10, 25, 25, 10,  5,  5],
    [ 0,  0,  0, 20, 20,  0,  0,  0],
    [ 5, -5,-10,  0,  0,-10, -5,  5],
    [ 5, 10, 10,-20,-20, 10, 10,  5],
    [ 0,  0,  0,  0,  0,  0,  0,  0],
  ],
  n: [
    [-50,-40,-30,-30,-30,-30,-40,-50],
    [-40,-20,  0,  0,  0,  0,-20,-40],
    [-30,  0, 10, 15, 15, 10,  0,-30],
    [-30,  5, 15, 20, 20, 15,  5,-30],
    [-30,  0, 15, 20, 20, 15,  0,-30],
    [-30,  5, 10, 15, 15, 10,  5,-30],
    [-40,-20,  0,  5,  5,  0,-20,-40],
    [-50,-40,-30,-30,-30,-30,-40,-50],
  ],
  b: [
    [-20,-10,-10,-10,-10,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5, 10, 10,  5,  0,-10],
    [-10,  5,  5, 10, 10,  5,  5,-10],
    [-10,  0, 10, 10, 10, 10,  0,-10],
    [-10, 10, 10, 10, 10, 10, 10,-10],
    [-10,  5,  0,  0,  0,  0,  5,-10],
    [-20,-10,-10,-10,-10,-10,-10,-20],
  ],
  r: [
    [ 0,  0,  0,  0,  0,  0,  0,  0],
    [ 5, 10, 10, 10, 10, 10, 10,  5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [ 0,  0,  0,  5,  5,  0,  0,  0],
  ],
  q: [
    [-20,-10,-10, -5, -5,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5,  5,  5,  5,  0,-10],
    [ -5,  0,  5,  5,  5,  5,  0, -5],
    [  0,  0,  5,  5,  5,  5,  0, -5],
    [-10,  5,  5,  5,  5,  5,  0,-10],
    [-10,  0,  5,  0,  0,  0,  0,-10],
    [-20,-10,-10, -5, -5,-10,-10,-20],
  ],
  k: [
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-20,-30,-30,-40,-40,-30,-30,-20],
    [-10,-20,-20,-20,-20,-20,-20,-10],
    [ 20, 20,  0,  0,  0,  0, 20, 20],
    [ 20, 30, 10,  0,  0, 10, 30, 20],
  ],
};

function getPST(piece, row, col, isBlack) {
  const p = piece.toLowerCase();
  if (!PST[p]) return 0;
  const r = isBlack ? row : 7 - row;
  return PST[p][r][col];
}

function evaluate(board) {
  let score = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece === ' ') continue;
      const isBlack = piece === piece.toLowerCase();
      const val = PIECE_VALUES[piece.toLowerCase()] || 0;
      const pst = getPST(piece, r, c, isBlack);
      if (isBlack) score += val + pst;
      else         score -= val + pst;
    }
  return score;
}

function orderMoves(board, moves) {
  return moves.sort((a, b) => {
    const vA = board[a.toRow][a.toCol] !== ' ' ? (PIECE_VALUES[board[a.toRow][a.toCol].toLowerCase()]||0) : 0;
    const vB = board[b.toRow][b.toCol] !== ' ' ? (PIECE_VALUES[board[b.toRow][b.toCol].toLowerCase()]||0) : 0;
    return vB - vA;
  });
}

// Lightweight gameState for AI search (no castling needed — just avoid null crashes)
function emptyGS() {
  return { castlingRights: { white:{kingSide:false,queenSide:false}, black:{kingSide:false,queenSide:false} }, enPassant: null };
}

function minimax(board, depth, alpha, beta, maximizing, gs) {
  if (depth === 0) return { score: evaluate(board) };
  const color = maximizing ? 'black' : 'white';
  const moves = orderMoves(board, getLegalMoves(board, color, gs));
  if (moves.length === 0) return { score: maximizing ? -15000 : 15000 };

  let best = maximizing ? { score: -Infinity } : { score: Infinity };
  let bestMove = null;

  for (const move of moves) {
    const clone = cloneBoard(board);
    // Compute next en passant
    const piece = clone[move.fromRow][move.fromCol];
    const p = piece.toLowerCase();
    let nextEP = null;
    if (p === 'p' && Math.abs(move.toRow - move.fromRow) === 2)
      nextEP = { row: (move.fromRow + move.toRow) / 2, col: move.fromCol };
    const nextGS = { castlingRights: gs.castlingRights, enPassant: nextEP };
    applyMove(clone, move.fromRow, move.fromCol, move.toRow, move.toCol, gs);
    const result = minimax(clone, depth - 1, alpha, beta, !maximizing, nextGS);

    if (maximizing) {
      if (result.score > best.score) { best = result; bestMove = move; }
      alpha = Math.max(alpha, result.score);
    } else {
      if (result.score < best.score) { best = result; bestMove = move; }
      beta = Math.min(beta, result.score);
    }
    if (beta <= alpha) break;
  }
  return { score: best.score, move: bestMove };
}

function getBestMove(board, difficulty, gameState) {
  const depthMap = { easy: 1, medium: 2, hard: 3 };
  const depth = depthMap[difficulty] || 2;
  const gs = gameState || emptyGS();

  if (difficulty === 'easy') {
    const moves = getLegalMoves(board, 'black', gs);
    if (moves.length === 0) return null;
    if (Math.random() < 0.4) return moves[Math.floor(Math.random() * moves.length)];
  }

  const result = minimax(board, depth, -Infinity, Infinity, true, gs);
  return result.move || null;
}

module.exports = { getBestMove };
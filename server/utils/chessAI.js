/**
 * Chess AI — Minimax with Alpha-Beta Pruning + Piece-Square Tables
 * Difficulty maps to search depth: easy=1, medium=2, hard=3
 */

const { isValidMove } = require('./moveValidator');
const { applyMove, cloneBoard } = require('./boardUtils');

// ── Piece values ──────────────────────────────────────────
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

// ── Piece-Square Tables (from Black's perspective, rows 0–7 = ranks 8–1) ──
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
  // For white pieces, mirror the table vertically
  const r = isBlack ? row : 7 - row;
  return PST[p][r][col];
}

// ── Static board evaluation ───────────────────────────────
// Positive = good for black (AI), Negative = good for white
function evaluate(board) {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece === ' ') continue;
      const isBlack = piece === piece.toLowerCase();
      const p = piece.toLowerCase();
      const val = PIECE_VALUES[p] || 0;
      const pst = getPST(piece, r, c, isBlack);
      if (isBlack) score += val + pst;
      else         score -= val + pst;
    }
  }
  return score;
}

// ── Generate all legal moves for a color ─────────────────
function generateMoves(board, color) {
  const moves = [];
  for (let fr = 0; fr < 8; fr++) {
    for (let fc = 0; fc < 8; fc++) {
      const piece = board[fr][fc];
      if (!piece || piece === ' ') continue;
      const isWhite = piece === piece.toUpperCase();
      if (color === 'white' && !isWhite) continue;
      if (color === 'black' && isWhite) continue;
      for (let tr = 0; tr < 8; tr++) {
        for (let tc = 0; tc < 8; tc++) {
          if (isValidMove(board, fr, fc, tr, tc, color)) {
            moves.push({ fromRow: fr, fromCol: fc, toRow: tr, toCol: tc });
          }
        }
      }
    }
  }
  return moves;
}

// ── Move ordering: captures first for better pruning ──────
function orderMoves(board, moves) {
  return moves.sort((a, b) => {
    const capA = board[a.toRow][a.toCol];
    const capB = board[b.toRow][b.toCol];
    const valA = (capA && capA !== ' ') ? (PIECE_VALUES[capA.toLowerCase()] || 0) : 0;
    const valB = (capB && capB !== ' ') ? (PIECE_VALUES[capB.toLowerCase()] || 0) : 0;
    return valB - valA;
  });
}

// ── Minimax with Alpha-Beta ───────────────────────────────
function minimax(board, depth, alpha, beta, maximizing) {
  if (depth === 0) return { score: evaluate(board) };

  const color = maximizing ? 'black' : 'white';
  const moves = orderMoves(board, generateMoves(board, color));

  if (moves.length === 0) {
    // No moves = checkmate or stalemate (simplified)
    return { score: maximizing ? -15000 : 15000 };
  }

  let best = maximizing ? { score: -Infinity } : { score: Infinity };
  let bestMove = null;

  for (const move of moves) {
    const clone = cloneBoard(board);
    applyMove(clone, move.fromRow, move.fromCol, move.toRow, move.toCol);
    const result = minimax(clone, depth - 1, alpha, beta, !maximizing);

    if (maximizing) {
      if (result.score > best.score) { best = result; bestMove = move; }
      alpha = Math.max(alpha, result.score);
    } else {
      if (result.score < best.score) { best = result; bestMove = move; }
      beta = Math.min(beta, result.score);
    }
    if (beta <= alpha) break; // Prune
  }

  return { score: best.score, move: bestMove };
}

// ── Public: pick the best move for the AI (black) ────────
function getBestMove(board, difficulty) {
  const depthMap = { easy: 1, medium: 2, hard: 3 };
  const depth = depthMap[difficulty] || 2;

  // Add slight randomness at easy difficulty
  if (difficulty === 'easy') {
    const moves = generateMoves(board, 'black');
    if (moves.length === 0) return null;
    // 40% chance of random move on easy
    if (Math.random() < 0.4) {
      return moves[Math.floor(Math.random() * moves.length)];
    }
  }

  const result = minimax(board, depth, -Infinity, Infinity, true);
  return result.move || null;
}

module.exports = { getBestMove };
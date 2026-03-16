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

function cloneBoard(board) {
  return board.map(row => [...row]);
}

// Create initial castling rights: both sides, both colors
function createCastlingRights() {
  return { white: { kingSide: true, queenSide: true }, black: { kingSide: true, queenSide: true } };
}

// Apply a move to the board (mutates). Handles castling & en passant.
// promotion: 'Q','R','B','N' — defaults to 'Q' if not provided
function applyMove(board, fromRow, fromCol, toRow, toCol, gameState, promotion) {
  const piece = board[fromRow][fromCol];
  const p = piece.toLowerCase();
  const isWhite = piece === piece.toUpperCase();

  board[toRow][toCol]     = piece;
  board[fromRow][fromCol] = ' ';

  // ── En passant capture ──
  if (p === 'p' && gameState && gameState.enPassant) {
    const ep = gameState.enPassant;
    if (toRow === ep.row && toCol === ep.col) {
      board[fromRow][toCol] = ' '; // remove captured pawn
    }
  }

  // ── Castling move ──
  if (p === 'k') {
    const dc = toCol - fromCol;
    if (Math.abs(dc) === 2) {
      if (dc === 2) { // king side
        board[fromRow][5] = board[fromRow][7];
        board[fromRow][7] = ' ';
      } else { // queen side
        board[fromRow][3] = board[fromRow][0];
        board[fromRow][0] = ' ';
      }
    }
  }

  // ── Pawn promotion ──
  if (p === 'p') {
    if (isWhite && toRow === 0) {
      const promo = promotion || 'Q';
      board[toRow][toCol] = promo.toUpperCase();
    }
    if (!isWhite && toRow === 7) {
      const promo = promotion || 'q';
      board[toRow][toCol] = typeof promo === 'string' && promo.length === 1
        ? promo.toLowerCase() : 'q';
    }
  }
}

// Update castling rights based on what moved
function updateCastlingRights(rights, piece, fromRow, fromCol) {
  const p = piece.toLowerCase();
  const isWhite = piece === piece.toUpperCase();
  const color = isWhite ? 'white' : 'black';

  if (p === 'k') {
    rights[color].kingSide  = false;
    rights[color].queenSide = false;
  }
  if (p === 'r') {
    if (fromCol === 7) rights[color].kingSide  = false;
    if (fromCol === 0) rights[color].queenSide = false;
  }
}

// Find the king square for a color
function findKing(board, color) {
  const king = color === 'white' ? 'K' : 'k';
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c] === king) return { row: r, col: c };
  return null;
}

// Is a square attacked by the given color?
function isSquareAttacked(board, row, col, byColor) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece === ' ') continue;
      const isWhite = piece === piece.toUpperCase();
      if (byColor === 'white' && !isWhite) continue;
      if (byColor === 'black' &&  isWhite) continue;
      if (canAttackSquare(board, r, c, row, col, piece)) return true;
    }
  }
  return false;
}

function canAttackSquare(board, fr, fc, tr, tc, piece) {
  const p = piece.toLowerCase();
  const isWhite = piece === piece.toUpperCase();
  const dr = tr - fr, dc = tc - fc;
  switch (p) {
    case 'p': {
      const dir = isWhite ? -1 : 1;
      return dr === dir && Math.abs(dc) === 1;
    }
    case 'r': return (fr===tr||fc===tc) && !isPathBlocked(board,fr,fc,tr,tc);
    case 'n': return (Math.abs(dr)===2&&Math.abs(dc)===1)||(Math.abs(dr)===1&&Math.abs(dc)===2);
    case 'b': return Math.abs(dr)===Math.abs(dc) && !isPathBlocked(board,fr,fc,tr,tc);
    case 'q': return ((fr===tr||fc===tc)||Math.abs(dr)===Math.abs(dc)) && !isPathBlocked(board,fr,fc,tr,tc);
    case 'k': return Math.abs(dr)<=1 && Math.abs(dc)<=1;
    default: return false;
  }
}

function isPathBlocked(board, fr, fc, tr, tc) {
  const stepR = Math.sign(tr-fr), stepC = Math.sign(tc-fc);
  let r = fr+stepR, c = fc+stepC;
  while (r!==tr||c!==tc) {
    if (board[r][c] !== ' ') return true;
    r+=stepR; c+=stepC;
  }
  return false;
}

// Is the given color's king in check?
function isInCheck(board, color) {
  const king = findKing(board, color);
  if (!king) return false;
  const opp = color === 'white' ? 'black' : 'white';
  return isSquareAttacked(board, king.row, king.col, opp);
}

// Get all legal moves for a color (respects check)
function getLegalMoves(board, color, gameState) {
  const moves = [];
  for (let fr=0; fr<8; fr++) {
    for (let fc=0; fc<8; fc++) {
      const piece = board[fr][fc];
      if (!piece||piece===' ') continue;
      const isWhite = piece===piece.toUpperCase();
      if (color==='white'&&!isWhite) continue;
      if (color==='black'&& isWhite) continue;
      for (let tr=0; tr<8; tr++) {
        for (let tc=0; tc<8; tc++) {
          if (isLegalMove(board, fr, fc, tr, tc, color, gameState)) {
            moves.push({ fromRow:fr, fromCol:fc, toRow:tr, toCol:tc });
          }
        }
      }
    }
  }
  return moves;
}

// Is this move legal (valid shape + doesn't leave own king in check)?
function isLegalMove(board, fr, fc, tr, tc, color, gameState) {
  const piece = board[fr][fc];
  if (!piece||piece===' ') return false;
  const isWhite = piece===piece.toUpperCase();
  if (color==='white'&&!isWhite) return false;
  if (color==='black'&& isWhite) return false;
  if (!isMoveShapeValid(board, fr, fc, tr, tc, color, gameState)) return false;
  // Simulate and check if own king ends up in check
  const clone = cloneBoard(board);
  applyMove(clone, fr, fc, tr, tc, gameState);
  return !isInCheck(clone, color);
}

function isMoveShapeValid(board, fr, fc, tr, tc, color, gameState) {
  if (fr===tr&&fc===tc) return false;
  const piece = board[fr][fc];
  const target = board[tr][tc];
  if (target&&target!==' ') {
    const isWhite = piece===piece.toUpperCase();
    const targetWhite = target===target.toUpperCase();
    if (isWhite===targetWhite) return false;
  }
  const p = piece.toLowerCase();
  const isWhite = piece===piece.toUpperCase();
  const dr = tr-fr, dc = tc-fc;
  switch(p) {
    case 'p': return validatePawnShape(board, fr, fc, tr, tc, isWhite, gameState);
    case 'r': return (fr===tr||fc===tc)&&!isPathBlocked(board,fr,fc,tr,tc);
    case 'n': return (Math.abs(dr)===2&&Math.abs(dc)===1)||(Math.abs(dr)===1&&Math.abs(dc)===2);
    case 'b': return Math.abs(dr)===Math.abs(dc)&&!isPathBlocked(board,fr,fc,tr,tc);
    case 'q': return ((fr===tr||fc===tc)||Math.abs(dr)===Math.abs(dc))&&!isPathBlocked(board,fr,fc,tr,tc);
    case 'k': return validateKingShape(board, fr, fc, tr, tc, color, gameState);
    default:  return false;
  }
}

function validatePawnShape(board, fr, fc, tr, tc, isWhite, gameState) {
  const dir = isWhite ? -1 : 1;
  const startRow = isWhite ? 6 : 1;
  const dr = tr-fr, dc = tc-fc;
  if (dc===0&&dr===dir&&board[tr][tc]===' ') return true;
  if (dc===0&&dr===2*dir&&fr===startRow&&board[fr+dir][fc]===' '&&board[tr][tc]===' ') return true;
  if (Math.abs(dc)===1&&dr===dir) {
    if (board[tr][tc]!==' ') return true;
    // En passant
    if (gameState&&gameState.enPassant&&tr===gameState.enPassant.row&&tc===gameState.enPassant.col) return true;
  }
  return false;
}

function validateKingShape(board, fr, fc, tr, tc, color, gameState) {
  const dr = tr-fr, dc = tc-fc;
  if (Math.abs(dr)<=1&&Math.abs(dc)<=1) return true;
  // Castling
  if (dr===0&&Math.abs(dc)===2&&gameState) {
    const rights = gameState.castlingRights;
    if (!rights) return false;
    const opp = color==='white'?'black':'white';
    const row = color==='white'?7:0;
    if (fr!==row||fc!==4) return false;
    if (isInCheck(board, color)) return false; // can't castle out of check
    if (dc===2&&rights[color].kingSide) {
      if (board[row][5]!==' '||board[row][6]!==' ') return false;
      if (isSquareAttacked(board,row,5,opp)||isSquareAttacked(board,row,6,opp)) return false;
      return true;
    }
    if (dc===-2&&rights[color].queenSide) {
      if (board[row][3]!==' '||board[row][2]!==' '||board[row][1]!==' ') return false;
      if (isSquareAttacked(board,row,3,opp)||isSquareAttacked(board,row,2,opp)) return false;
      return true;
    }
  }
  return false;
}

// Check game status after a move
// Returns: null | 'checkmate' | 'stalemate' | 'check'
function getGameStatus(board, colorToMove, gameState) {
  const legal = getLegalMoves(board, colorToMove, gameState);
  if (legal.length === 0) {
    if (isInCheck(board, colorToMove)) return 'checkmate';
    return 'stalemate';
  }
  if (isInCheck(board, colorToMove)) return 'check';
  return null;
}

// Legacy winner check (kept for compatibility)
function checkWinner(board) {
  let wK=false, bK=false;
  for (let r=0;r<8;r++) for(let c=0;c<8;c++) {
    if(board[r][c]==='K') wK=true;
    if(board[r][c]==='k') bK=true;
  }
  if(!wK) return 'black';
  if(!bK) return 'white';
  return null;
}

module.exports = {
  createInitialBoard, cloneBoard, createCastlingRights,
  applyMove, updateCastlingRights,
  findKing, isInCheck, isSquareAttacked,
  getLegalMoves, isLegalMove, getGameStatus,
  checkWinner, isPathBlocked,
};
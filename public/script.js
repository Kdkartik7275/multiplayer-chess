const socket = io();

// ── STATE ────────────────────────────────────────────────
let myColor       = null;
let board         = [];
let selected      = null;
let currentTurn   = 'white';
let lastMove      = null;
let roomId        = '';
let isVsComputer  = false;
let selectedDiff  = 'easy';

const PIECES = {
  K:'♔', Q:'♕', R:'♖', B:'♗', N:'♘', P:'♙',
  k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟',
};
const FILES = ['a','b','c','d','e','f','g','h'];

const DIFF_DESCS = {
  easy:   'Casual play — great for beginners.',
  medium: 'Balanced challenge — thinks two moves ahead.',
  hard:   'Tough opponent — uses deep positional analysis.',
};

// ── LOBBY NAVIGATION ──────────────────────────────────────
function selectMode(mode) {
  document.getElementById('mode-select').style.display = 'none';
  if (mode === 'human') {
    document.getElementById('panel-human').style.display = 'block';
  } else {
    document.getElementById('panel-cpu').style.display = 'block';
  }
}

function goBack() {
  document.getElementById('panel-human').style.display = 'none';
  document.getElementById('panel-cpu').style.display   = 'none';
  document.getElementById('mode-select').style.display = 'block';
}

function setDifficulty(diff) {
  selectedDiff = diff;
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.toggle('active', b.dataset.diff === diff));
  document.getElementById('diff-desc').textContent = DIFF_DESCS[diff];
}

// ── JOIN HUMAN ROOM ───────────────────────────────────────
function joinRoom() {
  roomId = document.getElementById('room-input').value.trim();
  if (!roomId) { alert('Please enter a Room ID'); return; }
  isVsComputer = false;
  socket.emit('joinRoom', { roomId });
  showGame('Joining room…');
  buildLabels();
}

document.getElementById('room-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinRoom();
});

// ── JOIN VS COMPUTER ──────────────────────────────────────
function joinComputer() {
  isVsComputer = true;
  socket.emit('joinComputer', { difficulty: selectedDiff });
  showGame('Starting game vs computer…');
}

function showGame(msg) {
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('game').style.display  = 'block';
  document.getElementById('status-msg').textContent = msg;
  buildLabels();
}

// ── COORDINATE LABELS ─────────────────────────────────────
function buildLabels() {
  const ranks = document.getElementById('rank-labels');
  const files = document.getElementById('file-labels');
  ranks.innerHTML = files.innerHTML = '';
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('span');
    s.textContent = myColor === 'black' ? i + 1 : 8 - i;
    ranks.appendChild(s);
  }
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('span');
    s.textContent = myColor === 'black' ? FILES[7 - i] : FILES[i];
    files.appendChild(s);
  }
}

// ── RENDER BOARD ──────────────────────────────────────────
function renderBoard(bd) {
  const el = document.getElementById('board');
  el.innerHTML = '';

  const rows = myColor === 'black' ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
  const cols = myColor === 'black' ? [...Array(8).keys()].reverse() : [...Array(8).keys()];

  rows.forEach(r => {
    cols.forEach(c => {
      const sq = document.createElement('div');
      sq.classList.add('sq', (r + c) % 2 === 0 ? 'light' : 'dark');
      sq.dataset.row = r;
      sq.dataset.col = c;

      if (lastMove) {
        if (r === lastMove.fromRow && c === lastMove.fromCol) sq.classList.add('last-from');
        if (r === lastMove.toRow   && c === lastMove.toCol)   sq.classList.add('last-to');
      }
      if (selected && selected.row === r && selected.col === c) sq.classList.add('selected');

      const piece = bd[r][c];
      if (piece && piece !== ' ') {
        const span = document.createElement('span');
        span.className = 'piece';
        span.textContent = PIECES[piece] || piece;
        sq.appendChild(span);
      }

      sq.addEventListener('click', () => onSquareClick(r, c));
      el.appendChild(sq);
    });
  });
}

// ── CLICK HANDLER ─────────────────────────────────────────
function onSquareClick(row, col) {
  if (!myColor || currentTurn !== myColor) return;

  const piece = board[row][col];

  if (selected) {
    if (selected.row === row && selected.col === col) {
      selected = null;
      renderBoard(board);
      return;
    }
    socket.emit('makeMove', {
      roomId,
      fromRow: selected.row, fromCol: selected.col,
      toRow:   row,          toCol:   col,
    });
    selected = null;
  } else {
    if (!piece || piece === ' ') return;
    const isWhitePiece = piece === piece.toUpperCase();
    if (myColor === 'white' && !isWhitePiece) return;
    if (myColor === 'black' && isWhitePiece)  return;
    selected = { row, col };
    renderBoard(board);
  }
}

// ── STATUS ────────────────────────────────────────────────
function updateStatus(turn, winner) {
  const badge = document.getElementById('turn-badge');
  const msg   = document.getElementById('status-msg');

  if (winner) {
    if (winner === 'draw') {
      badge.textContent = '🤝 Draw';
    } else {
      badge.textContent = winner === myColor ? '🏆 You Win!' : (isVsComputer ? '🤖 Computer Wins' : '💀 You Lose');
    }
    badge.className = 'turn-indicator';
    return;
  }

  const isMyTurn = turn === myColor;
  badge.textContent = isMyTurn ? '⚡ Your Turn' : (isVsComputer ? '🤖 Computer…' : "Opponent's Turn");
  badge.className   = 'turn-indicator' + (isMyTurn ? ' your-turn' : '');

  const modeTag = isVsComputer ? `vs Computer (${selectedDiff})` : `Room: ${roomId}`;
  msg.textContent = `${modeTag} · Playing as ${myColor}`;
}

// ── MOVE LOG ──────────────────────────────────────────────
function logMove(lm, piece, isCpu) {
  const log  = document.getElementById('move-log');
  const from = FILES[lm.fromCol] + (8 - lm.fromRow);
  const to   = FILES[lm.toCol]   + (8 - lm.toRow);
  const entry = document.createElement('span');
  entry.className = 'move-entry' + (isCpu ? ' cpu-move' : '');
  entry.textContent = `${PIECES[piece] || '?'}${from}→${to}`;
  log.appendChild(entry);
  log.scrollLeft = log.scrollWidth;
}

// ── OVERLAY ───────────────────────────────────────────────
function showOverlay(title, body) {
  document.getElementById('overlay-title').textContent = title;
  document.getElementById('overlay-body').textContent  = body;
  document.getElementById('overlay').classList.add('show');
}

// ── SOCKET EVENTS ─────────────────────────────────────────

socket.on('playerAssigned', ({ color, roomId: rid }) => {
  myColor = color;
  roomId  = rid || roomId;
  const dot   = document.getElementById('my-dot');
  const label = document.getElementById('my-color-label');
  dot.className   = 'color-dot ' + color;
  label.textContent = `You (${color})`;
  buildLabels();
});

socket.on('waiting', ({ message }) => {
  document.getElementById('status-msg').textContent = message;
});

socket.on('gameStart', ({ board: bd, turn, vsComputer: cpu }) => {
  board       = bd;
  currentTurn = turn;
  isVsComputer = !!cpu;
  renderBoard(bd);
  updateStatus(turn, null);
});

socket.on('boardUpdate', ({ board: bd, turn, winner, lastMove: lm, isComputerMove }) => {
  const movedPiece = lm ? board[lm.fromRow][lm.fromCol] : null;
  board       = bd;
  currentTurn = turn;
  lastMove    = lm;
  selected    = null;

  renderBoard(bd);
  updateStatus(turn, winner);
  if (lm && movedPiece) logMove(lm, movedPiece, !!isComputerMove);

  if (winner) {
    setTimeout(() => {
      if (winner === 'draw') {
        showOverlay('🤝 Draw!', 'No legal moves remain.');
      } else {
        const won = winner === myColor;
        if (isVsComputer) {
          showOverlay(
            won ? '🏆 Victory!' : '🤖 Computer Wins',
            won ? 'You outplayed the engine!' : 'The computer captured your king. Try again!',
          );
        } else {
          showOverlay(
            won ? '🏆 Victory!' : '💀 Defeated',
            won ? 'Congratulations, you captured the king!' : 'Your king was captured. Better luck next time!',
          );
        }
      }
    }, 500);
  }
});

socket.on('computerThinking', ({ thinking }) => {
  document.getElementById('thinking-bar').style.display = thinking ? 'flex' : 'none';
});

socket.on('invalidMove', ({ message }) => {
  selected = null;
  renderBoard(board);
  const msg = document.getElementById('status-msg');
  const old = msg.textContent;
  msg.style.color   = '#e05050';
  msg.textContent   = '⚠ ' + message;
  setTimeout(() => { msg.style.color = ''; msg.textContent = old; }, 1500);
});

socket.on('playerLeft', ({ message }) => {
  showOverlay('Opponent Left', message);
});

socket.on('roomFull', ({ message }) => {
  document.getElementById('game').style.display  = 'none';
  document.getElementById('lobby').style.display = 'block';
  alert(message);
});
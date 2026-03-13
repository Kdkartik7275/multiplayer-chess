const socket = io();

// ── STATE ─────────────────────────────────────────────────
let myColor      = null;
let board        = [];
let selected     = null;
let currentTurn  = 'white';
let lastMove     = null;
let roomId       = '';
let isVsComputer = false;
let selectedDiff = 'easy';
let totalMoves   = 0;

const PIECES = {
  K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙',
  k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟',
};
const FILES = ['a','b','c','d','e','f','g','h'];

// ════════════════════════════════════════════════
//  LOADING SCREEN
// ════════════════════════════════════════════════
const loadMessages = [
  'Summoning the pieces…',
  'Polishing the brass…',
  'Assembling the court…',
  'Lighting the torches…',
  'The battlefield awaits…',
];

function runLoader() {
  const bar   = document.getElementById('load-bar');
  const label = document.getElementById('load-label');
  let pct = 0;
  let msgIdx = 0;
  const steps = [
    { to: 25,  msg: loadMessages[1], delay: 350  },
    { to: 55,  msg: loadMessages[2], delay: 450  },
    { to: 78,  msg: loadMessages[3], delay: 400  },
    { to: 95,  msg: loadMessages[4], delay: 500  },
    { to: 100, msg: '',              delay: 300  },
  ];

  function next(i) {
    if (i >= steps.length) {
      // Done — transition to menu
      setTimeout(() => switchScreen('screen-loading', 'screen-menu'), 200);
      return;
    }
    const s = steps[i];
    setTimeout(() => {
      bar.style.width = s.to + '%';
      if (s.msg) label.textContent = s.msg;
      next(i + 1);
    }, s.delay);
  }

  label.textContent = loadMessages[0];
  bar.style.width   = '8%';
  next(0);
}

window.addEventListener('load', () => {
  runLoader();
  document.getElementById('room-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinRoom();
  });
});

// ════════════════════════════════════════════════
//  SCREEN TRANSITIONS
// ════════════════════════════════════════════════
function switchScreen(from, to) {
  const fromEl = document.getElementById(from);
  const toEl   = document.getElementById(to);
  fromEl.classList.add('exit');
  setTimeout(() => {
    fromEl.classList.remove('active', 'exit');
    toEl.classList.add('active');
  }, 500);
}

function goToMenu() {
  location.reload(); // Simplest clean state reset
}

// ════════════════════════════════════════════════
//  MENU NAVIGATION
// ════════════════════════════════════════════════
function showPanel(id) {
  ['menu-main','panel-multiplayer','panel-computer'].forEach(p => {
    const el = document.getElementById(p);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(id);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('fade-in');
    setTimeout(() => target.classList.remove('fade-in'), 400);
  }
}

function setDiff(diff) {
  selectedDiff = diff;
  document.querySelectorAll('.diff-card').forEach(c => {
    c.classList.toggle('active', c.dataset.diff === diff);
  });
}

// ════════════════════════════════════════════════
//  JOIN FUNCTIONS
// ════════════════════════════════════════════════
function joinRoom() {
  roomId = document.getElementById('room-input').value.trim();
  if (!roomId) { alert('Please enter a Room ID'); return; }
  isVsComputer = false;
  socket.emit('joinRoom', { roomId });
  switchScreen('screen-menu', 'screen-game');
  document.getElementById('status-msg').textContent = 'Joining room…';
  buildLabels();
}

function joinComputer() {
  isVsComputer = true;
  socket.emit('joinComputer', { difficulty: selectedDiff });
  switchScreen('screen-menu', 'screen-game');
  document.getElementById('status-msg').textContent = 'Starting battle…';
  buildLabels();
}

// ════════════════════════════════════════════════
//  BOARD LABELS
// ════════════════════════════════════════════════
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
    s.textContent = myColor === 'black' ? FILES[7-i] : FILES[i];
    files.appendChild(s);
  }
}

// ════════════════════════════════════════════════
//  RENDER BOARD
// ════════════════════════════════════════════════
function renderBoard(bd) {
  const el = document.getElementById('board');
  el.innerHTML = '';
  const rows = myColor === 'black' ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
  const cols = myColor === 'black' ? [...Array(8).keys()].reverse() : [...Array(8).keys()];

  rows.forEach(r => {
    cols.forEach(c => {
      const sq = document.createElement('div');
      sq.classList.add('sq', (r+c)%2===0 ? 'light' : 'dark');
      sq.dataset.row = r;
      sq.dataset.col = c;

      if (lastMove) {
        if (r===lastMove.fromRow && c===lastMove.fromCol) sq.classList.add('last-from');
        if (r===lastMove.toRow   && c===lastMove.toCol)   sq.classList.add('last-to');
      }
      if (selected && selected.row===r && selected.col===c) sq.classList.add('selected');

      const piece = bd[r][c];
      if (piece && piece !== ' ') {
        const span = document.createElement('span');
        span.className  = 'piece';
        span.textContent = PIECES[piece] || piece;
        sq.appendChild(span);
      }
      sq.addEventListener('click', () => onSquareClick(r, c));
      el.appendChild(sq);
    });
  });
}

// ════════════════════════════════════════════════
//  CLICK HANDLER
// ════════════════════════════════════════════════
function onSquareClick(row, col) {
  if (!myColor || currentTurn !== myColor) return;
  const piece = board[row][col];

  if (selected) {
    if (selected.row===row && selected.col===col) {
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
    if (!piece || piece===' ') return;
    const isW = piece === piece.toUpperCase();
    if (myColor==='white' && !isW) return;
    if (myColor==='black' &&  isW) return;
    selected = { row, col };
    renderBoard(board);
  }
}

// ════════════════════════════════════════════════
//  STATUS UPDATE
// ════════════════════════════════════════════════
function updateStatus(turn, winner) {
  const badge = document.getElementById('turn-badge');
  const msg   = document.getElementById('status-msg');

  if (winner) {
    badge.textContent = '—';
    badge.className   = 'turn-chip';
    return;
  }
  const mine = turn === myColor;
  badge.textContent = mine ? '⚡ Your Turn' : (isVsComputer ? '♞ Engine…' : "Opponent's Turn");
  badge.className   = 'turn-chip' + (mine ? ' your-turn' : '');

  const tag = isVsComputer
    ? `vs Computer (${selectedDiff})`
    : `Room: ${roomId}`;
  msg.textContent = `${tag} · You are ${myColor}`;
}

// ════════════════════════════════════════════════
//  MOVE LOG
// ════════════════════════════════════════════════
function logMove(lm, piece, isCpu) {
  const log  = document.getElementById('move-log');
  const from = FILES[lm.fromCol] + (8 - lm.fromRow);
  const to   = FILES[lm.toCol]   + (8 - lm.toRow);
  const entry = document.createElement('span');
  entry.className  = 'move-entry' + (isCpu ? ' cpu' : '');
  entry.textContent = `${PIECES[piece]||'?'}${from}→${to}`;
  log.appendChild(entry);
  log.scrollLeft = log.scrollWidth;
}

// ════════════════════════════════════════════════
//  RESULT SCREEN
// ════════════════════════════════════════════════
function showResult(winner) {
  const emblemEl   = document.getElementById('result-emblem');
  const verdictEl  = document.getElementById('result-verdict');
  const subtitleEl = document.getElementById('result-subtitle');
  const movesEl    = document.getElementById('stat-moves');
  const colorEl    = document.getElementById('stat-color');

  movesEl.textContent = totalMoves;
  colorEl.textContent = (myColor || '—').charAt(0).toUpperCase() + (myColor||'').slice(1);

  if (winner === 'draw') {
    emblemEl.textContent   = '🤝';
    verdictEl.textContent  = 'DRAW';
    verdictEl.className    = 'result-verdict draw';
    subtitleEl.textContent = 'An honourable stalemate.';
    spawnParticles('draw');
  } else if (winner === myColor) {
    emblemEl.textContent   = '♔';
    verdictEl.textContent  = 'VICTORY';
    verdictEl.className    = 'result-verdict win';
    subtitleEl.textContent = isVsComputer
      ? 'You have outplayed the iron engine.'
      : 'You have captured the enemy king!';
    spawnParticles('win');
  } else {
    emblemEl.textContent   = '☠';
    verdictEl.textContent  = 'DEFEAT';
    verdictEl.className    = 'result-verdict lose';
    subtitleEl.textContent = isVsComputer
      ? 'The engine claimed your king.'
      : 'Your king has fallen.';
    spawnParticles('lose');
  }

  switchScreen('screen-game', 'screen-result');
}

// Particle burst for result screen
function spawnParticles(type) {
  const container = document.getElementById('result-particles');
  container.innerHTML = '';
  const colors = {
    win:  ['#f5c842','#e8b84b','#fff7cc','#c9922a'],
    lose: ['#c04040','#8a2020','#ff6060','#501010'],
    draw: ['#c9922a','#8a7060','#d4c0a0'],
  };
  const palette = colors[type] || colors.win;
  const count = 60;

  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    const size  = 4 + Math.random() * 8;
    const angle = Math.random() * 360;
    const dist  = 80 + Math.random() * 220;
    const dur   = 1.2 + Math.random() * 1.6;
    const delay = Math.random() * 0.8;
    const color = palette[Math.floor(Math.random() * palette.length)];
    const shape = Math.random() > 0.5 ? '50%' : '2px';

    p.style.cssText = `
      position: absolute;
      left: 50%; top: 50%;
      width: ${size}px; height: ${size}px;
      background: ${color};
      border-radius: ${shape};
      opacity: 0;
      animation: particleFly ${dur}s ${delay}s ease-out forwards;
      --tx: ${Math.cos(angle * Math.PI/180) * dist}px;
      --ty: ${Math.sin(angle * Math.PI/180) * dist}px;
    `;
    container.appendChild(p);
  }

  // Inject keyframe if not yet
  if (!document.getElementById('particle-style')) {
    const style = document.createElement('style');
    style.id = 'particle-style';
    style.textContent = `
      @keyframes particleFly {
        0%   { opacity: 1; transform: translate(-50%,-50%) translate(0,0) rotate(0deg); }
        100% { opacity: 0; transform: translate(-50%,-50%) translate(var(--tx), var(--ty)) rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
}

// ════════════════════════════════════════════════
//  SOCKET EVENTS
// ════════════════════════════════════════════════

socket.on('playerAssigned', ({ color, roomId: rid }) => {
  myColor = color;
  roomId  = rid || roomId;
  const dot = document.getElementById('my-dot');
  dot.className = 'color-pip ' + color;
  document.getElementById('my-color-label').textContent = `You (${color})`;
  buildLabels();
});

socket.on('waiting', ({ message }) => {
  document.getElementById('status-msg').textContent = message;
});

socket.on('gameStart', ({ board: bd, turn, vsComputer: cpu }) => {
  board        = bd;
  currentTurn  = turn;
  isVsComputer = !!cpu;
  renderBoard(bd);
  updateStatus(turn, null);
});

socket.on('boardUpdate', ({ board: bd, turn, winner, moveCount, lastMove: lm, isComputerMove }) => {
  const movedPiece = lm ? board[lm.fromRow][lm.fromCol] : null;
  board       = bd;
  currentTurn = turn;
  lastMove    = lm;
  selected    = null;
  totalMoves  = moveCount || totalMoves + 1;

  renderBoard(bd);
  updateStatus(turn, winner);
  if (lm && movedPiece) logMove(lm, movedPiece, !!isComputerMove);

  if (winner) {
    setTimeout(() => showResult(winner), 800);
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
  msg.style.color = '#e05050';
  msg.textContent = '⚠ ' + message;
  setTimeout(() => { msg.style.color = ''; msg.textContent = old; }, 1500);
});

socket.on('playerLeft', ({ message }) => {
  // Show a simple result-style notice
  document.getElementById('result-emblem').textContent  = '🚪';
  document.getElementById('result-verdict').textContent = 'DEPARTED';
  document.getElementById('result-verdict').className   = 'result-verdict draw';
  document.getElementById('result-subtitle').textContent = message;
  document.getElementById('stat-moves').textContent = totalMoves;
  document.getElementById('stat-color').textContent = myColor || '—';
  spawnParticles('draw');
  switchScreen('screen-game', 'screen-result');
});

socket.on('roomFull', ({ message }) => {
  switchScreen('screen-game', 'screen-menu');
  showPanel('panel-multiplayer');
  alert(message);
});
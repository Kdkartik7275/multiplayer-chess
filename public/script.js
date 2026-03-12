const socket = io();

// ── STATE ────────────────────────────────────────────────
let myColor = null; // 'white' or 'black'
let board = []; // 8x8 array from server
let selected = null; // { row, col } of clicked piece
let currentTurn = "white";
let lastMove = null; // { fromRow, fromCol, toRow, toCol }
let roomId = "";

// Chess unicode symbols  (White pieces = filled, Black = outline feel)
const PIECES = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

// ── JOIN ROOM ─────────────────────────────────────────────
function joinRoom() {
  roomId = document.getElementById("room-input").value.trim();
  if (!roomId) {
    alert("Please enter a Room ID");
    return;
  }

  // Tell the server we want to join this room
  socket.emit("joinRoom", { roomId });

  document.getElementById("lobby").style.display = "none";
  document.getElementById("game").style.display = "block";
  document.getElementById("status-msg").textContent = "Joining room…";

  // Build coord labels
  buildLabels();
}

// Allow pressing Enter in the input
document.getElementById("room-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinRoom();
});

// ── BUILD COORDINATE LABELS ───────────────────────────────
function buildLabels() {
  const ranks = document.getElementById("rank-labels");
  const files = document.getElementById("file-labels");
  ranks.innerHTML = "";
  files.innerHTML = "";
  for (let i = 0; i < 8; i++) {
    const s = document.createElement("span");
    s.textContent = myColor === "black" ? i + 1 : 8 - i;
    ranks.appendChild(s);
  }
  for (let i = 0; i < 8; i++) {
    const s = document.createElement("span");
    s.textContent = myColor === "black" ? FILES[7 - i] : FILES[i];
    files.appendChild(s);
  }
}

// ── RENDER BOARD ──────────────────────────────────────────
function renderBoard(bd) {
  const el = document.getElementById("board");
  el.innerHTML = "";

  // Black player sees the board flipped so their pieces are at the bottom
  const rows =
    myColor === "black" ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
  const cols =
    myColor === "black" ? [...Array(8).keys()].reverse() : [...Array(8).keys()];

  rows.forEach((r) => {
    cols.forEach((c) => {
      const sq = document.createElement("div");
      sq.classList.add("sq", (r + c) % 2 === 0 ? "light" : "dark");
      sq.dataset.row = r;
      sq.dataset.col = c;

      // Highlight last move
      if (lastMove) {
        if (r === lastMove.fromRow && c === lastMove.fromCol)
          sq.classList.add("last-from");
        if (r === lastMove.toRow && c === lastMove.toCol)
          sq.classList.add("last-to");
      }

      // Highlight selected square
      if (selected && selected.row === r && selected.col === c)
        sq.classList.add("selected");

      // Show piece
      const piece = bd[r][c];
      if (piece && piece !== " ") {
        const span = document.createElement("span");
        span.className = "piece";
        span.textContent = PIECES[piece] || piece;
        sq.appendChild(span);
      }

      sq.addEventListener("click", () => onSquareClick(r, c));
      el.appendChild(sq);
    });
  });
}

// ── CLICK HANDLER ─────────────────────────────────────────
function onSquareClick(row, col) {
  if (!myColor || currentTurn !== myColor) return; // Not your turn

  const piece = board[row][col];

  if (selected) {
    // Second click: try to move
    if (selected.row === row && selected.col === col) {
      // Clicked same square: deselect
      selected = null;
      clearHighlights();
      renderBoard(board);
      return;
    }

    // Send move to server
    socket.emit("makeMove", {
      roomId,
      fromRow: selected.row,
      fromCol: selected.col,
      toRow: row,
      toCol: col,
    });
    selected = null;
    clearHighlights();
  } else {
    // First click: select a piece (only your own)
    if (!piece || piece === " ") return;
    const isWhitePiece = piece === piece.toUpperCase();
    if (myColor === "white" && !isWhitePiece) return;
    if (myColor === "black" && isWhitePiece) return;

    selected = { row, col };
    renderBoard(board);
    highlightSquare(row, col, "selected");
  }
}

function highlightSquare(r, c, cls) {
  document.querySelectorAll(".sq").forEach((sq) => {
    if (+sq.dataset.row === r && +sq.dataset.col === c) sq.classList.add(cls);
  });
}

function clearHighlights() {
  document.querySelectorAll(".sq").forEach((sq) => {
    sq.classList.remove("selected", "valid-move");
  });
}

// ── UPDATE STATUS BAR ─────────────────────────────────────
function updateStatus(turn, winner) {
  const badge = document.getElementById("turn-badge");
  const msg = document.getElementById("status-msg");

  if (winner) {
    badge.textContent = winner === myColor ? "🏆 You Win!" : "💀 You Lose";
    badge.className = "turn-indicator";
    return;
  }

  const isMyTurn = turn === myColor;
  badge.textContent = isMyTurn ? "⚡ Your Turn" : "Opponent's Turn";
  badge.className = "turn-indicator" + (isMyTurn ? " your-turn" : "");
  msg.textContent = `Room: ${roomId} · Playing as ${myColor}`;
}

// ── MOVE LOG ──────────────────────────────────────────────
function logMove(lm, piece) {
  const log = document.getElementById("move-log");
  const from = FILES[lm.fromCol] + (8 - lm.fromRow);
  const to = FILES[lm.toCol] + (8 - lm.toRow);
  const entry = document.createElement("span");
  entry.className = "move-entry";
  entry.textContent = `${PIECES[piece] || "?"}${from}→${to}`;
  log.appendChild(entry);
  log.scrollLeft = log.scrollWidth;
}

// ── SHOW OVERLAY ──────────────────────────────────────────
function showOverlay(title, body) {
  document.getElementById("overlay-title").textContent = title;
  document.getElementById("overlay-body").textContent = body;
  document.getElementById("overlay").classList.add("show");
}

// ── SOCKET EVENTS FROM SERVER ─────────────────────────────

// Server confirmed our color assignment
socket.on("playerAssigned", ({ color }) => {
  myColor = color;
  const dot = document.getElementById("my-dot");
  const label = document.getElementById("my-color-label");
  dot.className = "color-dot " + color;
  label.textContent = `You (${color})`;
  buildLabels();
});

// Waiting for second player
socket.on("waiting", ({ message }) => {
  document.getElementById("status-msg").textContent = message;
});

// Game is starting — server sends initial board
socket.on("gameStart", ({ board: bd, turn, message }) => {
  board = bd;
  currentTurn = turn;
  renderBoard(bd);
  updateStatus(turn, null);
  document.getElementById("status-msg").textContent = message;
});

// A move was made — server sends updated board
socket.on("boardUpdate", ({ board: bd, turn, winner, lastMove: lm }) => {
  // Remember which piece moved for the log (before updating board)
  const movedPiece = board[lm.fromRow][lm.fromCol];

  board = bd;
  currentTurn = turn;
  lastMove = lm;
  selected = null;

  renderBoard(bd);
  updateStatus(turn, winner);
  logMove(lm, movedPiece);

  if (winner) {
    setTimeout(() => {
      const won = winner === myColor;
      showOverlay(
        won ? "🏆 Victory!" : "💀 Defeated",
        won
          ? "Congratulations, you captured the king!"
          : "Your king was captured. Better luck next time!",
      );
    }, 500);
  }
});

// Invalid move feedback
socket.on("invalidMove", ({ message }) => {
  selected = null;
  renderBoard(board);
  // Flash the status briefly
  const msg = document.getElementById("status-msg");
  const old = msg.textContent;
  msg.style.color = "#e05050";
  msg.textContent = "⚠ " + message;
  setTimeout(() => {
    msg.style.color = "";
    msg.textContent = old;
  }, 1500);
});

// Opponent disconnected
socket.on("playerLeft", ({ message }) => {
  showOverlay("Opponent Left", message);
});

// Room is full
socket.on("roomFull", ({ message }) => {
  document.getElementById("game").style.display = "none";
  document.getElementById("lobby").style.display = "block";
  alert(message);
});

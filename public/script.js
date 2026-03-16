const socket = io();

// ── STATE ─────────────────────────────────────────
let myColor = null,
  board = [],
  selected = null;
let currentTurn = "white",
  lastMove = null;
let roomId = "",
  isVsComputer = false,
  selectedDiff = "easy";
let totalMoves = 0,
  gamePaused = false,
  showHints = true,
  gameOver = false;
let checkSquare = null,
  pendingPromo = null;

// Timer
let timerSeconds = 0,
  timerMyLeft = 0,
  timerOppLeft = 0;
let timerInterval = null,
  timerMaxSeconds = 0;

// History
let moveHistory = [],
  historyIndex = -1,
  isViewingHistory = false;

// Settings
let settings = { sound: true, hints: true, theme: "classic" };

// ── PIECE GLYPHS (same solid set, CSS colors them) ──
const PIECE_GLYPHS = {
  K: "♚",
  Q: "♛",
  R: "♜",
  B: "♝",
  N: "♞",
  P: "♟",
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

// ══════════════════════════════════════════════════
//  AUDIO
// ══════════════════════════════════════════════════
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx)
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playTone(freq, type, dur, vol = 0.18) {
  if (!settings.sound) return;
  try {
    const ctx = getAudioCtx(),
      osc = ctx.createOscillator(),
      gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + dur);
  } catch (e) {}
}
const SFX = {
  click() {
    playTone(880, "sine", 0.08, 0.12);
  },
  select() {
    playTone(660, "sine", 0.12, 0.15);
  },
  move() {
    playTone(440, "triangle", 0.18, 0.14);
  },
  capture() {
    playTone(200, "sawtooth", 0.15, 0.18);
    setTimeout(() => playTone(150, "sawtooth", 0.1, 0.1), 60);
  },
  invalid() {
    playTone(150, "square", 0.2, 0.12);
  },
  check() {
    [880, 1100, 1320].forEach((f, i) =>
      setTimeout(() => playTone(f, "sine", 0.3, 0.1), i * 60),
    );
  },
  gameStart() {
    [261, 329, 392].forEach((f, i) =>
      setTimeout(() => playTone(f, "sine", 0.5, 0.1), i * 100),
    );
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => playTone(f, "sine", 0.3, 0.15), i * 120),
    );
  },
  lose() {
    [523, 415, 330, 261].forEach((f, i) =>
      setTimeout(() => playTone(f, "triangle", 0.35, 0.12), i * 150),
    );
  },
  tick() {
    playTone(1200, "sine", 0.04, 0.06);
  },
  lowTime() {
    playTone(440, "square", 0.08, 0.1);
  },
};
function playClick() {
  SFX.click();
}

// ══════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════
function loadSettings() {
  try {
    const s = localStorage.getItem("royalChessSettings");
    if (s) Object.assign(settings, JSON.parse(s));
  } catch (e) {}
}
function saveSettings() {
  try {
    localStorage.setItem("royalChessSettings", JSON.stringify(settings));
  } catch (e) {}
}
function applySettings() {
  document.body.setAttribute("data-theme", settings.theme);
  document
    .querySelectorAll(".theme-swatch")
    .forEach((s) =>
      s.classList.toggle("active", s.dataset.theme === settings.theme),
    );
  document.getElementById("setting-sound").checked = settings.sound;
  document.getElementById("sound-icon").textContent = settings.sound
    ? "🔊"
    : "🔇";
  document.getElementById("sound-label").textContent = settings.sound
    ? "Sound On"
    : "Sound Off";
  document.getElementById("setting-hints").checked = settings.hints;
  showHints = settings.hints;
}
function openSettings() {
  document.getElementById("settings-overlay").classList.remove("hidden");
  document.getElementById("pause-overlay").classList.add("hidden");
}
function closeSettings() {
  SFX.click();
  document.getElementById("settings-overlay").classList.add("hidden");
}
function onSoundToggle(el) {
  settings.sound = el.checked;
  document.getElementById("sound-icon").textContent = settings.sound
    ? "🔊"
    : "🔇";
  document.getElementById("sound-label").textContent = settings.sound
    ? "Sound On"
    : "Sound Off";
  saveSettings();
  if (settings.sound) SFX.click();
}
function onHintsToggle(el) {
  settings.hints = el.checked;
  showHints = settings.hints;
  saveSettings();
  renderBoard(board);
}
function setTheme(name) {
  SFX.click();
  settings.theme = name;
  document.body.setAttribute("data-theme", name);
  document
    .querySelectorAll(".theme-swatch")
    .forEach((s) => s.classList.toggle("active", s.dataset.theme === name));
  saveSettings();
}
function toggleSound() {
  settings.sound = !settings.sound;
  document.getElementById("setting-sound").checked = settings.sound;
  document.getElementById("sound-icon").textContent = settings.sound
    ? "🔊"
    : "🔇";
  document.getElementById("sound-label").textContent = settings.sound
    ? "Sound On"
    : "Sound Off";
  saveSettings();
  if (settings.sound) SFX.click();
}

// ══════════════════════════════════════════════════
//  LOADING
// ══════════════════════════════════════════════════
function runLoader() {
  const bar = document.getElementById("load-bar"),
    lbl = document.getElementById("load-label");
  const msgs = [
    "Summoning the pieces…",
    "Polishing the brass…",
    "Assembling the court…",
    "Lighting the torches…",
    "The battlefield awaits…",
  ];
  const steps = [
    { to: 25, msg: msgs[1], d: 350 },
    { to: 55, msg: msgs[2], d: 450 },
    { to: 78, msg: msgs[3], d: 400 },
    { to: 95, msg: msgs[4], d: 500 },
    { to: 100, msg: "", d: 300 },
  ];
  lbl.textContent = msgs[0];
  bar.style.width = "8%";
  function next(i) {
    if (i >= steps.length) {
      setTimeout(() => switchScreen("screen-loading", "screen-menu"), 200);
      return;
    }
    const s = steps[i];
    setTimeout(() => {
      bar.style.width = s.to + "%";
      if (s.msg) lbl.textContent = s.msg;
      next(i + 1);
    }, s.d);
  }
  next(0);
}

// ══════════════════════════════════════════════════
//  SCREENS
// ══════════════════════════════════════════════════
function switchScreen(from, to) {
  const f = document.getElementById(from),
    t = document.getElementById(to);
  f.classList.add("exit");
  setTimeout(() => {
    f.classList.remove("active", "exit");
    t.classList.add("active");
  }, 500);
}
function goToMenu() {
  location.reload();
}

// ══════════════════════════════════════════════════
//  MENU
// ══════════════════════════════════════════════════
function showPanel(id) {
  ["menu-main", "panel-multiplayer", "panel-computer"].forEach((p) => {
    const el = document.getElementById(p);
    if (el) el.classList.add("hidden");
  });
  const t = document.getElementById(id);
  if (t) {
    t.classList.remove("hidden");
    t.classList.add("fade-in");
    setTimeout(() => t.classList.remove("fade-in"), 400);
  }
}
function setDiff(diff) {
  selectedDiff = diff;
  document
    .querySelectorAll(".diff-card")
    .forEach((c) => c.classList.toggle("active", c.dataset.diff === diff));
}
function setupTimerBtns(gid) {
  const btns = document.querySelectorAll(`#${gid} .timer-btn`);
  btns.forEach((btn) =>
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      timerSeconds = parseInt(btn.dataset.time, 10);
      SFX.click();
    }),
  );
}

// ══════════════════════════════════════════════════
//  JOIN
// ══════════════════════════════════════════════════
function joinRoom() {
  roomId = document.getElementById("room-input").value.trim();
  if (!roomId) {
    alert("Please enter a Room ID");
    return;
  }
  isVsComputer = false;
  socket.emit("joinRoom", { roomId, timerSeconds });
  switchScreen("screen-menu", "screen-game");
  document.getElementById("status-msg").textContent = "Joining room…";
  buildLabels();
}
function joinComputer() {
  isVsComputer = true;
  socket.emit("joinComputer", { difficulty: selectedDiff, timerSeconds });
  switchScreen("screen-menu", "screen-game");
  document.getElementById("status-msg").textContent = "Starting…";
  buildLabels();
}

// ══════════════════════════════════════════════════
//  PAUSE
// ══════════════════════════════════════════════════
function togglePause() {
  SFX.click();
  gamePaused ? resumeGame() : pauseGame();
}
function pauseGame() {
  gamePaused = true;
  stopTimer();
  document.getElementById("pause-overlay").classList.remove("hidden");
  document.getElementById("pause-btn").textContent = "▶";
}
function resumeGame() {
  SFX.click();
  gamePaused = false;
  document.getElementById("pause-overlay").classList.add("hidden");
  document.getElementById("pause-btn").textContent = "⏸";
  if (timerMaxSeconds > 0 && !gameOver) startTimer();
}

// ══════════════════════════════════════════════════
//  RESIGN & DRAW
// ══════════════════════════════════════════════════
function confirmResign() {
  if (gameOver) return;
  SFX.click();
  document.getElementById("resign-overlay").classList.remove("hidden");
}
function closeResign() {
  SFX.click();
  document.getElementById("resign-overlay").classList.add("hidden");
}
function doResign() {
  closeResign();
  socket.emit("resign", { roomId });
}
function offerDraw() {
  if (gameOver || isVsComputer) return;
  SFX.click();
  socket.emit("offerDraw", { roomId });
  showBanner("Draw offered — waiting…", "draw-offer");
}
function respondDraw(accept) {
  SFX.click();
  document.getElementById("draw-overlay").classList.add("hidden");
  socket.emit("respondDraw", { roomId, accept });
}

// ══════════════════════════════════════════════════
//  BANNER
// ══════════════════════════════════════════════════
function showBanner(msg, cls) {
  const b = document.getElementById("status-banner");
  b.textContent = msg;
  b.className = "status-banner " + cls;
  b.style.display = "block";
}
function hideBanner() {
  document.getElementById("status-banner").style.display = "none";
}

// ══════════════════════════════════════════════════
//  TIMER
// ══════════════════════════════════════════════════
function initTimers(secs) {
  if (!secs) return;
  timerMaxSeconds = secs;
  timerMyLeft = secs;
  timerOppLeft = secs;
  document.getElementById("timers-row").style.display = "flex";
  document.getElementById("timer-my-label").textContent =
    `You (${myColor || "?"})`;
  document.getElementById("timer-opp-label").textContent = isVsComputer
    ? "Computer"
    : "Opponent";
  updateTimerDisplay();
}
function updateTimerDisplay() {
  const myV = document.getElementById("timer-my-val"),
    oppV = document.getElementById("timer-opp-val");
  const myB = document.getElementById("timer-my-bar"),
    oppB = document.getElementById("timer-opp-bar");
  myV.textContent = fmt(timerMyLeft);
  oppV.textContent = fmt(timerOppLeft);
  myB.style.width = (timerMyLeft / timerMaxSeconds) * 100 + "%";
  oppB.style.width = (timerOppLeft / timerMaxSeconds) * 100 + "%";
  const mine = currentTurn === myColor;
  myV.className =
    "timer-display" +
    (mine ? " active" : "") +
    (timerMyLeft <= 30 ? " low" : "");
  oppV.className =
    "timer-display" +
    (!mine ? " active" : "") +
    (timerOppLeft <= 30 ? " low" : "");
  myB.style.background =
    timerMyLeft <= 30 ? "linear-gradient(90deg,#8a1010,#e04040)" : "";
  oppB.style.background =
    timerOppLeft <= 30 ? "linear-gradient(90deg,#8a1010,#e04040)" : "";
}
function fmt(s) {
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
function startTimer() {
  stopTimer();
  if (!timerMaxSeconds || gamePaused || gameOver) return;
  timerInterval = setInterval(() => {
    if (gamePaused || gameOver) return;
    const mine = currentTurn === myColor;
    if (mine) {
      timerMyLeft = Math.max(0, timerMyLeft - 1);
      if (timerMyLeft <= 10) SFX.tick();
      if (timerMyLeft <= 30 && timerMyLeft > 28) SFX.lowTime();
      if (timerMyLeft === 0) {
        stopTimer();
        showResult("timeout-loss");
        return;
      }
    } else {
      timerOppLeft = Math.max(0, timerOppLeft - 1);
      if (timerOppLeft === 0) {
        stopTimer();
        showResult("timeout-win");
        return;
      }
    }
    updateTimerDisplay();
  }, 1000);
}
function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// ══════════════════════════════════════════════════
//  BOARD LABELS
// ══════════════════════════════════════════════════
function buildLabels() {
  const ranks = document.getElementById("rank-labels"),
    files = document.getElementById("file-labels");
  ranks.innerHTML = files.innerHTML = "";
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

// ══════════════════════════════════════════════════
//  RENDER BOARD
// ══════════════════════════════════════════════════
function renderBoard(bd, overrideCheck) {
  const el = document.getElementById("board");
  el.innerHTML = "";
  const chk = overrideCheck !== undefined ? overrideCheck : checkSquare;
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
      if (showHints && lastMove) {
        if (r === lastMove.fromRow && c === lastMove.fromCol)
          sq.classList.add("last-from");
        if (r === lastMove.toRow && c === lastMove.toCol)
          sq.classList.add("last-to");
      }
      if (selected && selected.row === r && selected.col === c)
        sq.classList.add("selected");
      if (chk && r === chk.row && c === chk.col) sq.classList.add("in-check");
      const piece = bd[r][c];
      if (piece && piece !== " ") {
        const span = document.createElement("span");
        span.className =
          "piece " + (piece === piece.toUpperCase() ? "white" : "black");
        span.textContent = PIECE_GLYPHS[piece] || piece;
        sq.appendChild(span);
      }
      sq.addEventListener("click", () => onSquareClick(r, c));
      el.appendChild(sq);
    });
  });
}

// ══════════════════════════════════════════════════
//  CLICK
// ══════════════════════════════════════════════════
function onSquareClick(row, col) {
  if (
    !myColor ||
    currentTurn !== myColor ||
    gamePaused ||
    gameOver ||
    isViewingHistory
  )
    return;
  const piece = board[row][col];
  if (selected) {
    if (selected.row === row && selected.col === col) {
      selected = null;
      renderBoard(board);
      return;
    }
    if (board[row][col] && board[row][col] !== " ") SFX.capture();
    else SFX.move();
    if (timerMaxSeconds > 0) stopTimer();
    socket.emit("makeMove", {
      roomId,
      fromRow: selected.row,
      fromCol: selected.col,
      toRow: row,
      toCol: col,
    });
    selected = null;
  } else {
    if (!piece || piece === " ") return;
    const isW = piece === piece.toUpperCase();
    if (myColor === "white" && !isW) return;
    if (myColor === "black" && isW) return;
    SFX.select();
    selected = { row, col };
    renderBoard(board);
  }
}

// ══════════════════════════════════════════════════
//  PROMOTION
// ══════════════════════════════════════════════════
function showPromotionPicker(fromRow, fromCol, toRow, toCol) {
  pendingPromo = { fromRow, fromCol, toRow, toCol };
  const isW = myColor === "white";
  const opts = isW
    ? [
        { k: "Q", g: "♛", n: "Queen" },
        { k: "R", g: "♜", n: "Rook" },
        { k: "B", g: "♝", n: "Bishop" },
        { k: "N", g: "♞", n: "Knight" },
      ]
    : [
        { k: "q", g: "♛", n: "Queen" },
        { k: "r", g: "♜", n: "Rook" },
        { k: "b", g: "♝", n: "Bishop" },
        { k: "n", g: "♞", n: "Knight" },
      ];
  const c = document.getElementById("promo-pieces");
  c.innerHTML = "";
  opts.forEach((p) => {
    const btn = document.createElement("button");
    btn.className = "promo-piece-btn";
    btn.innerHTML = `<span class="piece ${isW ? "white" : "black"}" style="font-size:2.5rem;width:auto;height:auto">${p.g}</span><span class="promo-label">${p.n}</span>`;
    btn.onclick = () => {
      document.getElementById("promo-overlay").classList.add("hidden");
      if (!pendingPromo) return;
      const { fromRow, fromCol, toRow, toCol } = pendingPromo;
      pendingPromo = null;
      SFX.move();
      if (timerMaxSeconds > 0) stopTimer();
      socket.emit("makeMove", {
        roomId,
        fromRow,
        fromCol,
        toRow,
        toCol,
        promotion: p.k,
      });
    };
    c.appendChild(btn);
  });
  document.getElementById("promo-overlay").classList.remove("hidden");
}

// ══════════════════════════════════════════════════
//  HISTORY (always in sidebar)
// ══════════════════════════════════════════════════
function recordHistory(bd, lm, moveStr, color) {
  moveHistory.push({
    board: bd.map((r) => [...r]),
    lastMove: lm ? { ...lm } : null,
    moveStr,
    color,
  });
  updateHistoryList();
}
function updateHistoryList() {
  const list = document.getElementById("history-list");
  list.innerHTML = "";
  moveHistory.forEach((e, i) => {
    const d = document.createElement("div");
    const num = Math.floor(i / 2) + 1;
    d.className =
      "hist-entry " +
      (e.color === "white" ? "white-move" : "black-move") +
      (i === historyIndex ? " active" : "");
    d.textContent = (e.color === "white" ? `${num}. ` : "") + e.moveStr;
    d.onclick = () => jumpToHistory(i);
    list.appendChild(d);
  });
  list.scrollTop = list.scrollHeight;
  updateHistPos();
}
function updateHistPos() {
  const t = moveHistory.length,
    pos = historyIndex === -1 ? t : historyIndex + 1;
  document.getElementById("hist-pos").textContent = t ? `${pos}/${t}` : "—";
}
function jumpToHistory(i) {
  SFX.click();
  historyIndex = i;
  isViewingHistory = true;
  const e = moveHistory[i];
  // Temporarily set lastMove for highlights
  const savedLast = lastMove;
  lastMove = e.lastMove;
  renderBoard(e.board, null);
  lastMove = savedLast;
  document.getElementById("board").classList.add("viewing-history");
  document
    .querySelectorAll(".hist-entry")
    .forEach((el, j) => el.classList.toggle("active", j === i));
  updateHistPos();
}
function historyStep(dir) {
  SFX.click();
  const next = historyIndex + dir;
  if (next < 0) {
    historyGoLive();
    return;
  }
  if (next >= moveHistory.length) return;
  jumpToHistory(next);
}
function historyGoLive() {
  SFX.click();
  historyIndex = -1;
  isViewingHistory = false;
  document.getElementById("board").classList.remove("viewing-history");
  renderBoard(board);
  document
    .querySelectorAll(".hist-entry")
    .forEach((el) => el.classList.remove("active"));
  updateHistPos();
}

// ══════════════════════════════════════════════════
//  STATUS — updates BOTH desktop and mobile chips
// ══════════════════════════════════════════════════
function updateStatus(turn, winner) {
  const desktop = document.getElementById("turn-badge-desktop");
  const mobile = document.getElementById("turn-badge-mobile");
  if (winner) {
    [desktop, mobile].forEach((c) => {
      c.textContent = "—";
      c.className = c.id.includes("desktop")
        ? "turn-chip-desktop"
        : "turn-chip-mobile";
    });
    return;
  }
  const mine = turn === myColor;
  const txt = mine
    ? "⚡ Your Turn"
    : isVsComputer
      ? "♞ Engine…"
      : "Opponent's Turn";
  const cls = mine ? " your-turn" : "";
  desktop.textContent = txt;
  desktop.className = "turn-chip-desktop" + cls;
  mobile.textContent = txt;
  mobile.className = "turn-chip-mobile" + cls;
  document.getElementById("status-msg").textContent =
    (isVsComputer ? `vs Computer (${selectedDiff})` : `Room: ${roomId}`) +
    ` · You are ${myColor}`;
}
function updateGameActButtons() {
  const d = gameOver || isViewingHistory;
  document.getElementById("resign-btn").disabled = d;
  document.getElementById("draw-btn").disabled = d || isVsComputer;
}

// ══════════════════════════════════════════════════
//  RESULT
// ══════════════════════════════════════════════════
function showResult(winner, status) {
  gameOver = true;
  stopTimer();
  updateGameActButtons();
  const em = document.getElementById("result-emblem"),
    vr = document.getElementById("result-verdict"),
    sb = document.getElementById("result-subtitle");
  document.getElementById("stat-moves").textContent = totalMoves;
  document.getElementById("stat-color").textContent =
    (myColor || "—").charAt(0).toUpperCase() + (myColor || "").slice(1);
  const won = winner === myColor;
  if (winner === "timeout-win") {
    em.textContent = "⏱";
    vr.textContent = "VICTORY";
    vr.className = "result-verdict win";
    sb.textContent = "Opponent ran out of time!";
    SFX.win();
    spawnParticles("win");
  } else if (winner === "timeout-loss") {
    em.textContent = "⏱";
    vr.textContent = "DEFEAT";
    vr.className = "result-verdict lose";
    sb.textContent = "You ran out of time.";
    SFX.lose();
    spawnParticles("lose");
  } else if (winner === "draw" || status === "stalemate" || status === "draw") {
    em.textContent = "🤝";
    vr.textContent = status === "stalemate" ? "STALEMATE" : "DRAW";
    vr.className = "result-verdict draw";
    sb.textContent =
      status === "stalemate"
        ? "No legal moves — stalemate!"
        : "An honourable draw.";
    spawnParticles("draw");
  } else if (status === "resigned") {
    em.textContent = won ? "🏆" : "⚑";
    vr.textContent = won ? "VICTORY" : "DEFEAT";
    vr.className = "result-verdict " + (won ? "win" : "lose");
    sb.textContent = won ? "Opponent resigned." : "You resigned.";
    won ? SFX.win() : SFX.lose();
    spawnParticles(won ? "win" : "lose");
  } else if (status === "checkmate") {
    em.textContent = won ? "♔" : "☠";
    vr.textContent = won ? "CHECKMATE!" : "DEFEATED";
    vr.className = "result-verdict " + (won ? "win" : "lose");
    sb.textContent = won
      ? "You delivered checkmate!"
      : isVsComputer
        ? "The engine checkmated you."
        : "Your king has fallen.";
    won ? SFX.win() : SFX.lose();
    spawnParticles(won ? "win" : "lose");
  } else if (won) {
    em.textContent = "♔";
    vr.textContent = "VICTORY";
    vr.className = "result-verdict win";
    sb.textContent = isVsComputer
      ? "You outplayed the engine!"
      : "You captured the enemy king!";
    SFX.win();
    spawnParticles("win");
  } else {
    em.textContent = "☠";
    vr.textContent = "DEFEAT";
    vr.className = "result-verdict lose";
    sb.textContent = isVsComputer
      ? "The engine claimed your king."
      : "Your king has fallen.";
    SFX.lose();
    spawnParticles("lose");
  }
  setTimeout(() => switchScreen("screen-game", "screen-result"), 800);
}
function spawnParticles(type) {
  const cont = document.getElementById("result-particles");
  cont.innerHTML = "";
  const pal = {
    win: ["#f5c842", "#e8b84b", "#fff7cc", "#c9922a"],
    lose: ["#c04040", "#8a2020", "#ff6060"],
    draw: ["#c9922a", "#8a7060", "#d4c0a0"],
  };
  const p = pal[type] || pal.win;
  for (let i = 0; i < 70; i++) {
    const el = document.createElement("div");
    const sz = 4 + Math.random() * 8,
      ang = Math.random() * 360,
      dist = 80 + Math.random() * 220,
      dur = 1.2 + Math.random() * 1.6,
      del = Math.random() * 0.8;
    el.style.cssText = `position:absolute;left:50%;top:50%;width:${sz}px;height:${sz}px;background:${p[Math.floor(Math.random() * p.length)]};border-radius:${Math.random() > 0.5 ? "50%" : "2px"};opacity:0;animation:particleFly ${dur}s ${del}s ease-out forwards;--tx:${Math.cos((ang * Math.PI) / 180) * dist}px;--ty:${Math.sin((ang * Math.PI) / 180) * dist}px;`;
    cont.appendChild(el);
  }
  if (!document.getElementById("pstyle")) {
    const s = document.createElement("style");
    s.id = "pstyle";
    s.textContent =
      "@keyframes particleFly{0%{opacity:1;transform:translate(-50%,-50%) translate(0,0) rotate(0deg);}100%{opacity:0;transform:translate(-50%,-50%) translate(var(--tx),var(--ty)) rotate(360deg);}}";
    document.head.appendChild(s);
  }
}

// ══════════════════════════════════════════════════
//  SOCKET EVENTS
// ══════════════════════════════════════════════════
socket.on("playerAssigned", ({ color, roomId: rid }) => {
  myColor = color;
  roomId = rid || roomId;
  document.getElementById("my-dot").className = "color-pip " + color;
  document.getElementById("my-color-label").textContent = `You (${color})`;
  buildLabels();
});
socket.on("waiting", ({ message }) => {
  document.getElementById("status-msg").textContent = message;
});
socket.on(
  "gameStart",
  ({ board: bd, turn, vsComputer: cpu, timerSeconds: ts }) => {
    board = bd;
    currentTurn = turn;
    isVsComputer = !!cpu;
    renderBoard(bd);
    updateStatus(turn, null);
    SFX.gameStart();
    updateGameActButtons();
    if (ts && ts > 0) {
      timerSeconds = ts;
      initTimers(ts);
      startTimer();
    }
  },
);
socket.on(
  "boardUpdate",
  ({
    board: bd,
    turn,
    winner,
    moveCount,
    lastMove: lm,
    isComputerMove,
    status,
    checkSquare: cs,
    resigned,
  }) => {
    const movedPiece = lm ? board[lm.fromRow][lm.fromCol] : null;
    board = bd;
    currentTurn = turn;
    lastMove = lm;
    selected = null;
    totalMoves = moveCount || totalMoves + 1;
    checkSquare = cs || null;
    if (lm && movedPiece) {
      const from = FILES[lm.fromCol] + (8 - lm.fromRow),
        to = FILES[lm.toCol] + (8 - lm.toRow);
      const str = `${PIECE_GLYPHS[movedPiece] || "?"}${from}→${to}`;
      const moverColor = isComputerMove
        ? "black"
        : turn === "white"
          ? "black"
          : "white";
      recordHistory(bd, lm, str, moverColor);
    }
    if (!isViewingHistory) renderBoard(bd);
    else updateHistoryList();
    updateStatus(turn, winner);
    if (isComputerMove && lm) {
      const t = board[lm.toRow][lm.toCol];
      if (t && t !== " ") SFX.capture();
      else SFX.move();
    }
    hideBanner();
    if (status === "check") {
      showBanner("⚠ CHECK! Your king is under attack", "check");
      SFX.check();
    }
    if (timerMaxSeconds > 0 && !winner && !gamePaused) {
      stopTimer();
      startTimer();
      updateTimerDisplay();
    }
    if (
      winner ||
      status === "checkmate" ||
      status === "stalemate" ||
      status === "draw" ||
      resigned
    )
      showResult(winner, status);
  },
);
socket.on("promotionRequired", ({ fromRow, fromCol, toRow, toCol }) => {
  showPromotionPicker(fromRow, fromCol, toRow, toCol);
});
socket.on("drawOffered", ({ by }) => {
  if (by !== myColor)
    document.getElementById("draw-overlay").classList.remove("hidden");
});
socket.on("drawDeclined", () => {
  hideBanner();
  showBanner("Draw offer declined", "check");
  setTimeout(hideBanner, 2500);
});
socket.on("computerThinking", ({ thinking }) => {
  document.getElementById("thinking-bar").style.display = thinking
    ? "flex"
    : "none";
});
socket.on("invalidMove", ({ message }) => {
  SFX.invalid();
  selected = null;
  renderBoard(board);
  const msg = document.getElementById("status-msg"),
    old = msg.textContent;
  msg.style.color = "#e05050";
  msg.textContent = "⚠ " + message;
  setTimeout(() => {
    msg.style.color = "";
    msg.textContent = old;
  }, 1500);
});
socket.on("playerLeft", ({ message }) => {
  stopTimer();
  document.getElementById("result-emblem").textContent = "🚪";
  document.getElementById("result-verdict").textContent = "DEPARTED";
  document.getElementById("result-verdict").className = "result-verdict draw";
  document.getElementById("result-subtitle").textContent = message;
  document.getElementById("stat-moves").textContent = totalMoves;
  document.getElementById("stat-color").textContent = myColor || "—";
  spawnParticles("draw");
  switchScreen("screen-game", "screen-result");
});
socket.on("roomFull", ({ message }) => {
  switchScreen("screen-game", "screen-menu");
  showPanel("panel-multiplayer");
  alert(message);
});

// ══════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════
window.addEventListener("load", () => {
  loadSettings();
  applySettings();
  runLoader();
  document.getElementById("room-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinRoom();
  });
  setupTimerBtns("timer-select-mp");
  setupTimerBtns("timer-select-cpu");
  document
    .getElementById("settings-overlay")
    .addEventListener("click", function (e) {
      if (e.target === this) closeSettings();
    });
  document.addEventListener(
    "touchend",
    (e) => {
      const n = Date.now();
      if (n - (document._lt || 0) < 300) e.preventDefault();
      document._lt = n;
    },
    { passive: false },
  );
  ["touchstart", "click"].forEach((ev) =>
    document.addEventListener(
      ev,
      () => {
        try {
          getAudioCtx().resume();
        } catch (e) {}
      },
      { once: true },
    ),
  );
});

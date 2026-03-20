const socket = io();

// ── STATE ─────────────────────────────────────────────
let myColor = "white", board = [], selected = null;
let currentTurn = "white", lastMove = null;
let roomId = "", isVsComputer = false, selectedDiff = "easy";
let totalMoves = 0, gamePaused = false, showHints = true, gameOver = false;
let checkSquare = null, pendingPromo = null;
let timerSeconds = 0, timerMyLeft = 0, timerOppLeft = 0,
    timerInterval = null, timerMaxSeconds = 0;
let movePairs = [], moveFlat = [], boardSnapshots = [],
    historyIndex = -1, isViewingHistory = false;
let settings = { sound: true, hints: true, theme: "classic" };

// ── Undo / Hint ──────────────────────────────────────
let undosLeft = 2, hintsLeft = 2;

// ── Thinking timer (client-only, vs Computer, infinite mode) ──
let thinkStart = null, thinkInterval = null, thinkSeconds = 0;

// ── Legal move cache ──
let legalMovesCache = [];

// ── Client-side game state mirror ──
let clientGameState = {
  castlingRights: { white:{kingSide:true,queenSide:true}, black:{kingSide:true,queenSide:true} },
  enPassant: null,
};

const GLYPHS = { K:"♚",Q:"♛",R:"♜",B:"♝",N:"♞",P:"♟",k:"♚",q:"♛",r:"♜",b:"♝",n:"♞",p:"♟" };
const FILES = ["a","b","c","d","e","f","g","h"];
const FLOATPIECES = ["♟","♞","♝","♜","♛","♚","♙","♘","♗","♖","♕","♔"];

// ══════════════════════════════════════════════════════
//  CLIENT-SIDE MOVE VALIDATOR
// ══════════════════════════════════════════════════════
function cloneBoard(bd) { return bd.map(r => [...r]); }

function isPathBlocked(bd, fr, fc, tr, tc) {
  const sr = Math.sign(tr-fr), sc = Math.sign(tc-fc);
  let r = fr+sr, c = fc+sc;
  while (r !== tr || c !== tc) {
    if (bd[r][c] && bd[r][c] !== ' ') return true;
    r += sr; c += sc;
  }
  return false;
}

function canAttackSquare(bd, fr, fc, tr, tc, piece) {
  const p = piece.toLowerCase(), isW = piece === piece.toUpperCase();
  const dr = tr-fr, dc = tc-fc;
  switch (p) {
    case 'p': { const dir = isW ? -1 : 1; return dr===dir && Math.abs(dc)===1; }
    case 'r': return (fr===tr||fc===tc) && !isPathBlocked(bd,fr,fc,tr,tc);
    case 'n': return (Math.abs(dr)===2&&Math.abs(dc)===1)||(Math.abs(dr)===1&&Math.abs(dc)===2);
    case 'b': return Math.abs(dr)===Math.abs(dc) && !isPathBlocked(bd,fr,fc,tr,tc);
    case 'q': return ((fr===tr||fc===tc)||Math.abs(dr)===Math.abs(dc)) && !isPathBlocked(bd,fr,fc,tr,tc);
    case 'k': return Math.abs(dr)<=1 && Math.abs(dc)<=1;
    default: return false;
  }
}

function isSquareAttacked(bd, row, col, byColor) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const piece = bd[r][c];
      if (!piece || piece===' ') continue;
      const isW = piece===piece.toUpperCase();
      if (byColor==='white' && !isW) continue;
      if (byColor==='black' &&  isW) continue;
      if (canAttackSquare(bd,r,c,row,col,piece)) return true;
    }
  return false;
}

function findKingClient(bd, color) {
  const king = color==='white' ? 'K' : 'k';
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (bd[r][c]===king) return {row:r,col:c};
  return null;
}

function isInCheckClient(bd, color) {
  const k = findKingClient(bd, color);
  if (!k) return false;
  return isSquareAttacked(bd, k.row, k.col, color==='white'?'black':'white');
}

function applyMoveClient(bd, fr, fc, tr, tc, gs, promotion) {
  const piece = bd[fr][fc], p = piece.toLowerCase(), isW = piece===piece.toUpperCase();
  bd[tr][tc] = piece; bd[fr][fc] = ' ';
  if (p==='p' && gs && gs.enPassant && tr===gs.enPassant.row && tc===gs.enPassant.col)
    bd[fr][tc] = ' ';
  if (p==='k' && Math.abs(tc-fc)===2) {
    const row = fr;
    if (tc>fc) { bd[row][5]=bd[row][7]; bd[row][7]=' '; }
    else        { bd[row][3]=bd[row][0]; bd[row][0]=' '; }
  }
  if (p==='p') {
    if (isW && tr===0) bd[tr][tc] = (promotion||'Q').toUpperCase();
    if (!isW && tr===7) bd[tr][tc] = (promotion||'q').toLowerCase();
  }
}

function validatePawnShape(bd, fr, fc, tr, tc, isW, gs) {
  const dir = isW ? -1 : 1, startRow = isW ? 6 : 1;
  const dr = tr-fr, dc = tc-fc;
  const empty = s => !s || s===' ';
  if (dc===0 && dr===dir && empty(bd[tr][tc])) return true;
  if (dc===0 && dr===2*dir && fr===startRow && empty(bd[fr+dir][fc]) && empty(bd[tr][tc])) return true;
  if (Math.abs(dc)===1 && dr===dir) {
    if (bd[tr][tc] && bd[tr][tc]!==' ') return true;
    if (gs && gs.enPassant && tr===gs.enPassant.row && tc===gs.enPassant.col) return true;
  }
  return false;
}

function validateKingShape(bd, fr, fc, tr, tc, color, gs) {
  const dr = tr-fr, dc = tc-fc;
  if (Math.abs(dr)<=1 && Math.abs(dc)<=1) return true;
  if (dr===0 && Math.abs(dc)===2 && gs && gs.castlingRights) {
    const opp = color==='white'?'black':'white', row = color==='white'?7:0;
    if (fr!==row || fc!==4) return false;
    if (isInCheckClient(bd,color)) return false;
    const empty = s => !s || s===' ';
    if (dc===2 && gs.castlingRights[color].kingSide) {
      if (!empty(bd[row][5])||!empty(bd[row][6])) return false;
      if (isSquareAttacked(bd,row,5,opp)||isSquareAttacked(bd,row,6,opp)) return false;
      return true;
    }
    if (dc===-2 && gs.castlingRights[color].queenSide) {
      if (!empty(bd[row][3])||!empty(bd[row][2])||!empty(bd[row][1])) return false;
      if (isSquareAttacked(bd,row,3,opp)||isSquareAttacked(bd,row,2,opp)) return false;
      return true;
    }
  }
  return false;
}

function isMoveShapeValid(bd, fr, fc, tr, tc, color, gs) {
  if (fr===tr && fc===tc) return false;
  const piece = bd[fr][fc];
  if (!piece || piece===' ') return false;
  const isW = piece===piece.toUpperCase();
  if (color==='white' && !isW) return false;
  if (color==='black' &&  isW) return false;
  const target = bd[tr][tc];
  if (target && target!==' ') {
    const tW = target===target.toUpperCase();
    if (isW===tW) return false;
  }
  const p = piece.toLowerCase(), dr = tr-fr, dc = tc-fc;
  switch (p) {
    case 'p': return validatePawnShape(bd,fr,fc,tr,tc,isW,gs);
    case 'r': return (fr===tr||fc===tc) && !isPathBlocked(bd,fr,fc,tr,tc);
    case 'n': return (Math.abs(dr)===2&&Math.abs(dc)===1)||(Math.abs(dr)===1&&Math.abs(dc)===2);
    case 'b': return Math.abs(dr)===Math.abs(dc) && !isPathBlocked(bd,fr,fc,tr,tc);
    case 'q': return ((fr===tr||fc===tc)||Math.abs(dr)===Math.abs(dc)) && !isPathBlocked(bd,fr,fc,tr,tc);
    case 'k': return validateKingShape(bd,fr,fc,tr,tc,color,gs);
    default: return false;
  }
}

function isLegalMoveClient(bd, fr, fc, tr, tc, color, gs) {
  if (!isMoveShapeValid(bd,fr,fc,tr,tc,color,gs)) return false;
  const clone = cloneBoard(bd);
  applyMoveClient(clone,fr,fc,tr,tc,gs);
  return !isInCheckClient(clone,color);
}

function getLegalDestinations(bd, fr, fc, color, gs) {
  const dests = [];
  for (let tr = 0; tr < 8; tr++)
    for (let tc = 0; tc < 8; tc++)
      if (isLegalMoveClient(bd,fr,fc,tr,tc,color,gs)) dests.push({row:tr,col:tc});
  return dests;
}

function updateClientCastlingRights(piece, fromRow, fromCol) {
  const p = piece.toLowerCase(), isW = piece===piece.toUpperCase();
  const color = isW ? 'white' : 'black';
  if (p==='k') { clientGameState.castlingRights[color].kingSide=false; clientGameState.castlingRights[color].queenSide=false; }
  if (p==='r') {
    if (fromCol===7) clientGameState.castlingRights[color].kingSide=false;
    if (fromCol===0) clientGameState.castlingRights[color].queenSide=false;
  }
}

// ══════════════════════════════════════════════════════
//  PARTICLES
// ══════════════════════════════════════════════════════
function getThemeAccent() {
  return getComputedStyle(document.body).getPropertyValue('--a').trim() || '#6c8eff';
}
function spawnParticles(container, count=25, colors=null, isPanel=false) {
  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = isPanel ? "particle panel-p" : "particle";
    const sz = 2 + Math.random() * 5;
    const acc = colors ? colors[Math.floor(Math.random()*colors.length)] : getThemeAccent();
    const dur = isPanel ? (4 + Math.random()*8) : (8 + Math.random()*18);
    const delay = Math.random() * dur;
    const left = Math.random() * 100;
    p.style.cssText = `width:${sz}px;height:${sz}px;background:${acc};left:${left}%;animation-duration:${dur}s;animation-delay:-${delay}s;`;
    container.appendChild(p);
  }
}
function initLoadingParticles() { const c=document.querySelector("#screen-loading .bg-canvas"); if(c) spawnParticles(c,30,["#d4a843","#f0c060","#5b8cf5","#4caf82"]); }
function initFloatingPieces() {
  const c=document.getElementById("float-pieces"); if(!c) return; c.innerHTML="";
  for (let i=0;i<12;i++) {
    const el=document.createElement("div"); el.className="float-piece"; el.textContent=FLOATPIECES[i%FLOATPIECES.length];
    const left=5+Math.random()*90,dur=20+Math.random()*30,delay=Math.random()*dur,size=1.5+Math.random()*2;
    el.style.cssText=`left:${left}%;font-size:${size}rem;animation-duration:${dur}s;animation-delay:-${delay}s;`;
    c.appendChild(el);
  }
}
function burst(type) {
  const c=document.getElementById("result-particles"); c.innerHTML="";
  const pal={win:["#d4a843","#f0c060","#fff8cc","#a07820","#4caf82"],lose:["#e05555","#902020","#ff7070","#500010"],draw:["#d4a843","#888","#d4c0a0","#5b8cf5"]}[type]||["#d4a843"];
  for (let i=0;i<80;i++) {
    const el=document.createElement("div");
    const sz=3+Math.random()*9,ang=Math.random()*360,dist=60+Math.random()*250,dur=1+Math.random()*1.8,del=Math.random()*0.8;
    el.style.cssText=`position:absolute;left:50%;top:50%;width:${sz}px;height:${sz}px;background:${pal[~~(Math.random()*pal.length)]};border-radius:${Math.random()>.5?"50%":"3px"};opacity:0;animation:pfly ${dur}s ${del}s ease-out forwards;--tx:${Math.cos(ang*Math.PI/180)*dist}px;--ty:${Math.sin(ang*Math.PI/180)*dist}px;`;
    c.appendChild(el);
  }
  if (!document.getElementById("pfstyle")) {
    const s=document.createElement("style"); s.id="pfstyle";
    s.textContent="@keyframes pfly{0%{opacity:1;transform:translate(-50%,-50%)translate(0,0)rotate(0deg);}100%{opacity:0;transform:translate(-50%,-50%)translate(var(--tx),var(--ty))rotate(720deg);}}";
    document.head.appendChild(s);
  }
}

// ══════════════════════════════════════════════════════
//  AUDIO
// ══════════════════════════════════════════════════════
let audioCtx=null;
function getAudioCtx() { if(!audioCtx) audioCtx=new(window.AudioContext||window.webkitAudioContext)(); return audioCtx; }
function tone(freq,type,dur,vol=0.16) {
  if(!settings.sound) return;
  try { const ctx=getAudioCtx(),o=ctx.createOscillator(),g=ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.type=type; o.frequency.setValueAtTime(freq,ctx.currentTime); g.gain.setValueAtTime(vol,ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+dur); o.start(); o.stop(ctx.currentTime+dur); } catch(e) {}
}
const SFX = {
  click()   { tone(900,"sine",0.07,0.1); },
  select()  { tone(700,"sine",0.1,0.13); },
  move()    { tone(460,"triangle",0.16,0.12); },
  capture() { tone(240,"sawtooth",0.13,0.16); setTimeout(()=>tone(160,"sawtooth",0.08,0.1),50); },
  invalid() { tone(140,"square",0.16,0.09); },
  check()   { [900,1120,1350].forEach((f,i)=>setTimeout(()=>tone(f,"sine",0.25,0.08),i*50)); },
  start()   { [261,329,392,523].forEach((f,i)=>setTimeout(()=>tone(f,"sine",0.4,0.08),i*80)); },
  win()     { [523,659,784,1046,1318].forEach((f,i)=>setTimeout(()=>tone(f,"sine",0.3,0.12),i*100)); },
  lose()    { [523,415,330,261,220].forEach((f,i)=>setTimeout(()=>tone(f,"triangle",0.3,0.1),i*130)); },
  tick()    { tone(1300,"sine",0.03,0.04); },
  hint()    { [660,880].forEach((f,i)=>setTimeout(()=>tone(f,"sine",0.18,0.09),i*80)); },
  undo()    { tone(440,"sine",0.2,0.1); setTimeout(()=>tone(330,"sine",0.15,0.08),100); },
};
function playClick() { SFX.click(); }

// ══════════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════════
function loadSettings() { try { const s=localStorage.getItem("rcV4"); if(s) Object.assign(settings,JSON.parse(s)); } catch(e) {} }
function saveSettings() { try { localStorage.setItem("rcV4",JSON.stringify(settings)); } catch(e) {} }
function applySettings() {
  document.body.setAttribute("data-theme",settings.theme);
  document.querySelectorAll(".tsw").forEach(s=>s.classList.toggle("active",s.dataset.theme===settings.theme));
  document.getElementById("setting-sound").checked=settings.sound;
  document.getElementById("setting-hints").checked=settings.hints;
  showHints=settings.hints;
  const sb=document.getElementById("sound-btn"); if(sb) sb.textContent=settings.sound?"🔊 Sound":"🔇 Sound";
}
function openSettings()  { document.getElementById("settings-overlay").classList.remove("hidden"); document.getElementById("pause-overlay").classList.add("hidden"); }
function closeSettings() { SFX.click(); document.getElementById("settings-overlay").classList.add("hidden"); }
function onSoundToggle(el)  { settings.sound=el.checked; saveSettings(); const sb=document.getElementById("sound-btn"); if(sb) sb.textContent=settings.sound?"🔊 Sound":"🔇 Sound"; if(settings.sound) SFX.click(); }
function onHintsToggle(el)  { settings.hints=el.checked; showHints=settings.hints; saveSettings(); renderBoard(board); }

// setTheme — fixed: no innerHTML wipe, just update attribute + swatches
function setTheme(t) {
  SFX.click();
  settings.theme=t;
  document.body.setAttribute("data-theme",t);
  document.querySelectorAll(".tsw").forEach(s=>s.classList.toggle("active",s.dataset.theme===t));
  saveSettings();
}

function toggleSound() { settings.sound=!settings.sound; document.getElementById("setting-sound").checked=settings.sound; saveSettings(); const sb=document.getElementById("sound-btn"); if(sb) sb.textContent=settings.sound?"🔊 Sound":"🔇 Sound"; if(settings.sound) SFX.click(); }

// ══════════════════════════════════════════════════════
//  UNDO & HINT  (vs Computer only, 2 uses each per game)
// ══════════════════════════════════════════════════════
function resetUndoHint() {
  undosLeft = 2; hintsLeft = 2;
  _updateUndoHintUI();
}

function _updateUndoHintUI() {
  // Sidebar
  const undoBtn  = document.getElementById("undo-btn");
  const hintBtn  = document.getElementById("hint-btn");
  const undoUses = document.getElementById("undo-uses");
  const hintUses = document.getElementById("hint-uses");
  // Mobile
  const undoBtnM = document.getElementById("undo-btn-mobile");
  const hintBtnM = document.getElementById("hint-btn-mobile");

  // Show only in vs-computer games
  const show = isVsComputer && !gameOver;
  [undoBtn, undoBtnM].forEach(b => { if(b) b.style.display = show ? "" : "none"; });
  [hintBtn, hintBtnM].forEach(b => { if(b) b.style.display = show ? "" : "none"; });

  if (undoUses) undoUses.textContent = undosLeft;
  if (hintUses) hintUses.textContent = hintsLeft;

  if (undoBtn)  undoBtn.disabled  = (undosLeft <= 0 || gameOver);
  if (undoBtnM) undoBtnM.disabled = (undosLeft <= 0 || gameOver);
  if (hintBtn)  hintBtn.disabled  = (hintsLeft <= 0 || gameOver);
  if (hintBtnM) hintBtnM.disabled = (hintsLeft <= 0 || gameOver);
}

function doUndo() {
  if (!isVsComputer || undosLeft <= 0 || gameOver) return;
  // Need at least 2 snapshots (player move + AI response)
  if (boardSnapshots.length < 2) return;
  SFX.undo();
  undosLeft--;
  _updateUndoHintUI();
  // Tell the server to roll back 2 moves (player + AI response)
  // Server will reply with undoApplied containing the restored board state
  socket.emit("undoMove", { roomId });
}

function doHint() {
  if (!isVsComputer || hintsLeft <= 0 || gameOver || currentTurn !== myColor) return;
  SFX.hint();
  hintsLeft--;

  // Find piece with most legal moves
  let bestRow = -1, bestCol = -1, bestDests = [];
  let bestCount = -1;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece === ' ') continue;
      const isW = piece === piece.toUpperCase();
      if (myColor==='white' && !isW) continue;
      if (myColor==='black' &&  isW) continue;
      const dests = getLegalDestinations(board, r, c, myColor, clientGameState);
      if (dests.length > bestCount) {
        bestCount = dests.length;
        bestRow = r; bestCol = c;
        bestDests = dests;
      }
    }
  }

  _updateUndoHintUI();
  if (bestRow === -1) return;

  // Build a lookup of all board squares by [row][col]
  const sqMap = {};
  document.querySelectorAll("#board .sq").forEach(sq => {
    const r = +sq.dataset.row, c = +sq.dataset.col;
    if (!sqMap[r]) sqMap[r] = {};
    sqMap[r][c] = sq;
  });

  // Highlight source square (the piece to move)
  const srcSq = sqMap[bestRow] && sqMap[bestRow][bestCol];
  if (srcSq) srcSq.classList.add("hint-sq");

  // Show destination dots/rings on each legal target square
  const hintEls = []; // track injected elements for cleanup
  bestDests.forEach(({row, col}) => {
    const sq = sqMap[row] && sqMap[row][col];
    if (!sq) return;
    const isCapture = board[row][col] && board[row][col] !== ' ';
    if (isCapture) {
      // Capture ring — 4-corner brackets
      sq.classList.add("hint-dest-capture");
      const tl = document.createElement("span"); tl.className = "hdot-tl"; sq.appendChild(tl); hintEls.push({sq, el:tl});
      const tr = document.createElement("span"); tr.className = "hdot-tr"; sq.appendChild(tr); hintEls.push({sq, el:tr});
      const bl = document.createElement("span"); bl.className = "hdot-bl"; sq.appendChild(bl); hintEls.push({sq, el:bl});
      const br = document.createElement("span"); br.className = "hdot-br"; sq.appendChild(br); hintEls.push({sq, el:br});
    } else {
      // Move dot
      const dot = document.createElement("div"); dot.className = "hint-dest-dot"; sq.appendChild(dot);
      hintEls.push({sq, el:dot});
    }
  });

  // Auto-clear after 3 seconds
  setTimeout(() => {
    if (srcSq) srcSq.classList.remove("hint-sq");
    hintEls.forEach(({sq, el}) => {
      el.remove();
      sq.classList.remove("hint-dest-capture");
    });
  }, 3000);
}

// ══════════════════════════════════════════════════════
//  THINKING TIMER
// ══════════════════════════════════════════════════════
function startThinkTimer() {
  if (!isVsComputer || timerMaxSeconds>0 || gameOver || gamePaused) return;
  stopThinkTimer();
  thinkStart=Date.now(); thinkSeconds=0;
  _showThinkTimer(true); _updateThinkDisplay();
  thinkInterval=setInterval(()=>{
    if (gamePaused||gameOver) return;
    thinkSeconds=Math.floor((Date.now()-thinkStart)/1000);
    _updateThinkDisplay();
  },1000);
}
function stopThinkTimer() { if(thinkInterval){clearInterval(thinkInterval);thinkInterval=null;} thinkStart=null; thinkSeconds=0; }
function resetThinkTimer() { stopThinkTimer(); _showThinkTimer(false); }
function _showThinkTimer(visible) {
  const myTimer=document.getElementById("my-timer"); if(myTimer) myTimer.style.display=visible?"flex":"none";
  const myTimerMob=document.getElementById("timer-my-val-mobile"); if(myTimerMob) myTimerMob.style.display=visible?"inline":"none";
}
function _updateThinkDisplay() {
  const s=thinkSeconds;
  const display=Math.floor(s/60)+":"+String(s%60).padStart(2,"0");
  const urgency = s>90 ? " low" : "";
  const barCol = s>90
    ? "linear-gradient(90deg,#902020,#e05555)"
    : s>30
      ? "linear-gradient(90deg,#a07820,#d4a843)"
      : "linear-gradient(90deg,#2d8f5e,#4caf82)";
  const myV=document.getElementById("timer-my-val"); if(myV){ myV.textContent=display; myV.className="sb-ctime active"+urgency; }
  const myB=document.getElementById("timer-my-bar"); if(myB){ myB.style.width=Math.min((s%120)/120*100,100)+"%"; myB.style.background=barCol; }
  const myVm=document.getElementById("timer-my-val-mobile"); if(myVm){ myVm.textContent=display; myVm.className="mob-ptime active"+urgency; }
}

// ══════════════════════════════════════════════════════
//  LOADING
// ══════════════════════════════════════════════════════
function runLoader() {
  const bar=document.getElementById("load-bar"),lbl=document.getElementById("load-label");
  const msgs=["Summoning the pieces…","Polishing the board…","Calibrating the engine…","Almost ready…","Let the game begin…"];
  const steps=[{to:18,m:1,d:320},{to:48,m:2,d:400},{to:72,m:3,d:380},{to:92,m:4,d:420},{to:100,m:-1,d:280}];
  lbl.textContent=msgs[0]; bar.style.width="4%";
  function next(i) { if(i>=steps.length){setTimeout(()=>switchScreen("screen-loading","screen-menu"),160);return;} const s=steps[i]; setTimeout(()=>{bar.style.width=s.to+"%"; if(s.m>=0) lbl.textContent=msgs[s.m]; next(i+1);},s.d); }
  next(0);
}

// ══════════════════════════════════════════════════════
//  SCREENS
// ══════════════════════════════════════════════════════
function switchScreen(from,to) {
  const f=document.getElementById(from),t=document.getElementById(to);
  f.classList.add("exit"); setTimeout(()=>{f.classList.remove("active","exit");t.classList.add("active");},380);
}
function goToMenu() { location.reload(); }

// ══════════════════════════════════════════════════════
//  DECO BOARD
// ══════════════════════════════════════════════════════
function buildDecoBoard() {
  const el=document.getElementById("deco-board"); if(!el) return; el.innerHTML="";
  const layout=[["r","n","b","q","k","b","n","r"],["p","p","p","p","p","p","p","p"],[],[],[],[],["P","P","P","P","P","P","P","P"],["R","N","B","Q","K","B","N","R"]];
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    const sq=document.createElement("div"); sq.className="deco-sq"; sq.style.background=(r+c)%2===0?"#f0d9b5":"#b58863";
    const row=layout[r]; if(row&&row[c]){const span=document.createElement("span");const isW=row[c]===row[c].toUpperCase();span.style.cssText=`color:${isW?"#fff":"#111"};-webkit-text-stroke:${isW?"1.5px #111":"1.5px #ccc"};filter:drop-shadow(0 1px 3px rgba(0,0,0,0.6));`;span.textContent=GLYPHS[row[c]]||"";sq.appendChild(span);}
    el.appendChild(sq);
  }
}

// ══════════════════════════════════════════════════════
//  MENU
// ══════════════════════════════════════════════════════
function showPanel(id) {
  ["menu-main","panel-multiplayer","panel-computer"].forEach(p=>{const el=document.getElementById(p);if(el){el.classList.add("hidden");el.classList.remove("animate-in");}});
  const t=document.getElementById(id); if(t){t.classList.remove("hidden");requestAnimationFrame(()=>t.classList.add("animate-in"));}
}
function setDiff(d) { selectedDiff=d; document.querySelectorAll(".diff-pill").forEach(c=>c.classList.toggle("active",c.dataset.diff===d)); }
function setupTimerBtns(gid) {
  const btns=document.querySelectorAll(`#${gid} .time-pill`);
  btns.forEach(btn=>btn.addEventListener("click",()=>{btns.forEach(b=>b.classList.remove("active"));btn.classList.add("active");timerSeconds=parseInt(btn.dataset.time,10);SFX.click();}));
}

// ══════════════════════════════════════════════════════
//  JOIN
// ══════════════════════════════════════════════════════
function joinRoom() {
  roomId=document.getElementById("room-input").value.trim();
  if(!roomId){alert("Please enter a Room ID");return;}
  isVsComputer=false; socket.emit("joinRoom",{roomId,timerSeconds});
  switchScreen("screen-menu","screen-game"); setMode("Multiplayer"); buildLabels();
}
function joinComputer() {
  isVsComputer=true; socket.emit("joinComputer",{difficulty:selectedDiff,timerSeconds});
  switchScreen("screen-menu","screen-game");
  const names={easy:"vs Squire",medium:"vs Knight",hard:"vs King"}; setMode(names[selectedDiff]); buildLabels();
}
function setMode(txt) { document.getElementById("mode-tag").textContent=txt; document.getElementById("mode-tag-mobile").textContent=txt; }

// ══════════════════════════════════════════════════════
//  PAUSE / RESIGN / DRAW
// ══════════════════════════════════════════════════════
function togglePause() { SFX.click(); gamePaused?resumeGame():pauseGame(); }
function pauseGame() {
  gamePaused=true; stopTimer(); stopThinkTimer();
  document.getElementById("pause-overlay").classList.remove("hidden");
  ["pause-btn","pause-btn-mobile"].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent="▶";});
}
function resumeGame() {
  SFX.click(); gamePaused=false;
  document.getElementById("pause-overlay").classList.add("hidden");
  ["pause-btn","pause-btn-mobile"].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent="⏸";});
  if(timerMaxSeconds>0&&!gameOver) startTimer();
  if(isVsComputer&&timerMaxSeconds===0&&currentTurn===myColor&&!gameOver) startThinkTimer();
}
function confirmResign() { if(gameOver) return; SFX.click(); document.getElementById("resign-overlay").classList.remove("hidden"); }
function closeResign()   { SFX.click(); document.getElementById("resign-overlay").classList.add("hidden"); }
function doResign()      { closeResign(); socket.emit("resign",{roomId}); }
function offerDraw() { if(gameOver||isVsComputer) return; SFX.click(); socket.emit("offerDraw",{roomId}); showBanner("Draw offered — awaiting opponent…","draw-offer"); }
function respondDraw(a)  { SFX.click(); document.getElementById("draw-overlay").classList.add("hidden"); socket.emit("respondDraw",{roomId,accept:a}); }

function showBanner(msg,cls) {
  const sb=document.getElementById("status-banner"); sb.textContent=msg; sb.className="sb-banner "+cls; sb.style.display="block";
  const mb=document.getElementById("status-banner-mobile"); mb.textContent=msg; mb.className="mob-banner "+cls; mb.style.display="block";
}
function hideBanner() { const sb=document.getElementById("status-banner");if(sb)sb.style.display="none"; const mb=document.getElementById("status-banner-mobile");if(mb)mb.style.display="none"; }
function setThinking(val) { document.getElementById("thinking-bar").style.display=val?"flex":"none"; document.getElementById("thinking-bar-mobile").style.display=val?"flex":"none"; }

// ══════════════════════════════════════════════════════
//  TIMER
// ══════════════════════════════════════════════════════
function initTimers(secs) {
  if(!secs) return;
  timerMaxSeconds=secs; timerMyLeft=secs; timerOppLeft=secs;
  document.getElementById("my-timer").style.display="flex";
  document.getElementById("opp-timer").style.display="flex";
  document.getElementById("timer-my-val-mobile").style.display="inline";
  document.getElementById("timer-opp-val-mobile").style.display="inline";
  updateTimerDisplay();
}
function updateTimerDisplay() {
  const mine=currentTurn===myColor;
  const myV=document.getElementById("timer-my-val"),oppV=document.getElementById("timer-opp-val");
  const myB=document.getElementById("timer-my-bar"),oppB=document.getElementById("timer-opp-bar");
  if(myV){myV.textContent=fmt(timerMyLeft);oppV.textContent=fmt(timerOppLeft);}
  if(timerMaxSeconds&&myB){myB.style.width=(timerMyLeft/timerMaxSeconds)*100+"%";oppB.style.width=(timerOppLeft/timerMaxSeconds)*100+"%";}
  if(myV){myV.className="sb-ctime"+(mine?" active":"")+(timerMyLeft<=30?" low":"");oppV.className="sb-ctime"+(!mine?" active":"")+(timerOppLeft<=30?" low":"");}
  const myVm=document.getElementById("timer-my-val-mobile"),oppVm=document.getElementById("timer-opp-val-mobile");
  if(myVm){myVm.textContent=fmt(timerMyLeft);myVm.className="mob-ptime"+(mine?" active":"")+(timerMyLeft<=30?" low":"");}
  if(oppVm){oppVm.textContent=fmt(timerOppLeft);oppVm.className="mob-ptime"+(!mine?" active":"")+(timerOppLeft<=30?" low":"");}
}
function fmt(s) { return Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); }
function startTimer() {
  stopTimer(); if(!timerMaxSeconds||gamePaused||gameOver) return;
  timerInterval=setInterval(()=>{
    if(gamePaused||gameOver) return;
    const mine=currentTurn===myColor;
    if(mine){timerMyLeft=Math.max(0,timerMyLeft-1);if(timerMyLeft<=10)SFX.tick();if(timerMyLeft===0){stopTimer();showResult("timeout-loss");return;}}
    else{timerOppLeft=Math.max(0,timerOppLeft-1);if(timerOppLeft===0){stopTimer();showResult("timeout-win");return;}}
    updateTimerDisplay();
  },1000);
}
function stopTimer() { if(timerInterval){clearInterval(timerInterval);timerInterval=null;} }

// ══════════════════════════════════════════════════════
//  LABELS
// ══════════════════════════════════════════════════════
function buildLabels() {
  const ranks=document.getElementById("rank-labels"),files=document.getElementById("file-labels");
  if(ranks) ranks.innerHTML=""; if(files) files.innerHTML="";
  for(let i=0;i<8;i++){
    if(ranks){const s=document.createElement("span");s.textContent=myColor==="black"?i+1:8-i;ranks.appendChild(s);}
    if(files){const s=document.createElement("span");s.textContent=myColor==="black"?FILES[7-i]:FILES[i];files.appendChild(s);}
  }
}

// ══════════════════════════════════════════════════════
//  BOARD RENDER
// ══════════════════════════════════════════════════════
function renderBoard(bd, overrideCheck) {
  const el=document.getElementById("board"); el.innerHTML="";
  const chk=overrideCheck!==undefined?overrideCheck:checkSquare;
  const rows=myColor==="black"?[...Array(8).keys()].reverse():[...Array(8).keys()];
  const cols=myColor==="black"?[...Array(8).keys()].reverse():[...Array(8).keys()];
  rows.forEach(r=>cols.forEach(c=>{
    const sq=document.createElement("div");
    sq.classList.add("sq",(r+c)%2===0?"light":"dark");
    sq.dataset.row=r; sq.dataset.col=c;
    if(showHints&&lastMove){
      if(r===lastMove.fromRow&&c===lastMove.fromCol) sq.classList.add("last-from");
      if(r===lastMove.toRow&&c===lastMove.toCol)     sq.classList.add("last-to");
    }
    if(selected&&selected.row===r&&selected.col===c) sq.classList.add("selected");
    if(chk&&r===chk.row&&c===chk.col) sq.classList.add("in-check");

    const piece=bd[r][c];
    if(piece&&piece!==" "){
      const span=document.createElement("span");
      span.className="piece "+(piece===piece.toUpperCase()?"white":"black");
      span.textContent=GLYPHS[piece]||piece;
      sq.appendChild(span);
    }
    sq.addEventListener("click",()=>onSquareClick(r,c));
    el.appendChild(sq);
  }));
}

// ══════════════════════════════════════════════════════
//  ANIMATION — shadow + arc lift
// ══════════════════════════════════════════════════════
function animatePieceMove(piece,fromRow,fromCol,toRow,toCol,done) {
  const boardEl=document.getElementById("board"),boardRect=boardEl.getBoundingClientRect(),sqSize=boardRect.width/8;
  const dFromR=myColor==="black"?7-fromRow:fromRow,dFromC=myColor==="black"?7-fromCol:fromCol;
  const dToR=myColor==="black"?7-toRow:toRow,dToC=myColor==="black"?7-toCol:toCol;
  const fx=boardRect.left+dFromC*sqSize,fy=boardRect.top+dFromR*sqSize;
  const tx=boardRect.left+dToC*sqSize,ty=boardRect.top+dToR*sqSize;
  const isWhite=piece===piece.toUpperCase(),glyph=GLYPHS[piece]||piece,DURATION=260;
  const dx=tx-fx,dy=ty-fy;

  // Shadow oval on the board surface
  const shadow=document.createElement("div");
  const sw=sqSize*0.55, sh=sqSize*0.18;
  shadow.style.cssText=[
    "position:fixed",
    `left:${fx+sqSize/2-sw/2}px`,`top:${fy+sqSize*0.78}px`,
    `width:${sw}px`,`height:${sh}px`,
    "background:rgba(0,0,0,0.5)","border-radius:50%",
    "filter:blur(6px)","pointer-events:none","z-index:9997",
    "will-change:transform,opacity"
  ].join(";");
  document.body.appendChild(shadow);

  // Piece filters
  const baseFilter=isWhite
    ?"invert(1) drop-shadow(0 2px 0 rgba(0,0,0,.9)) drop-shadow(0 -1px 0 rgba(0,0,0,.9)) drop-shadow(1px 0 0 rgba(0,0,0,.9)) drop-shadow(-1px 0 0 rgba(0,0,0,.9))"
    :"drop-shadow(0 2px 0 rgba(220,200,160,.85)) drop-shadow(0 -1px 0 rgba(220,200,160,.85)) drop-shadow(1px 0 0 rgba(220,200,160,.85)) drop-shadow(-1px 0 0 rgba(220,200,160,.85))";
  const liftFilter=isWhite
    ?"invert(1) drop-shadow(0 8px 10px rgba(0,0,0,.75)) drop-shadow(0 -1px 0 rgba(0,0,0,.9)) drop-shadow(1px 0 0 rgba(0,0,0,.9)) drop-shadow(-1px 0 0 rgba(0,0,0,.9))"
    :"drop-shadow(0 8px 10px rgba(0,0,0,.7)) drop-shadow(0 -1px 0 rgba(220,200,160,.85)) drop-shadow(1px 0 0 rgba(220,200,160,.85)) drop-shadow(-1px 0 0 rgba(220,200,160,.85))";

  // Flying piece
  const flyer=document.createElement("span");
  flyer.style.cssText=[
    "position:fixed",`left:${fx}px`,`top:${fy}px`,
    `width:${sqSize}px`,`height:${sqSize}px`,`font-size:${sqSize*0.74}px`,
    "line-height:1","text-align:center","display:flex","align-items:center","justify-content:center",
    "pointer-events:none","z-index:9999","color:#000000","-webkit-text-stroke:0",
    `filter:${baseFilter}`,"will-change:transform,filter","transform-origin:center center"
  ].join(";");
  flyer.textContent=glyph;
  document.body.appendChild(flyer);

  // Arc: piece rises above straight line at midpoint
  const arcY=Math.min(sqSize*0.9,Math.sqrt(dx*dx+dy*dy)*0.22);

  // Animate piece with arc
  flyer.animate([
    {transform:"translate(0,0) scale(1)",         filter:baseFilter, offset:0},
    {transform:`translate(${dx*.45}px,${dy*.45-arcY}px) scale(1.22)`,filter:liftFilter,offset:0.4},
    {transform:`translate(${dx}px,${dy}px) scale(1.08)`, filter:liftFilter, offset:0.85},
    {transform:`translate(${dx}px,${dy}px) scale(1)`,    filter:baseFilter, offset:1}
  ],{duration:DURATION,easing:"cubic-bezier(0.22,0.8,0.35,1)",fill:"forwards"});

  // Animate shadow: expands at peak lift, shrinks on land
  const anim=shadow.animate([
    {transform:"translate(0,0) scale(1)",              opacity:0.5,  offset:0},
    {transform:`translate(${dx*.45}px,${dy*.45}px) scale(1.5,0.65)`,opacity:0.22,offset:0.4},
    {transform:`translate(${dx*.85}px,${dy*.85}px) scale(1.2,.8)`,  opacity:0.32,offset:0.85},
    {transform:`translate(${dx}px,${dy}px) scale(1)`, opacity:0.5,  offset:1}
  ],{duration:DURATION,easing:"cubic-bezier(0.22,0.8,0.35,1)",fill:"forwards"});

  anim.onfinish=()=>{
    flyer.remove(); shadow.remove(); done();
    document.querySelectorAll("#board .sq").forEach(sq=>{
      if(+sq.dataset.row===toRow&&+sq.dataset.col===toCol){
        sq.classList.add("piece-landing");
        setTimeout(()=>sq.classList.remove("piece-landing"),300);
      }
    });
  };
}

// ══════════════════════════════════════════════════════
//  SQUARE CLICK
// ══════════════════════════════════════════════════════
function onSquareClick(row, col) {
  if(!myColor||currentTurn!==myColor||gamePaused||gameOver||isViewingHistory) return;
  const piece=board[row][col];
  if(selected){
    if(selected.row===row&&selected.col===col){ selected=null;legalMovesCache=[];renderBoard(board);return; }
    if(piece&&piece!==' '){
      const isW=piece===piece.toUpperCase();
      const isOwn=(myColor==='white'&&isW)||(myColor==='black'&&!isW);
      if(isOwn){ SFX.select(); selected={row,col}; legalMovesCache=[]; renderBoard(board); return; }
    }
    const fromRow=selected.row,fromCol=selected.col;
    const isCapture=piece&&piece!==" ";
    if(isCapture)SFX.capture();else SFX.move();
    if(timerMaxSeconds>0) stopTimer();
    stopThinkTimer(); resetThinkTimer();
    selected=null; legalMovesCache=[];
    socket.emit("makeMove",{roomId,fromRow,fromCol,toRow:row,toCol:col});
  } else {
    if(!piece||piece===" ") return;
    if(myColor==="white"&&piece!==piece.toUpperCase()) return;
    if(myColor==="black"&&piece===piece.toUpperCase()) return;
    SFX.select(); selected={row,col};
    legalMovesCache=[];
    renderBoard(board);
  }
}

// ══════════════════════════════════════════════════════
//  PROMOTION
// ══════════════════════════════════════════════════════
function showPromo(fromRow,fromCol,toRow,toCol) {
  pendingPromo={fromRow,fromCol,toRow,toCol};
  const isW=myColor==="white";
  const opts=isW?[{k:"Q",g:"♛",n:"Queen"},{k:"R",g:"♜",n:"Rook"},{k:"B",g:"♝",n:"Bishop"},{k:"N",g:"♞",n:"Knight"}]:[{k:"q",g:"♛",n:"Queen"},{k:"r",g:"♜",n:"Rook"},{k:"b",g:"♝",n:"Bishop"},{k:"n",g:"♞",n:"Knight"}];
  const c=document.getElementById("promo-pieces"); c.innerHTML="";
  opts.forEach(p=>{
    const btn=document.createElement("button"); btn.className="promo-btn";
    btn.innerHTML=`<span class="piece ${isW?"white":"black"}" style="font-size:2rem;width:auto;height:auto">${p.g}</span><em>${p.n}</em>`;
    btn.onclick=()=>{
      document.getElementById("promo-overlay").classList.add("hidden");
      if(!pendingPromo) return;
      const{fromRow,fromCol,toRow,toCol}=pendingPromo; pendingPromo=null;
      SFX.move(); if(timerMaxSeconds>0) stopTimer(); stopThinkTimer(); resetThinkTimer();
      socket.emit("makeMove",{roomId,fromRow,fromCol,toRow,toCol,promotion:p.k});
    };
    c.appendChild(btn);
  });
  document.getElementById("promo-overlay").classList.remove("hidden");
}

// ══════════════════════════════════════════════════════
//  TURN + ACTIVE CARD
// ══════════════════════════════════════════════════════
function updateTurnIndicators(turn,winner,status) {
  const myDm=document.getElementById("my-dot-mobile"),oppDm=document.getElementById("opp-dot-mobile");
  if(myDm) myDm.className="mob-dot"; if(oppDm) oppDm.className="mob-dot";
  if(winner||gameOver) return;
  const mine=turn===myColor;
  if(myDm){if(mine)myDm.classList.add(status==="check"?"in-check":"active");else oppDm.classList.add("active");}
}
function updateActiveCard(turn) {
  document.getElementById("my-card").classList.toggle("active-player",turn===myColor);
  document.getElementById("opponent-card").classList.toggle("active-player",turn!==myColor);
  document.getElementById("my-row").classList.toggle("active-player",turn===myColor);
  document.getElementById("opponent-row").classList.toggle("active-player",turn!==myColor);
}
function setupPlayerCards() {
  const oppColor=myColor==="white"?"black":"white";
  const myAv=document.getElementById("my-avatar"),oppAv=document.getElementById("opp-avatar");
  myAv.textContent=myColor==="white"?"♔":"♚"; myAv.className="sb-avatar "+(myColor==="white"?"white-av":"black-av");
  document.getElementById("my-color-label").textContent=myColor==="white"?"White Pieces":"Black Pieces";
  oppAv.textContent=oppColor==="white"?"♔":"♚"; oppAv.className="sb-avatar "+(oppColor==="white"?"white-av":"black-av");
  document.getElementById("opp-color-label").textContent=oppColor==="white"?"White Pieces":"Black Pieces";
  document.getElementById("opp-name").textContent=isVsComputer?"AI Engine":"Opponent";
  const myAvm=document.getElementById("my-avatar-mobile"),oppAvm=document.getElementById("opp-avatar-mobile");
  myAvm.textContent=myColor==="white"?"♔":"♚"; myAvm.className="mob-av "+(myColor==="white"?"white-av":"black-av");
  document.getElementById("my-label-mobile").textContent=myColor==="white"?"White Pieces":"Black Pieces";
  oppAvm.textContent=oppColor==="white"?"♔":"♚"; oppAvm.className="mob-av "+(oppColor==="white"?"white-av":"black-av");
  document.getElementById("opp-label-mobile").textContent=oppColor==="white"?"White Pieces":"Black Pieces";
  document.getElementById("opp-name-mobile").textContent=isVsComputer?"AI Engine":"Opponent";
}

const PIECE_VAL = {P:1,p:1,N:3,n:3,B:3,b:3,R:5,r:5,Q:9,q:9,K:0,k:0};
function _renderCaptured(containerId, pieces) {
  const el = document.getElementById(containerId); if (!el) return;
  el.innerHTML = "";
  if (!pieces.length) return;
  const order = {Q:0,q:0,R:1,r:1,B:2,b:2,N:3,n:3,P:4,p:4};
  const sorted = [...pieces].sort((a,b)=>(order[a]??9)-(order[b]??9));
  let score = 0;
  sorted.forEach(p=>{
    const span=document.createElement("span");
    const isW=p===p.toUpperCase();
    span.className="cap-piece "+(isW?"white-cap":"black-cap");
    span.textContent=GLYPHS[p]||""; span.title=p.toUpperCase();
    el.appendChild(span); score += PIECE_VAL[p]||0;
  });
  if (score > 0) {
    const sc = document.createElement("span"); sc.className="cap-score"; sc.textContent="+"+score; el.appendChild(sc);
  }
}
const _capBuckets = {"captured-me":[],"captured-opp":[],"captured-me-mobile":[],"captured-opp-mobile":[]};
function addCapturedPiece(piece) {
  const isW=piece===piece.toUpperCase();
  const byMe=(isW&&myColor==="black")||(!isW&&myColor==="white");
  const meId=byMe?"captured-me":"captured-opp", meIdM=byMe?"captured-me-mobile":"captured-opp-mobile";
  _capBuckets[meId].push(piece); _capBuckets[meIdM].push(piece);
  _renderCaptured(meId,_capBuckets[meId]); _renderCaptured(meIdM,_capBuckets[meIdM]);
}
function resetCapturedPieces() {
  Object.keys(_capBuckets).forEach(k=>{_capBuckets[k]=[];});
  Object.keys(_capBuckets).forEach(k=>{const el=document.getElementById(k);if(el)el.innerHTML="";});
}

function updateGameActButtons() {
  // Draw: multiplayer only
  ["draw-btn","draw-btn-mobile"].forEach(id=>{
    const e=document.getElementById(id); if(!e) return;
    if(isVsComputer){ e.style.display="none"; }
    else { e.style.display=""; e.disabled=gameOver; }
  });
  // Undo/Hint: vs computer only
  _updateUndoHintUI();
}

// ══════════════════════════════════════════════════════
//  RESULT
// ══════════════════════════════════════════════════════
function showResult(winner,status) {
  gameOver=true; stopTimer(); stopThinkTimer(); resetThinkTimer(); updateGameActButtons(); legalMovesCache=[]; selected=null;
  const icon=document.getElementById("result-icon"),vr=document.getElementById("result-verdict"),sub=document.getElementById("result-subtitle");
  document.getElementById("stat-moves").textContent=totalMoves;
  document.getElementById("stat-color").textContent=myColor?myColor.charAt(0).toUpperCase()+myColor.slice(1):"—";
  const won=winner===myColor;
  if(winner==="timeout-win"){icon.textContent="⏱";vr.textContent="Victory";vr.className="result-verdict win";sub.textContent="Opponent ran out of time!";SFX.win();burst("win");}
  else if(winner==="timeout-loss"){icon.textContent="⏱";vr.textContent="Defeat";vr.className="result-verdict lose";sub.textContent="You ran out of time.";SFX.lose();burst("lose");}
  else if(winner==="draw"||status==="stalemate"||status==="draw"){icon.textContent="½";vr.textContent=status==="stalemate"?"Stalemate":"Draw";vr.className="result-verdict draw";sub.textContent=status==="stalemate"?"No legal moves — stalemate.":"The game is drawn.";burst("draw");}
  else if(status==="resigned"){icon.textContent=won?"🏆":"⚑";vr.textContent=won?"Victory":"Defeat";vr.className="result-verdict "+(won?"win":"lose");sub.textContent=won?"Opponent resigned.":"You resigned.";won?SFX.win():SFX.lose();burst(won?"win":"lose");}
  else if(status==="checkmate"){icon.textContent=won?"♔":"☠";vr.textContent=won?"Checkmate!":"Defeated";vr.className="result-verdict "+(won?"win":"lose");sub.textContent=won?"You delivered checkmate!":isVsComputer?"Engine checkmated you.":"Your king has fallen.";won?SFX.win():SFX.lose();burst(won?"win":"lose");}
  else if(won){icon.textContent="♔";vr.textContent="Victory";vr.className="result-verdict win";sub.textContent=isVsComputer?"You outplayed the engine!":"You captured the enemy king!";SFX.win();burst("win");}
  else{icon.textContent="☠";vr.textContent="Defeat";vr.className="result-verdict lose";sub.textContent=isVsComputer?"The engine prevailed.":"Your king has fallen.";SFX.lose();burst("lose");}
  setTimeout(()=>switchScreen("screen-game","screen-result"),900);
}

// ══════════════════════════════════════════════════════
//  SOCKET EVENTS
// ══════════════════════════════════════════════════════
socket.on("playerAssigned",({color,roomId:rid})=>{
  myColor=color; roomId=rid||roomId;
  document.getElementById("my-color-label").textContent=color==="white"?"White Pieces":"Black Pieces";
  document.getElementById("my-label-mobile").textContent=color==="white"?"White Pieces":"Black Pieces";
  buildLabels();
});
socket.on("waiting",()=>setMode("Waiting…"));
socket.on("gameStart",({board:bd,turn,vsComputer:cpu,timerSeconds:ts})=>{
  board=bd; currentTurn=turn; isVsComputer=!!cpu;
  clientGameState={castlingRights:{white:{kingSide:true,queenSide:true},black:{kingSide:true,queenSide:true}},enPassant:null};
  resetCapturedPieces();
  resetUndoHint(); // reset undo/hint counters every new game
  setupPlayerCards(); renderBoard(bd); updateTurnIndicators(turn,null,null); updateActiveCard(turn); updateGameActButtons(); SFX.start();
  if(ts&&ts>0){timerSeconds=ts;initTimers(ts);startTimer();}
  if(isVsComputer&&(!ts||ts===0)&&turn===myColor) startThinkTimer();
});
socket.on("boardUpdate",({board:bd,turn,winner,moveCount,lastMove:lm,isComputerMove,status,checkSquare:cs,resigned})=>{
  const movedPiece=lm?board[lm.fromRow][lm.fromCol]:null;
  const capturedPiece=lm&&board[lm.toRow][lm.toCol]&&board[lm.toRow][lm.toCol]!==' '?board[lm.toRow][lm.toCol]:null;
  board=bd; currentTurn=turn; lastMove=lm; selected=null; legalMovesCache=[];
  totalMoves=moveCount||totalMoves+1; checkSquare=cs||null;
  if(capturedPiece) addCapturedPiece(capturedPiece);
  if(lm&&lm.piece){
    updateClientCastlingRights(lm.piece,lm.fromRow,lm.fromCol);
    const mp=lm.piece.toLowerCase();
    if(mp==='p'&&Math.abs(lm.toRow-lm.fromRow)===2) clientGameState.enPassant={row:(lm.fromRow+lm.toRow)/2,col:lm.fromCol};
    else clientGameState.enPassant=null;
  } else { clientGameState.enPassant=null; }
  recordSnapshot(bd,lm,cs);
  if(!isViewingHistory){
    const isMyOwnMove=!isComputerMove&&turn===myColor;
    if(lm&&movedPiece&&!winner&&!isMyOwnMove){
      const intermediate=bd.map(r=>[...r]);
      intermediate[lm.fromRow][lm.fromCol]=movedPiece; intermediate[lm.toRow][lm.toCol]=' ';
      renderBoard(intermediate);
      animatePieceMove(movedPiece,lm.fromRow,lm.fromCol,lm.toRow,lm.toCol,()=>{
        renderBoard(bd); if(status==="check"){showBanner("⚠ Check! Your king is under attack","check");SFX.check();}
      });
    } else {
      renderBoard(bd); if(status==="check"){showBanner("⚠ Check! Your king is under attack","check");SFX.check();}
    }
  }
  updateTurnIndicators(turn,winner,status); updateActiveCard(turn);
  if(isComputerMove) SFX.move();
  hideBanner();
  if(isVsComputer&&timerMaxSeconds===0){
    if(turn===myColor&&!winner&&!gamePaused) startThinkTimer();
    else { stopThinkTimer(); if(!winner) resetThinkTimer(); }
  }
  if(timerMaxSeconds>0&&!winner&&!gamePaused){stopTimer();startTimer();updateTimerDisplay();}
  if(winner||status==="checkmate"||status==="stalemate"||status==="draw"||resigned) showResult(winner,status);
});
socket.on("promotionRequired",({fromRow,fromCol,toRow,toCol})=>showPromo(fromRow,fromCol,toRow,toCol));
socket.on("drawOffered",({by})=>{if(by!==myColor)document.getElementById("draw-overlay").classList.remove("hidden");});
socket.on("drawDeclined",()=>{hideBanner();showBanner("Draw offer declined","check");setTimeout(hideBanner,2500);});
socket.on("computerThinking",({thinking})=>setThinking(thinking));
socket.on("invalidMove",({message})=>{SFX.invalid();selected=null;legalMovesCache=[];renderBoard(board);showBanner("⚠ "+message,"check");setTimeout(hideBanner,1800);});
socket.on("playerLeft",({message})=>{
  stopTimer();stopThinkTimer();resetThinkTimer();
  document.getElementById("result-icon").textContent="🚪";
  document.getElementById("result-verdict").textContent="Disconnected";
  document.getElementById("result-verdict").className="result-verdict draw";
  document.getElementById("result-subtitle").textContent=message;
  document.getElementById("stat-moves").textContent=totalMoves;
  document.getElementById("stat-color").textContent=myColor||"—";
  burst("draw"); setTimeout(()=>switchScreen("screen-game","screen-result"),400);
});
socket.on("roomFull",({message})=>{switchScreen("screen-game","screen-menu");showPanel("panel-multiplayer");alert(message);});

// Server confirmed undo — restore the board it sends back
socket.on("undoApplied",({board:bd, gameState:gs, lastMove:lm})=>{
  // Remove last 2 client snapshots (AI + player moves)
  // Remove the last 2 snapshots (player move + AI response)
  const toRemove = Math.min(2, boardSnapshots.length);
  if (toRemove > 0) boardSnapshots.splice(boardSnapshots.length - toRemove, toRemove);
  // Restore board and game state from server truth
  board = bd;
  currentTurn = myColor;
  lastMove = lm || null;
  checkSquare = null;
  selected = null; legalMovesCache = [];
  // Restore client-side castling/enPassant to match server
  if (gs) {
    clientGameState.castlingRights = {
      white:{...gs.castlingRights.white},
      black:{...gs.castlingRights.black}
    };
    clientGameState.enPassant = gs.enPassant ? {...gs.enPassant} : null;
  }
  renderBoard(board);
  hideBanner();
  updateActiveCard(currentTurn);
  updateTurnIndicators(currentTurn, null, null);
});

// ══════════════════════════════════════════════════════
//  HISTORY
// ══════════════════════════════════════════════════════
function recordSnapshot(bd,lm,chkSq){
  boardSnapshots.push({
    board:bd.map(r=>[...r]),
    lastMove:lm?{...lm}:null,
    checkSq:chkSq||null,
    gs:{
      castlingRights:{
        white:{...clientGameState.castlingRights.white},
        black:{...clientGameState.castlingRights.black}
      },
      enPassant:clientGameState.enPassant?{...clientGameState.enPassant}:null
    }
  });
}
function historyStep(){}
function historyGoLive(){historyIndex=-1;isViewingHistory=false;document.getElementById("board").classList.remove("viewing-history");renderBoard(board);}
function jumpToSnap(){}

// ══════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════
window.addEventListener("load",()=>{
  loadSettings(); applySettings(); runLoader(); initLoadingParticles(); initFloatingPieces(); buildDecoBoard();
  const menuBg=document.querySelector("#screen-menu .menu-left .bg-canvas");
  if(menuBg) spawnParticles(menuBg,20,["#d4a843","#5b8cf5","#4caf82"]);
  document.getElementById("room-input").addEventListener("keydown",e=>{if(e.key==="Enter")joinRoom();});
  setupTimerBtns("timer-select-mp"); setupTimerBtns("timer-select-cpu");
  const gameBg=document.querySelector("#screen-game .game-bg-canvas");
  if(gameBg) spawnParticles(gameBg,25);
  const menuRightBg=document.querySelector("#screen-menu .menu-right-bg");
  if(menuRightBg) spawnParticles(menuRightBg,30,null,true);
  document.getElementById("settings-overlay").addEventListener("click",function(e){if(e.target===this)closeSettings();});
  document.addEventListener("touchend",e=>{const n=Date.now();if(n-(document._lt||0)<300)e.preventDefault();document._lt=n;},{passive:false});
  ["touchstart","click"].forEach(ev=>document.addEventListener(ev,()=>{try{getAudioCtx().resume();}catch(e){}},{once:true}));
});
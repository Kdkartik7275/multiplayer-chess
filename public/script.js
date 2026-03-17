const socket = io();

// ── STATE ─────────────────────────────────────────────
let myColor='white', board=[], selected=null;
let currentTurn='white', lastMove=null;
let roomId='', isVsComputer=false, selectedDiff='easy';
let totalMoves=0, gamePaused=false, showHints=true, gameOver=false;
let checkSquare=null, pendingPromo=null;
let timerSeconds=0, timerMyLeft=0, timerOppLeft=0, timerInterval=null, timerMaxSeconds=0;
let movePairs=[], moveFlat=[], boardSnapshots=[], historyIndex=-1, isViewingHistory=false;
let settings={ sound:true, hints:true, theme:'classic' };

const GLYPHS={ K:'♚',Q:'♛',R:'♜',B:'♝',N:'♞',P:'♟',k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟' };
const FILES=['a','b','c','d','e','f','g','h'];
const FLOATPIECES=['♟','♞','♝','♜','♛','♚','♙','♘','♗','♖','♕','♔'];

// ══════════════════════════════════════════════════════
//  PARTICLE SYSTEM
// ══════════════════════════════════════════════════════
function spawnParticles(container, count=25, colors=['#d4a843','#f0c060','#a07820']) {
  for(let i=0;i<count;i++){
    const p=document.createElement('div');
    p.className='particle';
    const sz=2+Math.random()*5;
    const col=colors[Math.floor(Math.random()*colors.length)];
    const dur=8+Math.random()*16;
    const delay=Math.random()*dur;
    const left=Math.random()*100;
    p.style.cssText=`width:${sz}px;height:${sz}px;background:${col};left:${left}%;animation-duration:${dur}s;animation-delay:-${delay}s;opacity:${0.3+Math.random()*0.5};`;
    container.appendChild(p);
  }
}

function initLoadingParticles(){
  const c=document.querySelector('#screen-loading .bg-canvas');
  if(c) spawnParticles(c,30,['#d4a843','#f0c060','#5b8cf5','#4caf82']);
}

// Floating chess pieces on menu left panel
function initFloatingPieces(){
  const c=document.getElementById('float-pieces'); if(!c)return;
  c.innerHTML='';
  for(let i=0;i<12;i++){
    const el=document.createElement('div');
    el.className='float-piece';
    el.textContent=FLOATPIECES[i%FLOATPIECES.length];
    const left=5+Math.random()*90;
    const dur=20+Math.random()*30;
    const delay=Math.random()*dur;
    const size=1.5+Math.random()*2;
    el.style.cssText=`left:${left}%;font-size:${size}rem;animation-duration:${dur}s;animation-delay:-${delay}s;`;
    c.appendChild(el);
  }
}

// Result burst particles
function burst(type){
  const c=document.getElementById('result-particles'); c.innerHTML='';
  const palettes={
    win:['#d4a843','#f0c060','#fff8cc','#a07820','#4caf82'],
    lose:['#e05555','#902020','#ff7070','#500010'],
    draw:['#d4a843','#888','#d4c0a0','#5b8cf5'],
  };
  const pal=palettes[type]||palettes.win;
  for(let i=0;i<80;i++){
    const el=document.createElement('div');
    const sz=3+Math.random()*9, ang=Math.random()*360, dist=60+Math.random()*250;
    const dur=1+Math.random()*1.8, del=Math.random()*0.8;
    el.style.cssText=`position:absolute;left:50%;top:50%;width:${sz}px;height:${sz}px;background:${pal[~~(Math.random()*pal.length)]};border-radius:${Math.random()>.5?'50%':'3px'};opacity:0;animation:pfly ${dur}s ${del}s ease-out forwards;--tx:${Math.cos(ang*Math.PI/180)*dist}px;--ty:${Math.sin(ang*Math.PI/180)*dist}px;`;
    c.appendChild(el);
  }
  if(!document.getElementById('pfstyle')){
    const s=document.createElement('style');s.id='pfstyle';
    s.textContent='@keyframes pfly{0%{opacity:1;transform:translate(-50%,-50%) translate(0,0) rotate(0deg);}100%{opacity:0;transform:translate(-50%,-50%) translate(var(--tx),var(--ty)) rotate(720deg);}}';
    document.head.appendChild(s);
  }
}

// ══════════════════════════════════════════════════════
//  AUDIO
// ══════════════════════════════════════════════════════
let audioCtx=null;
function getAudioCtx(){ if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)(); return audioCtx; }
function tone(freq,type,dur,vol=0.16){
  if(!settings.sound)return;
  try{ const ctx=getAudioCtx(),o=ctx.createOscillator(),g=ctx.createGain(); o.connect(g);g.connect(ctx.destination); o.type=type;o.frequency.setValueAtTime(freq,ctx.currentTime); g.gain.setValueAtTime(vol,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+dur); o.start();o.stop(ctx.currentTime+dur); }catch(e){}
}
const SFX={
  click()   { tone(900,'sine',0.07,0.1); },
  select()  { tone(700,'sine',0.1,0.13); },
  move()    { tone(460,'triangle',0.16,0.12); },
  capture() { tone(240,'sawtooth',0.13,0.16); setTimeout(()=>tone(160,'sawtooth',0.08,0.1),50); },
  invalid() { tone(140,'square',0.16,0.09); },
  check()   { [900,1120,1350].forEach((f,i)=>setTimeout(()=>tone(f,'sine',0.25,0.08),i*50)); },
  start()   { [261,329,392,523].forEach((f,i)=>setTimeout(()=>tone(f,'sine',0.4,0.08),i*80)); },
  win()     { [523,659,784,1046,1318].forEach((f,i)=>setTimeout(()=>tone(f,'sine',0.3,0.12),i*100)); },
  lose()    { [523,415,330,261,220].forEach((f,i)=>setTimeout(()=>tone(f,'triangle',0.3,0.1),i*130)); },
  tick()    { tone(1300,'sine',0.03,0.04); },
};
function playClick(){ SFX.click(); }

// ══════════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════════
function loadSettings(){ try{ const s=localStorage.getItem('rcV4'); if(s)Object.assign(settings,JSON.parse(s)); }catch(e){} }
function saveSettings(){ try{ localStorage.setItem('rcV4',JSON.stringify(settings)); }catch(e){} }
function applySettings(){
  document.body.setAttribute('data-theme',settings.theme);
  document.querySelectorAll('.tsw').forEach(s=>s.classList.toggle('active',s.dataset.theme===settings.theme));
  document.getElementById('setting-sound').checked=settings.sound;
  document.getElementById('setting-hints').checked=settings.hints;
  showHints=settings.hints;
  const sb=document.getElementById('sound-btn'); if(sb)sb.textContent=settings.sound?'🔊 Sound':'🔇 Sound';
}
function openSettings()  { document.getElementById('settings-overlay').classList.remove('hidden'); document.getElementById('pause-overlay').classList.add('hidden'); }
function closeSettings() { SFX.click(); document.getElementById('settings-overlay').classList.add('hidden'); }
function onSoundToggle(el){ settings.sound=el.checked; saveSettings(); const sb=document.getElementById('sound-btn');if(sb)sb.textContent=settings.sound?'🔊 Sound':'🔇 Sound'; if(settings.sound)SFX.click(); }
function onHintsToggle(el){ settings.hints=el.checked; showHints=settings.hints; saveSettings(); renderBoard(board); }
function setTheme(t){ SFX.click(); settings.theme=t; document.body.setAttribute('data-theme',t); document.querySelectorAll('.tsw').forEach(s=>s.classList.toggle('active',s.dataset.theme===t)); saveSettings(); }
function toggleSound(){ settings.sound=!settings.sound; document.getElementById('setting-sound').checked=settings.sound; saveSettings(); const sb=document.getElementById('sound-btn');if(sb)sb.textContent=settings.sound?'🔊 Sound':'🔇 Sound'; if(settings.sound)SFX.click(); }

// ══════════════════════════════════════════════════════
//  LOADING
// ══════════════════════════════════════════════════════
function runLoader(){
  const bar=document.getElementById('load-bar'),lbl=document.getElementById('load-label');
  const msgs=['Summoning the pieces…','Polishing the board…','Calibrating the engine…','Almost ready…','Let the game begin…'];
  const steps=[{to:18,m:1,d:320},{to:48,m:2,d:400},{to:72,m:3,d:380},{to:92,m:4,d:420},{to:100,m:-1,d:280}];
  lbl.textContent=msgs[0]; bar.style.width='4%';
  function next(i){ if(i>=steps.length){setTimeout(()=>switchScreen('screen-loading','screen-menu'),160);return;} const s=steps[i]; setTimeout(()=>{bar.style.width=s.to+'%'; if(s.m>=0)lbl.textContent=msgs[s.m]; next(i+1);},s.d); }
  next(0);
}

// ══════════════════════════════════════════════════════
//  SCREENS
// ══════════════════════════════════════════════════════
function switchScreen(from,to){
  const f=document.getElementById(from),t=document.getElementById(to);
  f.classList.add('exit'); setTimeout(()=>{ f.classList.remove('active','exit'); t.classList.add('active'); },380);
}
function goToMenu(){ location.reload(); }

// ══════════════════════════════════════════════════════
//  DECO BOARD
// ══════════════════════════════════════════════════════
function buildDecoBoard(){
  const el=document.getElementById('deco-board'); if(!el)return;
  el.innerHTML='';
  const layout=[['r','n','b','q','k','b','n','r'],['p','p','p','p','p','p','p','p'],[],[],[],[],['P','P','P','P','P','P','P','P'],['R','N','B','Q','K','B','N','R']];
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    const sq=document.createElement('div'); sq.className='deco-sq';
    const isLight=(r+c)%2===0;
    sq.style.background=isLight?'#f0d9b5':'#b58863';
    const row=layout[r];
    if(row&&row[c]){
      const span=document.createElement('span');
      const isW=row[c]===row[c].toUpperCase();
      span.style.cssText=`color:${isW?'#fff':'#111'};-webkit-text-stroke:${isW?'1.5px #111':'1.5px #ccc'};filter:drop-shadow(0 1px 3px rgba(0,0,0,0.6));`;
      span.textContent=GLYPHS[row[c]]||'';
      sq.appendChild(span);
    }
    el.appendChild(sq);
  }
}

// ══════════════════════════════════════════════════════
//  MENU
// ══════════════════════════════════════════════════════
function showPanel(id){
  ['menu-main','panel-multiplayer','panel-computer'].forEach(p=>{ const el=document.getElementById(p); if(el){el.classList.add('hidden');el.classList.remove('animate-in');} });
  const t=document.getElementById(id); if(t){t.classList.remove('hidden'); requestAnimationFrame(()=>t.classList.add('animate-in'));}
}
function setDiff(d){ selectedDiff=d; document.querySelectorAll('.diff-pill').forEach(c=>c.classList.toggle('active',c.dataset.diff===d)); }
function setupTimerBtns(gid){ const btns=document.querySelectorAll(`#${gid} .time-pill`); btns.forEach(btn=>btn.addEventListener('click',()=>{btns.forEach(b=>b.classList.remove('active'));btn.classList.add('active');timerSeconds=parseInt(btn.dataset.time,10);SFX.click();})); }

// ══════════════════════════════════════════════════════
//  JOIN
// ══════════════════════════════════════════════════════
function joinRoom(){
  roomId=document.getElementById('room-input').value.trim();
  if(!roomId){alert('Please enter a Room ID');return;}
  isVsComputer=false;
  socket.emit('joinRoom',{roomId,timerSeconds});
  switchScreen('screen-menu','screen-game');
  document.getElementById('mode-tag').textContent='Multiplayer';
  document.getElementById('engine-info').style.display='none';
  buildLabels();
}
function joinComputer(){
  isVsComputer=true;
  socket.emit('joinComputer',{difficulty:selectedDiff,timerSeconds});
  switchScreen('screen-menu','screen-game');
  const names={easy:'Squire',medium:'Knight',hard:'King'};
  document.getElementById('mode-tag').textContent=`vs ${names[selectedDiff]}`;
  document.getElementById('engine-info').style.display='flex';
  document.getElementById('engine-depth').textContent={easy:'Depth 1 · Casual',medium:'Depth 2 · Balanced',hard:'Depth 3 · Ruthless'}[selectedDiff];
  buildLabels();
}

// ══════════════════════════════════════════════════════
//  PAUSE / RESIGN / DRAW
// ══════════════════════════════════════════════════════
function togglePause(){ SFX.click(); gamePaused?resumeGame():pauseGame(); }
function pauseGame()  { gamePaused=true; stopTimer(); document.getElementById('pause-overlay').classList.remove('hidden'); document.getElementById('pause-btn').textContent='▶'; }
function resumeGame() { SFX.click(); gamePaused=false; document.getElementById('pause-overlay').classList.add('hidden'); document.getElementById('pause-btn').textContent='⏸'; if(timerMaxSeconds>0&&!gameOver)startTimer(); }
function confirmResign(){ if(gameOver)return; SFX.click(); document.getElementById('resign-overlay').classList.remove('hidden'); }
function closeResign()  { SFX.click(); document.getElementById('resign-overlay').classList.add('hidden'); }
function doResign()     { closeResign(); socket.emit('resign',{roomId}); }
function offerDraw(){ if(gameOver||isVsComputer)return; SFX.click(); socket.emit('offerDraw',{roomId}); showBanner('Draw offered — awaiting opponent…','draw-offer'); }
function respondDraw(a){ SFX.click(); document.getElementById('draw-overlay').classList.add('hidden'); socket.emit('respondDraw',{roomId,accept:a}); }
function showBanner(msg,cls){ const b=document.getElementById('status-banner'); b.textContent=msg; b.className='status-banner '+cls; b.style.display='block'; }
function hideBanner()       { const b=document.getElementById('status-banner'); if(b)b.style.display='none'; }

// ══════════════════════════════════════════════════════
//  TIMER
// ══════════════════════════════════════════════════════
function initTimers(secs){
  if(!secs)return; timerMaxSeconds=secs; timerMyLeft=secs; timerOppLeft=secs;
  document.getElementById('my-timer').style.display='flex';
  document.getElementById('opp-timer').style.display='flex';
  updateTimerDisplay();
}
function updateTimerDisplay(){
  const myV=document.getElementById('timer-my-val'),oppV=document.getElementById('timer-opp-val');
  const myB=document.getElementById('timer-my-bar'),oppB=document.getElementById('timer-opp-bar');
  myV.textContent=fmt(timerMyLeft); oppV.textContent=fmt(timerOppLeft);
  if(timerMaxSeconds){ myB.style.width=((timerMyLeft/timerMaxSeconds)*100)+'%'; oppB.style.width=((timerOppLeft/timerMaxSeconds)*100)+'%'; }
  const mine=currentTurn===myColor;
  myV.className='pc-time'+(mine?' active':'')+(timerMyLeft<=30?' low':'');
  oppV.className='pc-time'+(!mine?' active':'')+(timerOppLeft<=30?' low':'');
}
function fmt(s){ return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
function startTimer(){
  stopTimer(); if(!timerMaxSeconds||gamePaused||gameOver)return;
  timerInterval=setInterval(()=>{
    if(gamePaused||gameOver)return;
    const mine=currentTurn===myColor;
    if(mine){ timerMyLeft=Math.max(0,timerMyLeft-1); if(timerMyLeft<=10)SFX.tick(); if(timerMyLeft===0){stopTimer();showResult('timeout-loss');return;} }
    else    { timerOppLeft=Math.max(0,timerOppLeft-1); if(timerOppLeft===0){stopTimer();showResult('timeout-win');return;} }
    updateTimerDisplay();
  },1000);
}
function stopTimer(){ if(timerInterval){clearInterval(timerInterval);timerInterval=null;} }

// ══════════════════════════════════════════════════════
//  BOARD RENDER + PIECE ANIMATION
// ══════════════════════════════════════════════════════
function buildLabels(){
  const ranks=document.getElementById('rank-labels'),files=document.getElementById('file-labels');
  ranks.innerHTML=files.innerHTML='';
  for(let i=0;i<8;i++){const s=document.createElement('span');s.textContent=myColor==='black'?i+1:8-i;ranks.appendChild(s);}
  for(let i=0;i<8;i++){const s=document.createElement('span');s.textContent=myColor==='black'?FILES[7-i]:FILES[i];files.appendChild(s);}
}

/* Render the board statically (no animation) */
function renderBoard(bd, overrideCheck){
  const el=document.getElementById('board'); el.innerHTML='';
  const chk=overrideCheck!==undefined?overrideCheck:checkSquare;
  const rows=myColor==='black'?[...Array(8).keys()].reverse():[...Array(8).keys()];
  const cols=myColor==='black'?[...Array(8).keys()].reverse():[...Array(8).keys()];
  rows.forEach(r=>cols.forEach(c=>{
    const sq=document.createElement('div');
    sq.classList.add('sq',(r+c)%2===0?'light':'dark');
    sq.dataset.row=r; sq.dataset.col=c;
    if(showHints&&lastMove){
      if(r===lastMove.fromRow&&c===lastMove.fromCol)sq.classList.add('last-from');
      if(r===lastMove.toRow  &&c===lastMove.toCol)  sq.classList.add('last-to');
    }
    if(selected&&selected.row===r&&selected.col===c)sq.classList.add('selected');
    if(chk&&r===chk.row&&c===chk.col)sq.classList.add('in-check');
    const piece=bd[r][c];
    if(piece&&piece!==' '){
      const span=document.createElement('span');
      span.className='piece '+(piece===piece.toUpperCase()?'white':'black');
      span.textContent=GLYPHS[piece]||piece;
      sq.appendChild(span);
    }
    sq.addEventListener('click',()=>onSquareClick(r,c));
    el.appendChild(sq);
  }));
}

/* ─── PIECE ANIMATION ─────────────────────────────────────────
   Strategy: inject a unique @keyframes per move with exact pixel
   values baked in, then apply it with animation (not transition).
   iOS Safari always runs @keyframes — it never skips them.
   The flyer sits at position:fixed over the from-square at z:9999.
────────────────────────────────────────────────────────────── */

let _animId = 0; // unique id per animation to avoid keyframe name collisions

function animatePieceMove(piece, fromRow, fromCol, toRow, toCol, done) {
  const boardEl = document.getElementById('board');
  const boardRect = boardEl.getBoundingClientRect();
  const sq = boardRect.width / 8;

  // Display coords (account for board flip)
  const dFromR = myColor === 'black' ? (7 - fromRow) : fromRow;
  const dFromC = myColor === 'black' ? (7 - fromCol) : fromCol;
  const dToR   = myColor === 'black' ? (7 - toRow)   : toRow;
  const dToC   = myColor === 'black' ? (7 - toCol)   : toCol;

  // Absolute pixel positions of each square's top-left
  const fx = boardRect.left + dFromC * sq;
  const fy = boardRect.top  + dFromR * sq;
  const tx = boardRect.left + dToC   * sq;
  const ty = boardRect.top  + dToR   * sq;

  // How far to travel (used as the translate endpoint in @keyframes)
  const dx = tx - fx;
  const dy = ty - fy;

  const isWhite = piece === piece.toUpperCase();
  const id = 'pm' + (++_animId);
  const DURATION = 240; // ms

  // 1. Inject unique @keyframes into a <style> tag
  const styleEl = document.createElement('style');
  styleEl.id = id + '-style';
  styleEl.textContent = `
    @keyframes ${id} {
      0%   { transform: translate(0px, 0px)        scale(1.22); opacity:1; }
      40%  { transform: translate(${dx*0.5}px, ${dy*0.5}px) scale(1.28); opacity:1; }
      100% { transform: translate(${dx}px, ${dy}px) scale(1.18); opacity:1; }
    }
  `;
  document.head.appendChild(styleEl);

  // 2. Build flyer — sits at FROM square, no transition, only animation
  const flyer = document.createElement('span');
  flyer.textContent = GLYPHS[piece] || piece;

  const filterWhite = `invert(1)`;
  const filterBlack = `none`;

  flyer.style.cssText = `
    position:fixed;
    left:${fx}px; top:${fy}px;
    width:${sq}px; height:${sq}px;
    font-size:${sq * 0.74}px;
    line-height:${sq}px;
    text-align:center;
    display:block;
    pointer-events:none;
    z-index:9999;
    color:#000000;
    will-change:transform;
    filter:${isWhite ? filterWhite : filterBlack};
    animation:${id} ${DURATION}ms cubic-bezier(0.25,0.1,0.25,1.0) forwards;
  `;

  document.body.appendChild(flyer);

  // 3. After animation completes, clean up and call done
  setTimeout(() => {
    flyer.remove();
    styleEl.remove();
    done();
    // Flash landing square
    document.querySelectorAll('#board .sq').forEach(sq => {
      if (+sq.dataset.row === toRow && +sq.dataset.col === toCol) {
        sq.classList.add('piece-landing');
        setTimeout(() => sq.classList.remove('piece-landing'), 300);
      }
    });
  }, DURATION + 30);
}

function onSquareClick(row,col){
  if(!myColor||currentTurn!==myColor||gamePaused||gameOver||isViewingHistory)return;
  const piece=board[row][col];
  if(selected){
    if(selected.row===row&&selected.col===col){selected=null;renderBoard(board);return;}
    const fromRow=selected.row, fromCol=selected.col;
    const isCapture=board[row][col]&&board[row][col]!==' ';
    if(isCapture)SFX.capture();else SFX.move();
    if(timerMaxSeconds>0)stopTimer();

    // // Animate the move locally immediately (optimistic UI)
    // const movingPiece=board[fromRow][fromCol];
    // const intermediate=board.map(r=>[...r]);
    // intermediate[fromRow][fromCol]=' ';
    // intermediate[row][col]=' ';
    // renderBoard(intermediate);
    // animatePieceMove(movingPiece, fromRow, fromCol, row, col, ()=>{
    //   // Board will be corrected when server responds
    // });

    socket.emit('makeMove',{roomId,fromRow,fromCol,toRow:row,toCol:col});
    selected=null;
  } else {
    if(!piece||piece===' ')return;
    if(myColor==='white'&&piece!==piece.toUpperCase())return;
    if(myColor==='black'&&piece===piece.toUpperCase())return;
    SFX.select(); selected={row,col}; renderBoard(board);
  }
}

// ══════════════════════════════════════════════════════
//  PROMOTION
// ══════════════════════════════════════════════════════
function showPromo(fromRow,fromCol,toRow,toCol){
  pendingPromo={fromRow,fromCol,toRow,toCol};
  const isW=myColor==='white';
  const opts=isW
    ?[{k:'Q',g:'♛',n:'Queen'},{k:'R',g:'♜',n:'Rook'},{k:'B',g:'♝',n:'Bishop'},{k:'N',g:'♞',n:'Knight'}]
    :[{k:'q',g:'♛',n:'Queen'},{k:'r',g:'♜',n:'Rook'},{k:'b',g:'♝',n:'Bishop'},{k:'n',g:'♞',n:'Knight'}];
  const c=document.getElementById('promo-pieces'); c.innerHTML='';
  opts.forEach(p=>{
    const btn=document.createElement('button'); btn.className='promo-btn';
    btn.innerHTML=`<span class="piece ${isW?'white':'black'}" style="font-size:2rem;width:auto;height:auto">${p.g}</span><em>${p.n}</em>`;
    btn.onclick=()=>{
      document.getElementById('promo-overlay').classList.add('hidden');
      if(!pendingPromo)return; const {fromRow,fromCol,toRow,toCol}=pendingPromo; pendingPromo=null;
      SFX.move(); if(timerMaxSeconds>0)stopTimer();
      socket.emit('makeMove',{roomId,fromRow,fromCol,toRow,toCol,promotion:p.k});
    };
    c.appendChild(btn);
  });
  document.getElementById('promo-overlay').classList.remove('hidden');
}

// ══════════════════════════════════════════════════════
//  TURN INDICATORS + PLAYER CARDS
// ══════════════════════════════════════════════════════
function updateTurnIndicators(turn,winner,status){
  const myD=document.getElementById('my-turn-dot'), oppD=document.getElementById('opp-turn-dot');
  const myL=document.getElementById('my-turn-label'), oppL=document.getElementById('opp-turn-label');
  [myD,oppD].forEach(d=>d.className='turn-dot'); [myL,oppL].forEach(l=>l.className='');
  if(winner||gameOver)return;
  const mine=turn===myColor;
  if(mine){
    myD.classList.add(status==='check'?'in-check':'active');
    myL.className=status==='check'?'check-label':'active-label';
    myL.textContent=status==='check'?'⚠ CHECK — Your turn!':'Your Turn';
    oppL.textContent=isVsComputer?'Computer':'Opponent';
  } else {
    oppD.classList.add('active'); oppL.className='active-label';
    oppL.textContent=isVsComputer?'Computer thinking…':"Opponent's Turn";
    myL.textContent='Waiting…';
  }
}

function updateActiveCard(turn){
  document.getElementById('my-card').classList.toggle('active-player',turn===myColor);
  document.getElementById('opponent-card').classList.toggle('active-player',turn!==myColor);
}

function setupPlayerCards(){
  const oppColor=myColor==='white'?'black':'white';
  const myAv=document.getElementById('my-avatar'), oppAv=document.getElementById('opp-avatar');
  myAv.textContent=myColor==='white'?'♔':'♚';
  myAv.className='pc-avatar '+(myColor==='white'?'white-av':'black-av');
  document.getElementById('my-color-label').textContent=myColor==='white'?'White Pieces':'Black Pieces';
  oppAv.textContent=oppColor==='white'?'♔':'♚';
  oppAv.className='pc-avatar '+(oppColor==='white'?'white-av':'black-av');
  document.getElementById('opp-color-label').textContent=oppColor==='white'?'White Pieces':'Black Pieces';
  document.getElementById('opp-name').textContent=isVsComputer?'AI Engine':'Opponent';
}

function addCapturedPiece(piece){
  const isW=piece===piece.toUpperCase();
  const byMe=(isW&&myColor==='black')||(!isW&&myColor==='white');
  const containerId=byMe?'captured-me':'captured-opp';
  const span=document.createElement('span');
  span.className='cap-piece '+(isW?'white-cap':'black-cap');
  span.textContent=GLYPHS[piece]||'';
  document.getElementById(containerId).appendChild(span);
}

// ══════════════════════════════════════════════════════
//  MOVE LIST (numbered pairs, chess.com style)
// ══════════════════════════════════════════════════════
function addMoveToList(str,color){
  const list=document.getElementById('move-list');
  if(color==='white'){
    const num=movePairs.length+1;
    const row=document.createElement('div'); row.className='move-pair'; row.id=`pair-${num}`;
    const numEl=document.createElement('div'); numEl.className='move-num'; numEl.textContent=num+'.';
    const wC=document.createElement('div'); wC.className='move-cell white-cell'; wC.id=`m-w-${num}`; wC.textContent=str; wC.onclick=()=>jumpByCell('w',num);
    const bC=document.createElement('div'); bC.className='move-cell black-cell'; bC.id=`m-b-${num}`; bC.textContent=''; bC.onclick=()=>jumpByCell('b',num);
    row.append(numEl,wC,bC); list.appendChild(row);
    movePairs.push({white:str,black:null,num});
  } else if(movePairs.length>0){
    const last=movePairs[movePairs.length-1]; last.black=str;
    const bC=document.getElementById(`m-b-${last.num}`); if(bC)bC.textContent=str;
  }
  const pairIdx=movePairs.length-1;
  moveFlat.push({str,color,pairIdx,side:color==='white'?'w':'b'});
  // Highlight latest
  document.querySelectorAll('.move-cell').forEach(c=>c.classList.remove('active'));
  const pair=movePairs[movePairs.length-1];
  const cell=document.getElementById(`m-${color==='white'?'w':'b'}-${pair.num}`);
  if(cell)cell.classList.add('active');
  list.scrollTop=list.scrollHeight;
}

function recordSnapshot(bd,lm,chkSq){
  boardSnapshots.push({board:bd.map(r=>[...r]),lastMove:lm?{...lm}:null,checkSq:chkSq||null});
}

function jumpByCell(side,pairNum){
  SFX.click();
  const idx=moveFlat.findIndex(m=>m.pairIdx===(pairNum-1)&&m.side===side);
  if(idx!==-1)jumpToSnap(idx);
}

function jumpToSnap(idx){
  if(idx<0||idx>=boardSnapshots.length)return;
  historyIndex=idx; isViewingHistory=true;
  const snap=boardSnapshots[idx];
  const saved=lastMove; lastMove=snap.lastMove;
  renderBoard(snap.board,snap.checkSq);
  lastMove=saved;
  document.getElementById('board').classList.add('viewing-history');
  document.querySelectorAll('.move-cell').forEach(c=>c.classList.remove('active'));
  const m=moveFlat[idx];
  if(m){const cell=document.getElementById(`m-${m.side}-${movePairs[m.pairIdx].num}`);if(cell)cell.classList.add('active');}
}

function historyStep(dir){
  SFX.click();
  if(!isFinite(dir)){
    if(dir>0)historyGoLive(); else if(boardSnapshots.length)jumpToSnap(0);
    return;
  }
  if(!isViewingHistory){if(dir<0&&boardSnapshots.length>0)jumpToSnap(boardSnapshots.length-2);return;}
  const next=historyIndex+dir;
  if(next<0){historyGoLive();return;}
  if(next<boardSnapshots.length)jumpToSnap(next);
}

function historyGoLive(){
  SFX.click(); historyIndex=-1; isViewingHistory=false;
  document.getElementById('board').classList.remove('viewing-history');
  renderBoard(board);
  document.querySelectorAll('.move-cell').forEach(c=>c.classList.remove('active'));
  if(moveFlat.length){const last=moveFlat[moveFlat.length-1];const cell=document.getElementById(`m-${last.side}-${movePairs[last.pairIdx].num}`);if(cell)cell.classList.add('active');}
}

function updateGameActButtons(){
  const d=gameOver; ['resign-btn','draw-btn'].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=d;});
  const drawBtn=document.getElementById('draw-btn'); if(drawBtn)drawBtn.disabled=d||isVsComputer;
}

// ══════════════════════════════════════════════════════
//  RESULT
// ══════════════════════════════════════════════════════
function showResult(winner,status){
  gameOver=true; stopTimer(); updateGameActButtons();
  const icon=document.getElementById('result-icon'),vr=document.getElementById('result-verdict'),sub=document.getElementById('result-subtitle');
  document.getElementById('stat-moves').textContent=totalMoves;
  document.getElementById('stat-color').textContent=myColor?myColor.charAt(0).toUpperCase()+myColor.slice(1):'—';
  const won=winner===myColor;
  if(winner==='timeout-win')     {icon.textContent='⏱';vr.textContent='Victory';   vr.className='result-verdict win';  sub.textContent='Opponent ran out of time!';SFX.win();burst('win');}
  else if(winner==='timeout-loss'){icon.textContent='⏱';vr.textContent='Defeat';    vr.className='result-verdict lose'; sub.textContent='You ran out of time.';       SFX.lose();burst('lose');}
  else if(winner==='draw'||status==='stalemate'||status==='draw'){icon.textContent='½';vr.textContent=status==='stalemate'?'Stalemate':'Draw';vr.className='result-verdict draw';sub.textContent=status==='stalemate'?'No legal moves — stalemate.':'The game is drawn.';burst('draw');}
  else if(status==='resigned')   {icon.textContent=won?'🏆':'⚑'; vr.textContent=won?'Victory':'Defeat';vr.className='result-verdict '+(won?'win':'lose');sub.textContent=won?'Opponent resigned.':'You resigned.';won?SFX.win():SFX.lose();burst(won?'win':'lose');}
  else if(status==='checkmate')  {icon.textContent=won?'♔':'☠'; vr.textContent=won?'Checkmate!':'Defeated';vr.className='result-verdict '+(won?'win':'lose');sub.textContent=won?'You delivered checkmate!':isVsComputer?'Engine checkmated you.':'Your king has fallen.';won?SFX.win():SFX.lose();burst(won?'win':'lose');}
  else if(won){icon.textContent='♔';vr.textContent='Victory';vr.className='result-verdict win'; sub.textContent=isVsComputer?'You outplayed the engine!':'You captured the enemy king!';SFX.win();burst('win');}
  else        {icon.textContent='☠';vr.textContent='Defeat'; vr.className='result-verdict lose';sub.textContent=isVsComputer?'The engine prevailed.':'Your king has fallen.';SFX.lose();burst('lose');}
  setTimeout(()=>switchScreen('screen-game','screen-result'),900);
}

// ══════════════════════════════════════════════════════
//  SOCKET EVENTS
// ══════════════════════════════════════════════════════
socket.on('playerAssigned',({color,roomId:rid})=>{
  myColor=color; roomId=rid||roomId;
  document.getElementById('my-color-label').textContent=color==='white'?'White Pieces':'Black Pieces';
  buildLabels();
});
socket.on('waiting',()=>{ document.getElementById('mode-tag').textContent='Waiting…'; });
socket.on('gameStart',({board:bd,turn,vsComputer:cpu,timerSeconds:ts})=>{
  board=bd; currentTurn=turn; isVsComputer=!!cpu;
  setupPlayerCards(); renderBoard(bd);
  updateTurnIndicators(turn,null,null); updateActiveCard(turn); updateGameActButtons();
  SFX.start();
  if(ts&&ts>0){timerSeconds=ts;initTimers(ts);startTimer();}
});
socket.on('boardUpdate',({board:bd,turn,winner,moveCount,lastMove:lm,isComputerMove,status,checkSquare:cs,resigned})=>{
  const movedPiece=lm?board[lm.fromRow][lm.fromCol]:null;
  const capturedPiece=lm&&board[lm.toRow][lm.toCol]&&board[lm.toRow][lm.toCol]!==' '?board[lm.toRow][lm.toCol]:null;

  // Capture old board state before updating
  const prevBoard = board.map(r=>[...r]);

  board=bd; currentTurn=turn; lastMove=lm; selected=null;
  totalMoves=moveCount||totalMoves+1; checkSquare=cs||null;

  if(capturedPiece)addCapturedPiece(capturedPiece);
  if(lm&&movedPiece){
    const from=FILES[lm.fromCol]+(8-lm.fromRow),to=FILES[lm.toCol]+(8-lm.toRow);
    addMoveToList(GLYPHS[movedPiece]+from+'–'+to, isComputerMove?'black':(turn==='white'?'black':'white'));
  }
  recordSnapshot(bd,lm,cs);

  if(!isViewingHistory){
    // ✅ Animate ALL moves (both opponent and your own moves)
    if(lm && movedPiece && !winner){
      const intermediate = bd.map(r=>[...r]);
      // Put piece back at source for the background board
      intermediate[lm.fromRow][lm.fromCol] = movedPiece;
      intermediate[lm.toRow][lm.toCol]     = ' ';
      renderBoard(intermediate);
      // Animate the flying piece, then show final board
      animatePieceMove(movedPiece, lm.fromRow, lm.fromCol, lm.toRow, lm.toCol, ()=>{
        renderBoard(bd);
        if(status==='check'){showBanner('⚠ Check! Your king is under attack','check');SFX.check();}
      });
    } else {
      renderBoard(bd);
      if(status==='check'){showBanner('⚠ Check! Your king is under attack','check');SFX.check();}
    }
  }

  updateTurnIndicators(turn,winner,status); updateActiveCard(turn);
  if(isComputerMove)SFX.move();
  hideBanner();
  if(timerMaxSeconds>0&&!winner&&!gamePaused){stopTimer();startTimer();updateTimerDisplay();}
  if(winner||status==='checkmate'||status==='stalemate'||status==='draw'||resigned)showResult(winner,status);
});
socket.on('promotionRequired',({fromRow,fromCol,toRow,toCol})=>showPromo(fromRow,fromCol,toRow,toCol));
socket.on('drawOffered',({by})=>{if(by!==myColor)document.getElementById('draw-overlay').classList.remove('hidden');});
socket.on('drawDeclined',()=>{hideBanner();showBanner('Draw offer declined','check');setTimeout(hideBanner,2500);});
socket.on('computerThinking',({thinking})=>{ document.getElementById('thinking-bar').style.display=thinking?'flex':'none'; });
socket.on('invalidMove',({message})=>{ SFX.invalid();selected=null;renderBoard(board);showBanner('⚠ '+message,'check');setTimeout(hideBanner,1800); });
socket.on('playerLeft',({message})=>{
  stopTimer();
  document.getElementById('result-icon').textContent='🚪';
  document.getElementById('result-verdict').textContent='Disconnected';
  document.getElementById('result-verdict').className='result-verdict draw';
  document.getElementById('result-subtitle').textContent=message;
  document.getElementById('stat-moves').textContent=totalMoves;
  document.getElementById('stat-color').textContent=myColor||'—';
  burst('draw'); setTimeout(()=>switchScreen('screen-game','screen-result'),400);
});
socket.on('roomFull',({message})=>{switchScreen('screen-game','screen-menu');showPanel('panel-multiplayer');alert(message);});

// ══════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════
window.addEventListener('load',()=>{
  loadSettings(); applySettings(); runLoader();
  initLoadingParticles();
  initFloatingPieces();
  buildDecoBoard();
  // Spawn ambient particles on loading screen bg-canvas
  const menuBgCanvas=document.querySelector('#screen-menu .menu-left .bg-canvas');
  if(menuBgCanvas)spawnParticles(menuBgCanvas,20,['#d4a843','#5b8cf5','#4caf82']);
  document.getElementById('room-input').addEventListener('keydown',e=>{if(e.key==='Enter')joinRoom();});
  setupTimerBtns('timer-select-mp');
  setupTimerBtns('timer-select-cpu');
  document.getElementById('settings-overlay').addEventListener('click',function(e){if(e.target===this)closeSettings();});
  document.addEventListener('touchend',e=>{const n=Date.now();if(n-(document._lt||0)<300)e.preventDefault();document._lt=n;},{passive:false});
  ['touchstart','click'].forEach(ev=>document.addEventListener(ev,()=>{try{getAudioCtx().resume();}catch(e){}},{once:true}));
});
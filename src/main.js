import "./style.css";
import { Chess } from "chess.js";
import { io } from "socket.io-client";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_KEY ?? "";

// ── DOM refs ──────────────────────────────────────────────────────────────────
const boardEl          = document.getElementById("board");
const newGameBtn       = document.getElementById("new-game");
const hintMoveBtn      = document.getElementById("hint-move");
const playHintBtn      = document.getElementById("play-hint");
const statusLineEl     = document.getElementById("status-line");
const selectedSquareEl = document.getElementById("selected-square");
const opponentModeEl   = document.getElementById("engine-mode");
const hintLineEl       = document.getElementById("hint-line");
const hintRowEl        = document.getElementById("hint-row");
const moveListEl       = document.getElementById("move-list");
const askCoachBtn      = document.getElementById("ask-coach");
const coachMessageEl   = document.getElementById("coach-message");
const modeAiBtn        = document.getElementById("mode-ai-btn");
const modeMpBtn        = document.getElementById("mode-mp-btn");
const lobbyCard        = document.getElementById("lobby-card");
const createRoomBtn    = document.getElementById("create-room-btn");
const joinRoomBtn      = document.getElementById("join-room-btn");
const roomCodeInput    = document.getElementById("room-code-input");
const lobbyStatusEl    = document.getElementById("lobby-status");
// Auth DOM refs
const authOverlay      = document.getElementById("auth-overlay");
const appEl            = document.getElementById("app");
const loginPanel       = document.getElementById("login-panel");
const registerPanel    = document.getElementById("register-panel");
const loginUsernameEl  = document.getElementById("login-username");
const loginPasswordEl  = document.getElementById("login-password");
const loginBtn         = document.getElementById("login-btn");
const loginErrorEl     = document.getElementById("login-error");
const goRegisterLink   = document.getElementById("go-register");
const regUsernameEl    = document.getElementById("reg-username");
const regPasswordEl    = document.getElementById("reg-password");
const regConfirmEl     = document.getElementById("reg-confirm");
const registerBtn      = document.getElementById("register-btn");
const registerErrorEl  = document.getElementById("register-error");
const goLoginLink      = document.getElementById("go-login");
const usernameDisplay  = document.getElementById("username-display");
const logoutBtn        = document.getElementById("logout-btn");

if (
  !(boardEl          instanceof HTMLElement)       ||
  !(newGameBtn       instanceof HTMLButtonElement) ||
  !(hintMoveBtn      instanceof HTMLButtonElement) ||
  !(playHintBtn      instanceof HTMLButtonElement) ||
  !(statusLineEl     instanceof HTMLElement)       ||
  !(selectedSquareEl instanceof HTMLElement)       ||
  !(opponentModeEl   instanceof HTMLElement)       ||
  !(hintLineEl       instanceof HTMLElement)       ||
  !(hintRowEl        instanceof HTMLElement)       ||
  !(moveListEl       instanceof HTMLOListElement)  ||
  !(askCoachBtn      instanceof HTMLButtonElement) ||
  !(coachMessageEl   instanceof HTMLElement)       ||
  !(modeAiBtn        instanceof HTMLButtonElement) ||
  !(modeMpBtn        instanceof HTMLButtonElement) ||
  !(lobbyCard        instanceof HTMLElement)       ||
  !(createRoomBtn    instanceof HTMLButtonElement) ||
  !(joinRoomBtn      instanceof HTMLButtonElement) ||
  !(roomCodeInput    instanceof HTMLInputElement)  ||
  !(lobbyStatusEl    instanceof HTMLElement)       ||
  !(authOverlay      instanceof HTMLElement)       ||
  !(appEl            instanceof HTMLElement)       ||
  !(loginPanel       instanceof HTMLElement)       ||
  !(registerPanel    instanceof HTMLElement)       ||
  !(loginUsernameEl  instanceof HTMLInputElement)  ||
  !(loginPasswordEl  instanceof HTMLInputElement)  ||
  !(loginBtn         instanceof HTMLButtonElement) ||
  !(loginErrorEl     instanceof HTMLElement)       ||
  !(goRegisterLink   instanceof HTMLElement)       ||
  !(regUsernameEl    instanceof HTMLInputElement)  ||
  !(regPasswordEl    instanceof HTMLInputElement)  ||
  !(regConfirmEl     instanceof HTMLInputElement)  ||
  !(registerBtn      instanceof HTMLButtonElement) ||
  !(registerErrorEl  instanceof HTMLElement)       ||
  !(goLoginLink      instanceof HTMLElement)       ||
  !(usernameDisplay  instanceof HTMLElement)       ||
  !(logoutBtn        instanceof HTMLButtonElement)
) {
  throw new Error("Missing required DOM elements.");
}

// ── Chess constants ───────────────────────────────────────────────────────────
const files      = ["a", "b", "c", "d", "e", "f", "g", "h"];
const ranks      = ["8", "7", "6", "5", "4", "3", "2", "1"];
const pieceValues = { p: 1, n: 3.2, b: 3.3, r: 5, q: 9, k: 0 };
const unicodePiece = {
  wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
};

// ── Game state ────────────────────────────────────────────────────────────────
const aiColor   = "b";
let playerColor = "w";
const game      = new Chess();
let selectedSquare = null;
let legalTargets   = [];
let isAiThinking   = false;
let hintMove       = null;

// ── Multiplayer state ─────────────────────────────────────────────────────────
let gameMode        = "ai";   // "ai" | "multiplayer"
let mpState         = "idle"; // "idle" | "waiting" | "playing"
let roomCode        = null;
let socket          = null;
let opponentUsername = null;

// ── Auth helpers ──────────────────────────────────────────────────────────────
const TOKEN_KEY    = "chess_token";
const USERNAME_KEY = "chess_username";

function getToken()    { return localStorage.getItem(TOKEN_KEY); }
function getStoredUsername() { return localStorage.getItem(USERNAME_KEY) ?? ""; }

function saveSession(token, username) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USERNAME_KEY, username);
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USERNAME_KEY);
}

function showApp(username) {
  usernameDisplay.textContent = username;
  authOverlay.hidden = true;
  appEl.hidden       = false;
  startNewGame();
}

function showAuth(panel = "login") {
  appEl.hidden       = true;
  authOverlay.hidden = false;
  loginPanel.hidden    = panel !== "login";
  registerPanel.hidden = panel !== "register";
  loginErrorEl.textContent    = "";
  registerErrorEl.textContent = "";
}

async function callApi(path, body) {
  const res = await fetch(path, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed.");
  return data;
}

async function handleLogin() {
  const username = loginUsernameEl.value.trim();
  const password = loginPasswordEl.value;
  loginErrorEl.textContent = "";
  loginBtn.disabled = true;
  try {
    const { token, username: name } = await callApi("/api/login", { username, password });
    saveSession(token, name);
    showApp(name);
  } catch (err) {
    loginErrorEl.textContent = err.message;
  } finally {
    loginBtn.disabled = false;
  }
}

async function handleRegister() {
  const username = regUsernameEl.value.trim();
  const password = regPasswordEl.value;
  const confirm  = regConfirmEl.value;
  registerErrorEl.textContent = "";
  if (password !== confirm) { registerErrorEl.textContent = "Passwords do not match."; return; }
  registerBtn.disabled = true;
  try {
    const { token, username: name } = await callApi("/api/register", { username, password });
    saveSession(token, name);
    showApp(name);
  } catch (err) {
    registerErrorEl.textContent = err.message;
  } finally {
    registerBtn.disabled = false;
  }
}

function handleLogout() {
  if (socket) { socket.disconnect(); socket = null; }
  clearSession();
  showAuth("login");
  loginUsernameEl.value = "";
  loginPasswordEl.value = "";
}

// ── AI engine ─────────────────────────────────────────────────────────────────
function clearSelection() { selectedSquare = null; legalTargets = []; }
function clearHint()      { hintMove = null; }

function evaluateMaterial(chess, perspective) {
  let score = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const value = pieceValues[piece.type] ?? 0;
      score += piece.color === perspective ? value : -value;
    }
  }
  return score;
}

function evaluatePosition(chess, perspective) {
  if (chess.isCheckmate()) return chess.turn() === perspective ? -9999 : 9999;
  if (chess.isDraw()) return 0;
  let score = evaluateMaterial(chess, perspective);
  if (chess.isCheck()) score += chess.turn() === perspective ? -0.2 : 0.2;
  return score;
}

function minimax(chess, depth, alpha, beta, maximizing, perspective) {
  if (depth === 0 || chess.isGameOver()) return evaluatePosition(chess, perspective);
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return evaluatePosition(chess, perspective);
  if (maximizing) {
    let best = Number.NEGATIVE_INFINITY;
    for (const move of moves) {
      chess.move(move);
      const val = minimax(chess, depth - 1, alpha, beta, false, perspective);
      chess.undo();
      best = Math.max(best, val);
      alpha = Math.max(alpha, val);
      if (beta <= alpha) break;
    }
    return best;
  }
  let best = Number.POSITIVE_INFINITY;
  for (const move of moves) {
    chess.move(move);
    const val = minimax(chess, depth - 1, alpha, beta, true, perspective);
    chess.undo();
    best = Math.min(best, val);
    beta = Math.min(beta, val);
    if (beta <= alpha) break;
  }
  return best;
}

function getHintCandidate() {
  if (game.turn() !== playerColor || game.isGameOver()) return null;
  const moves = game.moves({ verbose: true });
  if (!moves.length) return null;
  let bestMove = moves[0], bestScore = Number.NEGATIVE_INFINITY;
  for (const move of moves) {
    game.move(move);
    const score = minimax(game, 1, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, false, playerColor);
    game.undo();
    if (score > bestScore) { bestScore = score; bestMove = move; }
  }
  return bestMove;
}

function getEasyAiMove() {
  const moves = game.moves({ verbose: true });
  if (!moves.length) return null;
  const scored = moves.map((move) => {
    let score = 0;
    if (move.captured) score += (pieceValues[move.captured] ?? 0) * 1.5;
    if (move.promotion) score += 2.5;
    game.move(move);
    score += evaluatePosition(game, aiColor) * 0.4;
    game.undo();
    score += Math.random() * 2.2;
    return { move, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const pool = scored.slice(0, Math.min(4, scored.length));
  return pool[Math.floor(Math.random() * pool.length)].move;
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function getPieceGlyph(square) {
  const piece = game.get(square);
  if (!piece) return "";
  return unicodePiece[`${piece.color}${piece.type}`] ?? "";
}

function getGameStatusText() {
  if (game.isCheckmate()) {
    if (gameMode === "multiplayer") return game.turn() === playerColor ? "Checkmate — you lose." : "Checkmate — you win! 🎉";
    return game.turn() === playerColor ? "Checkmate. Easy AI wins." : "Checkmate. You win.";
  }
  if (game.isStalemate())           return "Draw by stalemate.";
  if (game.isInsufficientMaterial()) return "Draw by insufficient material.";
  if (game.isThreefoldRepetition()) return "Draw by threefold repetition.";
  if (game.isDraw())                return "Draw.";
  if (isAiThinking)                 return "Easy AI is thinking...";
  if (gameMode === "multiplayer")   return game.turn() === playerColor ? "Your turn." : "Opponent's turn…";
  return game.turn() === playerColor ? "Your turn (White)." : "AI turn (Black).";
}

function refreshMoveList() {
  moveListEl.innerHTML = "";
  const history = game.history({ verbose: true });
  for (let i = 0; i < history.length; i += 2) {
    const row = document.createElement("li");
    row.textContent = `${Math.floor(i / 2) + 1}. ${history[i].san}${history[i + 1] ? ` ${history[i + 1].san}` : ""}`;
    moveListEl.appendChild(row);
  }
}

function refreshHintText() {
  if (!hintMove) { hintLineEl.textContent = 'Press "Hint Move".'; return; }
  hintLineEl.textContent = `${hintMove.from} → ${hintMove.to} (${hintMove.san})`;
}

function renderBoard() {
  boardEl.innerHTML = "";
  const flipped      = gameMode === "multiplayer" && playerColor === "b";
  const displayRanks = flipped ? [...ranks].reverse() : ranks;
  const displayFiles = flipped ? [...files].reverse() : files;

  for (const rank of displayRanks) {
    for (const file of displayFiles) {
      const square  = `${file}${rank}`;
      const isLight = (files.indexOf(file) + Number(rank)) % 2 === 0;
      const btn     = document.createElement("button");
      btn.type      = "button";
      btn.className = `square ${isLight ? "light" : "dark"}`;
      btn.dataset.square = square;
      btn.textContent    = getPieceGlyph(square);

      const piece = game.get(square);
      if (piece?.color === "w") btn.classList.add("piece-white");
      if (piece?.color === "b") btn.classList.add("piece-black");
      btn.setAttribute("aria-label", `Square ${square}`);

      const canInteract = gameMode === "multiplayer"
        ? mpState === "playing" && !game.isGameOver() && game.turn() === playerColor
        : !isAiThinking && !game.isGameOver();
      btn.disabled = !canInteract;

      if (square === selectedSquare)  btn.classList.add("selected");
      if (legalTargets.includes(square)) btn.classList.add("target");
      if (hintMove?.from === square)  btn.classList.add("hint-from");
      if (hintMove?.to   === square)  btn.classList.add("hint-to");

      btn.addEventListener("click", () => void onSquareClick(square));
      boardEl.appendChild(btn);
    }
  }
}

function refreshUi() {
  statusLineEl.textContent  = getGameStatusText();
  selectedSquareEl.textContent = selectedSquare ?? "None";
  opponentModeEl.textContent   = gameMode === "ai"
    ? "Easy AI"
    : opponentUsername ?? (roomCode ? `Waiting… (Room: ${roomCode})` : "Online Player");
  refreshHintText();
  refreshMoveList();
  renderBoard();

  const isAi = gameMode === "ai";
  hintMoveBtn.hidden = !isAi;
  playHintBtn.hidden = !isAi;
  hintRowEl.hidden   = !isAi;
  lobbyCard.hidden   = gameMode !== "multiplayer" || mpState === "playing";
}

// ── Multiplayer ───────────────────────────────────────────────────────────────
function setLobbyStatus(msg, isError = false) {
  lobbyStatusEl.textContent = msg;
  lobbyStatusEl.className   = `lobby-status${isError ? " error" : ""}`;
}

function connectSocket() {
  if (socket?.connected) return socket;

  socket = io({ auth: { token: getToken() } });

  socket.on("connect_error", (err) => {
    if (err.message.includes("Authentication") || err.message.includes("session")) {
      clearSession();
      showAuth("login");
    }
  });

  socket.on("room-created", ({ code }) => {
    roomCode = code;
    mpState  = "waiting";
    setLobbyStatus(`Room created! Give this code to your opponent:`);
    // Display code prominently
    const codeEl = document.createElement("span");
    codeEl.className   = "room-code";
    codeEl.textContent = code;
    lobbyStatusEl.appendChild(document.createElement("br"));
    lobbyStatusEl.appendChild(codeEl);
    createRoomBtn.disabled = true;
    joinRoomBtn.disabled   = true;
    roomCodeInput.disabled = true;
    refreshUi();
  });

  socket.on("color-assigned", ({ color }) => {
    playerColor = color;
  });

  socket.on("game-start", ({ whiteUser, blackUser }) => {
    opponentUsername = playerColor === "w" ? blackUser : whiteUser;
    mpState = "playing";
    game.reset();
    clearSelection();
    clearHint();
    refreshUi();
  });

  socket.on("move-made", ({ from, to, promotion }) => {
    game.move({ from, to, promotion });
    clearSelection();
    refreshUi();
    if (game.isGameOver()) void askGeminiCoach();
  });

  socket.on("move-rejected", () => {
    game.undo();
    refreshUi();
  });

  socket.on("opponent-left", () => {
    mpState          = "idle";
    roomCode         = null;
    playerColor      = "w";
    opponentUsername = null;
    createRoomBtn.disabled = false;
    joinRoomBtn.disabled   = false;
    roomCodeInput.disabled = false;
    setLobbyStatus("Opponent disconnected. Start a new room or join another.", true);
    refreshUi();
  });

  socket.on("room-error", ({ message }) => {
    setLobbyStatus(message, true);
  });

  return socket;
}

function createRoom() {
  const s = connectSocket();
  setLobbyStatus("Creating room…");
  s.emit("create-room");
}

function joinRoom() {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) { setLobbyStatus("Enter a room code first.", true); return; }
  const s = connectSocket();
  setLobbyStatus("Joining room…");
  s.emit("join-room", { code });
}

// ── Game flow ─────────────────────────────────────────────────────────────────
function choosePromotion() {
  const raw = prompt("Promote to (q, r, b, n):", "q");
  if (!raw) return "q";
  const v = raw.trim().toLowerCase();
  return ["q", "r", "b", "n"].includes(v) ? v : "q";
}

async function runAiTurn() {
  if (gameMode !== "ai" || game.isGameOver() || game.turn() !== aiColor) { refreshUi(); return; }
  isAiThinking = true;
  refreshUi();
  try {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const move = getEasyAiMove();
    if (move) game.move(move);
  } finally {
    isAiThinking = false;
    clearHint();
    refreshUi();
    if (game.isGameOver()) void askGeminiCoach();
  }
}

function isPlayerPiece(square) {
  const piece = game.get(square);
  return Boolean(piece && piece.color === playerColor);
}

async function applyPlayerMove(from, to) {
  const movingPiece     = game.get(from);
  const isPromotionMove = movingPiece?.type === "p" && (to.endsWith("8") || to.endsWith("1"));
  const promotion       = isPromotionMove ? choosePromotion() : undefined;

  if (gameMode === "multiplayer") {
    const result = game.move({ from, to, promotion });
    clearSelection();
    if (!result) { refreshUi(); return; }
    clearHint();
    socket.emit("move", { from, to, promotion });
    refreshUi();
    if (game.isGameOver()) void askGeminiCoach();
    return;
  }

  const result = game.move(promotion ? { from, to, promotion } : { from, to });
  clearSelection();
  if (!result) { refreshUi(); return; }
  clearHint();
  refreshUi();
  await runAiTurn();
}

async function onSquareClick(square) {
  if (gameMode === "multiplayer") {
    if (mpState !== "playing" || game.isGameOver() || game.turn() !== playerColor) return;
  } else {
    if (isAiThinking || game.isGameOver() || game.turn() !== playerColor) return;
  }

  if (!selectedSquare) {
    if (!isPlayerPiece(square)) return;
    const moves = game.moves({ square, verbose: true });
    if (!moves.length) return;
    selectedSquare = square;
    legalTargets   = moves.map((m) => m.to);
    refreshUi();
    return;
  }

  if (square === selectedSquare) { clearSelection(); refreshUi(); return; }

  if (isPlayerPiece(square)) {
    selectedSquare = square;
    legalTargets   = game.moves({ square, verbose: true }).map((m) => m.to);
    refreshUi();
    return;
  }

  if (!legalTargets.includes(square)) { clearSelection(); refreshUi(); return; }

  await applyPlayerMove(selectedSquare, square);
}

function requestHint() {
  if (gameMode !== "ai" || isAiThinking || game.isGameOver() || game.turn() !== playerColor) return;
  hintMove = getHintCandidate();
  refreshUi();
}

async function playHintMove() {
  if (gameMode !== "ai" || isAiThinking || game.isGameOver() || game.turn() !== playerColor) return;
  if (!hintMove) hintMove = getHintCandidate();
  if (!hintMove) return;
  await applyPlayerMove(hintMove.from, hintMove.to);
}

// ── Gemini Coach ──────────────────────────────────────────────────────────────
async function askGeminiCoach() {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") {
    coachMessageEl.classList.remove("thinking");
    coachMessageEl.textContent = "Add your Gemini API key to the .env file to enable Coach G.";
    return;
  }

  askCoachBtn.disabled = true;
  coachMessageEl.classList.add("thinking");
  coachMessageEl.textContent = "Coach G is thinking";

  const history   = game.history({ verbose: true });
  const lastMoves = history.slice(-6).map((m) => m.san).join(", ");
  const userPrompt = `Chess position (FEN): ${game.fen()}
Last moves played: ${lastMoves || "none yet"}
Move number: ${Math.ceil(history.length / 2)}
Game status: ${getGameStatusText()}

Give the player one short piece of advice about their position or what to watch out for next.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: "You are Coach G, a friendly and encouraging chess coach. Give the player ONE short piece of advice (2-3 sentences max). Be specific to the position, speak naturally like a human teacher, avoid heavy jargon. If the game just ended, give a brief closing comment." }],
          },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        }),
      }
    );

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody?.error?.message ?? `HTTP ${response.status}`);
    }

    const data = await response.json();
    const text  = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "I have no advice right now.";
    coachMessageEl.classList.remove("thinking");
    coachMessageEl.textContent = text;
  } catch (err) {
    coachMessageEl.classList.remove("thinking");
    coachMessageEl.textContent = `Coach G error: ${err.message}`;
  } finally {
    askCoachBtn.disabled = false;
  }
}

// ── Mode switching ────────────────────────────────────────────────────────────
function switchMode(mode) {
  if (gameMode === mode) return;
  gameMode    = mode;
  mpState     = "idle";
  roomCode    = null;
  playerColor = "w";

  if (socket) { socket.disconnect(); socket = null; }

  modeAiBtn.classList.toggle("active", mode === "ai");
  modeMpBtn.classList.toggle("active", mode === "multiplayer");

  roomCodeInput.value    = "";
  roomCodeInput.disabled = false;
  createRoomBtn.disabled = false;
  joinRoomBtn.disabled   = false;
  setLobbyStatus("");

  game.reset();
  clearSelection();
  clearHint();
  isAiThinking = false;
  coachMessageEl.classList.remove("thinking");
  coachMessageEl.textContent = 'Click "Ask Coach" for advice on the current position.';
  refreshUi();
}

// ── Init ──────────────────────────────────────────────────────────────────────
function startNewGame() {
  if (gameMode === "multiplayer" && socket) {
    socket.disconnect();
    socket      = null;
    mpState     = "idle";
    roomCode    = null;
    playerColor = "w";
    roomCodeInput.disabled = false;
    createRoomBtn.disabled = false;
    joinRoomBtn.disabled   = false;
    setLobbyStatus("");
  }
  game.reset();
  clearSelection();
  clearHint();
  isAiThinking = false;
  coachMessageEl.classList.remove("thinking");
  coachMessageEl.textContent = 'Click "Ask Coach" for advice on the current position.';
  refreshUi();
}

// Game controls
newGameBtn.addEventListener("click",    () => startNewGame());
hintMoveBtn.addEventListener("click",   () => requestHint());
playHintBtn.addEventListener("click",   () => void playHintMove());
askCoachBtn.addEventListener("click",   () => void askGeminiCoach());
modeAiBtn.addEventListener("click",     () => switchMode("ai"));
modeMpBtn.addEventListener("click",     () => switchMode("multiplayer"));
createRoomBtn.addEventListener("click", () => createRoom());
joinRoomBtn.addEventListener("click",   () => joinRoom());
roomCodeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });

// Auth controls
loginBtn.addEventListener("click",    () => void handleLogin());
registerBtn.addEventListener("click", () => void handleRegister());
logoutBtn.addEventListener("click",   () => handleLogout());
goRegisterLink.addEventListener("click", (e) => { e.preventDefault(); showAuth("register"); });
goLoginLink.addEventListener("click",    (e) => { e.preventDefault(); showAuth("login"); });
loginPasswordEl.addEventListener("keydown",  (e) => { if (e.key === "Enter") void handleLogin(); });
regConfirmEl.addEventListener("keydown",     (e) => { if (e.key === "Enter") void handleRegister(); });

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const savedToken    = getToken();
const savedUsername = getStoredUsername();
if (savedToken && savedUsername) {
  showApp(savedUsername);
} else {
  showAuth("login");
}

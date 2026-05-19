import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { Chess } from "chess.js";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_in_production";
const PORT = 3001;

// ── SQLite setup ──────────────────────────────────────────────────────────────
const db = new Database("chess.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT    UNIQUE NOT NULL COLLATE NOCASE,
    password   TEXT    NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.post("/api/register", async (req, res) => {
  const { username, password } = req.body ?? {};
  const name = username?.trim();
  if (!name || !password)        return res.status(400).json({ error: "Username and password required." });
  if (name.length < 3)           return res.status(400).json({ error: "Username must be at least 3 characters." });
  if (password.length < 6)       return res.status(400).json({ error: "Password must be at least 6 characters." });

  try {
    const hash = await bcrypt.hash(password, 10);
    db.prepare("INSERT INTO users (username, password) VALUES (?, ?)").run(name, hash);
    const token = jwt.sign({ username: name }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, username: name });
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "Username already taken." });
    res.status(500).json({ error: "Server error." });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: "Username and password required." });

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user) return res.status(401).json({ error: "Invalid username or password." });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: "Invalid username or password." });

  const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, username: user.username });
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

// Require valid JWT for every socket connection
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Authentication required."));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.data.username = payload.username;
    next();
  } catch {
    next(new Error("Invalid or expired session. Please log in again."));
  }
});

// roomCode -> { white, whiteUser, black, blackUser, chess }
const rooms = new Map();

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

io.on("connection", (socket) => {
  let currentRoom  = null;
  let currentColor = null;

  socket.on("create-room", () => {
    let code;
    do { code = generateCode(); } while (rooms.has(code));
    rooms.set(code, {
      white: socket.id, whiteUser: socket.data.username,
      black: null,      blackUser: null,
      chess: new Chess(),
    });
    currentRoom  = code;
    currentColor = "w";
    socket.join(code);
    socket.emit("room-created", { code });
  });

  socket.on("join-room", ({ code }) => {
    const room = rooms.get(code);
    if (!room)       { socket.emit("room-error", { message: "Room not found. Check the code and try again." }); return; }
    if (room.black)  { socket.emit("room-error", { message: "Room is already full." }); return; }

    room.black    = socket.id;
    room.blackUser = socket.data.username;
    currentRoom   = code;
    currentColor  = "b";
    socket.join(code);

    socket.emit("color-assigned", { color: "b" });
    io.to(room.white).emit("color-assigned", { color: "w" });
    io.to(code).emit("game-start", {
      whiteUser: room.whiteUser,
      blackUser: room.blackUser,
    });
  });

  socket.on("move", ({ from, to, promotion }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (currentColor !== room.chess.turn()) return;

    const result = room.chess.move({ from, to, promotion });
    if (!result) { socket.emit("move-rejected"); return; }

    socket.to(currentRoom).emit("move-made", { from, to, promotion });
  });

  socket.on("disconnect", () => {
    if (currentRoom) {
      socket.to(currentRoom).emit("opponent-left");
      rooms.delete(currentRoom);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Chess server running on http://localhost:${PORT}`);
});

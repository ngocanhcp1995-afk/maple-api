// index.js (FULL)
// Node + Express + MySQL2 + CORS
// Endpoints:
//   GET /
//   GET /api/health
//   GET /api/server_status
//   GET /api/leaderboard?type=level|fame|meso&limit=50

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();

// ===== CORS =====
// Nếu bạn muốn chỉ cho phép domain Netlify, thay "*" thành domain của bạn.
app.use(cors({ origin: "*" }));
app.use(express.json());

// ===== ENV =====
const PORT = process.env.PORT || 10000;

const DB_HOST = process.env.DB_HOST;
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;
const DB_NAME = process.env.DB_NAME || "railway";

// ===== MySQL pool =====
let pool;
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASS,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      connectTimeout: 10000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
  }
  return pool;
}

// ===== Root check (BƯỚC 2) =====
app.get("/", (req, res) => {
  res.type("text").send("OK - maple-api is running 🚀");
});

// ===== Health check =====
app.get("/api/health", async (req, res) => {
  try {
    const p = getPool();
    const [rows] = await p.query("SELECT 1 AS ok");
    res.json({
      ok: true,
      db: true,
      port: PORT,
      test: rows?.[0]?.ok ?? 1,
      time: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      db: false,
      error: String(e?.message || e),
    });
  }
});

// ===== Server status =====
// Nếu bạn muốn status "online" dựa theo server game thật (port 8484),
// bạn phải thêm TCP ping riêng. Ở đây tạm trả online khi DB ok.
app.get("/api/server_status", async (req, res) => {
  try {
    const p = getPool();
    await p.query("SELECT 1");
    res.json({
      online: true,
      note: "DB reachable",
      time: new Date().toISOString(),
    });
  } catch (e) {
    res.json({
      online: false,
      note: "DB not reachable",
      error: String(e?.message || e),
      time: new Date().toISOString(),
    });
  }
});

// ===== Leaderboard =====
app.get("/api/leaderboard", async (req, res) => {
  try {
    const type = String(req.query.type || "level").toLowerCase();
    let limit = Number(req.query.limit || 50);
    if (!Number.isFinite(limit) || limit <= 0) limit = 50;
    if (limit > 200) limit = 200;

    // map type -> column/order
    // fame & meso nằm trong characters của heavenms
    // level nằm trong characters (level)
    const config = {
      level: { orderBy: "level", label: "level" },
      fame: { orderBy: "fame", label: "fame" },
      meso: { orderBy: "meso", label: "meso" },
    };

    const pick = config[type] || config.level;

    // IMPORTANT:
    // HeavenMS: characters có cột gm (0/1), name, level, fame, meso
    // Ẩn GM: WHERE gm = 0
const sql = `
  SELECT name, level, fame, meso, gm
  FROM characters
  WHERE gm = 0
  ORDER BY ${pick.orderBy} DESC, name ASC
  LIMIT ?
`;

    const p = getPool();
    const [rows] = await p.query(sql, [limit]);

    res.json({
      ok: true,
      type: pick.label,
      count: rows.length,
      rows,
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: String(e?.message || e),
    });
  }
});

// ===== Start =====
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});

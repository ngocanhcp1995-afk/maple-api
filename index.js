require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());

const origin = process.env.CORS_ORIGIN || "*";
app.use(cors({ origin }));

const PORT = Number(process.env.PORT || 3000);

// STALE_MS: quá thời gian này kể từ updated_at thì coi như OFF
const STALE_MS = Number(process.env.STALE_MS || 900000);

// DB Remote (Railway)
const DB = {
  host: process.env.REMOTE_DB_HOST,
  port: Number(process.env.REMOTE_DB_PORT || 3306),
  user: process.env.REMOTE_DB_USER,
  password: process.env.REMOTE_DB_PASS,
  database: process.env.REMOTE_DB_NAME,
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

let pool;

async function initDb() {
  pool = mysql.createPool(DB);
  const conn = await pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

function fail(res, err, code = 500) {
  console.error(err);
  res.status(code).json({
    ok: false,
    error: err?.message || String(err),
  });
}

app.get("/", (req, res) => {
  res.send("OK - maple-api is running 🚀");
});

app.get("/api/health", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");
    res.json({ ok: true, db: rows?.[0]?.ok === 1 });
  } catch (err) {
    fail(res, err);
  }
});

/**
 * GET /api/status
 * Tính last_update_sec ngay trong SQL (UTC) để khỏi lệch timezone
 */
app.get("/api/status", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        is_online,
        online_count,
        updated_at,
        TIMESTAMPDIFF(SECOND, updated_at, UTC_TIMESTAMP()) AS last_update_sec
      FROM server_status
      WHERE id = 1
      LIMIT 1
    `);

    const row = rows?.[0];
    if (!row) {
      return res.json({
        ok: true,
        isOnline: false,
        onlineCount: 0,
        updatedAt: null,
        lastUpdateSec: null,
        reason: "server_status row not found",
        staleMs: STALE_MS,
      });
    }

    const lastUpdateSec = Math.max(0, Number(row.last_update_sec || 0));
    const isOnline =
      (row.is_online === 1 || row.is_online === true) &&
      lastUpdateSec * 1000 <= STALE_MS;

    return res.json({
      ok: true,
      isOnline,
      onlineCount: isOnline ? Number(row.online_count || 0) : 0,
      updatedAt: row.updated_at,
      lastUpdateSec,
      staleMs: STALE_MS,
    });
  } catch (err) {
    fail(res, err);
  }
});

/**
 * GET /api/leaderboard?type=level|fame|meso|dog|fish&limit=10
 * Đọc trực tiếp từ characters_light
 */
app.get("/api/leaderboard", async (req, res) => {
  try {
    const type = String(req.query.type || "level").toLowerCase();
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 10)));

    // IMPORTANT: orderBy là chuỗi cố định để tránh SQL injection
    const MAP = {
      level: { orderBy: "level DESC, meso DESC", scoreKey: "level" },
      fame:  { orderBy: "fame DESC, level DESC", scoreKey: "fame" },
      meso:  { orderBy: "meso DESC, level DESC", scoreKey: "meso" },

      // ✅ FIX: đúng tên cột trong DB
      dog:   { orderBy: "dog_points DESC, level DESC", scoreKey: "dog" },
      fish:  { orderBy: "fish_points DESC, level DESC", scoreKey: "fish" },
    };

    const cfg = MAP[type] || MAP.level;

    // ✅ FIX: SELECT đúng tên cột dog_points/fish_points
    const sql = `
      SELECT
        name,
        job,
        level,
        fame,
        meso,
        dog_points,
        fish_points
      FROM characters_light
      ORDER BY ${cfg.orderBy}
      LIMIT ?
    `;

    const [rows] = await pool.query(sql, [limit]);

    res.json({
      ok: true,
      type: MAP[type] ? type : "level",
      scoreKey: cfg.scoreKey,
      limit,
      rows,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    fail(res, err);
  }
});

(async () => {
  try {
    await initDb();
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`API running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start:", err);
    process.exit(1);
  }
})();

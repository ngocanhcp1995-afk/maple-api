require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());

const origin = process.env.CORS_ORIGIN || "*";
app.use(cors({ origin }));

const PORT = Number(process.env.PORT || 3000);

// DB Railway
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

app.get("/api/server_status", async (req, res) => {
  try {
    // ✅ dùng đúng bảng
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS c FROM characters_light"
    );
    res.json({ ok: true, online: true, cachedRows: rows?.[0]?.c ?? 0 });
  } catch (err) {
    fail(res, err);
  }
});

/**
 * GET /api/leaderboard?type=meso|level|fame&limit=10
 */
app.get("/api/leaderboard", async (req, res) => {
  try {
    const type = String(req.query.type || "level").toLowerCase();
    const limitRaw = Number(req.query.limit || 50);
    const limit = Math.max(1, Math.min(200, isNaN(limitRaw) ? 50 : limitRaw));

    let orderBy = "level DESC, meso DESC";
    if (type === "meso") orderBy = "meso DESC, level DESC";
    if (type === "fame") orderBy = "fame DESC, level DESC";

    const sql = `
      SELECT name, level, fame, meso
      FROM characters_light
      ORDER BY ${orderBy}
      LIMIT ?
    `;

    const [rows] = await pool.query(sql, [limit]);

    res.json({
      ok: true,
      type,
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
    app.listen(PORT, () => {
      console.log(`API running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start:", err);
    process.exit(1);
  }
})();

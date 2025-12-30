import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/** =========================
 *  Cache RAM 30s
 *  ========================= */
const cache = new Map(); // key -> { exp, data }

function getCache(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() > v.exp) {
    cache.delete(key);
    return null;
  }
  return v.data;
}

function setCache(key, data, ttlMs = 30000) {
  cache.set(key, { exp: Date.now() + ttlMs, data });
}

/** =========================
 *  Helpers
 *  ========================= */
function safeInt(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  const x = Math.floor(n);
  return Math.max(min, Math.min(max, x));
}

/**
 * GET /api/rankings?type=level|fame|meso&q=name&limit=100
 */
router.get("/", async (req, res) => {
  const type = (req.query.type || "level").toString().toLowerCase();
  const q = (req.query.q || "").toString().trim();
  const limit = safeInt(req.query.limit, 100, 1, 200);

  // Cache key theo query
  const key = `rank:${type}:${q}:${limit}`;
  const cached = getCache(key);
  if (cached) return res.json(cached);

  // Sort theo type
  // Lưu ý: HeavenMS thường có columns: level, exp, fame, meso, gm
  let orderBy = "level DESC, exp DESC";
  if (type === "fame") orderBy = "fame DESC, level DESC, exp DESC";
  if (type === "meso") orderBy = "meso DESC, level DESC, exp DESC";

  // Build WHERE + params
  const params = [];
  let where = "WHERE gm = 0"; // ẩn GM

  if (q.length > 0) {
    where += " AND name LIKE ?";
    params.push(`%${q}%`);
  }

  const sql = `
    SELECT name, level, exp, fame, meso
    FROM characters
    ${where}
    ORDER BY ${orderBy}
    LIMIT ?
  `;
  params.push(limit);

  try {
    const [rows] = await pool.query(sql, params);

    const payload = {
      updatedAt: new Date().toISOString(),
      type,
      count: rows.length,
      players: rows.map((r, i) => ({
        rank: i + 1,
        name: r.name,
        level: r.level,
        fame: r.fame,
        meso: r.meso,
      })),
    };

    // Cache 30s
    setCache(key, payload, 30000);

    return res.json(payload);
  } catch (e) {
    return res.status(500).json({
      error: "DB query failed",
      detail: String(e?.message || e),
      hint:
        "Nếu báo Unknown column (gm/meso/fame/exp) thì schema DB bạn khác HeavenMS mặc định — gửi lỗi để mình chỉnh đúng.",
    });
  }
});

export default router;

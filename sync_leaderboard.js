require("dotenv").config();
const mysql = require("mysql2/promise");

const LOCAL = {
  host: process.env.LOCAL_DB_HOST,
  port: Number(process.env.LOCAL_DB_PORT || 3306),
  user: process.env.LOCAL_DB_USER,
  password: process.env.LOCAL_DB_PASS,
  database: process.env.LOCAL_DB_NAME,
};

const REMOTE = {
  host: process.env.REMOTE_DB_HOST,
  port: Number(process.env.REMOTE_DB_PORT || 3306),
  user: process.env.REMOTE_DB_USER,
  password: process.env.REMOTE_DB_PASS,
  database: process.env.REMOTE_DB_NAME,
};

function hasLocalConfig() {
  return !!(LOCAL.host && LOCAL.user && LOCAL.database);
}

async function ensureRemoteTables(remote) {
  // characters_light: đúng cột + đúng thứ tự
  await remote.execute(`
    CREATE TABLE IF NOT EXISTS characters_light (
      name VARCHAR(50) PRIMARY KEY,
      job INT NOT NULL DEFAULT 0,
      level INT NOT NULL DEFAULT 0,
      fame INT NOT NULL DEFAULT 0,
      meso BIGINT NOT NULL DEFAULT 0,
      dog_points INT NOT NULL DEFAULT 0,
      fish_points INT NOT NULL DEFAULT 0
    )
  `);

  // add thiếu cột (an toàn)
  await remote.execute(`ALTER TABLE characters_light ADD COLUMN job INT NOT NULL DEFAULT 0`).catch(() => {});
  await remote.execute(`ALTER TABLE characters_light ADD COLUMN level INT NOT NULL DEFAULT 0`).catch(() => {});
  await remote.execute(`ALTER TABLE characters_light ADD COLUMN fame INT NOT NULL DEFAULT 0`).catch(() => {});
  await remote.execute(`ALTER TABLE characters_light ADD COLUMN meso BIGINT NOT NULL DEFAULT 0`).catch(() => {});
  await remote.execute(`ALTER TABLE characters_light ADD COLUMN dog_points INT NOT NULL DEFAULT 0`).catch(() => {});
  await remote.execute(`ALTER TABLE characters_light ADD COLUMN fish_points INT NOT NULL DEFAULT 0`).catch(() => {});

  // reorder cột (HeidiSQL đẹp)
  await remote.execute(`ALTER TABLE characters_light MODIFY COLUMN job INT NOT NULL DEFAULT 0 AFTER name`).catch(() => {});
  await remote.execute(`ALTER TABLE characters_light MODIFY COLUMN level INT NOT NULL DEFAULT 0 AFTER job`).catch(() => {});
  await remote.execute(`ALTER TABLE characters_light MODIFY COLUMN fame INT NOT NULL DEFAULT 0 AFTER level`).catch(() => {});
  await remote.execute(`ALTER TABLE characters_light MODIFY COLUMN meso BIGINT NOT NULL DEFAULT 0 AFTER fame`).catch(() => {});
  await remote.execute(`ALTER TABLE characters_light MODIFY COLUMN dog_points INT NOT NULL DEFAULT 0 AFTER meso`).catch(() => {});
  await remote.execute(`ALTER TABLE characters_light MODIFY COLUMN fish_points INT NOT NULL DEFAULT 0 AFTER dog_points`).catch(() => {});

  // server_status (để /api/status đọc online)
  await remote.execute(`
    CREATE TABLE IF NOT EXISTS server_status (
      id TINYINT NOT NULL PRIMARY KEY,
      is_online BOOLEAN NOT NULL DEFAULT FALSE,
      online_count INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await remote.execute(`
    INSERT INTO server_status (id, is_online, online_count)
    VALUES (1, FALSE, 0)
    ON DUPLICATE KEY UPDATE id=id
  `);
}

async function fetchOnlineCount(local) {
  // HeavenMS thường có accounts.loggedin và characters.gm
  const [rows] = await local.execute(`
    SELECT COUNT(*) AS c
    FROM accounts a
    JOIN characters ch ON ch.accountid = a.id
    WHERE a.loggedin > 0
      AND (ch.gm = 0 OR ch.gm IS NULL)
  `);
  return rows?.[0]?.c ?? 0;
}

async function updateStatus(remote, isOnline, onlineCount) {
  await remote.execute(
    `
    INSERT INTO server_status (id, is_online, online_count, updated_at)
    VALUES (1, ?, ?, UTC_TIMESTAMP())
    ON DUPLICATE KEY UPDATE
      is_online = VALUES(is_online),
      online_count = VALUES(online_count),
      updated_at = UTC_TIMESTAMP()
    `,
    [isOnline ? 1 : 0, Number(onlineCount || 0)]
  );
}

async function syncLeaderboardFromLocalToRemote(local, remote) {
  // ✅ local phải có bảng characters (HeavenMS)
  // ✅ cột đúng tên: dog_points, fish_points
  const [rows] = await local.execute(`
    SELECT
      name,
      job,
      level,
      fame,
      meso,
      COALESCE(dog_points, 0)  AS dog_points,
      COALESCE(fish_points, 0) AS fish_points
    FROM characters
    WHERE (gm = 0 OR gm IS NULL)
    ORDER BY level DESC
    LIMIT 200
  `);

  // ⚠️ chỉ TRUNCATE khi local đọc được rows (để khỏi xóa data nếu local lỗi)
  await remote.execute(`TRUNCATE TABLE characters_light`);

  if (rows.length) {
    const values = rows.map((r) => [
      r.name,
      Number(r.job || 0),
      Number(r.level || 0),
      Number(r.fame || 0),
      Number(r.meso || 0),
      Number(r.dog_points || 0),
      Number(r.fish_points || 0),
    ]);

    await remote.query(
      `
      INSERT INTO characters_light
        (name, job, level, fame, meso, dog_points, fish_points)
      VALUES ?
      `,
      [values]
    );
  }

  return rows.length;
}

async function main() {
  let local = null;
  let remote = null;

  try {
    console.log("[REMOTE]", REMOTE.host, REMOTE.database, REMOTE.user);
    if (hasLocalConfig()) console.log("[LOCAL ]", LOCAL.host, LOCAL.database, LOCAL.user);
    else console.log("[LOCAL ] (no local config) => schema-only mode");

    remote = await mysql.createConnection(REMOTE);
    await ensureRemoteTables(remote);

    // 1) Nếu có local DB => sync leaderboard + update online
    if (hasLocalConfig()) {
      try {
        local = await mysql.createConnection(LOCAL);

        const rowsSynced = await syncLeaderboardFromLocalToRemote(local, remote);

        let online = 0;
        let isOnline = true;
        try {
          online = await fetchOnlineCount(local);
        } catch (e) {
          isOnline = false;
          online = 0;
          console.error("[ONLINE] fetch failed:", e?.message || e);
        }

        await updateStatus(remote, isOnline, online);

        console.log(`[SYNC OK] leaderboard_rows=${rowsSynced} online=${online}`);
      } catch (e) {
        // Nếu local lỗi => KHÔNG TRUNCATE gì thêm (vì chưa vào sync)
        console.error("[LOCAL SYNC FAIL] => fallback schema-only:", e?.message || e);
      }
    } else {
      // 2) Không có local => chỉ fix schema, nhưng vẫn set status OFF nhẹ để tránh stale
      await updateStatus(remote, false, 0);
      console.log("[SCHEMA ONLY] fixed columns + reordered. status set OFF.");
    }

    // In ra thứ tự cột cho bạn nhìn
    const [cols] = await remote.query(`SHOW COLUMNS FROM characters_light`);
    console.log("[characters_light columns]");
    cols.forEach((c, i) => console.log(`${i + 1}. ${c.Field}`));
  } catch (e) {
    console.error("[SYNC FAIL]", e?.message || e);
    process.exitCode = 1;
  } finally {
    try { if (local) await local.end(); } catch {}
    try { if (remote) await remote.end(); } catch {}
  }
}

main();

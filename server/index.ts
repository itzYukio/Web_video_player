import express, { Request, Response, NextFunction } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import mime from "mime-types";
import Redis from "ioredis";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || "/media");
const DATA_ROOT = path.resolve(process.env.DATA_ROOT || "/data");
const SESSION_TTL = Number(process.env.SESSION_TTL || 2592000);
const THUMB_WIDTH = Number(process.env.THUMB_WIDTH || 640);
const VIDEO_EXTENSIONS = new Set((process.env.VIDEO_EXTENSIONS || "mp4,mkv,webm,m4v,mov,avi,ts,mts,m2ts").split(",").map(x => x.trim().toLowerCase()).filter(Boolean));

await fs.mkdir(DATA_ROOT, { recursive: true });
await fs.mkdir(path.join(DATA_ROOT, "thumbs"), { recursive: true });
await fs.mkdir(path.join(DATA_ROOT, "subtitles"), { recursive: true });

const db = new Database(path.join(DATA_ROOT, "library.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL,
  video_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, video_path),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS history (
  user_id INTEGER NOT NULL,
  video_path TEXT NOT NULL,
  watched_at INTEGER NOT NULL,
  position REAL NOT NULL DEFAULT 0,
  duration REAL NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, video_path),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS media_meta (
  video_path TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  duration REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
`);

let redis: Redis | null = null;
const redisUrl = process.env.REDIS_URL || "";
if (redisUrl) {
  redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2, enableOfflineQueue: false });
  redis.on("error", e => console.error("[redis]", e.message));
  try { await redis.connect(); await redis.ping(); } catch (e: any) {
    console.error("[redis] unavailable:", e?.message || e);
    redis = null;
  }
}

const sessionKey = (hash: string) => `vpl:session:${hash}`;
const progressKey = (userId: number, videoPath: string) => `vpl:progress:${userId}:${safeRelative(videoPath)}`;

type AuthRequest = Request & { user?: { id: number; username: string } };

function safeRelative(input: string | undefined): string {
  const value = (input || "").replace(/\\/g, "/");
  const cleaned = path.posix.normalize("/" + value).replace(/^\/+/, "");
  if (cleaned === ".." || cleaned.startsWith("../")) throw new Error("Invalid path");
  return cleaned;
}
function absolutePath(relative: string): string {
  const safe = safeRelative(relative);
  const absolute = path.resolve(MEDIA_ROOT, safe);
  if (absolute !== MEDIA_ROOT && !absolute.startsWith(MEDIA_ROOT + path.sep)) throw new Error("Path escapes media root");
  return absolute;
}
function isVideo(name: string) { return VIDEO_EXTENSIONS.has(path.extname(name).slice(1).toLowerCase()); }
function titleFor(name: string) { return name.replace(/\.[^.]+$/, ""); }
function baseName(name: string) { return name.replace(/\.(?:srt|vtt)$/i, "").replace(/\.[a-z]{2,3}$/i, ""); }
function hashText(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }

function parseEpisode(name: string) {
  const stem = titleFor(name);
  let m = stem.match(/(?:^|[\s._-])S(\d{1,3})[\s._-]*E(\d{1,3})(?:$|[\s._-])/i);
  if (m) return { season: Number(m[1]), episode: Number(m[2]), label: `S${String(Number(m[1])).padStart(2,"0")}E${String(Number(m[2])).padStart(2,"0")}` };
  m = stem.match(/(?:^|[\s._-])(\d{1,2})x(\d{1,3})(?:$|[\s._-])/i);
  if (m) return { season: Number(m[1]), episode: Number(m[2]), label: `S${String(Number(m[1])).padStart(2,"0")}E${String(Number(m[2])).padStart(2,"0")}` };
  m = stem.match(/(?:^|[\s._-])(?:episode|ep)[\s._-]*(\d{1,4})(?:$|[\s._-])/i);
  if (m) return { season: 1, episode: Number(m[1]), label: `EP${String(Number(m[1])).padStart(2,"0")}` };
  return null;
}

function auth(req: AuthRequest, res: Response, next: NextFunction) {
  if (!redis) return res.status(503).json({ error: "Redis is required for authentication. Check REDIS_URL." });
  const raw = req.cookies?.vpl_session || req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!raw) return res.status(401).json({ error: "Authentication required" });
  const hash = hashText(raw);
  redis.get(sessionKey(hash)).then(async value => {
    if (!value) return res.status(401).json({ error: "Session expired" });
    try {
      const session = JSON.parse(value);
      req.user = session;
      await redis!.expire(sessionKey(hash), SESSION_TTL);
      next();
    } catch { res.status(401).json({ error: "Invalid session" }); }
  }).catch(() => res.status(503).json({ error: "Session store unavailable" }));
}

app.use(express.json({ limit: "64kb" }));
app.use((req, _res, next) => {
  const cookie = req.headers.cookie || "";
  (req as any).cookies = Object.fromEntries(cookie.split(";").map(x => x.trim()).filter(Boolean).map(x => {
    const i = x.indexOf("="); return [i > -1 ? x.slice(0,i) : x, i > -1 ? decodeURIComponent(x.slice(i+1)) : ""];
  }));
  next();
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false });

async function ensureAdmin() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  if (count.c === 0) {
    const username = (process.env.ADMIN_USERNAME || "admin").trim();
    const password = process.env.ADMIN_PASSWORD || "";
    if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters on first start.");
    const now = Date.now();
    const hash = await bcrypt.hash(password, 12);
    db.prepare("INSERT INTO users(username,password_hash,created_at,updated_at) VALUES(?,?,?,?)").run(username, hash, now, now);
    console.log(`[auth] created initial user: ${username}`);
  }
}
await ensureAdmin();

app.get("/api/health", async (_req, res) => {
  let redisStatus = "disabled";
  if (redis) { try { await redis.ping(); redisStatus = "ok"; } catch { redisStatus = "error"; } }
  res.json({ ok: true, redis: redisStatus, ffmpeg: await commandExists("ffmpeg"), mediaRoot: MEDIA_ROOT });
});

app.post("/api/auth/login", loginLimiter, async (req, res) => {
  if (!redis) return res.status(503).json({ error: "Redis is unavailable." });
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const user = db.prepare("SELECT id,username,password_hash FROM users WHERE username=?").get(username) as any;
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: "Invalid username or password." });
  const token = crypto.randomBytes(32).toString("base64url");
  await redis.set(sessionKey(hashText(token)), JSON.stringify({ id: user.id, username: user.username }), "EX", SESSION_TTL);
  res.setHeader("Set-Cookie", `vpl_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  res.json({ user: { id: user.id, username: user.username } });
});

app.post("/api/auth/logout", auth, async (req: AuthRequest, res) => {
  const raw = (req as any).cookies?.vpl_session;
  if (redis && raw) await redis.del(sessionKey(hashText(raw))).catch(() => {});
  res.setHeader("Set-Cookie", "vpl_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/auth/me", auth, (req: AuthRequest, res) => res.json({ user: req.user }));

app.post("/api/auth/password", auth, async (req: AuthRequest, res) => {
  const oldPassword = String(req.body?.oldPassword || "");
  const newPassword = String(req.body?.newPassword || "");
  if (newPassword.length < 12) return res.status(400).json({ error: "New password must be at least 12 characters." });
  const user = db.prepare("SELECT password_hash FROM users WHERE id=?").get(req.user!.id) as any;
  if (!user || !(await bcrypt.compare(oldPassword, user.password_hash))) return res.status(401).json({ error: "Current password is incorrect." });
  const hash = await bcrypt.hash(newPassword, 12);
  db.prepare("UPDATE users SET password_hash=?,updated_at=? WHERE id=?").run(hash, Date.now(), req.user!.id);
  res.json({ ok: true });
});

async function readFolder(relative: string) {
  const folder = absolutePath(relative);
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const folders: any[] = [], videos: any[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) folders.push({ name: entry.name, path: child });
    else if (entry.isFile() && isVideo(entry.name)) {
      const ep = parseEpisode(entry.name);
      videos.push({ name: entry.name, title: titleFor(entry.name), path: child, episode: ep });
    }
  }
  const sorter = (a:any,b:any) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  folders.sort(sorter);
  videos.sort((a,b) => {
    if (a.episode && b.episode) return (a.episode.season-b.episode.season) || (a.episode.episode-b.episode.episode) || sorter(a,b);
    return sorter(a,b);
  });
  return { path: relative, name: relative ? path.posix.basename(relative) : "Library", breadcrumbs: relative ? relative.split("/") : [], folders, videos };
}

app.get("/api/folders", auth, async (req, res) => {
  try { res.json(await readFolder(safeRelative(String(req.query.path || "")))); }
  catch (e:any) { res.status(e?.code === "ENOENT" ? 404 : 400).json({ error: e?.message || "Unable to read folder" }); }
});

async function videoExists(videoPath: string) {
  const p = absolutePath(videoPath);
  const st = await fs.stat(p);
  if (!st.isFile() || !isVideo(p)) throw new Error("Invalid video");
  return { p, st };
}

app.get("/api/video/:action", auth, async (req, res) => {
  const videoPath = safeRelative(String(req.query.path || ""));
  try {
    const { p, st } = await videoExists(videoPath);
    const ep = parseEpisode(path.basename(p));
    if (req.params.action === "info") {
      const fav = db.prepare("SELECT 1 AS ok FROM favorites WHERE user_id=? AND video_path=?").get(req.user!.id, videoPath) as any;
      const h = db.prepare("SELECT watched_at,position,duration,completed FROM history WHERE user_id=? AND video_path=?").get(req.user!.id, videoPath) as any;
      let progress = h?.position || 0;
      if (redis) { const raw = await redis.get(progressKey(req.user!.id, videoPath)).catch(() => null); if (raw) progress = JSON.parse(raw).position || progress; }
      res.json({ path: videoPath, name: path.basename(p), title: titleFor(path.basename(p)), size: st.size, mtime: st.mtimeMs, episode: ep, favorite: !!fav, progress, duration: h?.duration || 0 });
    }
  } catch (e:any) { res.status(404).json({ error: e?.message || "Not found" }); }
});

app.get("/api/subtitles", auth, async (req, res) => {
  try {
    const videoPath = safeRelative(String(req.query.path || ""));
    const video = await videoExists(videoPath);
    const dir = path.dirname(video.p), stem = path.basename(video.p).replace(/\.[^.]+$/, "");
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const tracks: any[] = [];
    for (const e of entries) {
      if (!e.isFile() || !/\.(srt|vtt)$/i.test(e.name)) continue;
      const b = baseName(e.name);
      if (b !== stem && !b.startsWith(stem + ".")) continue;
      const match = e.name.match(/\.([a-z]{2,3})\.(srt|vtt)$/i);
      tracks.push({ name: e.name, path: `${path.posix.dirname(videoPath) === "." ? "" : path.posix.dirname(videoPath) + "/"}${e.name}`, language: match?.[1]?.toLowerCase() || "und", format: e.name.toLowerCase().endsWith(".srt") ? "srt" : "vtt" });
    }
    tracks.sort((a,b) => a.language.localeCompare(b.language));
    res.json({ tracks });
  } catch (e:any) { res.status(400).json({ error: e?.message || "Unable to read subtitles" }); }
});

app.get("/subtitles", auth, async (req, res) => {
  try {
    const relative = safeRelative(String(req.query.path || ""));
    const source = absolutePath(relative);
    const stat = await fs.stat(source);
    if (!/\.(srt|vtt)$/i.test(source)) return res.status(404).end();
    if (source.toLowerCase().endsWith(".vtt")) {
      res.type("text/vtt").send(await fs.readFile(source, "utf8")); return;
    }
    const key = hashText(`${relative}:${stat.size}:${stat.mtimeMs}`);
    const cache = path.join(DATA_ROOT, "subtitles", `${key}.vtt`);
    try {
      const cached = await fs.readFile(cache, "utf8"); res.type("text/vtt").send(cached); return;
    } catch {}
    const srt = await fs.readFile(source, "utf8");
    const vtt = srtToVtt(srt);
    await fs.writeFile(cache, vtt);
    res.type("text/vtt").send(vtt);
  } catch (e:any) { res.status(404).json({ error: e?.message || "Subtitle not found" }); }
});

function srtToVtt(input: string) {
  const normalized = input.replace(/^\uFEFF/, "").replace(/\r\n/g,"\n").replace(/\r/g,"\n");
  const lines = normalized.split("\n");
  const out = ["WEBVTT", ""];
  for (const line of lines) out.push(line.replace(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/g, "$1:$2:$3.$4"));
  return out.join("\n");
}

app.get("/api/thumb", auth, async (req, res) => {
  try {
    const relative = safeRelative(String(req.query.path || ""));
    const { p, st } = await videoExists(relative);
    const key = hashText(`${relative}:${st.size}:${st.mtimeMs}`);
    const thumb = path.join(DATA_ROOT, "thumbs", `${key}.jpg`);
    try {
      const t = await fs.stat(thumb);
      if (t.size > 0) return res.sendFile(thumb);
    } catch {}
    await generateThumbnail(p, thumb);
    res.sendFile(thumb);
  } catch (e:any) { res.status(404).end(); }
});

function generateThumbnail(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-hide_banner","-loglevel","error","-ss","00:00:05","-i",input,"-frames:v","1","-vf",`scale=${THUMB_WIDTH}:-2`, "-q:v","3","-y",output]);
    let stderr = "";
    ff.stderr.on("data", d => stderr += d.toString());
    ff.on("error", reject);
    ff.on("close", code => code === 0 ? resolve() : reject(new Error(stderr || "ffmpeg failed")));
  });
}

app.get("/api/continue", auth, async (req, res) => {
  const rows = db.prepare("SELECT video_path AS path,watched_at,position,duration,completed FROM history WHERE user_id=? AND completed=0 AND position>0 ORDER BY watched_at DESC LIMIT 20").all(req.user!.id) as any[];
  res.json({ items: rows });
});

app.get("/api/history", auth, async (req, res) => {
  const rows = db.prepare("SELECT video_path AS path,watched_at,position,duration,completed FROM history WHERE user_id=? ORDER BY watched_at DESC LIMIT 100").all(req.user!.id) as any[];
  res.json({ items: rows });
});

app.get("/api/favorites", auth, (_req: AuthRequest, res) => {
  const rows = db.prepare("SELECT video_path AS path,created_at FROM favorites WHERE user_id=? ORDER BY created_at DESC").all(_req.user!.id);
  res.json({ items: rows });
});

app.post("/api/favorite", auth, async (req: AuthRequest, res) => {
  const videoPath = safeRelative(String(req.body?.path || ""));
  const exists = db.prepare("SELECT 1 FROM favorites WHERE user_id=? AND video_path=?").get(req.user!.id, videoPath);
  if (exists) db.prepare("DELETE FROM favorites WHERE user_id=? AND video_path=?").run(req.user!.id, videoPath);
  else db.prepare("INSERT INTO favorites(user_id,video_path,created_at) VALUES(?,?,?)").run(req.user!.id, videoPath, Date.now());
  res.json({ favorite: !exists });
});

app.post("/api/progress", auth, async (req: AuthRequest, res) => {
  const videoPath = safeRelative(String(req.body?.path || ""));
  const position = Math.max(0, Number(req.body?.position || 0));
  const duration = Math.max(0, Number(req.body?.duration || 0));
  const completed = Boolean(req.body?.completed) || (duration > 0 && position >= duration * 0.95);
  const now = Date.now();
  db.prepare(`
    INSERT INTO history(user_id,video_path,watched_at,position,duration,completed)
    VALUES(?,?,?,?,?,?)
    ON CONFLICT(user_id,video_path) DO UPDATE SET watched_at=excluded.watched_at,position=excluded.position,duration=excluded.duration,completed=excluded.completed
  `).run(req.user!.id, videoPath, now, position, duration, completed ? 1 : 0);
  if (redis) await redis.set(progressKey(req.user!.id, videoPath), JSON.stringify({ position, duration, updatedAt: now }), "EX", 60*60*24*180).catch(()=>{});
  res.json({ ok: true });
});

app.delete("/api/history", auth, (req: AuthRequest, res) => {
  const videoPath = safeRelative(String(req.query.path || ""));
  db.prepare("DELETE FROM history WHERE user_id=? AND video_path=?").run(req.user!.id, videoPath);
  if (redis) redis.del(progressKey(req.user!.id, videoPath)).catch(()=>{});
  res.json({ ok: true });
});


function detectProfile(ua: string) {
  const u = ua.toLowerCase();
  if (/iphone|ipad|ipod/.test(u) || /safari/.test(u) && !/chrome|chromium|android/.test(u)) {
    return { id: "safari-h264", ext: "mp4", video: "libx264", audio: "aac", audioBitrate: "160k", args: ["-profile:v","high","-level","4.1","-pix_fmt","yuv420p","-preset","veryfast","-crf","22","-c:a","aac","-b:a","160k","-movflags","+faststart"] };
  }
  if (/firefox/.test(u)) {
    return { id: "firefox-vp9", ext: "webm", video: "libvpx-vp9", audio: "libopus", audioBitrate: "128k", args: ["-c:v","libvpx-vp9","-crf","32","-b:v","0","-deadline","good","-cpu-used","4","-c:a","libopus","-b:a","128k"] };
  }
  if (/chrome|chromium|edg\//.test(u)) {
    return { id: "chromium-vp9", ext: "webm", video: "libvpx-vp9", audio: "libopus", audioBitrate: "128k", args: ["-c:v","libvpx-vp9","-crf","32","-b:v","0","-deadline","good","-cpu-used","4","-c:a","libopus","-b:a","128k"] };
  }
  return { id: "universal-h264", ext: "mp4", video: "libx264", audio: "aac", audioBitrate: "160k", args: ["-profile:v","high","-level","4.1","-pix_fmt","yuv420p","-preset","veryfast","-crf","22","-c:a","aac","-b:a","160k","-movflags","+faststart"] };
}

async function ffprobe(input: string) {
  return new Promise<any>((resolve, reject) => {
    const p = spawn("ffprobe", ["-v","error","-print_format","json","-show_streams","-show_format",input]);
    let out="", err="";
    p.stdout.on("data", d => out += d.toString());
    p.stderr.on("data", d => err += d.toString());
    p.on("error", reject);
    p.on("close", code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err || "ffprobe failed")));
  });
}

function sourceCompatible(info: any, profile: ReturnType<typeof detectProfile>) {
  const v = info?.streams?.find((x:any)=>x.codec_type==="video");
  const a = info?.streams?.find((x:any)=>x.codec_type==="audio");
  if (!v) return false;
  if (profile.ext === "mp4") {
    return ["h264"].includes(v.codec_name) && (!a || ["aac","mp3"].includes(a.codec_name)) &&
      (!v.pix_fmt || ["yuv420p","yuvj420p"].includes(v.pix_fmt));
  }
  return ["vp9","vp8"].includes(v.codec_name) && (!a || ["opus","vorbis"].includes(a.codec_name));
}

const transcodeLocks = new Map<string, Promise<string>>();

async function ensureTranscoded(input: string, relative: string, profile: ReturnType<typeof detectProfile>) {
  const st = await fs.stat(input);
  const key = hashText(`${relative}:${st.size}:${st.mtimeMs}:${profile.id}`);
  const output = path.join(DATA_ROOT, "transcoded", `${key}.${profile.ext}`);
  await fs.mkdir(path.dirname(output), { recursive: true });

  try {
    const cached = await fs.stat(output);
    if (cached.size > 1024) return output;
  } catch {}

  const lockKey = `${output}`;
  const existing = transcodeLocks.get(lockKey);
  if (existing) return existing;

  const job = new Promise<string>((resolve, reject) => {
    console.log(`[transcode] ${relative} -> ${profile.id}`);
    const args = ["-hide_banner","-loglevel","error","-i",input,"-map","0:v:0","-map","0:a:0?"];
    args.push(...profile.args, "-y", output);
    const ff = spawn("ffmpeg", args);
    let stderr = "";
    ff.stderr.on("data", d => stderr += d.toString());
    ff.on("error", reject);
    ff.on("close", code => code === 0 ? resolve(output) : reject(new Error(stderr || "FFmpeg transcoding failed")));
  }).finally(() => transcodeLocks.delete(lockKey));

  transcodeLocks.set(lockKey, job);
  return job;
}

async function sendRangeFile(req: Request, res: Response, filePath: string, contentType: string) {
  const st = await fs.stat(filePath);
  const size = st.size;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");
  const range = req.headers.range;
  if (!range) {
    res.setHeader("Content-Length", size);
    createReadStream(filePath).pipe(res);
    return;
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m) return res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
  let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]) - 1);
  let end = m[2] ? Number(m[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
  }
  end = Math.min(end, size - 1);
  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  res.setHeader("Content-Length", end - start + 1);
  createReadStream(filePath, { start, end }).pipe(res);
}

app.get("/stream", auth, async (req: Request, res: Response) => {
  try {
    const relative = safeRelative(String(req.query.path || ""));
    const { p } = await videoExists(relative);
    const profile = detectProfile(String(req.headers["user-agent"] || ""));
    let info: any;
    try { info = await ffprobe(p); } catch {}
    let streamFile = p;
    let type = mime.getType(p) || "application/octet-stream";

    if (!info || !sourceCompatible(info, profile)) {
      streamFile = await ensureTranscoded(p, relative, profile);
      type = profile.ext === "webm" ? "video/webm" : "video/mp4";
    }

    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(path.basename(p))}`);
    res.setHeader("X-Video-Delivery", streamFile === p ? "direct" : `transcoded:${profile.id}`);
    await sendRangeFile(req, res, streamFile, type);
  } catch (e:any) {
    console.error("[stream]", e);
    res.status(500).json({ error: e?.message || "Unable to prepare video stream" });
  }
});

const dist = path.resolve(process.cwd(), "dist");
app.use(express.static(dist));
app.get(/^(?!\/api|\/stream|\/subtitles|\/thumb).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));

async function commandExists(command: string) {
  return new Promise<boolean>(resolve => {
    const p = spawn(command, ["-version"]);
    p.on("error", () => resolve(false)); p.on("close", code => resolve(code === 0));
  });
}

app.listen(PORT, HOST, () => console.log(`VPS Video Library v2 listening on ${HOST}:${PORT}`));

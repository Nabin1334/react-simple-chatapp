const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const express = require("express");
const { DatabaseSync } = require("node:sqlite");

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = "kurakane_session";
const LEGACY_SESSION_COOKIE = "gather_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RATE_LIMIT_ENTRIES = 10000;
const SESSION_COOKIE_OPTIONS = "Path=/; HttpOnly; SameSite=Strict";
const DUMMY_SALT = Buffer.from("9f5f4f5a608217a7c5a9a679f9d3c6e1", "hex");

function getCookieValue(cookieHeader, cookieName) {
	if (typeof cookieHeader !== "string") {
		return null;
	}

	for (const part of cookieHeader.split(";")) {
		const separatorIndex = part.indexOf("=");
		if (separatorIndex === -1 || part.slice(0, separatorIndex).trim() !== cookieName) {
			continue;
		}
		return part.slice(separatorIndex + 1).trim() || null;
	}
	return null;
}

function hashSessionToken(token) {
	return crypto.createHash("sha256").update(token).digest("hex");
}

function createAuthService({ databasePath, cookieSecure, io }) {
	fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
	const database = new DatabaseSync(databasePath);
	database.exec(`
		PRAGMA foreign_keys = ON;
		PRAGMA journal_mode = WAL;
		PRAGMA busy_timeout = 5000;
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY,
			email TEXT NOT NULL UNIQUE COLLATE NOCASE,
			display_name TEXT NOT NULL,
			password_salt BLOB NOT NULL,
			password_hash BLOB NOT NULL,
			created_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS sessions (
			token_hash TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			expires_at INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
	`);
	if (databasePath !== ":memory:") {
		fs.chmodSync(databasePath, 0o600);
	}

	const router = express.Router();
	const findUserByEmail = database.prepare(
		"SELECT id, email, display_name AS displayName, password_salt AS salt, password_hash AS hash FROM users WHERE email = ?",
	);
	const findUserById = database.prepare(
		"SELECT id, email, display_name AS displayName FROM users WHERE id = ?",
	);
	const findSession = database.prepare(
		"SELECT token_hash AS sessionHash, user_id AS userId, expires_at AS expiresAt FROM sessions WHERE token_hash = ? AND expires_at > ?",
	);
	const removeExpiredSessions = database.prepare("DELETE FROM sessions WHERE expires_at <= ?");
	const removeSession = database.prepare("DELETE FROM sessions WHERE token_hash = ?");
	const insertSession = database.prepare(
		"INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
	);

	function publicUser(user) {
		return {
			id: user.id,
			email: user.email,
			displayName: user.displayName,
		};
	}

	function getSessionFromToken(token) {
		if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,50}$/.test(token)) {
			return null;
		}
		const sessionHash = hashSessionToken(token);
		const session = findSession.get(sessionHash, Date.now());
		if (!session) {
			return null;
		}
		const user = findUserById.get(session.userId);
		return user ? { sessionHash, expiresAt: session.expiresAt, user: publicUser(user) } : null;
	}

	function getSessionFromCookie(cookieHeader) {
		const token = getCookieValue(cookieHeader, SESSION_COOKIE)
			|| getCookieValue(cookieHeader, LEGACY_SESSION_COOKIE);
		return getSessionFromToken(token);
	}

	function setSessionCookie(res, token) {
		const secureAttribute = cookieSecure ? "; Secure" : "";
		res.setHeader(
			"Set-Cookie",
			`${SESSION_COOKIE}=${token}; ${SESSION_COOKIE_OPTIONS}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secureAttribute}`,
		);
	}

	function clearSessionCookie(res) {
		const secureAttribute = cookieSecure ? "; Secure" : "";
		res.setHeader(
			"Set-Cookie",
			[
				`${SESSION_COOKIE}=; ${SESSION_COOKIE_OPTIONS}; Max-Age=0${secureAttribute}`,
				`${LEGACY_SESSION_COOKIE}=; ${SESSION_COOKIE_OPTIONS}; Max-Age=0${secureAttribute}`,
			],
		);
	}

	function issueSession(userId, res) {
		removeExpiredSessions.run(Date.now());
		const token = crypto.randomBytes(32).toString("base64url");
		insertSession.run(hashSessionToken(token), userId, Date.now() + SESSION_TTL_MS);
		setSessionCookie(res, token);
	}

	const attemptsByIp = new Map();
	router.use((req, res, next) => {
		if (req.method !== "POST" || !["/login", "/signup"].includes(req.path)) {
			return next();
		}

		const now = Date.now();
		const key = req.ip || req.socket.remoteAddress || "unknown";
		let attempt = attemptsByIp.get(key);
		if (!attempt || now - attempt.startedAt >= 60 * 1000) {
			attempt = { startedAt: now, count: 0 };
		}
		attempt.count += 1;
		attemptsByIp.set(key, attempt);
		if (attemptsByIp.size > MAX_RATE_LIMIT_ENTRIES) {
			for (const [ip, entry] of attemptsByIp) {
				if (now - entry.startedAt >= 60 * 1000) {
					attemptsByIp.delete(ip);
				}
			}
			while (attemptsByIp.size > MAX_RATE_LIMIT_ENTRIES) {
				attemptsByIp.delete(attemptsByIp.keys().next().value);
			}
		}
		if (attempt.count > 10) {
			res.setHeader("Retry-After", Math.ceil((attempt.startedAt + 60 * 1000 - now) / 1000));
			return res.status(429).json({ error: "Too many attempts. Please wait a minute and try again." });
		}
		next();
	});

	router.get("/me", (req, res) => {
		const session = getSessionFromCookie(req.headers.cookie);
		if (!session) {
			return res.status(401).json({ error: "Authentication required." });
		}
		res.json({ user: session.user });
	});

	router.post("/signup", async (req, res, next) => {
		try {
			const { displayName, email, password } = req.body || {};
			if (
				typeof displayName !== "string"
				|| typeof email !== "string"
				|| typeof password !== "string"
			) {
				return res.status(400).json({ error: "Name, email, and password are required." });
			}

			const normalizedName = displayName.trim();
			const normalizedEmail = email.trim().toLowerCase();
			if (!normalizedName || normalizedName.length > 80) {
				return res.status(400).json({ error: "Name must be between 1 and 80 characters." });
			}
			if (
				normalizedEmail.length > 254
				|| !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
			) {
				return res.status(400).json({ error: "Enter a valid email address." });
			}
			if (password.length < 12 || Buffer.byteLength(password, "utf8") > 128) {
				return res.status(400).json({ error: "Use a password with at least 12 characters and no more than 128 bytes." });
			}

			const salt = crypto.randomBytes(16);
			const passwordHash = await scrypt(password, salt, 64);
			let result;
			try {
				result = database.prepare(
					"INSERT INTO users (email, display_name, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
				).run(normalizedEmail, normalizedName, salt, passwordHash, Date.now());
			} catch (error) {
				if (error.errcode === 2067) {
					return res.status(409).json({ error: "An account with that email already exists." });
				}
				throw error;
			}

			const user = findUserById.get(Number(result.lastInsertRowid));
			issueSession(user.id, res);
			res.status(201).json({ user: publicUser(user) });
		} catch (error) {
			next(error);
		}
	});

	router.post("/login", async (req, res, next) => {
		try {
			const { email, password } = req.body || {};
			if (typeof email !== "string" || typeof password !== "string" || Buffer.byteLength(password, "utf8") > 128) {
				return res.status(400).json({ error: "Email and password are required." });
			}

			const user = findUserByEmail.get(email.trim().toLowerCase());
			const salt = user ? user.salt : DUMMY_SALT;
			const actualHash = await scrypt(password, salt, 64);
			const validPassword = user
				&& actualHash.length === user.hash.length
				&& crypto.timingSafeEqual(actualHash, user.hash);
			if (!validPassword) {
				return res.status(401).json({ error: "Invalid email or password." });
			}

			issueSession(user.id, res);
			res.json({ user: publicUser(user) });
		} catch (error) {
			next(error);
		}
	});

	router.post("/logout", (req, res) => {
		const session = getSessionFromCookie(req.headers.cookie);
		if (session) {
			removeSession.run(session.sessionHash);
			for (const socket of io.sockets.sockets.values()) {
				if (socket.data.sessionHash === session.sessionHash) {
					socket.disconnect(true);
				}
			}
		}
		clearSessionCookie(res);
		res.status(204).end();
	});

	return {
		router,
		getSessionFromCookie,
		close: () => database.close(),
	};
}

module.exports = { createAuthService };

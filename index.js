const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");
const { createAuthService } = require("./auth");

const app = express();
const server = http.createServer(app);
const clientBuildPath = path.join(__dirname, "client", "build");
const clientIndexPath = path.join(clientBuildPath, "index.html");
const port = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);
app.use((req, res, next) => {
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("X-Frame-Options", "DENY");
	res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
	res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
	if (isProduction) {
		res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
	}
	next();
});

const configuredOrigins = (process.env.CLIENT_ORIGIN || "")
	.split(",")
	.map((origin) => origin.trim())
	.filter(Boolean)
	.map((origin) => {
		const parsedOrigin = new URL(origin);
		if (
			(parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:")
			|| parsedOrigin.username
			|| parsedOrigin.password
			|| parsedOrigin.pathname !== "/"
			|| parsedOrigin.search
			|| parsedOrigin.hash
		) {
			throw new Error(`Invalid CLIENT_ORIGIN value: ${origin}`);
		}
		return parsedOrigin.origin;
	});
const developmentOrigins = isProduction
	? []
	: ["http://localhost:3000", "http://127.0.0.1:3000"];
const knownOrigins = new Set([...configuredOrigins, ...developmentOrigins]);

function isAllowedOrigin(origin, requestHost) {
	if (typeof origin !== "string" || origin === "null") {
		return false;
	}

	try {
		const parsedOrigin = new URL(origin);
		if (parsedOrigin.origin !== origin || (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:")) {
			return false;
		}

		if (knownOrigins.has(parsedOrigin.origin)) {
			return true;
		}

		const requiredProtocol = isProduction ? "https:" : parsedOrigin.protocol;
		return parsedOrigin.host.toLowerCase() === String(requestHost || "").toLowerCase()
			&& parsedOrigin.protocol === requiredProtocol;
	} catch {
		return false;
	}
}

app.use((req, res, next) => cors({
	origin: (origin, callback) => {
		callback(null, origin && isAllowedOrigin(origin, req.get("host")) ? origin : false);
	},
	credentials: true,
	methods: ["GET", "POST"],
	allowedHeaders: ["Content-Type"],
})(req, res, next));
app.use(express.json({ limit: "16kb" }));
app.use("/auth", (req, res, next) => {
	if (req.method === "POST" && !isAllowedOrigin(req.get("Origin"), req.get("host"))) {
		return res.status(403).json({ error: "Request origin is not allowed." });
	}
	next();
});

const io = new Server(server, {
	cors: {
		origin: Array.from(knownOrigins),
		credentials: true,
	},
	transports: ["websocket", "polling"],
	maxHttpBufferSize: 128 * 1024,
});
const CALL_TIMEOUT_MS = 60 * 1000;

const authService = createAuthService({
	databasePath: process.env.AUTH_DATABASE_PATH || path.join(__dirname, "data", "auth.sqlite"),
	cookieSecure: isProduction,
	io,
});
app.use("/auth", authService.router);

io.use((socket, next) => {
	const authenticatedSession = authService.getSessionFromCookie(socket.handshake.headers.cookie);
	if (!authenticatedSession) {
		return next(new Error("Authentication required."));
	}

	socket.data.userId = authenticatedSession.user.id;
	socket.data.displayName = authenticatedSession.user.displayName;
	socket.data.sessionHash = authenticatedSession.sessionHash;
	socket.data.expiresAt = authenticatedSession.expiresAt;
	next();
});

io.engine.allowRequest = (req, callback) => {
	const origin = req.headers.origin;
	const authenticated = Boolean(authService.getSessionFromCookie(req.headers.cookie));
	callback(null, authenticated && (!origin || isAllowedOrigin(origin, req.headers.host)));
};

app.get("/health", (req, res) => {
	res.send("Running");
});

const peerForSocket = new Map();
const pendingCallTimeouts = new Map();

function clearPendingCallTimeout(socketId) {
	const timeout = pendingCallTimeouts.get(socketId);
	if (!timeout) {
		return;
	}

	clearTimeout(timeout);
	for (const [peerId, pendingTimeout] of pendingCallTimeouts) {
		if (pendingTimeout === timeout) {
			pendingCallTimeouts.delete(peerId);
		}
	}
}

function isValidSignal(signal) {
	if (!signal || typeof signal !== "object" || Array.isArray(signal)) {
		return false;
	}

	try {
		return Buffer.byteLength(JSON.stringify(signal), "utf8") <= 64 * 1024;
	} catch {
		return false;
	}
}

function endCallFor(socketId) {
	clearPendingCallTimeout(socketId);
	const peerId = peerForSocket.get(socketId);
	peerForSocket.delete(socketId);
	if (peerId) {
		peerForSocket.delete(peerId);
		io.to(peerId).emit("callEnded");
	}
}

io.on("connection", (socket) => {
	const sessionTimeout = setTimeout(
		() => socket.disconnect(true),
		Math.max(0, socket.data.expiresAt - Date.now()),
	);
	sessionTimeout.unref();
	socket.emit("me", socket.id);

	socket.on("disconnect", () => {
		clearTimeout(sessionTimeout);
		endCallFor(socket.id);
	});

	socket.on("callUser", (data) => {
		const targetId = data && data.userToCall;
		if (
			typeof targetId !== "string"
			|| targetId === socket.id
			|| !io.sockets.sockets.has(targetId)
			|| peerForSocket.has(socket.id)
			|| peerForSocket.has(targetId)
			|| !isValidSignal(data.signalData)
		) {
			socket.emit("callError", "That person cannot be called right now.");
			return;
		}

		peerForSocket.set(socket.id, targetId);
		peerForSocket.set(targetId, socket.id);
		const timeout = setTimeout(() => {
			if (peerForSocket.get(socket.id) !== targetId) {
				return;
			}
			clearPendingCallTimeout(socket.id);
			peerForSocket.delete(socket.id);
			peerForSocket.delete(targetId);
			io.to(socket.id).emit("callError", "No answer. The call has ended.");
			io.to(targetId).emit("callEnded");
		}, CALL_TIMEOUT_MS);
		timeout.unref();
		pendingCallTimeouts.set(socket.id, timeout);
		pendingCallTimeouts.set(targetId, timeout);
		io.to(targetId).emit("callUser", {
			signal: data.signalData,
			from: socket.id,
			name: socket.data.displayName,
		});
	});

	socket.on("answerCall", (data) => {
		const targetId = data && data.to;
		if (
			typeof targetId !== "string"
			|| peerForSocket.get(socket.id) !== targetId
			|| !isValidSignal(data.signal)
		) {
			socket.emit("callError", "This call is no longer available.");
			return;
		}

		clearPendingCallTimeout(socket.id);
		io.to(targetId).emit("callAccepted", data.signal);
	});

	socket.on("callEnded", () => {
		endCallFor(socket.id);
	});
});

if (fs.existsSync(clientIndexPath)) {
	app.use(express.static(clientBuildPath, {
		dotfiles: "deny",
		index: false,
	}));
	app.get("*", (req, res) => {
		res.sendFile(clientIndexPath);
	});
} else {
	app.get("/", (req, res) => {
		res.status(503).send("Client build not found. Run npm run build before starting the production server.");
	});
}

server.on("error", (error) => {
	if (error.code === "EADDRINUSE") {
		console.error(`Port ${port} is already in use. Stop the other process or set PORT to a different available port.`);
		authService.close();
		process.exitCode = 1;
		return;
	}
	throw error;
});

app.use((error, req, res, next) => {
	console.error("Request failed:", error);
	if (res.headersSent) {
		return next(error);
	}
	const requestedStatus = Number(error.statusCode || error.status);
	const statusCode = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus < 500
		? requestedStatus
		: 500;
	const message = error.type === "entity.too.large"
		? "Request body is too large."
		: error.type === "entity.parse.failed"
			? "Invalid JSON request body."
			: "An unexpected server error occurred.";
	res.status(statusCode).json({ error: message });
});

server.listen(port, () => {
	console.log(`Server is running on port ${port}`);
});

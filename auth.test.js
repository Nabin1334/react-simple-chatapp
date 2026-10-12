const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createAuthService } = require("./auth");

async function createHarness(cookieSecure = false) {
	const sockets = new Map();
	const io = { sockets: { sockets } };
	const authService = createAuthService({
		databasePath: ":memory:",
		cookieSecure,
		io,
	});
	const app = express();
	app.use(express.json());
	app.use(authService.router);
	const server = http.createServer(app);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();

	return {
		authService,
		io,
		server,
		url: `http://127.0.0.1:${address.port}`,
		close: async () => {
			await new Promise((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
			authService.close();
		},
	};
}

function sessionCookie(response) {
	return response.headers.get("set-cookie").split(";")[0];
}

test("signup, login, session lookup, and logout use private sessions", async (t) => {
	const harness = await createHarness();
	t.after(harness.close);

	const signupResponse = await fetch(`${harness.url}/signup`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			displayName: "Kurakane User",
			email: "  PERSON@example.com ",
			password: "a-strong-passphrase",
		}),
	});
	assert.equal(signupResponse.status, 201);
	const signupBody = await signupResponse.json();
	assert.deepEqual(signupBody.user, {
		id: 1,
		email: "person@example.com",
		displayName: "Kurakane User",
	});
	const signupCookie = sessionCookie(signupResponse);
	assert.match(signupCookie, /^kurakane_session=[A-Za-z0-9_-]+$/);
	assert.match(signupResponse.headers.get("set-cookie"), /HttpOnly/);
	assert.match(signupResponse.headers.get("set-cookie"), /SameSite=Strict/);
	assert.doesNotMatch(JSON.stringify(signupBody), /password|hash|salt/i);

	const duplicateResponse = await fetch(`${harness.url}/signup`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			displayName: "Other",
			email: "person@example.com",
			password: "another-strong-passphrase",
		}),
	});
	assert.equal(duplicateResponse.status, 409);

	const wrongPasswordResponse = await fetch(`${harness.url}/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email: "person@example.com", password: "incorrect-passphrase" }),
	});
	assert.equal(wrongPasswordResponse.status, 401);

	const loginResponse = await fetch(`${harness.url}/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email: "PERSON@example.com", password: "a-strong-passphrase" }),
	});
	assert.equal(loginResponse.status, 200);
	const loginCookie = sessionCookie(loginResponse);
	assert.notEqual(loginCookie, signupCookie);

	const session = harness.authService.getSessionFromCookie(loginCookie);
	assert.equal(session.user.email, "person@example.com");
	const legacyCookie = `gather_session=${signupCookie.split("=")[1]}`;
	assert.equal(harness.authService.getSessionFromCookie(legacyCookie).user.email, "person@example.com");
	const legacyLogoutResponse = await fetch(`${harness.url}/logout`, {
		method: "POST",
		headers: { Cookie: legacyCookie },
	});
	assert.equal(legacyLogoutResponse.status, 204);
	assert.equal(harness.authService.getSessionFromCookie(legacyCookie), null);

	let disconnected = false;
	harness.io.sockets.sockets.set("active-socket", {
		data: { sessionHash: session.sessionHash },
		disconnect(force) {
			disconnected = force;
		},
	});

	const currentUserResponse = await fetch(`${harness.url}/me`, {
		headers: { Cookie: loginCookie },
	});
	assert.equal(currentUserResponse.status, 200);
	assert.deepEqual((await currentUserResponse.json()).user, session.user);

	const logoutResponse = await fetch(`${harness.url}/logout`, {
		method: "POST",
		headers: { Cookie: loginCookie },
	});
	assert.equal(logoutResponse.status, 204);
	assert.match(logoutResponse.headers.get("set-cookie"), /kurakane_session=;.*Max-Age=0/);
	assert.match(logoutResponse.headers.get("set-cookie"), /gather_session=;.*Max-Age=0/);
	assert.equal(disconnected, true);

	const expiredSessionResponse = await fetch(`${harness.url}/me`, {
		headers: { Cookie: loginCookie },
	});
	assert.equal(expiredSessionResponse.status, 401);
});

test("production sessions are marked Secure", async (t) => {
	const harness = await createHarness(true);
	t.after(harness.close);

	const response = await fetch(`${harness.url}/signup`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			displayName: "Secure User",
			email: "secure@example.com",
			password: "a-strong-passphrase",
		}),
	});
	assert.equal(response.status, 201);
	assert.match(response.headers.get("set-cookie"), /; Secure/);
});

test("signup enforces the minimum passphrase length and throttles attempts", async (t) => {
	const harness = await createHarness();
	t.after(harness.close);

	const weakPasswordResponse = await fetch(`${harness.url}/signup`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			displayName: "Weak Password User",
			email: "weak@example.com",
			password: "too-short",
		}),
	});
	assert.equal(weakPasswordResponse.status, 400);

	for (let attempt = 1; attempt < 10; attempt += 1) {
		const response = await fetch(`${harness.url}/signup`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				displayName: "Rate Limited User",
				email: "rate-limited@example.com",
				password: "too-short",
			}),
		});
		assert.equal(response.status, 400);
	}

	const throttledResponse = await fetch(`${harness.url}/signup`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			displayName: "Rate Limited User",
			email: "rate-limited@example.com",
			password: "too-short",
		}),
	});
	assert.equal(throttledResponse.status, 429);
	assert.ok(Number(throttledResponse.headers.get("retry-after")) > 0);
});

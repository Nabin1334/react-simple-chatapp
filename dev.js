const path = require("node:path");
const { spawn } = require("node:child_process");

const npmCli = process.env.npm_execpath;
if (!npmCli) {
	console.error("Start the development servers with `npm run dev`.");
	process.exit(1);
}

const clientDirectory = path.join(__dirname, "client");
const services = [
	{
		name: "API",
		args: ["index.js"],
		cwd: __dirname,
		env: process.env,
	},
	{
		name: "React client",
		args: [npmCli, "--prefix", clientDirectory, "start"],
		cwd: __dirname,
		env: { ...process.env, BROWSER: "none" },
	},
];
const children = [];
let isShuttingDown = false;

async function isApiAlreadyRunning() {
	const port = process.env.PORT || 5000;
	try {
		const response = await fetch(`http://127.0.0.1:${port}/health`, {
			signal: AbortSignal.timeout(1000),
		});
		return response.ok && (await response.text()) === "Running";
	} catch {
		return false;
	}
}

function stopServices(exitCode) {
	if (isShuttingDown) {
		return;
	}
	isShuttingDown = true;
	process.exitCode = exitCode;
	for (const child of children) {
		if (child.exitCode === null) {
			child.kill("SIGTERM");
		}
	}
}

async function startServices() {
	const apiIsRunning = await isApiAlreadyRunning();
	if (apiIsRunning) {
		console.log(`Using the existing API on port ${process.env.PORT || 5000}.`);
	}

	for (const service of services) {
		if (service.name === "API" && apiIsRunning) {
			continue;
		}

		const child = spawn(process.execPath, service.args, {
			cwd: service.cwd,
			env: service.env,
			stdio: "inherit",
		});
		children.push(child);

		child.on("error", (error) => {
			console.error(`Unable to start ${service.name}:`, error);
			stopServices(1);
		});
		child.on("exit", (code, signal) => {
			if (!isShuttingDown) {
				console.error(`${service.name} stopped${signal ? ` (${signal})` : ` with exit code ${code ?? 1}`}.`);
				stopServices(code || 1);
			}
		});
	}
}

process.on("SIGINT", () => stopServices(0));
process.on("SIGTERM", () => stopServices(0));
startServices().catch((error) => {
	console.error("Unable to check the local API:", error);
	stopServices(1);
});

# Kurakane video calls

## Run the app locally

Requires Node.js 22.13 or later. The server uses Node's built-in SQLite module to store accounts and sessions. From the project folder, install dependencies and start both development servers:

```sh
npm run setup
npm run dev
```

Open [http://localhost:3000](http://localhost:5173) for the app. `npm run dev` starts the React development server and the API/signaling server together, reusing a healthy local API if one is already running. Leave the terminal open while using Kurakane; press **Ctrl+C** to stop the services started by that command. The API health check is at [http://localhost:5000/health](http://localhost:5173/health).

Run `npm run setup` once after cloning the project, or again after changing dependencies. For a production-style local run, `npm start` builds the browser app and serves it from [http://localhost:5000](http://localhost:8000).

If port 5000 is already in use, stop the other server or choose a free port. In PowerShell, for example:

```powershell
$env:PORT = "5178"
npm start
```

Then open `http://localhost:5178`.

## Deploy to Render from Git

The `render.yaml` Blueprint builds the React client, starts the Node server, configures the `/health` check, and mounts a persistent 1 GB disk for the SQLite account database. The persistent disk requires Render's paid Starter plan.

This folder is initialized as a local Git repository. Create an empty GitHub, GitLab, or Bitbucket repository, then connect and push this project (replace the URL with your repository URL):

```sh
git remote add origin <your-repository-url>
git add .
git commit -m "Prepare Kurakane for Render"
git push -u origin main
```

In Render choose **New > Blueprint** and connect that repository. Render reads `render.yaml` and creates the service. After the first deploy finishes, open the service URL provided by Render. Deploys from the connected branch are automatic.

The app serves the frontend, authentication API, and Socket.IO signaling from the same Render service. HTTPS is enabled by Render; no separate frontend service or `CLIENT_ORIGIN` value is needed.

Create an account from the sign-in page, using a password of at least 12 characters. Passwords are hashed with scrypt; the browser receives only a random, HttpOnly, SameSite session cookie. The default SQLite database is `data/auth.sqlite`; set `AUTH_DATABASE_PATH` to store it elsewhere. Keep this file on persistent storage and restrict access to it when deploying.

## Run with live client reloading

In the first terminal, start the signaling server from the project root:

```sh
npm run server
```

In a second terminal, run the client development server:

```sh
npm --prefix client start
```

Open [http://localhost:3000](http://localhost:5173). The client connects to the local signaling server on port 5000. Sign in and out without enabling your camera or microphone. The browser requests device access only after you click **Start call** or **Answer**; grant permission then to join the call.

To call someone, sign in from another browser or device, copy their call ID, and paste it into the **Call ID** field. For another device on the same network, serve the app over HTTPS (camera access on other devices requires a secure context) and set `REACT_APP_SOCKET_URL` to the signaling server's reachable address before starting the client.

For production, set `NODE_ENV=production`, serve the application over HTTPS on one origin, and use a persistent disk for the SQLite database. If a reverse proxy serves the frontend on a different origin, configure it to forward `/auth` and Socket.IO requests through that origin and set `CLIENT_ORIGIN` to the exact browser origin (comma-separated if needed). If the application runs behind a single trusted reverse proxy, set `TRUST_PROXY=1` so IP-based sign-in throttling sees the client address. The SQLite store and in-memory sign-in throttling are intended for one application instance; use a shared database and distributed rate limiter before scaling horizontally. The current sign-in system does not include email verification or password recovery.

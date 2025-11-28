KYVOTV Backend (Minimal)

This is a minimal Node.js + Express backend used by the KYVOTV front-end for OAuth and prototype metrics storage.

Quick start

1. Copy `.env.example` to `.env` and fill your Twitch app credentials:

   TWITCH_CLIENT_ID=your_client_id
   TWITCH_CLIENT_SECRET=your_client_secret
   BASE_URL=https://your-public-url.example.com  # for testing with ngrok use the ngrok URL
   PORT=3000

2. Install dependencies and run:

   npm install
   ```markdown
   BROCKER.TV Backend (Minimal)

   This is a minimal Node.js + Express backend used by the BROCKER.TV front-end for OAuth, session handling and prototype metrics storage.

   Quick start

   1. Create a `.env` file in the project root and set the required values:

      ```env
      TWITCH_CLIENT_ID=your_twitch_client_id
      TWITCH_CLIENT_SECRET=your_twitch_client_secret
      YOUTUBE_CLIENT_ID=your_google_client_id
      YOUTUBE_CLIENT_SECRET=your_google_client_secret
      BASE_URL=http://localhost:3000
      JWT_SECRET=replace_this_with_a_strong_secret
      PORT=3000
      ```

   2. Install dependencies and run:

      ```bash
      npm install
      npm start
      ```

   3. OAuth quick test (front-end calls these endpoints):

      - `GET /auth/twitch/url?user=<localUser>&intent=register` — returns Twitch authorization URL
      - `GET /auth/google/url?user=<localUser>&intent=register` — returns Google/YouTube authorization URL

      Open the returned URL in a browser to authorize the application. The server will handle callbacks at `/auth/twitch/callback`, `/auth/google/callback` and `/auth/youtube/callback`.

   Endpoints of interest

    - `GET /auth/twitch/url` and `/auth/twitch/callback`
    - `GET /auth/youtube/url`, `/auth/google/url` and `/auth/youtube/callback`, `/auth/google/callback`
    - `GET /auth/steam/url` and `/auth/steam/callback`
    - `POST /api/users` — register local user (sets auth cookie)
    - `POST /api/users/login` — login local user (sets auth cookie)
    - `POST /api/auth/logout` — clear session cookie
    - `GET /api/me` — returns current authenticated user (cookie or bearer token)
    - `POST /api/stream/start` and `POST /api/stream/stop` — session metrics polling

   Notes

   - This backend is a prototype. For production usage:
     - Use a secure secrets store for client secrets and `JWT_SECRET`.
     - Serve over HTTPS and set cookie `secure: true` in `server.js`.
     - Harden token handling, add rate-limiting and proper error handling.
     - Consider replacing polling with provider webhooks (e.g., Twitch EventSub) for scalable metrics.

   ``` 

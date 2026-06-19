# Pharma Pulse

A self-hosted, live interactive training tool (Slido-style) for **Operations Pharmacy**.
Staff answer questions on their phones; answers appear live on the presenter screen.

Three parts, all built in:

| Part | URL | Who uses it |
|------|-----|-------------|
| **Admin dashboard** | `/admin` (also `/`) | You — create questions, add staff, control what's live |
| **Presenter screen** | `/present` | The projector / shared screen during training |
| **Staff form** | `/form` | Staff, on their phones |

### Question types
- **Multiple choice** → live bar chart with percentages
- **Word cloud / bubbles** → short answers float up as animated bubbles, sized by popularity
- **Open text feed** → free responses scroll in as cards
- **Rating / scale** → 1–N rating with a big average and a distribution chart

Everything updates in real time (WebSockets). Data is stored in a simple `data.json` file — no database to set up.

---

## Run it on your computer (test)

You need [Node.js](https://nodejs.org) 18+ installed.

```bash
npm install
npm start
```

Open `http://localhost:3000`. Default admin password is **`pharmacy123`**.

To let staff on the **same WiFi** join: find your computer's local IP (e.g. `192.168.1.20`) and they open `http://192.168.1.20:3000/form`.

---

## Deploy online (so staff can join from anywhere)

The easiest free option is **Render**:

1. Put this folder in a GitHub repository (or upload the ZIP to a new repo).
2. Go to <https://render.com> → **New** → **Web Service** → connect the repo.
3. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Environment variable:** add `ADMIN_PASS` and set it to a password of your choice.
4. Deploy. Render gives you a URL like `https://pharma-pulse.onrender.com`.
   - Admin: `…/admin` · Presenter: `…/present` · Staff: `…/form`

> The same steps work on **Railway**, **Fly.io**, **Cyclic**, or any host that runs Node.
> On a free tier the server may "sleep" when idle — just open the admin link a minute before your session to wake it.

**Persistence note:** answers are saved to `data.json`. On some free hosts the disk resets when the service restarts, which clears old responses — fine for live training, but attach a persistent disk if you need long-term history.

---

## How to run a session

1. Open **/admin**, sign in.
2. Add your questions (and optionally staff names under the **Staff** tab).
3. Put **/present** on the projector and share **/form** (or the QR code on the screen) with staff.
4. For each question click **Go live ▶**. Use **Pause answers** to lock results, **Clear responses** to reuse a question.

## Changing the admin password

Set the `ADMIN_PASS` environment variable on your host (step 3 above). Locally:

```bash
ADMIN_PASS="your-secret" npm start
```

## Files

```
server.js          # backend: API + real-time + storage
public/admin.html  # admin dashboard
public/present.html# presenter screen
public/form.html   # staff form
public/style.css   # shared clean/professional theme
```

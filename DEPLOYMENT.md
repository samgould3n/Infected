# Deployment Guide — no coding required

Follow these steps in order. You'll create three free accounts, click through some setup screens, and copy-paste three values. Total time: about 20–30 minutes. You will not need to edit any code.

You will need:
- A computer with a web browser
- An email address
- The folder of files this guide came with (the `manhunt` folder)

---

## Part 1 — Create the database (Supabase)

Supabase hosts the game's database for free.

1. Go to **https://supabase.com** and click **Start your project**. Sign up with your email or GitHub.
2. Once logged in, click **New project**.
   - **Name:** `manhunt` (anything is fine)
   - **Database password:** click *Generate a password*. You won't need it again, but save it somewhere just in case.
   - **Region:** choose **West EU (London)** (closest to UK players).
   - Click **Create new project** and wait ~2 minutes while it sets up.
   - *[Screenshot placeholder: Supabase "New project" form]*
3. Create the database tables:
   - In the left sidebar, click the **SQL Editor** icon (looks like a terminal/page).
   - On your computer, open the file `supabase/schema.sql` from the manhunt folder with any text editor (Notepad on Windows, TextEdit on Mac).
   - Select **all** the text in that file (Ctrl+A / Cmd+A), copy it, and paste it into the big empty box in the SQL Editor.
   - Click **Run** (bottom right). You should see "Success. No rows returned".
   - *[Screenshot placeholder: SQL Editor with green Success message]*
4. Collect your three keys (keep this browser tab open — you'll paste these in Part 3):
   - In the left sidebar click **Project Settings** (gear icon) → **API**.
   - You will see:
     - **Project URL** — looks like `https://abcdefgh.supabase.co`
     - **anon public** key — a long string of letters
     - **service_role** key — another long string (click *Reveal* to see it). **Treat this one like a password — never share it.**
   - *[Screenshot placeholder: Supabase API settings page with the three values highlighted]*

---

## Part 2 — Put the code on GitHub

GitHub stores the code so Vercel (Part 3) can read it.

1. Go to **https://github.com** and sign up (free).
2. Click the **+** in the top-right corner → **New repository**.
   - **Repository name:** `manhunt`
   - Leave everything else as it is. Click **Create repository**.
3. On the new repository page, click the link that says **uploading an existing file**.
   - *[Screenshot placeholder: empty repo page with "uploading an existing file" link circled]*
4. On your computer, open the `manhunt` folder. Select **everything inside it** (not the folder itself) — including the `src`, `public`, and `supabase` folders — and drag it all into the GitHub upload box.
   - **Do not upload** the `node_modules` folder or the `.next` folder if you see them — they're huge and unnecessary. (If you received this project as a zip, they won't be there.)
   - GitHub keeps folder structure when you drag folders in. Wait for all files to show in the list.
5. Click **Commit changes** at the bottom. Wait for the upload to finish.

> If drag-and-drop won't accept folders in your browser, use Chrome or Edge — they support folder upload.

---

## Part 3 — Put the game online (Vercel)

Vercel runs the app and gives you a web address.

1. Go to **https://vercel.com** and click **Sign Up** → **Continue with GitHub** (this links the two accounts — click *Authorize* when asked).
2. On your Vercel dashboard, click **Add New… → Project**.
3. You'll see a list of your GitHub repositories. Find **manhunt** and click **Import**.
4. Before clicking Deploy, open the **Environment Variables** section. Add these three, one at a time (Name on the left, Value on the right, then **Add**). Copy the values from the Supabase tab you kept open (Part 1, step 4):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | your **Project URL** |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the **anon public** key |
   | `SUPABASE_SERVICE_ROLE_KEY` | the **service_role** key |

   Type the names exactly as shown (capitals and underscores matter).
   - *[Screenshot placeholder: Vercel environment variables form with three rows filled]*
5. Click **Deploy**. Wait 1–2 minutes. When you see confetti, click **Continue to Dashboard**, then click the **Visit** button (or the link like `manhunt-xxxx.vercel.app`).

**That web address is your game.** Anyone you send it to can play. It already uses HTTPS, which phones require before sharing location.

---

## Part 4 — Play

On phones, use **Safari (iPhone)** or **Chrome (Android)**.

1. **Host:** open the web address on your phone → **Host a game**.
   - Name yourself, pick a play area (tap the map to place a circle, draw a polygon, or use a preset), set the match length and ping interval, and tap **Create game**.
2. You'll get a **room code** (like `K3PFQ`). Share the code or the link on screen with everyone.
3. **Players:** open the same web address → enter the code and a nickname → **Join**.
   - When the phone asks to use your location, tap **Allow** (choose *Allow While Using App* / *Precise* on iPhone).
4. When everyone is in the lobby, the host taps **Start game**. Roles are dealt secretly — check your screen privately!
5. During the game:
   - Maps update with enemy positions every ping interval — watch the countdown.
   - **Hunters:** physically tag someone, then tap **Capture — show QR** and have them scan it.
   - **Survivors (tagged):** tap **I've been tagged — scan QR** and point your camera at the hunter's screen. If the camera struggles, type the 6-character code shown under the QR instead.
   - Captured survivors instantly turn into hunters (your screen turns red) and keep playing.
6. The game ends when time runs out (survivors win if any remain) or every survivor is infected (hunters win). The winner screen shows for everyone.

### Add it to your home screen (optional, nicer)
- **iPhone:** in Safari, tap Share → **Add to Home Screen**.
- **Android:** in Chrome, tap ⋮ → **Add to Home screen** / **Install app**.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Location permission denied" banner | Phone Settings → Safari/Chrome → Location → Allow. On iPhone also Settings → Privacy → Location Services → Safari Websites → While Using. |
| Map is grey / blank | Brief internet drop — map tiles need data. It recovers on its own. |
| Camera won't open for scanning | Allow camera permission when prompted, or type the 6-character backup code instead. |
| "Game not found" | Codes expire when a game finishes. Ask the host for the current code. Check for easy mix-ups (the code alphabet avoids 0/O and 1/I). |
| Deploy failed on Vercel | Almost always a mistyped environment variable name. Go to Project → Settings → Environment Variables, fix it, then Deployments → ⋯ → Redeploy. |
| Changed a setting in Supabase/Vercel and nothing happened | Redeploy: Vercel → Deployments → ⋯ on the latest → Redeploy. |

## Costs

Everything in this guide uses free tiers, which comfortably handle dozens of simultaneous players. Supabase pauses free projects after a week of inactivity — if the app stops working after a quiet spell, open your Supabase dashboard and click **Restore project**.

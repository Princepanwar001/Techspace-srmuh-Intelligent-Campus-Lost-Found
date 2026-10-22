# LostLink — Intelligent Campus Lost & Found

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![React](https://img.shields.io/badge/Frontend-React%2019%20%2B%20Vite-61dafb.svg)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Backend-Node.js%20%2B%20Express%205-green.svg)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/Database-MongoDB%20Atlas%20%2B%20Mongoose-47A248.svg)](https://www.mongodb.com/)
[![Auth](https://img.shields.io/badge/Auth-Google%20Identity%20Services%20%2B%20JWT-4285F4.svg)](https://developers.google.com/identity)
[![Security Regression Tests](https://img.shields.io/badge/Tests-86%2F86%20Passing-brightgreen.svg)]()

LostLink is an intelligent, secure, and privacy-focused campus lost-and-found web application designed to help university students, faculty, and campus staff report lost items, log found items, discover matches with explainable scoring, securely verify ownership, and celebrate community returns through gamification and verified XP rewards.

---

## Architecture & Technology Stack

LostLink is built as a decoupled full-stack client-server architecture:

```
┌──────────────────────────────────────────┐
│      LostLink Client (Vite + React 19)   │
│  - Google Identity Services (One-Tap/Btn)│
│  - Teal / Aqua / Amber Design System     │
│  - Responsive Modals & Real-Time State   │
└────────────────────┬─────────────────────┘
                     │ HTTP / JSON (Bearer JWT)
                     ▼
┌──────────────────────────────────────────┐
│    LostLink Server (Node.js + Express 5) │
│  - Security Headers (nosniff, DENY, etc) │
│  - In-Memory Request Rate Limiting       │
│  - Google ID Token Cryptographic Verify  │
│  - Explainable Matching Engine           │
│  - Fraud-Resistant Reward Ledger         │
│  - Audit Logging (Admin & Claims)        │
└────────────────────┬─────────────────────┘
                     │ Mongoose 9 ODM (TLS)
                     ▼
┌──────────────────────────────────────────┐
│       MongoDB Atlas Cloud Database       │
│  - Users (googleId, role: student/admin) │
│  - Items (LOST/FOUND, status lifecycle)  │
│  - Claims (private proof, review audit)  │
│  - Notifications & Reward Events         │
└──────────────────────────────────────────┘
```

### Core Technologies
* **Frontend**: React 19, Vite, CSS Design System (Custom Properties, responsive layouts, no heavy component libraries).
* **Backend**: Node.js (ES Modules), Express 5, CORS, Dotenv.
* **Authentication**: Official Google Identity Services SDK on the frontend; Google's `google-auth-library` (`OAuth2Client.verifyIdToken`) on the backend with HS256 JSON Web Tokens (JWT).
* **Database & Modeling**: MongoDB Atlas with Mongoose ODM; strict schema validation, unique indexes, and field-level security projection (`select: false` on sensitive attributes).
* **Security Middleware**: OWASP-oriented HTTP headers (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`), in-memory IP rate limiting, strict pagination and input sanitization, regex injection prevention, and strict JSON error masking.

---

## Key Features

1. **Verified Google-Only Sign-In**:
   * One-click authentication using Google Identity Services.
   * Cryptographically verified on the backend via official Google certs.
   * Disables insecure email/password registration to eliminate credential stuffing and password reuse.
   * Zero college-domain restrictions (any valid Google account is accepted).
   * Privilege escalation protection: client-supplied roles are ignored; new users default to `student`.

2. **Lost & Found Reporting**:
   * Structured reporting for items across 8 campus categories (Electronics, Documents, Bags, Clothing, Accessories, Books, Keys, Other).
   * Strict item date validation (rejects invalid dates or dates >7 days in the future).
   * Status lifecycle: `OPEN` → `MATCHED` → `CLAIM_PENDING` → `RETURNED` / `CLOSED`.

3. **Explainable Smart Matching Engine**:
   * Deterministic, transparent rule-based similarity scoring (0–100%).
   * Multi-signal analysis: category matching (35%), keyword token overlap (30%), campus location proximity (20%), and report date proximity (15%).
   * Detailed breakdown for each match showing exactly why two items were paired.

4. **Protected Ownership Claims & Review Audit**:
   * Private proof description submitted by claimants (never exposed publicly).
   * Reviewable by the report owner or authorized campus administrators.
   * Approving a claim transitions the item to `RETURNED`, unlocks community XP rewards, and automatically notifies competing claimants of closure.
   * Comprehensive audit logging for all review decisions.

5. **Server-Verified Rewards & Leaderboard**:
   * Idempotent XP engine: +15 XP for logging a found report, +10 XP for lost reports, +50 XP for verified return handovers.
   * Anti-fraud daily report creation caps (max 5 rewarded reports/day).
   * Reconciled badge unlocks (`FIRST_VALID_REPORT`, `HELPFUL_FINDER`, `SUCCESSFUL_RETURN`, `COMMUNITY_HELPER`).
   * Privacy-preserving public leaderboard with opt-out preferences.

6. **Event-Driven Notifications**:
   * In-app notification tray for claim submissions, review outcomes, and return confirmations.
   * Mark-as-read and mark-all-as-read actions with per-user ownership isolation.

7. **Admin Moderation & Analytics**:
   * Role-based moderation queue for administrative review.
   * Report moderation auto-rejects pending claims and triggers automatic XP revocation.
   * Visual analytics dashboard deriving campus return rates, active reports, and category breakdowns.

---

## Prerequisites

Ensure you have the following installed locally:
* **Node.js**: v18.0.0 or higher (v20+ recommended).
* **npm**: v9.0.0 or higher.
* **MongoDB**: A free MongoDB Atlas cluster connection URI or local MongoDB instance.
* **Google Cloud Console Project**: An authorized OAuth 2.0 Web Client ID.

---

## Environment Variables

### Backend Configuration (`server/.env`)
Copy `server/.env.example` to `server/.env` and supply your real values:

| Variable | Type | Description | Example Placeholder |
| :--- | :--- | :--- | :--- |
| `PORT` | Number | Port on which the Express API runs | `5000` |
| `CLIENT_URL` | String | Allowed CORS origin(s) | `http://localhost:5173` |
| `MONGODB_URI` | String | MongoDB Atlas or local connection URI | `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority` |
| `JWT_SECRET` | String | Cryptographic key for signing session JWTs | `replace_with_a_strong_random_secret_at_least_32_characters` |
| `GOOGLE_CLIENT_ID` | String | Google OAuth 2.0 Web Client ID | `<client-id>.apps.googleusercontent.com` |

### Frontend Configuration (`client/.env.local` or `client/.env`)
Copy `client/.env.example` to `client/.env.local` and supply your real values:

| Variable | Type | Description | Example Placeholder |
| :--- | :--- | :--- | :--- |
| `VITE_API_URL` | String | Base URL of the backend API | `http://localhost:5000` |
| `VITE_GOOGLE_CLIENT_ID`| String | Google OAuth 2.0 Web Client ID (matches server) | `<client-id>.apps.googleusercontent.com` |
| `VITE_CAMPUS_NAME` | String | Display name of the educational institution | `SmartCampus University` |
| `VITE_CONTACT_EMAIL` | String | Help desk or campus support contact email | `lostandfound@campus.edu` |

> [!IMPORTANT]
> Never commit `.env` or `.env.local` files containing real secrets, database passwords, or private keys to version control. Both root and client `.gitignore` files are pre-configured to exclude them.

---

## Google OAuth 2.0 Setup

To enable Google sign-in locally:
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project, then navigate to **APIs & Services > Credentials**.
3. Configure the **OAuth Consent Screen** (User Type: External).
4. Click **Create Credentials > OAuth client ID** (Application type: **Web application**).
5. Add to **Authorized JavaScript origins**:
   * `http://localhost:5173` (for local development)
   * `http://localhost:5000` (optional, for backend)
   * *(Add your production domain here when deploying, e.g., `https://your-domain.com`)*.
6. Copy the generated **Client ID** into both `client/.env.local` (`VITE_GOOGLE_CLIENT_ID`) and `server/.env` (`GOOGLE_CLIENT_ID`).

---

## Installation & Local Development

### 1. Clone the repository
```bash
git clone https://github.com/Princepanwar001/Techspace-srmuh-Intelligent-Campus-Lost-Found.git
cd Techspace-srmuh-Intelligent-Campus-Lost-Found
```

### 2. Configure environments
Follow the table above to populate `server/.env` and `client/.env.local`.

### 3. Backend Setup
```bash
# Navigate to backend directory
cd server

# Install dependencies
npm install

# Start development server with live reload
npm run dev

# Or start standard production server
npm start
```
The backend will start at `http://localhost:5000`. Test health at `http://localhost:5000/api/health`.

### 4. Frontend Setup
In a separate terminal:
```bash
# Navigate to frontend directory
cd client

# Install dependencies
npm install

# Start Vite development server
npm run dev
```
The frontend will be accessible at `http://localhost:5173`.

---

## Testing & Quality Verification

LostLink includes an extensive 86-case automated regression and security test suite covering authentication, IDOR ownership protections, claims processing, XP idempotency, rate limiting, and admin moderation.

```bash
# Run backend security and regression test suite (86/86 automated cases)
npm --prefix server test

# Run frontend ESLint checks (0 errors, 0 warnings)
npm --prefix client run lint

# Run frontend production build
npm --prefix client run build

# Run Node syntax check across server source files
node --check server/src/server.js
```

---

## Production Deployment Guidelines & Limitations

When deploying LostLink to production hosting platforms (such as Vercel, Netlify, Render, Railway, AWS, or Docker):

1. **Google OAuth Origins**:
   * Add your live production URL (e.g., `https://lostlink.campus.edu`) to **Authorized JavaScript origins** in Google Cloud Console. Without this, Google will block sign-in attempts on your live domain.

2. **Frontend Build-Time Variables**:
   * Because Vite statically bakes `import.meta.env` values into production JavaScript bundles during `npm run build`, you **must define `VITE_API_URL` and `VITE_GOOGLE_CLIENT_ID` in your hosting platform's build environment settings** before running the build step.

3. **Backend CORS Configuration**:
   * Ensure `CLIENT_URL` in the backend environment matches your production frontend URL exactly (e.g., `CLIENT_URL=https://lostlink.campus.edu` with no trailing slash).

4. **HTTPS & Security**:
   * Production traffic must be served over HTTPS. Ensure your hosting provider or reverse proxy (Nginx, Cloudflare, etc.) terminates TLS and applies `Strict-Transport-Security` (HSTS).

5. **Known Development Advisory**:
   * `nodemon` brings in transitive dependencies flagged in `npm audit`. Because `nodemon` is strictly a `devDependency` and is not executed in production (`npm start` runs `node src/server.js`), production runtimes are unexposed. Use `npm ci --omit=dev` for production container builds.

---

## License

This project is licensed under the ISC License.

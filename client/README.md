# LostLink — Frontend Web Client

The frontend user interface for the **LostLink Intelligent Campus Lost & Found** platform, built with **React 19** and **Vite**.

---

## Overview

The LostLink client provides a responsive, accessible, and high-performance campus web application featuring a bespoke teal, aqua, and amber design system. It handles user authentication via Google Identity Services, real-time report filtering, explainable matching previews, claim submission with ownership verification, and gamified community leaderboards.

---

## Design System & Theme

The user interface uses clean CSS custom properties (`client/src/index.css` and `client/src/App.css`):
* **Primary Teal**: `#0f766e` / `#115e59` (Brand identity, main action buttons, typography)
* **Background Aqua & Off-White**: `#f0fdfa` / `#f8fafc` (Page canvas, card backgrounds, subtle borders)
* **Warm Amber Accent**: `#d97706` / `#b45309` (Call-to-action highlights, "I Lost Something" workflow, trust badges)
* **Dark Midnight Teal**: `#042f2e` (Hero showcasing, high-contrast modal headers)

---

## Component Architecture

* **`src/App.jsx`**: Main application container managing routing, navigation bar, lost/found feed, report creation modal, claim submission drawer, notification tray, XP leaderboard, and admin dashboard.
* **`src/components/AuthPanel.jsx`**: Unified Google Identity Services authentication interface rendering the official "Continue with Google" button, state handling, and connection diagnostics.
* **`src/components/AuthPanel.css`**: Styling for the authentication showcase, Google button container, loading spinner, and diagnostic banners.
* **`src/App.css`**: Comprehensive styling for all LostLink pages, modals, badge components, filter tabs, and responsive grids.

---

## Client Environment Variables

Configuration is loaded via Vite environment variables. Place local overrides in `client/.env.local`:

```bash
# Backend Express API base URL
VITE_API_URL=http://localhost:5000

# Google OAuth 2.0 Web Client ID (must match Authorized JavaScript Origin)
VITE_GOOGLE_CLIENT_ID=your_google_oauth_web_client_id.apps.googleusercontent.com

# Institutional branding
VITE_CAMPUS_NAME=SmartCampus University
VITE_CONTACT_EMAIL=lostandfound@campus.edu
```

> [!NOTE]
> In production builds (`npm run build`), environment variables prefixed with `VITE_` are statically compiled into the client bundles. Ensure they are set in your hosting platform's build settings.

---

## Available Scripts

In the `client/` directory, you can run:

```bash
# Start Vite development server with Hot Module Replacement (HMR)
npm run dev

# Run ESLint to verify code quality and style
npm run lint

# Compile production-ready bundle into the dist/ directory
npm run build

# Preview the local production build locally
npm run preview
```

---

## Browser Support

Built for modern evergreen browsers (Chrome, Edge, Firefox, Safari) with native support for CSS Grid, Flexbox, KaTeX, and Google Identity Services SDK.

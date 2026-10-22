import express from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { OAuth2Client } from "google-auth-library";
import User from "../models/User.js";
import requireAuth from "../middleware/requireAuth.js";

const router = express.Router();
const googleOAuthClient = new OAuth2Client();

const VALID_GOOGLE_ISSUERS = new Set([
  "accounts.google.com",
  "https://accounts.google.com",
]);

// Default verifier uses Google's official OAuth2Client.verifyIdToken.
// Can be overridden in automated regression tests via setGoogleTokenVerifierForTests.
let activeGoogleTokenVerifier = async function verifyWithGoogleLibrary(
  idToken,
  expectedClientId
) {
  const ticket = await googleOAuthClient.verifyIdToken({
    idToken,
    audience: expectedClientId,
  });
  return ticket.getPayload();
};

export function setGoogleTokenVerifierForTests(customVerifier) {
  if (typeof customVerifier === "function") {
    activeGoogleTokenVerifier = customVerifier;
  } else {
    activeGoogleTokenVerifier = async function verifyWithGoogleLibrary(
      idToken,
      expectedClientId
    ) {
      const ticket = await googleOAuthClient.verifyIdToken({
        idToken,
        audience: expectedClientId,
      });
      return ticket.getPayload();
    };
  }
}

export async function verifyGoogleTokenWithOfficialLibrary(
  idToken,
  expectedClientId
) {
  const ticket = await googleOAuthClient.verifyIdToken({
    idToken,
    audience: expectedClientId,
  });
  return ticket.getPayload();
}

function getConfiguredGoogleClientId() {
  let clientId = (
    process.env.GOOGLE_CLIENT_ID ||
    process.env.VITE_GOOGLE_CLIENT_ID ||
    ""
  ).trim();

  // Attempt to reload dotenv if process.env was not populated at module load
  if (!clientId) {
    try {
      dotenv.config({ override: true });
    } catch {
      // ignore
    }
    clientId = (
      process.env.GOOGLE_CLIENT_ID ||
      process.env.VITE_GOOGLE_CLIENT_ID ||
      ""
    ).trim();
  }

  return clientId;
}

// Create an application JWT for an authenticated user.
function createToken(user) {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign({ sub: user._id.toString() }, secret, {
    algorithm: "HS256",
    expiresIn: "1h",
  });
}

// Return only public user fields. Never expose passwordHash or googleId.
function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role === "admin" ? "admin" : "student",
  };
}

function sanitizeDisplayName(rawName, fallbackEmail) {
  const candidate =
    typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ") : "";
  if (candidate.length >= 2) {
    return candidate.slice(0, 80);
  }
  const localPart =
    typeof fallbackEmail === "string"
      ? fallbackEmail.split("@")[0].replace(/[^a-zA-Z0-9 _.-]/g, "").trim()
      : "";
  if (localPart.length >= 2) {
    return localPart.slice(0, 80);
  }
  return "Campus Member";
}

// GOOGLE SIGN-IN — Verify Google ID token on the backend and issue application JWT
router.post("/google", async (req, res) => {
  try {
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message: "Authentication is not configured",
      });
    }

    const googleClientId = getConfiguredGoogleClientId();
    if (!googleClientId) {
      return res.status(500).json({
        success: false,
        message: "Google OAuth Client ID is not configured on the server",
      });
    }

    const body =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? req.body
        : {};

    const rawToken =
      typeof body.credential === "string"
        ? body.credential.trim()
        : typeof body.idToken === "string"
          ? body.idToken.trim()
          : "";

    if (!rawToken || rawToken.length > 4096) {
      return res.status(400).json({
        success: false,
        message: "A valid Google ID token credential is required",
      });
    }

    let payload = null;
    try {
      payload = await activeGoogleTokenVerifier(rawToken, googleClientId);
    } catch {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired Google ID token",
      });
    }

    if (!payload || typeof payload !== "object") {
      return res.status(401).json({
        success: false,
        message: "Invalid Google ID token payload",
      });
    }

    // Explicitly enforce issuer, audience, email verification, subject, and email format
    if (!VALID_GOOGLE_ISSUERS.has(payload.iss)) {
      return res.status(401).json({
        success: false,
        message: "Invalid Google token issuer",
      });
    }

    const audienceMatches = Array.isArray(payload.aud)
      ? payload.aud.includes(googleClientId)
      : payload.aud === googleClientId;

    if (!audienceMatches) {
      return res.status(401).json({
        success: false,
        message: "Google token audience mismatch",
      });
    }

    if (payload.email_verified !== true) {
      return res.status(401).json({
        success: false,
        message: "Google account email must be verified",
      });
    }

    const googleSub =
      typeof payload.sub === "string" ? payload.sub.trim() : "";
    const email =
      typeof payload.email === "string"
        ? payload.email.trim().toLowerCase()
        : "";

    if (
      !googleSub ||
      !email ||
      email.length > 254 ||
      !/^\S+@\S+\.\S+$/.test(email)
    ) {
      return res.status(401).json({
        success: false,
        message: "Google token is missing a valid email or subject identifier",
      });
    }

    const displayName = sanitizeDisplayName(
      payload.name || payload.given_name,
      email
    );

    // Retrieve existing user or create a new student user.
    // Never trust client-supplied email, role, or privileges.
    let user = null;
    try {
      user = await User.findOne({
        $or: [{ googleId: googleSub }, { email }],
      }).select("+googleId");

      if (user) {
        let needsSave = false;
        if (!user.googleId) {
          user.googleId = googleSub;
          user.authProvider = "google";
          needsSave = true;
        }
        if (!user.name || user.name.trim().length < 2) {
          user.name = displayName;
          needsSave = true;
        }
        if (user.role !== "admin") {
          user.role = "student";
        }
        if (needsSave) {
          await user.save();
        }
      } else {
        try {
          user = await User.create({
            name: displayName,
            email,
            googleId: googleSub,
            authProvider: "google",
            role: "student",
          });
        } catch (createErr) {
          if (createErr.code === 11000) {
            user = await User.findOne({ email });
          } else {
            throw createErr;
          }
        }
      }
    } catch (dbErr) {
      console.error("Database error during Google sign-in:", dbErr.message);
      return res.status(500).json({
        success: false,
        message: "Database error during authentication. Please try again.",
      });
    }

    if (!user) {
      return res.status(500).json({
        success: false,
        message: "Could not complete Google sign-in. Account resolution failed.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Google sign-in successful",
      token: createToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    console.error("Google authentication error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not complete Google authentication",
    });
  }
});

// PASSWORD REGISTRATION — Disabled in favor of Google-only authentication
router.post("/register", (req, res) => {
  return res.status(403).json({
    success: false,
    message:
      "Password registration is disabled. Please continue with Google.",
  });
});

// PASSWORD LOGIN — Disabled in favor of Google-only authentication
router.post("/login", (req, res) => {
  return res.status(403).json({
    success: false,
    message: "Password sign-in is disabled. Please continue with Google.",
  });
});

// CURRENT USER — protected endpoint
router.get("/me", requireAuth, (req, res) => {
  if (Object.keys(req.query || {}).length > 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid query parameter",
    });
  }

  return res.json({
    success: true,
    user: publicUser(req.user),
  });
});

export default router;

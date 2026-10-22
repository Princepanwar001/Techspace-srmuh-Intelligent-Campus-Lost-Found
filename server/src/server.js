import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import itemRoutes from "./routes/itemRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import claimRoutes from "./routes/claimRoutes.js";
import rewardRoutes from "./routes/rewardRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import {
  apiNotFoundHandler,
  createRateLimiter,
  securityHeaders,
} from "./middleware/securityMiddleware.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(securityHeaders);

const defaultOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];
const envOrigins = (process.env.CLIENT_URL || "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const allowedOrigins = Array.from(new Set([...defaultOrigins, ...envOrigins]));

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  })
);

const authRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  keyPrefix: "auth",
  message: "Too many authentication attempts, please try again in a minute",
});

const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 300,
  keyPrefix: "api",
  message: "Too many API requests, please slow down",
});

app.use(express.json({ limit: "100kb" }));
app.use("/api", apiRateLimiter);
app.use("/api/auth", authRateLimiter, authRoutes);
app.use("/api/items", itemRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/claims", claimRoutes);
app.use("/api/rewards", rewardRoutes);
app.use("/api/notifications", notificationRoutes);

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "SmartCampus API is running",
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected",
  });
});

app.use("/api", apiNotFoundHandler);

// Prevent malformed JSON or unexpected middleware errors from leaking stack traces
app.use((err, req, res, next) => {
  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON payload",
    });
  }

  if (err?.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "Request payload too large",
    });
  }

  console.error("Unhandled request error:", err?.message || "Unknown error");
  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

async function startServer() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing in server/.env");
    }

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is missing in server/.env");
    }

    await mongoose.connect(process.env.MONGODB_URI, {
      dbName: "smartcampus",
    });

    console.log("MongoDB connected successfully.");

    if (!process.env.GOOGLE_CLIENT_ID) {
      console.warn(
        "WARNING: GOOGLE_CLIENT_ID is not configured in server/.env. Google authentication will be unavailable until set."
      );
    }

    app.listen(PORT, () => {
      console.log(`Backend running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Startup error:", error.message);
    process.exit(1);
  }
}

startServer();

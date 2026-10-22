import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";

export default async function requireAuth(req, res, next) {
  // Read the token from the Authorization header.
  const authHeader = req.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(\S+)$/i);

  if (!match) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  const token = match[1];
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    console.error("JWT_SECRET is not configured");

    return res.status(500).json({
      success: false,
      message: "Authentication is not configured",
    });
  }

  try {
    // Verify that the token is valid and has not expired.
    const payload = jwt.verify(token, secret, {
      algorithms: ["HS256"],
    });

    if (
      typeof payload !== "object" ||
      !payload.sub ||
      !mongoose.isValidObjectId(payload.sub)
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token",
      });
    }

    // Find the account associated with this token.
    const user = await User.findById(payload.sub).select(
      "_id name email role"
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User no longer exists",
      });
    }

    if (user.role !== "admin") {
      user.role = "student";
    }

    // Make the authenticated user available to the next handler.
    req.user = user;

    next();
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError" ||
      error.name === "NotBeforeError"
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    console.error("Authentication error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not authenticate request",
    });
  }
}
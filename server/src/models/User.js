import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    // Student's full name
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },

    // Email is used for login
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: /^\S+@\S+\.\S+$/,
    },

    // Legacy password hash (optional for Google-authenticated accounts; never exposed)
    passwordHash: {
      type: String,
      required: false,
      default: null,
      select: false,
    },

    // Verified Google subject identifier (sub)
    googleId: {
      type: String,
      trim: true,
      default: null,
      select: false,
    },

    authProvider: {
      type: String,
      enum: ["google", "local"],
      default: "google",
    },

    // Public registration must create student accounts
    role: {
      type: String,
      enum: ["student", "admin"],
      default: "student",
    },

    // Phase 6: Server-authoritative XP, level, and badge summary
    xp: {
      type: Number,
      default: 0,
      min: 0,
    },

    level: {
      type: Number,
      default: 1,
      min: 1,
    },

    badges: {
      type: [
        {
          code: { type: String, required: true },
          name: { type: String, required: true },
          description: { type: String, required: true },
          icon: { type: String, default: "★" },
          awardedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },

    leaderboardOptOut: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ xp: -1, level: -1, createdAt: 1 });

const User = mongoose.model("User", userSchema);

export default User;

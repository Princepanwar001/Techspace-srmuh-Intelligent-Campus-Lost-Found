import mongoose from "mongoose";

// Append-only server-authoritative reward ledger.
// Every reward event requires a unique idempotencyKey enforced at the database level
// so retries, concurrent requests, or repeated status transitions never double-award XP.
const rewardEventSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    eventType: {
      type: String,
      required: true,
      enum: [
        "REPORT_CREATED_LOST",
        "REPORT_CREATED_FOUND",
        "VERIFIED_RETURN_FINDER",
        "VERIFIED_RETURN_CLAIMANT",
      ],
    },

    points: {
      type: Number,
      required: true,
      min: 1,
      max: 500,
    },

    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 250,
    },

    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 200,
    },

    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Item",
      default: null,
    },

    claim: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Claim",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

rewardEventSchema.index({ user: 1, createdAt: -1 });
rewardEventSchema.index({ user: 1, eventType: 1, createdAt: -1 });

const RewardEvent = mongoose.model("RewardEvent", rewardEventSchema);

export default RewardEvent;

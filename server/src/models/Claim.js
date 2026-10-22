import mongoose from "mongoose";

const claimSchema = new mongoose.Schema(
  {
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Item",
      required: true,
    },

    claimant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Private ownership verification details provided by claimant.
    // Never exposed on public item endpoints.
    proofDescription: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 1000,
    },

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      required: true,
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },

    reviewNote: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
  },
  { timestamps: true }
);

// Index for fast lookup of claims by item in newest-first order
claimSchema.index({ item: 1, createdAt: -1 });

// Prevent duplicate active (PENDING or APPROVED) claims by the same user on the same item
claimSchema.index(
  { item: 1, claimant: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["PENDING", "APPROVED"] },
    },
  }
);

// Prevent multiple APPROVED claims on the same item at the database level
claimSchema.index(
  { item: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: "APPROVED",
    },
  }
);

export default mongoose.model("Claim", claimSchema);

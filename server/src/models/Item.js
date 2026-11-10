import mongoose from "mongoose";

const itemImageSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    publicId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    visibility: {
      type: String,
      enum: ["PUBLIC", "PRIVATE"],
      default: "PUBLIC",
      required: true,
    },
    mimeType: {
      type: String,
      enum: ["image/jpeg", "image/png", "image/webp"],
      default: "image/jpeg",
    },
    sizeBytes: {
      type: Number,
      min: 1,
      max: 5 * 1024 * 1024,
      default: null,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const rewardSettlementSchema = new mongoose.Schema(
  {
    linkedClaimId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Claim",
      default: null,
    },
    linkedFoundItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Item",
      default: null,
    },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    finderUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    ownerConfirmedAt: {
      type: Date,
      default: null,
    },
    ownerConfirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    finderConfirmedAt: {
      type: Date,
      default: null,
    },
    finderConfirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    paymentMethodNote: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
  },
  { _id: false }
);

const itemSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },

    category: {
      type: String,
      required: true,
      enum: [
        "Electronics",
        "Documents",
        "Bags",
        "Clothing",
        "Accessories",
        "Books",
        "Keys",
        "Other",
      ],
    },

    type: {
      type: String,
      required: true,
      enum: ["LOST", "FOUND"],
    },

    location: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    itemDate: {
      type: Date,
      required: true,
    },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    status: {
      type: String,
      enum: [
        "OPEN",
        "MATCHED",
        "CLAIM_PENDING",
        "RETURNED",
        "CLOSED",
      ],
      default: "OPEN",
    },

    images: {
      type: [itemImageSchema],
      default: [],
      validate: {
        validator: (arr) => !Array.isArray(arr) || arr.length <= 5,
        message: "Maximum 5 images allowed per item report",
      },
    },

    // Optional voluntary monetary reward offer (integer paise in INR; LOST items only)
    rewardAmountPaise: {
      type: Number,
      default: 0,
      min: 0,
      max: 5000000,
      validate: {
        validator: (val) => Number.isInteger(val) && val >= 0,
        message: "rewardAmountPaise must be a non-negative integer",
      },
    },

    rewardCurrency: {
      type: String,
      enum: ["INR"],
      default: "INR",
    },

    rewardStatus: {
      type: String,
      enum: [
        "NONE",
        "OFFERED",
        "SETTLEMENT_PENDING",
        "SETTLED",
        "CANCELLED",
      ],
      default: "NONE",
    },

    rewardOfferedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    rewardSettledAt: {
      type: Date,
      default: null,
    },

    rewardSettlement: {
      type: rewardSettlementSchema,
      default: () => ({}),
    },

    moderated: {
      type: Boolean,
      default: false,
    },

    moderatedAt: {
      type: Date,
      default: null,
    },

    moderatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    moderationReason: {
      type: String,
      trim: true,
      maxlength: 300,
      default: "",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Item", itemSchema);
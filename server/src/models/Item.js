import mongoose from "mongoose";

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
import mongoose from "mongoose";

const SubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    plan: {
      type: String,
      enum: ["free", "pro", "premium"],
      default: "free",
      index: true,
    },
    provider: {
      type: String,
      enum: ["razorpay", "manual"],
      default: "manual",
    },
    status: {
      type: String,
      enum: ["active", "trialing", "past_due", "canceled", "incomplete"],
      default: "active",
      index: true,
    },
    customerId: {
      type: String,
      default: null,
      index: true,
    },
    subscriptionId: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
    },
    currentPeriodStart: {
      type: Date,
      default: Date.now,
    },
    currentPeriodEnd: {
      type: Date,
      default: null,
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    lastProviderEventAt: { type: Date, default: null },
    processedWebhookEvents: [
      {
        eventId: { type: String, required: true },
        processedAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  },
);

export const Subscription =
  mongoose.models.Subscription || mongoose.model("Subscription", SubscriptionSchema);

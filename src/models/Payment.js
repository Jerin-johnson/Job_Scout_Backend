import mongoose from "mongoose";

const PaymentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    subscriptionId: { type: String, default: null, index: true },
    provider: { type: String, enum: ["razorpay"], default: "razorpay", index: true },
    providerPaymentId: { type: String, required: true, unique: true },
    providerEventId: { type: String, default: null, index: true },
    amountMinor: { type: Number, required: true, min: 0 },
    amountRefundedMinor: { type: Number, default: 0, min: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true },
    status: {
      type: String,
      enum: ["captured", "partially_refunded", "refund_pending", "refunded", "failed"],
      default: "captured",
      index: true,
    },
    paidAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

PaymentSchema.index({ paidAt: -1, status: 1 });

export const Payment = mongoose.models.Payment || mongoose.model("Payment", PaymentSchema);

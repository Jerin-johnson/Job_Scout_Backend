import mongoose from "mongoose";

const UserFeedbackSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  category: { type: String, enum: ["general", "bug", "idea"], required: true },
  message: { type: String, required: true, trim: true, minlength: 10, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 180 },
}, { versionKey: false });

UserFeedbackSchema.index({ userId: 1, createdAt: -1 });

export const UserFeedback = mongoose.models.UserFeedback || mongoose.model("UserFeedback", UserFeedbackSchema);

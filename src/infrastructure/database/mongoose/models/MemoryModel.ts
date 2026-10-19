import mongoose, { Document, Model, Schema } from "mongoose";

const MemorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["preference", "fact", "feedback", "episode", "goal"],
      required: true,
      index: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
    },
    embedding: {
      type: [Number],
      default: [],
    },
    // Legacy vectors remain valid stored data but have unknown provenance.
    embeddingMetadata: {
      provider: { type: String, default: undefined },
      model: { type: String, default: undefined },
      dimension: { type: Number, default: undefined },
    },
    importance: {
      type: Number,
      min: 1,
      max: 5,
      default: 3,
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.8,
    },
    source: {
      type: String,
      enum: ["chat", "tailoring", "interview", "user_edit"],
      default: "chat",
    },
    consentVersion: {
      type: String,
      default: "memory-consent-v1",
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
    useCount: {
      type: Number,
      default: 0,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    supersededBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Memory",
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false,
  },
);

// Compound index for user memory queries
MemorySchema.index({ userId: 1, type: 1 });
MemorySchema.index(
  { userId: 1, key: 1 },
  {
    unique: true,
    partialFilterExpression: { type: { $in: ["preference", "goal"] }, isDeleted: false },
  },
);

// TTL index on expiresAt for temporary feedback/memories
MemorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Pre-save compliance hook: Block protected attributes and secrets
 */
MemorySchema.pre("save", function (next) {
  const protectedPatterns = [
    /\b(christian|muslim|hindu|jewish|sikh|buddhist|atheist|religion)\b/i,
    /\b(caucasian|black|african|hispanic|latino|asian|ethnicity|race)\b/i,
    /\b(brahmin|dalit|caste|kshatriya|vaishya)\b/i,
    /\b(pregnant|disability|disease|medical condition|diagnosed with|health condition|surgery)\b/i,
    /\b(democrat|republican|bjp|congress|political party|voted for|politics|communist|socialist)\b/i,
    /\b(password|api[_ -]?key|secret[_ -]?key|private[_ -]?key|ssn|social security|aadhaar|pan card|credit card)\b/i,
    /\b(born in 19[0-9]{2}|age is [0-9]{2}|years old)\b/i,
  ];

  const fullText = `${this.key} ${this.content}`;
  for (const pattern of protectedPatterns) {
    if (pattern.test(fullText)) {
      const err = new Error(
        "Compliance violation: Storing protected attributes (religion, ethnicity, caste, health, politics, secrets, age inferences) is strictly prohibited.",
      ) as Error & { code?: string };
      err.code = "PROTECTED_ATTRIBUTE_REJECTED";
      return next(err);
    }
  }
  next();
});

export const Memory = mongoose.models.Memory || mongoose.model("Memory", MemorySchema);

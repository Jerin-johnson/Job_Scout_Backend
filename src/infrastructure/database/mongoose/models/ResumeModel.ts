import mongoose, { Document, Model, Schema } from "mongoose";

export interface IEncryptedRawTextSubdoc {
  cipherText: string;
  iv: string;
  tag: string;
  keyVersion?: string;
}

export interface IFactsSummarySubdoc {
  roles: number;
  skills: number;
  education: number;
  totalFacts: number;
}

export interface IResumeDocument extends Document {
  userId: mongoose.Types.ObjectId;
  fileHash: string;
  originalFilename: string;
  mimeType: string;
  s3Key: string;
  encryptedRawText: IEncryptedRawTextSubdoc;
  parsedFactsCount: number;
  factsSummary: IFactsSummarySubdoc;
  isActive: boolean;
  createdAt: Date;
}

export const ResumeSchema = new Schema<IResumeDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    fileHash: {
      type: String,
      required: true,
      index: true,
    },
    originalFilename: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    s3Key: {
      type: String,
      required: true,
    },
    encryptedRawText: {
      cipherText: { type: String, required: true },
      iv: { type: String, required: true },
      tag: { type: String, required: true },
      keyVersion: { type: String, default: "v1" },
    },
    parsedFactsCount: {
      type: Number,
      default: 0,
    },
    factsSummary: {
      roles: { type: Number, default: 0 },
      skills: { type: Number, default: 0 },
      education: { type: Number, default: 0 },
      totalFacts: { type: Number, default: 0 },
    },
    isActive: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  },
);

ResumeSchema.index({ userId: 1, s3Key: 1 }, { unique: true });

export const ResumeModel: Model<IResumeDocument> =
  (mongoose.models.Resume as Model<IResumeDocument>) ||
  mongoose.model<IResumeDocument>("Resume", ResumeSchema);

export { ResumeModel as Resume };

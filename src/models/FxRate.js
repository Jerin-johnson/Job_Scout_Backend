import mongoose from "mongoose";

const FxRateSchema = new mongoose.Schema({
  key: { type: String, default: "ecb-reference", unique: true },
  source: { type: String, required: true },
  date: { type: Date, required: true, index: true },
  // units of each currency per EUR, matching the published ECB observation.
  ratesPerEur: { type: Map, of: Number, required: true },
}, { timestamps: true });

export const FxRate = mongoose.models.FxRate || mongoose.model("FxRate", FxRateSchema);

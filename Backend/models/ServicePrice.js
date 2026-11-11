const mongoose = require("mongoose");

const servicePriceSchema = new mongoose.Schema(
  {
    serviceId: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: "" },
    category: { type: String, default: "" },
    providerRate: { type: Number, default: 0 },
    sellingRate: { type: Number, required: true, min: 0 },
    enabled: { type: Boolean, default: true },
    displayName: { type: String, default: "" },
    description: { type: String, default: "" },
    minOverride: { type: Number, default: null },
    maxOverride: { type: Number, default: null },
    updatedBy: { type: String, default: "admin" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("ServicePrice", servicePriceSchema);

const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false
    },

    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },

    providerOrderId: {
      type: String,
      required: false
    },

    service: { type: mongoose.Schema.Types.ObjectId, ref: "Service", required: false },

    boostType: { type: String, default: "" },

    serviceId: {
      type: String,
      required: false
    },

    serviceName: {
      type: String,
      required: false
    },

    platform: {
      type: String,
      required: false
    },

    link: {
      type: String,
      required: false
    },

    quantity: {
      type: Number,
      required: true
    },

    amount: {
      type: Number,
      required: true
    },

    status: {
      type: String,
      default: "Pending"
    },

    remains: {
      type: Number,
      default: 0
    },

    startCount: {
      type: Number,
      default: 0
    },

    providerCharge: {
      type: Number,
      default: 0
    },

    refundProcessed: {
      type: Boolean,
      default: false
    },

    emailNotifications: {
      type: [String],
      default: []
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("Order", orderSchema);
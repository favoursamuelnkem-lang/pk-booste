const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false
    },

    reference: { type: String, default: "" },

    balanceAfter: { type: Number, default: 0 },

    note: { type: String, default: "" },

    txRef: {
      type: String,
      required: false,
      unique: true,
      sparse: true
    },

    type: {
      type: String,
      required: true
    },

    amount: {
      type: Number,
      required: true
    },

    currency: {
      type: String,
      default: "NGN"
    },

    status: {
      type: String,
      default: "pending"
    },

    flutterwaveId: {
      type: String
    }

  },
  {
    timestamps: true
  }
);

module.exports =
  mongoose.model("Transaction", transactionSchema);
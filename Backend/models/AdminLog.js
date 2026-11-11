const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  adminEmail: { type: String, default: "admin" },
  action: { type: String, required: true },
  targetType: { type: String, default: "" },
  targetId: { type: String, default: "" },
  details: { type: String, default: "" }
}, { timestamps: true });
module.exports = mongoose.model("AdminLog", schema);

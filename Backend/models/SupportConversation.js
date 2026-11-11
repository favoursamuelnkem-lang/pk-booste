const mongoose = require("mongoose");
const supportMessageSchema = new mongoose.Schema({ sender: { type: String, enum: ["customer", "admin"], required: true }, text: { type: String, required: true, trim: true, maxlength: 2000 }, sentAt: { type: Date, default: Date.now } }, { _id: true });
const supportConversationSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true }, status: { type: String, enum: ["open", "closed"], default: "open", index: true }, messages: { type: [supportMessageSchema], default: [] }, lastMessageAt: { type: Date, default: Date.now, index: true } }, { timestamps: true });
supportConversationSchema.index({ userId: 1, status: 1 });
module.exports = mongoose.model("SupportConversation", supportConversationSchema);

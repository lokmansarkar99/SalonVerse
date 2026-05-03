import mongoose from "mongoose";

const notificationLogSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, required: true }, // e.g. 'welcome', 'near_reward'
    sentAt: { type: Date, default: Date.now }
}, {
    timestamps: true,
    versionKey: false
});

export const NotificationLogModel = mongoose.model("NotificationLog", notificationLogSchema);

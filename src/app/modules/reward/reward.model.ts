import { model, Schema, Types } from "mongoose";
import { IStatus } from "../user/user.interface";

// reward.model.ts
const rewardSchema = new Schema({
    userId: { type: Types.ObjectId, ref: "User" },
    type: { type: String, enum: ["INVITE", "SALON"], default: "INVITE" },
    title: { type: String },
    discountAmount: { type: Number },
    expiresAt: { type: Date },
    isUsed: { type: Boolean, default: false },
    source: { type: String, enum: ["SYSTEM", "SALON"], default: "SYSTEM" },
    status: { type: String, enum: Object.values(IStatus), default: IStatus.PENDING },
    createdAt: { type: Date, default: Date.now },
});

export const Reward = model("Reward", rewardSchema);




const viewRewardSchema = new Schema({
    userId: { type: Types.ObjectId, ref: "User" },
    salonId: { type: Types.ObjectId, ref: "Salon" },
    pendingCoins: { type: Number },
    totalCoins: { type: Number },
    status: { type: String, enum: Object.values(IStatus), default: IStatus.PENDING },
    viewCount: { type: Number, default: 0 },
    lastVisitAt: { type: Date },
    totalShare: { type: Number },
    everyVisitCoins: { type: Number, default: 0 },
    timeZoneBonusCoins: { type: Number, default: 0 },
    totalVisitBonusCoins: { type: Number, default: 0 },
    everyShareBonusCoins: { type: Number, default: 0 }
}, {
    timestamps: true
});

viewRewardSchema.index({ userId: 1, salonId: 1, createdAt: 1 });
export const ViewReward = model("ViewReward", viewRewardSchema);


// PRUCHASE -its generate When admin Approve viewReward
const pointIssuedHistory = new Schema({
    userId: { type: Types.ObjectId, ref: "User" },
    salonId: { type: Types.ObjectId, ref: "Salon" },
    points: { type: Number },
    services: { type: [String], default: [] },
    totalBill: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
})
export const PointIssuedHistory = model("PointIssuedHistory", pointIssuedHistory);



const purchaseRewardSchema = new Schema({
    userId: { type: Types.ObjectId, ref: "User" },
    salonId: { type: Types.ObjectId, ref: "Salon" },
    rewardId: { type: Types.ObjectId, ref: "RewardSalon" },
    pointCost: { type: Number },
    status: { type: String, enum: Object.values(IStatus), default: IStatus.PENDING },
}, { timestamps: true });

export const PurchaseReward = model("PurchaseReward", purchaseRewardSchema);


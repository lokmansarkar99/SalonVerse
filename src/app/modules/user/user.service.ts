import AppError from "../../errorHalper.ts/AppError";
import { UserModel } from "./user.model";
import httpStatus from "http-status-codes";
import bcrypt from "bcrypt";
import { JwtPayload } from "jsonwebtoken";
import { IAuthProvider, IStatus, IUser, USER_ROLE } from "./user.interface";
import unlinkFile from "../../shared/unLinkFile";
import { QueryBuilder } from "../../utils/QueryBuilder";
import generateNumber from "../../utils/generate";
import { Reward, ViewReward } from "../reward/reward.model";
import mongoose from "mongoose";
import { verifyOTPService } from "../OTP/OTP.service";
import { sendOTP } from "../../middleware/twilio";
import { Rule } from "../Setting/rule/rule.model";
import { firebaseNotificationBuilder } from "../../shared/sendNotification";
import { INOTIFICATION_EVENT, INOTIFICATION_TYPE, IREFERENCE_TYPE } from "../notification/notification.interface";

import { CreateUserToken } from "../../utils/userToken";
import { saveNotification, socketHelper } from "../../helpers/socketHelper";
import { NotificationModel } from "../notification/notification.model";


// ✅ Step 1: OTP পাঠাও
const sendRegistrationOTP = async (phoneNumber: string) => {
    const existingUser = await UserModel.findOne({ phoneNumber });

    await sendOTP(phoneNumber);
    return { message: "OTP sent to " + phoneNumber };
};

// ✅ Step 2: OTP verify + User create
// const createUser = async (payload: any) => {
//     const { referralCode, phoneNumber, otp } = payload;

//     // OTP verify করো
//     try {
//         await verifyOTPCode(phoneNumber, otp);
//     } catch (err) {
//         throw new AppError(httpStatus.BAD_REQUEST, "Invalid or expired OTP");
//     }

//     const existingUser = await UserModel.findOne({ phoneNumber });
//     if (existingUser) {
//         throw new AppError(httpStatus.BAD_REQUEST, "User already exists");
//     }

//     // Check inviter
//     let inviterUser = null;
//     if (referralCode) {
//         inviterUser = await UserModel.findOne({ referralCode });
//         if (!inviterUser) {
//             throw new AppError(httpStatus.BAD_REQUEST, "Invalid referral code");
//         }
//     }

//     // Create user
//     const user = await UserModel.create({
//         ...payload,
//         referralCode: generateNumber(8),
//         invitedBy: inviterUser ? inviterUser._id : null,
//         isPhoneVerified: true,
//         status: IStatus.ACTIVE,
//     });

//     // Invite reward logic
//     if (inviterUser) {
//         const updatedInviter = await UserModel.findByIdAndUpdate(
//             inviterUser._id,
//             { $inc: { successfulInvites: 1 } },
//             { new: true }
//         );

//         if (
//             updatedInviter &&
//             typeof updatedInviter.successfulInvites === "number" &&
//             updatedInviter.successfulInvites % 3 === 0
//         ) {
//             await Reward.create({
//                 userId: updatedInviter._id,
//                 type: "INVITE",
//                 title: "Invite Reward - 20 AED",
//                 discountAmount: 20,
//                 expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
//                 isUsed: false,
//                 source: "SYSTEM",
//                 createdAt: new Date(),
//             });
//         }
//     }

//     return user;
// };

export const createUser = async (payload: any) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { referralCode, phoneNumber, otp, ...rest } = payload;

        /* ================= OTP VERIFY ================= */

        await verifyOTPService(
            phoneNumber,
            otp,
        );

        /* ================= IF USER EXISTS → LOGIN ================= */

        const existingUser = await UserModel.findOne({ phoneNumber });

        if (existingUser) {
            await session.abortTransaction();
            session.endSession();

            const token = await CreateUserToken(existingUser);
            return {
                isNewUser: false,
                userId: existingUser._id,
                accessToken: token.accessToken,
                refreshToken: token.refreshToken,
            };
        }

        /* ================= CHECK INVITER ================= */

        let inviterUser = null;

        if (referralCode) {
            inviterUser = await UserModel.findOne({ referralCode }).select("+fcmToken");
            if (!inviterUser) {
                throw new AppError(httpStatus.BAD_REQUEST, "Invalid referral code");
            }
        }

        /* ================= CREATE USER ================= */

        const user = await UserModel.create(
            [
                {
                    ...rest,
                    phoneNumber,
                    referralCode: generateNumber(8),
                    invitedBy: inviterUser ? inviterUser._id : null,
                    verified: true,
                    status: IStatus.ACTIVE,
                },
            ],
            { session }
        );

        /* ================= INVITE REWARD ================= */

        if (inviterUser) {
            const updatedInviter = await UserModel.findByIdAndUpdate(
                inviterUser._id,
                { $inc: { successfulInvites: 1 } },
                { new: true, session }
            );

            if (updatedInviter && typeof updatedInviter.successfulInvites === "number" && updatedInviter.successfulInvites % 3 === 0) {
                await Reward.create(
                    [
                        {
                            userId: updatedInviter._id,
                            type: "INVITE",
                            title: "Invite Reward - 20 AED",
                            discountAmount: 20,
                            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                            isUsed: false,
                            source: "SYSTEM",
                            status: IStatus.PENDING,
                            createdAt: new Date(),
                        },
                    ],
                    { session }
                );
                // realtime notification
                socketHelper.emit("notification", {
                    receiver: updatedInviter._id,
                    title: "Invite Reward - 20 AED",
                    message: "You received a 20 AED reward for inviting 3 users",
                    type: "INVITE_REWARD",
                });
                await saveNotification({
                    receiverId: updatedInviter._id,
                    title: "Invite Reward - 20 AED",
                    body: "You received a 20 AED reward for inviting 3 users",
                    notificationEvent: INOTIFICATION_EVENT.INVITE,
                    notificationType: INOTIFICATION_TYPE.NOTIFICATION,
                    referenceId: updatedInviter._id,
                    referenceType: IREFERENCE_TYPE.USER,
                    read: false,
                });
            }
            Promise.allSettled([
                firebaseNotificationBuilder({
                    user: inviterUser,
                    title: "Referral Success",
                    body: "Your friend joined 💖 You earned something special!",
                    notificationEvent: INOTIFICATION_EVENT.INVITE,
                })
            ]);
        }


        await session.commitTransaction();
        session.endSession();

        // 🔥 Push Notification for New User (#1 Welcome)
        if (user[0] && user[0].fcmToken) {
            firebaseNotificationBuilder({
                user: user[0],
                title: "Welcome to Zena",
                body: "Your glow journey starts here",
                notificationEvent: INOTIFICATION_EVENT.LOGIN
            });
        }

        /* ================= GENERATE TOKENS ================= */
        const token = await CreateUserToken(user[0]);
        return {
            isNewUser: true,
            userId: user[0]._id,
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
        };
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw error;
    }
};


const getAllUser = async (user: JwtPayload, query: any) => {
    if (user.role !== USER_ROLE.SUPER_ADMIN) {
        throw new AppError(httpStatus.BAD_REQUEST, "You are not authorized");
    }

    const queryBuilder = new QueryBuilder(UserModel.find().lean(), query);
    const result = await queryBuilder
        .search(["name", "email"])
        .filter()
        .limit()
        .dateRange()
        .sort()
        .fields()
        .paginate();

    const [meta, data] = await Promise.all([result.getMeta(), result.build()]);
    if (!data || data.length === 0) {
        throw new AppError(httpStatus.NOT_FOUND, "No user found");
    }
    return { meta, data };
};

const updateUser = async (payload: any, owner: JwtPayload) => {
    const result = await UserModel.findById({ _id: owner.userId });
    if (!result) {
        throw new AppError(httpStatus.BAD_REQUEST, "User not found");
    }
    if (payload.image && result.image) {
        unlinkFile(result.image);
    }
    await UserModel.findOneAndUpdate({ _id: owner.userId }, payload, { new: true });

    return await userDetails(owner.userId);
};

const userDetails = async (userId: string) => {
    const result = await UserModel.findById({ _id: userId }).select("-password +fcmToken");
    if (!result) {
        throw new AppError(httpStatus.BAD_REQUEST, "User not found");
    }

    const totalVisit = await ViewReward.aggregate([
        {
            $match: {
                userId: result._id,
                status: IStatus.APPROVED
            }
        },
        {
            $group: {
                _id: null,
                totalVisit: { $sum: '$viewCount' },
                lastVisit: { $max: "$lastVisitAt" }
            }
        }
    ])
    const totalVisitValue = totalVisit.length > 0 ? totalVisit[0].totalVisit : 0;
    const lastVisit = totalVisit.length > 0 ? totalVisit[0].lastVisit : 0;
    const availableReward = await Reward.find({ userId: result._id, status: IStatus.PENDING });

    const tire = await Rule.findOne({ ruleType: 'rewardRule' })





    return { ...result.toObject(), TotalVisit: totalVisitValue, LastVisit: lastVisit, availableReward };
};


const deleteUser = async (owner: JwtPayload, userId?: string, password?: string) => {
    if (owner.role === USER_ROLE.USER) {
        if (!password) {
            throw new AppError(httpStatus.BAD_REQUEST, "Password is required to delete your account");
        }
        const user = await UserModel.findById(owner.id).select("password");
        if (!user) {
            throw new AppError(httpStatus.NOT_FOUND, "User not found");
        }
        const isMatch = await bcrypt.compare(password as string, user.password as string);
        if (!isMatch) {
            throw new AppError(httpStatus.EXPECTATION_FAILED, "Incorrect password");
        }
        return await userDeleteFunc(owner.id, IStatus.DELETED);
    }

    if (owner.role === USER_ROLE.SUPER_ADMIN && userId) {
        const user = await UserModel.findById(userId);
        if (!user) {
            throw new AppError(httpStatus.NOT_FOUND, "User not found");
        }
        if (user.role === USER_ROLE.SUPER_ADMIN) {
            throw new AppError(httpStatus.FORBIDDEN, "Admin cannot delete another admin");
        }
        return await userDeleteFunc(userId, IStatus.SUSPENDED);
    }
    throw new AppError(httpStatus.FORBIDDEN, "You are not authorized");
};

const userDeleteFunc = async (userId: string, status: IStatus) => {
    const updateData: Partial<IUser> = { status };
    if (status === IStatus.DELETED) {
        Object.assign(updateData, { name: "", email: "", password: "", image: "" });
    }
    const result = await UserModel.findByIdAndUpdate(userId, updateData, { new: true });
    if (!result) {
        throw new AppError(httpStatus.NOT_FOUND, "User not found");
    }
    return result;
};

const getUserCoins = async (userId: string) => {
    const result = await UserModel.findById(userId).select("coins");
    if (!result) {
        throw new AppError(httpStatus.NOT_FOUND, "User not found");
    }
    return result;
};

export const userService = {
    sendRegistrationOTP, // ✅ নতুন
    createUser,
    getAllUser,
    updateUser,
    userDetails,
    deleteUser,
    getUserCoins,
};
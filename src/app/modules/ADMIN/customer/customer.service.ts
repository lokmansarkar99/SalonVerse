import { JwtPayload } from "jsonwebtoken";
import AppError from "../../../errorHalper.ts/AppError";
import { QueryBuilder } from "../../../utils/QueryBuilder";
import { PointIssuedHistory, Reward, ViewReward } from "../../reward/reward.model";
import { IStatus, USER_ROLE } from "../../user/user.interface";
import { UserModel } from "../../user/user.model";
import httpStatus from "http-status-codes";
import mongoose, { Mongoose } from "mongoose";
import { firebaseNotificationBuilder } from "../../../shared/sendNotification";
import { INOTIFICATION_EVENT, INOTIFICATION_TYPE } from "../../notification/notification.interface";
import { visitSalon } from "../../SUPER_ADMIN/salon/visitRecord";
import generateNumber from "../../../utils/generate";

// customer.service.ts
const createCustomerManually = async (payload: any, adminId: string) => {
    const admin = await UserModel.findById(adminId);
    if (!admin) throw new AppError(httpStatus.NOT_FOUND, "Admin not found");

    if (admin.role !== USER_ROLE.OWNER && admin.role !== USER_ROLE.SUPER_ADMIN) {
        throw new AppError(httpStatus.FORBIDDEN, "You are not authorized");
    }

    const salon = await mongoose.model('Salon').findOne({ admin: admin._id });
    if (!salon) throw new AppError(httpStatus.NOT_FOUND, "Salon not found");

    let user = await UserModel.findOne({ phoneNumber: payload.phoneNumber });
    if (!user) {
        user = await UserModel.create({
            name: payload.name || "Customer",
            phoneNumber: payload.phoneNumber,
            role: USER_ROLE.USER,
            verified: true,
            status: IStatus.ACTIVE,
            referralCode: generateNumber(8).toString(),
        });
    }

    const visitResult = await visitSalon(salon._id.toString(), user._id.toString(), {
        services: payload.services || [],
        totalBill: payload.totalBill || 0,
        status: IStatus.APPROVED
    });

    const coinsToGrant = visitResult.coinsBreakdown.total;

    if (coinsToGrant > 0 && visitResult.reward) {
        await UserModel.findByIdAndUpdate(user._id, {
            $inc: { coins: coinsToGrant }
        });

        await ViewReward.findByIdAndUpdate(visitResult.reward._id, {
            $inc: { pendingCoins: -coinsToGrant }
        });
    }

    return {
        user,
        visitResult,
        grantedCoins: coinsToGrant
    };
};

const getAllCustomer = async (query: any, userId: string) => {
    const user = await UserModel.findById(userId);
    if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");
    if (user.role !== USER_ROLE.OWNER && user.role !== USER_ROLE.SUPER_ADMIN) throw new AppError(httpStatus.FORBIDDEN, "You are not authorized");

    let baseQuery;
    let totalCustomerFilter: any = { role: USER_ROLE.USER };

    if (user.role === USER_ROLE.OWNER) {
        const salon = await mongoose.model('Salon').findOne({ admin: user._id });
        if (!salon) throw new AppError(httpStatus.NOT_FOUND, "Salon not found");

        const visitedUserIds = await ViewReward.find({ salonId: salon._id }).distinct("userId");
        totalCustomerFilter = { _id: { $in: visitedUserIds }, role: USER_ROLE.USER };
        baseQuery = UserModel.find(totalCustomerFilter).select("name email image phoneNumber coins isOnline");
    } else {
        baseQuery = UserModel.find(totalCustomerFilter).select("name email image phoneNumber coins isOnline");
    }

    const queryBuilder = new QueryBuilder(baseQuery, query)
        .search(['name', 'phoneNumber'])
        .filter()
        .limit()
        .paginate()

    const [meta, data] = await Promise.all([
        queryBuilder.getMeta(),
        queryBuilder.build(),
    ]);
    if (data.length === 0) {
        throw new AppError(httpStatus.NOT_FOUND, "No visit history found");
    }

    const totalCustomer = await UserModel.countDocuments(totalCustomerFilter);
    const activeCustomer = await UserModel.countDocuments({
        ...totalCustomerFilter,
        isOnline: true
    });
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    let matchQuery: any = {
        createdAt: {
            $gte: todayStart
        }
    };
    if (user.role === USER_ROLE.OWNER) {
        const salon = await mongoose.model('Salon').findOne({ admin: user._id });
        if (salon) {
            matchQuery.salonId = salon._id;
        }
    }

    const TodayIssued = await PointIssuedHistory.aggregate([
        {
            $match: matchQuery
        },
        {
            $group: {
                _id: null,
                totalPoints: { $sum: "$points" }
            }
        }
    ]);

    const formattedUsers = data.map((u) => ({
        ...u.toObject(),
        name: u.name || "No Name",
        userId: u._id,
        phoneNumber: u.phoneNumber || "NO Number"
    }));


    return { meta, data: formattedUsers, dashboardData: { totalCustomer, activeCustomer, todayIssued: TodayIssued[0]?.totalPoints || 0 } }
}

const getSingleUser = async (userId: string, reqUser: JwtPayload) => {
    console.log(userId, reqUser.userId)
    const user = await UserModel.findById(userId).select("-auths").populate({ path: "invitedBy", select: "name image phoneNumber" });
    const userInfo = await UserModel.findById(reqUser.userId);
    if (!userInfo) throw new AppError(httpStatus.NOT_FOUND, "User not found");
    if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

    if (userInfo.role !== USER_ROLE.OWNER && userInfo.role !== USER_ROLE.SUPER_ADMIN) throw new AppError(httpStatus.FORBIDDEN, "You are not authorized");

    const totalVisitDoc = await ViewReward.findOne({ userId: new mongoose.Types.ObjectId(userId) }).select("viewCount");
    const totalVisit = totalVisitDoc ? totalVisitDoc.viewCount : 0;



    const availableReward = await Reward.find({ userId: new mongoose.Types.ObjectId(userId), status: IStatus.PENDING });

    return { user, totalVisit, availableReward }

}


// Approve Reward
const approvedReward = async (userId: string, reqUser: JwtPayload) => {
    const userInfo = await UserModel.findById(reqUser.userId);
    if (!userInfo) throw new AppError(httpStatus.NOT_FOUND, "User not found");

    if (userInfo.role !== USER_ROLE.OWNER && userInfo.role !== USER_ROLE.SUPER_ADMIN) throw new AppError(httpStatus.FORBIDDEN, "You are not authorized");

    const user = new mongoose.Types.ObjectId(userId)
    const reward = await Reward.findOne({ userId: user, status: IStatus.PENDING });
    if (!reward) throw new AppError(httpStatus.NOT_FOUND, "Reward not found");

    reward.status = IStatus.APPROVED;

    const rewardOwnerUser = await UserModel.findById(reward.userId);
    if (!rewardOwnerUser) throw new AppError(httpStatus.NOT_FOUND, "Reward owner not found");
    // if (rewardOwnerUser.fcmToken) {
    //     await firebaseNotificationBuilder({
    //         user: rewardOwnerUser,
    //         title: "You've successfully approved a reward",
    //         body: "You've successfully approved a reward",
    //         notificationEvent: INOTIFICATION_EVENT.APPROVE_REWARD,
    //         notificationType: INOTIFICATION_TYPE.NOTIFICATION,
    //         referenceId: userInfo._id,
    //         referenceType: "User"
    //     })
    // }
    await reward.save();

    return reward;
}

export const CustomerService = {
    createCustomerManually,
    getAllCustomer,
    getSingleUser,
    approvedReward
}

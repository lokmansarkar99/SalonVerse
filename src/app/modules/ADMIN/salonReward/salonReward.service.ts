import AppError from "../../../errorHalper.ts/AppError";
import { UserModel } from "../../user/user.model";
import httpStatus from "http-status-codes";
import { IStatus, USER_ROLE } from "../../user/user.interface";
import { RewardSalonModel } from "./salonReward.model";
import { SalonModel } from "../../SUPER_ADMIN/salon/salon.model";
import { QueryBuilder } from "../../../utils/QueryBuilder";
import unlinkFile from "../../../shared/unLinkFile";
import {
  PointIssuedHistory,
  PurchaseReward,
  ViewReward,
} from "../../reward/reward.model";
import mongoose, { Types } from "mongoose";
import { firebaseNotificationBuilder } from "../../../shared/sendNotification";
import {
  INOTIFICATION_EVENT,
  INOTIFICATION_TYPE,
  IREFERENCE_TYPE,
} from "../../notification/notification.interface";
import { saveNotification, socketHelper } from "../../../helpers/socketHelper";
import { Rule } from "../../Setting/rule/rule.model";
import { getDistance } from "../../SUPER_ADMIN/salon/distance";
import { visitSalon } from "../../SUPER_ADMIN/salon/visitRecord";
// reward.service.ts
const createReward = async (payload: any, userId: string) => {
  const user = await UserModel.findById(userId);
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  if (user.role !== USER_ROLE.OWNER) {
    throw new AppError(httpStatus.FORBIDDEN, "You are not authorized");
  }
  const salon = await SalonModel.findOne({ admin: user._id });
  if (!salon) {
    throw new AppError(httpStatus.NOT_FOUND, "Salon not found");
  }
  const reward = await RewardSalonModel.create({
    ...payload,
    ownerId: user._id,
    salonId: salon._id,
  });
  return reward;
};

const getAllSalonReward = async (query: any) => {
  const { salons, ...rest } = query;
  let mongoQuery: any = {};

  if (salons) {
    const salonIds = salons.split(",");
    mongoQuery.salonId = { $in: salonIds };
  }
  const reward = RewardSalonModel.find(mongoQuery);

  const queryBuilder = new QueryBuilder(reward, rest)
    .search([
      "rewardName",
      "service",
      "description",
      "redemptionPolicy",
      "rewardStatus",
    ])
    .filter()
    .sort()
    .paginate()
    .fields();

  const [data, meta] = await Promise.all([
    queryBuilder.build(),
    queryBuilder.getMeta(),
  ]);

  const salon = await Promise.all(
    data.map(async (item: any) => {
      const salon = await SalonModel.findById(item.salonId);
      return { ...item.toObject(), openingTime: salon?.openingTime };
    }),
  );

  const salonsWithClosedDays = salon.map((item: any) => {
    const closedDays = item.openingTime?.filter(
      (day: any) => day.isClosed === true,
    );

    return {
      ...item,
      // remove openingTime
      openingTime: undefined,
      closedDays,
    };
  });

  return { data: salonsWithClosedDays, meta };
};

const globalReward = async (userId: string, query: any) => {
  const user = await UserModel.findById(userId);
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const userViewReward = await ViewReward.find({ userId: userId });

  // Extract salonIds
  const salonIds = userViewReward
    .map((item) => item.salonId)
    .filter((id): id is Types.ObjectId => !!id);

  // Find salons in RewardSalonModel
  const reward = RewardSalonModel.find({ salonId: { $in: salonIds } });

  const queryBuilder = new QueryBuilder(reward, query)
    .search([
      "rewardName",
      "service",
      "description",
      "redemptionPolicy",
      "rewardStatus",
    ])
    .filter()
    .sort()
    .paginate()
    .fields();

  const [data, meta] = await Promise.all([
    queryBuilder.build(),
    queryBuilder.getMeta(),
  ]);

  const salon = await Promise.all(
    data.map(async (item: any) => {
      const salon = await SalonModel.findById(item.salonId);
      return { ...item.toObject(), openingTime: salon?.openingTime };
    }),
  );

  const salonsWithClosedDays = salon.map((item: any) => {
    const closedDays = item.openingTime?.filter(
      (day: any) => day.isClosed === true,
    );

    return {
      ...item,
      // remove openingTime
      openingTime: undefined,
      closedDays,
      VisitorCoin: user.coins,
    };
  });

  return { data: salonsWithClosedDays, meta };
};

const getSingleSalonReward = async (id: string, userId: string) => {
  const reward = await RewardSalonModel.findById(id);
  const visitorUser = await UserModel.findById(userId);
  if (!visitorUser) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }
  if (!reward) {
    throw new AppError(httpStatus.NOT_FOUND, "Reward not found");
  }
  return { ...reward.toObject(), VisitorCoin: visitorUser?.coins || 0 };
};

const updateSalonReward = async (id: string, payload: any) => {
  const rewardInfo = await RewardSalonModel.findById(id);
  if (!rewardInfo) {
    throw new AppError(httpStatus.NOT_FOUND, "Reward not found");
  }

  if (payload.rewardImage && rewardInfo.rewardImage) {
    await unlinkFile(rewardInfo.rewardImage);
  }

  const reward = await RewardSalonModel.findByIdAndUpdate(id, payload, {
    new: true,
  });
  return reward;
};

const claimReward = async (id: string, userId: string) => {
  const reward = await RewardSalonModel.findById(id);
  if (!reward) throw new AppError(httpStatus.NOT_FOUND, "Reward not found");

  const visitorUser = await UserModel.findById(userId);
  const admin = await UserModel.findOne({
    _id: new mongoose.Types.ObjectId(reward.ownerId),
  });
  if (!admin) throw new AppError(httpStatus.NOT_FOUND, "Admin not found");
  if (!visitorUser) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  await PurchaseReward.create({
    rewardId: reward._id,
    userId: visitorUser._id,
    salonId: reward.salonId,
    pointCost: reward.rewardPoints,
  });

  if (Number(reward?.rewardPoints) > Number(visitorUser?.coins)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "You don't have enough coins to claim this reward",
    );
  }

  await UserModel.findByIdAndUpdate(visitorUser._id, {
    $inc: { coins: -reward.rewardPoints },
  });

  // realtime notification
  socketHelper.emit("notification", {
    receiver: visitorUser._id,
    title: "Reward Claimed",
    message: `${reward.rewardName} claimed successfully`,
    type: "INVITE_REWARD",
  });
  await saveNotification({
    receiverId: visitorUser._id,
    title: "Reward Claimed",
    body: `${reward.rewardName} claimed successfully`,
    notificationEvent: INOTIFICATION_EVENT.PURCHASE_REWARD,
    notificationType: INOTIFICATION_TYPE.NOTIFICATION,
    referenceId: visitorUser._id,
    referenceType: IREFERENCE_TYPE.USER,
    read: false,
  });

  return `${reward.rewardName} claimed successfully`;
};

// RDDEMPTION

const getAllRedemption = async (query: any, userId: string) => {
  const { phone, rewardName, ...rest } = query;

  let mongoQuery: any = {};

  const userInfo = await UserModel.findById(userId);
  if (userInfo?.role === USER_ROLE.OWNER) {
    const salon = await SalonModel.findOne({ admin: userInfo._id });
    if (salon) {
      mongoQuery.salonId = salon._id;
    }
  }

  if (phone) {
    const user = await UserModel.findOne({ phoneNumber: phone });
    if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");
    mongoQuery.userId = user._id;
  }
  if (rewardName) {
    const reward = await RewardSalonModel.findOne({ rewardName: rewardName });
    if (reward) {
      mongoQuery.rewardId = reward._id;
    }
  }
  const reward = PurchaseReward.find(mongoQuery)
    .populate({ path: "rewardId", select: "rewardName rewardPoints" })
    .populate({ path: "userId", select: "phoneNumber" });

  const queryBuilder = new QueryBuilder(reward, rest)
    .search(["status"])
    .filter()
    .sort()
    .paginate()
    .fields();

  const [data, meta] = await Promise.all([
    queryBuilder.build(),
    queryBuilder.getMeta(),
  ]);

  if (data.length < 0) {
    throw new AppError(httpStatus.NOT_FOUND, "No data found");
  }

  const result = data.map((item: any) => {
    return {
      _id: item._id,
      rewardName: item.rewardId.rewardName,
      rewardPoints: item.rewardId.rewardPoints,
      phoneNumber: item.userId.phoneNumber,
      status: item.status,
      createdAt: item.createdAt,
    };
  });

  const coundPending = await PurchaseReward.countDocuments({
    status: IStatus.PENDING,
  });
  const coundApproved = await PurchaseReward.countDocuments({
    status: IStatus.APPROVED,
  });
  const coundRejected = await PurchaseReward.countDocuments({
    status: IStatus.REJECTED,
  });
  const totalPointReedem = await PurchaseReward.aggregate([
    {
      $match: { status: IStatus.APPROVED },
    },
    {
      $lookup: {
        from: "rewardsalons",
        localField: "rewardId",
        foreignField: "_id",
        as: "rewardId",
      },
    },
    {
      $unwind: "$rewardId",
    },
    {
      $group: {
        _id: null,
        totalPointReedem: { $sum: "$rewardId.rewardPoints" },
      },
    },
  ]);

  return {
    data: result,
    meta,
    statusCount: {
      pending: coundPending,
      approved: coundApproved,
      rejected: coundRejected,
      totalPointReedem: totalPointReedem[0]?.totalPointReedem || 0,
    },
  };
};

const approveRedemption = async (
  id: string,
  adminId: string,
  payload?: { services?: string[]; totalBill?: number },
) => {
  // id = userId passed by admin, adminId = logged-in admin

  // 1️⃣ Validate payload
  if (!payload?.services || payload.services.length === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "Please select at least one service.");
  }

  if (payload.totalBill === undefined || payload.totalBill <= 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "Total bill must be greater than zero.");
  }

  // 2️⃣ Find the target user
  const user = await UserModel.findById(id);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  // 3️⃣ Find admin and their salon
  const admin = await UserModel.findById(adminId);
  if (!admin) throw new AppError(httpStatus.NOT_FOUND, "Admin not found");

  const salon = await SalonModel.findOne({ admin: admin._id });
  if (!salon)
    throw new AppError(httpStatus.NOT_FOUND, "Salon not found for this admin");

  // 4️⃣ Find today's visit that is pending
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const todayVisitHistory = await PointIssuedHistory.findOne({
    userId: user._id,
    salonId: salon._id,
    createdAt: { $gte: startOfDay, $lte: endOfDay }
  });

  if (!todayVisitHistory) {
    throw new AppError(httpStatus.NOT_FOUND, "No visit history found for today to approve. User must confirm visit first.");
  }

  // 5️⃣ Update ViewReward status and transfer coins
  const viewReward = await ViewReward.findOne({ userId: user._id, salonId: salon._id });
  if (!viewReward || !viewReward.pendingCoins || viewReward.pendingCoins <= 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "No pending coins found for this user at this salon.");
  }

  const coinsToGrant = viewReward.pendingCoins;

  // Grant coins to user
  await UserModel.findByIdAndUpdate(user._id, {
    $inc: { coins: coinsToGrant }
  });

  // Reset pending coins and mark as approved
  viewReward.pendingCoins = 0;
  viewReward.status = IStatus.APPROVED;
  await viewReward.save();

  // 6️⃣ Update PointIssuedHistory
  todayVisitHistory.services = payload.services;
  todayVisitHistory.totalBill = payload.totalBill;
  await todayVisitHistory.save();

  // 7️⃣ Notify user
  socketHelper.emit("notification", {
    receiver: user._id.toString(),
    title: "Visit Approved",
    message: `Your visit to ${salon.businessName} was approved. You received ${coinsToGrant} coins!`,
    type: "VISIT_APPROVED",
  });
  await saveNotification({
    receiverId: user._id,
    title: "Visit Approved",
    body: `Your visit to ${salon.businessName} was approved. You received ${coinsToGrant} coins!`,
    notificationEvent: INOTIFICATION_EVENT.VISIT,
    notificationType: INOTIFICATION_TYPE.NOTIFICATION,
    read: false,
  });

  return {
    message: `Visit approved! ${coinsToGrant} coins granted to ${user.name}`,
    grantedCoins: coinsToGrant
  };
};

const getPurchaseRewardHistory = async (
  userId: string,
  query: Record<string, string>,
) => {
  const matchQuery: any = { userId: new mongoose.Types.ObjectId(userId) };

  if (query.searchTerm) {
    const matchingSalons = await SalonModel.find({
      businessName: { $regex: query.searchTerm, $options: "i" },
    }).select("_id");
    const salonIds = matchingSalons.map((s) => s._id);
    matchQuery.salonId = { $in: salonIds };
  }

  const reward = PurchaseReward.find(matchQuery)
    .populate({ path: "salonId", select: "businessName service" })
    .lean();
  if (!reward) throw new AppError(httpStatus.NOT_FOUND, "Reward not found");

  const queryBuilder = new QueryBuilder(reward, query)
    .search([])
    .filter()
    .sort();

  const [data, meta] = await Promise.all([
    queryBuilder.build(),
    queryBuilder.getMeta(),
  ]);

  const total = await PurchaseReward.aggregate([
    {
      $match: { userId: new mongoose.Types.ObjectId(userId) },
    },
    {
      $group: {
        _id: null,
        totalPointReedem: { $sum: "$pointCost" },
      },
    },
  ]);

  return {
    meta,
    reward: data,
    totalPointReedem: total[0]?.totalPointReedem || 0,
  };
  // return reward
};

const getViewHistory = async (id: string, userId: string) => {
  const reward = await PointIssuedHistory.find({
    salonId: new mongoose.Types.ObjectId(id),
    userId: new mongoose.Types.ObjectId(userId),
  })
    .populate({ path: "userId", select: "phoneNumber" })
    .populate({ path: "salonId", select: "businessName location service" });
  let salonData = null;

  if (reward.length === 0) {
    const salon = await SalonModel.findById(id).select(
      "businessName location service",
    );
    if (!salon) throw new AppError(httpStatus.NOT_FOUND, "Salon not found");
    salonData = salon as any;
  } else {
    salonData = reward[0].salonId as any;
  }

  // Salon info (only once)
  const salon = {
    businessName: salonData?.businessName || "",
    location: salonData?.location || "",
    service: salonData?.service || "",
  };

  // History list
  const history = reward.map((item: any) => ({
    _id: item._id,
    points: item?.points || 0,
    services: item?.services || [],
    totalBill: item?.totalBill || 0,
    createdAt: item?.createdAt,
  }));

  return {
    salon,
    history,
  };
};

export const salonRewardService = {
  createReward,
  getAllSalonReward,
  getSingleSalonReward,
  updateSalonReward,
  claimReward,
  approveRedemption,
  getAllRedemption,
  globalReward,
  getPurchaseRewardHistory,
  getViewHistory,
};

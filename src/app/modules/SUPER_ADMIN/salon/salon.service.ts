// salon.service.ts
import httpStatus from "http-status-codes";
import bcrypt from "bcrypt";
import { RatingModel, SalonModel } from "./salon.model";
import AppError from "../../../errorHalper.ts/AppError";
import { UserModel } from "../../user/user.model";
import { IStatus, USER_ROLE } from "../../user/user.interface";
import generateNumber, { generateHashCode } from "../../../utils/generate";
import { QueryBuilder } from "../../../utils/QueryBuilder";
import { visitSalon } from "./visitRecord";
import { PointIssuedHistory, PurchaseReward, Reward, ViewReward } from "../../reward/reward.model";
import { RewardSalonModel } from "../../ADMIN/salonReward/salonReward.model";
import axios from "axios";
import { envVar } from "../../../config/env";
import { getDistance } from "./distance";
import mongoose from "mongoose";

const createSalon = async (payload: any, user: string) => {
    const superAdmin = await UserModel.findById(user);
    if (!superAdmin) {
        throw new AppError(httpStatus.NOT_FOUND, "Super Admin not found");
    }

    if (superAdmin.role !== USER_ROLE.SUPER_ADMIN) {
        throw new AppError(httpStatus.FORBIDDEN, "You are not authorized");
    }

    const { email, phone, password, ...salonPayload } = payload;

    if (!email || !phone || !password) {
        throw new AppError(httpStatus.BAD_REQUEST, "Admin email, phone, and password are required");
    }

    const exist = await SalonModel.findOne({ email });

    if (exist) {
        throw new AppError(httpStatus.BAD_REQUEST, "Salon already exists");
    }

    let adminInfo = await UserModel.findOne({ $or: [{ email }, { phoneNumber: phone }] });

    if (adminInfo) {
        throw new AppError(httpStatus.BAD_REQUEST, "User with this email or phone already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    adminInfo = await UserModel.create({
        name: salonPayload.businessName || "Salon Admin",
        email: email,
        phoneNumber: phone,
        password: hashedPassword,
        role: USER_ROLE.OWNER,
        verified: true,
        status: IStatus.ACTIVE,
        referralCode: generateNumber(8).toString()
    });

    const generateSalonId = await generateHashCode(adminInfo);

    const salon = await SalonModel.create({ 
        ...salonPayload, 
        email, 
        phone, 
        admin: adminInfo._id, 
        createdBy: superAdmin._id, 
        salonId: generateSalonId 
    });
    return salon;
};
// daily Subscription Check 
export const dailySubscriptionCheck = async () => {
    const salons = await SalonModel.find();
    salons.forEach(async (salon) => {
        const subscription = await SalonModel.findOne({ _id: salon._id });
        if (subscription) {
            if (subscription.activeStatus === IStatus.ACTIVE) {
                const today = new Date();
                const subscriptionEndDate = new Date(subscription.expiryDate);
                if (today > subscriptionEndDate) {
                    subscription.activeStatus = IStatus.EXPIRED;
                    await subscription.save();
                }
            }
        }
    });
};

const getAllSalon = async (query: any) => {
    const { lat1, lon1, ...rest } = query;

    const queryBuilder = new QueryBuilder(SalonModel.find().populate("admin", "name email phoneNumber"), rest);
    const result = await queryBuilder
        .search(['businessName', 'service', 'city', 'activeStatus'])
        .filter()
        .sort()
        .paginate()
        .fields();
    const [meta, data] = await Promise.all([
        queryBuilder.getMeta(),
        queryBuilder.build(),
    ]);
    if (data.length === 0) {
        return { allData: [], meta };
    }
    const allData = await Promise.all(
        data.map(async (salon) => {
            const visitor = await ViewReward.countDocuments({ salonId: salon._id });
            return { ...salon.toObject(), visitor }
        })
    )
    const injectIsRewardAvailable = await Promise.all(
        allData.map(async (salon) => {
            const reward = await RewardSalonModel.findOne({ salonId: salon._id });


            let distance = null;
            if (lat1 && lon1) {
                const response = await axios.get(
                    `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${Number(lat1)},${Number(lon1)}&destinations=${Number(salon.lat)},${Number(salon.lon)}&key=${envVar.GOOGLE_MAP_KEY}`
                );

                const element = response?.data?.rows?.[0]?.elements?.[0];

                if (element?.status === "OK") {
                    distance = element.distance.text;
                }
            }

            return { ...salon, isRewardAvailable: !!reward, distance }
        })
    )

    return { allData: injectIsRewardAvailable, meta };

};

const updateSalon = async (payload: any, user: string) => {
    const owner = await UserModel.findById(user);
    if (!owner) {
        throw new AppError(httpStatus.NOT_FOUND, "Owner not found");
    }

    if (owner.role !== USER_ROLE.OWNER) {
        throw new AppError(httpStatus.FORBIDDEN, "You are not authorized");
    }
    const salonOwner = await SalonModel.findOne({ admin: owner._id });
    if (!salonOwner) {
        throw new AppError(httpStatus.NOT_FOUND, `Salon not found for this ${owner.name}`);
    }

    const salon = await SalonModel.findByIdAndUpdate(salonOwner._id, payload, {
        new: true,
    });

    if (!salon) {
        throw new AppError(httpStatus.NOT_FOUND, "Salon not found");
    }

    return salon;
};

const deleteSalon = async (id: string, user: string) => {
    const superAdmin = await UserModel.findById(user);
    if (!superAdmin) {
        throw new AppError(httpStatus.NOT_FOUND, "Super Admin not found");
    }

    if (superAdmin.role !== USER_ROLE.SUPER_ADMIN) {
        throw new AppError(httpStatus.FORBIDDEN, "You are not authorized");
    }
    const salon = await SalonModel.findByIdAndUpdate(id, { activeStatus: IStatus.DELETED });

    if (!salon) {
        throw new AppError(httpStatus.NOT_FOUND, "Salon not found");
    }

    return null;
};

const getSingleSalon = async (id: string, userId: string, lat1: string, lon1: string) => {
    const viwerInfo = await UserModel.findById(userId);
    if (!viwerInfo) throw new AppError(httpStatus.NOT_FOUND, "User not found");

    // 1️⃣ Find the salon and populate admin info
    const salon = await SalonModel.findById(id).populate("admin", "name email phoneNumber");
    if (!salon) {
        throw new AppError(httpStatus.NOT_FOUND, "Salon not found");
    }

    // 2️⃣ Find all visitors for this salon
    const visitors: any = await ViewReward.find({ salonId: salon._id }).populate(
        "userId",
        "isOnline "
    )
        .lean();

    let distance = 0
    if (lat1 && lon1) {
        distance = getDistance(lat1, lon1, salon.lat, salon.lon);
    }


    // 4️⃣ Calculate total online customers

    const totalOnline = visitors.filter((visitor: any) => visitor.userId?.isOnline).length;

    const result = await RatingModel.aggregate([
        {
            $match: { salonId: new mongoose.Types.ObjectId(id) }
        },
        {
            $group: {
                _id: "$salonId",
                averageRating: { $avg: "$rating" },
                totalRatings: { $sum: 1 }
            }
        }
    ]);
    const isVisited = await ViewReward.findOne({ salonId: salon._id, userId: userId, updatedAt: new Date().toISOString().split("T")[0] });
    return {
        ...salon.toObject(),
        isVisited: !!isVisited,
        totalOnline,
        distance,
        averageRating: result[0]?.averageRating,
        totalRatings: result[0]?.totalRatings,

    };
};
const getSalonSetting = async (user: string) => {
    const owner = await UserModel.findById(user);
    console.log("OWNER", owner)
    if (!owner) {
        throw new AppError(httpStatus.NOT_FOUND, "Owner not found");
    }

    if (owner.role !== USER_ROLE.OWNER) {
        throw new AppError(httpStatus.FORBIDDEN, "You are not authorized");
    }
    const salonOwner = await SalonModel.findOne({ admin: owner._id });
    console.log("SALONWONER", salonOwner)
    if (!salonOwner) {
        throw new AppError(httpStatus.NOT_FOUND, `Salon not found for this ${owner.name}`);
    }

    return salonOwner;
};

const visitConfirm = async (id: string, user: string, lat1: string, lon1: string) => {
    const viwerInfo = await UserModel.findById(user);
    if (!viwerInfo) throw new AppError(httpStatus.NOT_FOUND, "User not found");

    // 1️⃣ Find the salon and populate admin info
    const salon = await SalonModel.findById(id).populate("admin", "name email phoneNumber");
    if (!salon) {
        throw new AppError(httpStatus.NOT_FOUND, "Salon not found");
    }

    const checkTodayVisitSalon = await PointIssuedHistory.find({ salonId: salon._id, userId: user, createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } });
    if (checkTodayVisitSalon.length > 0) {
        throw new AppError(httpStatus.BAD_REQUEST, "You have already visited this salon today");
    }

    // 2️⃣ Find all visitors for this salon
    const visitors = await ViewReward.find({ salonId: salon._id }).populate<{ customer: { isOnline: boolean } }>(
        "userId",
        "isOnline "
    )
        .lean();

    if (!salon.lat || !salon.lon) {
        throw new AppError(httpStatus.BAD_REQUEST, "Salon coordinates are not configured in the system.");
    }

    let distance = NaN
    if (lat1 && lon1) {
        distance = getDistance(lat1, lon1, salon.lat, salon.lon);
    }

    console.log("DISTANCE", distance)

    if (isNaN(distance) || distance * 1000 > 50) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            `You are too far from the salon. You must be within 50 meters. (Current: ${Math.round(distance * 1000)}m)`
        );
    }

    // 3️⃣ Calculate total points issued
    await visitSalon(salon._id.toString(), viwerInfo._id.toString());

    // 5️⃣ Return summary only
    return { message: "Visit confirmed successfully" }
};

const salonMenagement = async (user: string) => {
    const owner = await UserModel.findById(user);
    if (!owner) {
        throw new AppError(httpStatus.NOT_FOUND, "Owner not found");
    }

    if (owner.role !== USER_ROLE.SUPER_ADMIN) {
        throw new AppError(httpStatus.FORBIDDEN, "You are not authorized");
    }
    const activeSalon = await SalonModel.countDocuments({ activeStatus: IStatus.ACTIVE });
    const totalUser = await UserModel.countDocuments({ role: USER_ROLE.USER });
    const expiringSoon = await SalonModel.find({
        expiryDate: {
            $gte: new Date(),
            $lt: new Date(new Date().setDate(new Date().getDate() + 30))
        }
    }).select("businessName")
    const totalExpiringSoon = expiringSoon.length;

    return { activeSalon, totalUser, totalExpiringSoon };
};

const updateSalonRating = async (id: string, user: string, rating: number, comment: string) => {
    const userInfo = await UserModel.findById(user);
    if (!userInfo) {
        throw new AppError(httpStatus.NOT_FOUND, "User not found");
    }

    console.log("USERinfo", userInfo)
    if (rating < 1 || rating > 5) {
        throw new AppError(httpStatus.BAD_REQUEST, "Rating must be between 1 and 5");
    }

    if (userInfo.role !== USER_ROLE.USER) {
        throw new AppError(httpStatus.FORBIDDEN, "You are not authorized");
    }
    const salon = await RatingModel.create({ rating, comment, userId: user, salonId: id });

    if (!salon) {
        throw new AppError(httpStatus.NOT_FOUND, "Salon not found");
    }

    return salon;
};
export const salonService = {
    createSalon,
    getAllSalon,
    getSingleSalon,
    updateSalon,
    deleteSalon,
    visitConfirm,
    getSalonSetting,
    salonMenagement,
    updateSalonRating
};

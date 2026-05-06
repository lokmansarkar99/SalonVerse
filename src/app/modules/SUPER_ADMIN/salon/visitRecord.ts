import AppError from "../../../errorHalper.ts/AppError";
import { saveNotification, socketHelper } from "../../../helpers/socketHelper";
import { INOTIFICATION_EVENT, INOTIFICATION_TYPE, IREFERENCE_TYPE } from "../../notification/notification.interface";
import { PointIssuedHistory, ViewReward } from "../../reward/reward.model";
import { Rule, TimeDayRule } from "../../Setting/rule/rule.model";
import { IStatus, USER_ROLE } from "../../user/user.interface";
import { UserModel } from "../../user/user.model";
import { SalonModel } from "./salon.model";
import { firebaseNotificationBuilder } from "../../../shared/sendNotification";

export const visitSalon = async (salonId: string, userId: string, payload?: { services?: string[], totalBill?: number, status?: IStatus }) => {
    // 1️⃣ Check User
    const user = await UserModel.findById(userId).select("+fcmToken");
    if (!user) throw new AppError(404, "User not found");

    if (user.role !== USER_ROLE.USER) {
        throw new AppError(403, "Only users can receive visit coins");
    }

    // 2️⃣ Check Salon
    const salon = await SalonModel.findById(salonId);
    if (!salon) throw new AppError(404, "Salon not found");
    const admin = await UserModel.findById(salon?.admin);
    if (!admin) throw new AppError(404, "Admin not found");


    // 3️⃣ Get Smart Rule
    const rules = await Rule.findOne({ ruleType: "smartRule" });
    if (!rules) throw new AppError(404, "Smart rule not found");

    // 4️⃣ Get Riyadh Time
    const riyadhTime = new Date(
        new Date().toLocaleString("en-US", { timeZone: "Asia/Riyadh" })
    );

    const currentHour = riyadhTime.getHours();
    const daysMap = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const currentDay = daysMap[riyadhTime.getDay()];

    // 5️⃣ Prevent Multiple Coins Same Day
    const startOfDay = new Date(riyadhTime);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(riyadhTime);
    endOfDay.setHours(23, 59, 59, 999);

    const todayVisit = await ViewReward.findOne({
        userId,
        salonId,
        lastVisitAt: { $gte: startOfDay, $lte: endOfDay },
    });

    if (todayVisit) {
        throw new AppError(400, "User has already received a visit coin for this salon today");
    }

    // 6️⃣ Monthly Visit Count
    const startOfMonth = new Date(
        riyadhTime.getFullYear(),
        riyadhTime.getMonth(),
        1
    );

    const endOfMonth = new Date(
        riyadhTime.getFullYear(),
        riyadhTime.getMonth() + 1,
        1
    );

    const totalMonthlyVisits = await ViewReward.countDocuments({
        userId,
        salonId,
        lastVisitAt: { $gte: startOfMonth, $lt: endOfMonth },
    });

    // 7️⃣ Monthly Limit Check
    if (totalMonthlyVisits >= rules.totalVist) {
        throw new AppError(400, "Monthly visit limit reached");
    }

    // 8️⃣ Timezone Bonus Check
    const isInTimeZone =
        currentHour >= rules.timeZoneStart &&
        currentHour < rules.timeZoneEnd;

    // 9️⃣ Visit Count Bonus Check
    // +1 কারণ এই visit টা এখনো count হয়নি
    const nextVisitCount = totalMonthlyVisits + 1;
    const isTotalVisitBonus = nextVisitCount % rules.totalVist === 0;

    // 🔟 Coin Calculate
    let baseCoins = rules.everyVisitCoins;
    if (isInTimeZone) baseCoins += rules.timeZoneGetCoin;
    if (isTotalVisitBonus) baseCoins += rules.totalVisitGetCoin;

    // 1️⃣1️⃣ Time & Day Rule Multiplier
    const activeTimeDayRules = await TimeDayRule.find({ isActive: true });
    let appliedMultiplier = 1;
    let appliedRuleName: string | null = null;

    for (const tdr of activeTimeDayRules) {
        const dayMatch = (tdr as any).applicableDays.includes(currentDay);
        const timeMatch = currentHour >= (tdr as any).timeStart && currentHour < (tdr as any).timeEnd;
        if (dayMatch && timeMatch && (tdr as any).pointsMultiplier > appliedMultiplier) {
            appliedMultiplier = (tdr as any).pointsMultiplier;
            appliedRuleName = (tdr as any).ruleName;
        }
    }

    const coinsToAdd = Math.round(baseCoins * appliedMultiplier);

    // 1️⃣1️⃣ Create or Update Reward Entry
    const reward = await ViewReward.findOneAndUpdate(
        { userId, salonId },
        {
            $inc: {
                pendingCoins: coinsToAdd,
                viewCount: 1,
                totalCoins: coinsToAdd,
                everyVisitCoins: rules.everyVisitCoins,
                timeZoneBonusCoins: isInTimeZone ? rules.timeZoneGetCoin : 0,
                totalVisitBonusCoins: isTotalVisitBonus ? rules.totalVisitGetCoin : 0,
            },
            $set: {
                status: payload?.status || IStatus.PENDING,
                lastVisitAt: new Date(),
            },
        },
        { upsert: true, new: true }
    );
    console.log("rewardVIEWcount", reward.viewCount)
    await PointIssuedHistory.create({
        userId: userId,
        salonId: salonId,
        points: coinsToAdd,
        services: payload?.services || [],
        totalBill: payload?.totalBill || 0,
    })

    socketHelper.emit("notification", {
        receiver: user._id.toString(),
        title: "Visit Reward pending",
        message: `You've successfully visited a salon and pending ${coinsToAdd} coins`,
        type: "VISIT_REWARD",
    });
    await saveNotification({
        receiverId: user._id,
        title: "Visit Reward pending",
        body: `You've successfully visited a salon and pending ${coinsToAdd} coins for approval`,
        notificationEvent: INOTIFICATION_EVENT.VISIT,
        notificationType: INOTIFICATION_TYPE.NOTIFICATION,
        read: false,
    });

    // 🔥 Push Notifications for User Engagement
    const pushNotifications: any[] = [];


    // Phase 2: After First Visit
    if (reward.viewCount === 1) {
        pushNotifications.push(firebaseNotificationBuilder({
            user,
            title: "Visit Recorded",
            body: "That was just the beginning 💖",
            notificationEvent: INOTIFICATION_EVENT.VISIT
        }));
    }

    // Phase 3: Reward Engine (Points Milestones)
    const totalCoins = reward.totalCoins || 0;
    if (totalCoins >= 400) {
        pushNotifications.push(firebaseNotificationBuilder({
            user,
            title: "Reward Unlocked",
            body: "Your reward is ready 💖 Go enjoy it!",
            notificationEvent: INOTIFICATION_EVENT.VISIT
        }));
    } else if (totalCoins >= 300) {
        pushNotifications.push(firebaseNotificationBuilder({
            user,
            title: "So Close!",
            body: "You’re so close 🎁 Just one visit left!",
            notificationEvent: INOTIFICATION_EVENT.VISIT
        }));
    } else if (totalCoins >= 200) {
        pushNotifications.push(firebaseNotificationBuilder({
            user,
            title: "Mid Progress",
            body: "You’re getting closer to something special ✨",
            notificationEvent: INOTIFICATION_EVENT.VISIT
        }));
    } else if (totalCoins >= 100 && totalCoins < 200) {
        // Check if it just crossed 100 in this visit
        if (totalCoins - coinsToAdd < 100) {
            pushNotifications.push(firebaseNotificationBuilder({
                user,
                title: "Points Rolling In 💖",
                body: "You’ve started collecting points 💖 Keep going!",
                notificationEvent: INOTIFICATION_EVENT.VISIT
            }));
        }
    } else {
        pushNotifications.push(firebaseNotificationBuilder({
            user,
            title: "Points Rolling In 💖",
            body: "You’ve started collecting points 💖 Keep going!",
            notificationEvent: INOTIFICATION_EVENT.VISIT
        }));
    }


    // Wait for pushes but don't block the main flow entirely if they fail
    Promise.allSettled(pushNotifications);

    // realtime notification for admin
    socketHelper.emit("notification", {
        receiver: admin._id,
        title: "Reward Claimed",
        message: `${user.name} claimed successfully`,
        type: "INVITE_REWARD",
    });
    await saveNotification({
        receiverId: admin._id,
        title: "Reward Claimed",
        body: `${user.name} visited your salon and claimed ${coinsToAdd} coins pending`,
        notificationEvent: INOTIFICATION_EVENT.PURCHASE_REWARD,
        notificationType: INOTIFICATION_TYPE.NOTIFICATION,
        referenceId: user._id,
        referenceType: IREFERENCE_TYPE.USER,
        read: false,
    });

    return {
        message: `Visit recorded! ${coinsToAdd} coins pending`,
        coinsBreakdown: {
            baseCoins: rules.everyVisitCoins,
            timezoneBonus: isInTimeZone ? rules.timeZoneGetCoin : 0,
            visitCountBonus: isTotalVisitBonus ? rules.totalVisitGetCoin : 0,
            timeDayMultiplier: appliedMultiplier,
            appliedTimeDayRule: appliedRuleName,
            total: coinsToAdd,
        },
        reward,
    };
};

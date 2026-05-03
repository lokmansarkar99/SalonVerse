import cron from "node-cron";
import { dailySubscriptionCheck } from "../../SUPER_ADMIN/salon/salon.service";
import { Reward, ViewReward } from "../../reward/reward.model";
import { IStatus } from "../../user/user.interface";
import { UserModel } from "../../user/user.model";
import { firebaseNotificationBuilder } from "../../../shared/sendNotification";
import { INOTIFICATION_EVENT } from "../../notification/notification.interface";
import mongoose from "mongoose";

export const startCheckSubscriptionCron = () => cron.schedule("0 0 * * *", async () => {
    console.log("Daily subscription check started");
    await dailySubscriptionCheck();
});

export const startRewardExpireCron = () => {
    cron.schedule("0 0 * * *", async () => {
        try {
            const now = new Date();
            const result = await Reward.updateMany(
                {
                    expiresAt: { $lt: now },
                    isUsed: false,
                    status: { $ne: IStatus.EXPIRED }
                },
                {
                    $set: { status: IStatus.EXPIRED }
                }
            );
            console.log(`Expired rewards updated: ${result.modifiedCount}`);
        } catch (error) {
            console.error("Reward expire cron error:", error);
        }
    });
};

export const startNotificationCrons = () => {

    // 1️⃣ Daily Engagement Crons (Every day at 10:00 AM)
    cron.schedule("0 10 * * *", async () => {
        try {
            console.log("Daily engagement crons started");
            const now = new Date();
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

            // Phase 1 - 2. Complete Profile
            const incompleteUsers = await UserModel.find({
                isCompleted: false,
                createdAt: { $lt: oneDayAgo },
                fcmToken: { $exists: true, $ne: "" }
            }).select("+fcmToken languages");
            
            incompleteUsers.forEach(user => {
                const isArabic = (user as any).languages === 'AR';
                firebaseNotificationBuilder({
                    user,
                    title: isArabic ? '✨ كمّلي ملفك' : 'Complete your profile ✨',
                    body: isArabic ? 'عشان يكون حضورك واضح عند زيارتك 💖' : 'So salons can recognize you instantly',
                    sendOnceKey: "complete_profile",
                    notificationEvent: INOTIFICATION_EVENT.LOGIN,
                    saveToDatabase: false
                });
            });

            // Phase 1 - 3. First Visit Push
            const newUsersWithNoVisits = await UserModel.aggregate([
                { $match: { createdAt: { $lt: oneDayAgo }, fcmToken: { $exists: true, $ne: "" } } },
                {
                    $lookup: {
                        from: "viewrewards",
                        localField: "_id",
                        foreignField: "userId",
                        as: "visits"
                    }
                },
                { $match: { "visits.0": { $exists: false } } },
                { $project: { fcmToken: 1, name: 1, email: 1, languages: 1 } }
            ]);
            newUsersWithNoVisits.forEach(user => {
                const isArabic = user.languages === 'AR';
                firebaseNotificationBuilder({
                    user,
                    title: isArabic ? '✨ كل شي يبدأ بزيارة وحدة' : 'Your glow starts here',
                    body: isArabic ? 'خليها اليوم 💖' : 'Your glow starts with one visit ✨',
                    sendOnceKey: "first_visit",
                    notificationEvent: INOTIFICATION_EVENT.VISIT,
                    saveToDatabase: false
                });
            });

            // Post Visit Reminders (Phase 2) & Dormant (Phase 6)
            const viewRewards = await ViewReward.find().populate({ path: "userId", select: "+fcmToken languages coins" });
            
            viewRewards.forEach(reward => {
                const user = reward.userId as any;
                if (!user?.fcmToken) return;

                const isArabic = user.languages === 'AR';
                const lastVisitAt = new Date(reward.lastVisitAt).getTime();
                const daysSinceVisit = Math.floor((now.getTime() - lastVisitAt) / (1000 * 60 * 60 * 24));

                if (daysSinceVisit === 1) {
                    firebaseNotificationBuilder({ 
                        user, 
                        title: isArabic ? '✨ طلعتي تبرقين أمس' : 'You looked amazing yesterday ✨',
                        body: isArabic ? 'جاهزة للـ glow الجاي؟ 💖' : 'Ready for your next glow?',
                        sendOnceKey: "visit_24h", 
                        notificationEvent: INOTIFICATION_EVENT.VISIT,
                        saveToDatabase: false 
                    });
                } else if (daysSinceVisit === 3) {
                    firebaseNotificationBuilder({ 
                        user, 
                        title: isArabic ? '💖 شوية دلع لنفسك ما يضر' : 'A little self-care never hurts 💖',
                        body: isArabic ? 'خذي لك موعد خفيف ✨' : 'Treat yourself today',
                        sendOnceKey: "reminder_3d", 
                        notificationEvent: INOTIFICATION_EVENT.VISIT,
                        saveToDatabase: false 
                    });
                } else if (daysSinceVisit === 7) {
                    firebaseNotificationBuilder({ 
                        user, 
                        title: isArabic ? '✨ صار لك أسبوع' : 'It’s been a week… time to feel fresh again ✨',
                        body: isArabic ? 'مو وقت لمسة تجددك؟ 💅💖' : 'Book your session',
                        sendOnceKey: "reminder_7d", 
                        notificationEvent: INOTIFICATION_EVENT.VISIT,
                        saveToDatabase: false 
                    });
                } else if (daysSinceVisit === 10) {
                    firebaseNotificationBuilder({ 
                        user, 
                        title: isArabic ? '💔 اشتقنا لك' : 'We miss you 💔',
                        body: isArabic ? 'مو وقت ترجعين تدلعين نفسك؟ 💖' : 'Let’s fix that with a little pampering ✨',
                        sendOnceKey: "dormant_10", 
                        notificationEvent: INOTIFICATION_EVENT.VISIT,
                        saveToDatabase: false 
                    });
                } else if (daysSinceVisit === 14) {
                    firebaseNotificationBuilder({ 
                        user, 
                        title: isArabic ? '💕 شاركي Zena مع صديقتك' : 'Share Zena with your bestie 💕',
                        body: isArabic ? 'وكل وحدة فيكم تربح 💖✨' : 'You both win!',
                        sendOnceKey: "invite_prompt", 
                        notificationEvent: INOTIFICATION_EVENT.INVITE,
                        saveToDatabase: false 
                    });
                } else if (daysSinceVisit === 20) {
                    firebaseNotificationBuilder({ 
                        user, 
                        title: isArabic ? '✨ طولتي علينا' : 'It’s been a while… your glow is waiting ✨',
                        body: isArabic ? 'جمالك ينتظرك 💖' : 'Book now',
                        sendOnceKey: "dormant_20", 
                        notificationEvent: INOTIFICATION_EVENT.VISIT,
                        saveToDatabase: false 
                    });
                }
            });

        } catch (error) {
            console.error("Daily notification cron error:", error);
        }
    });

    // 2️⃣ Thursday Pre-Weekend Reminder (#14) at 10:00 AM
    cron.schedule("0 10 * * 4", async () => {
        try {
            console.log("Thursday pre-weekend cron started");
            const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

            const users = await ViewReward.find({
                lastVisitAt: { $lt: fiveDaysAgo }
            }).populate({ path: "userId", select: "+fcmToken languages" });

            users.forEach(reward => {
                const user = reward.userId as any;
                if (user?.fcmToken) {
                    const isArabic = user.languages === 'AR';
                    firebaseNotificationBuilder({
                        user,
                        title: isArabic ? '💖 الويكند قرب' : 'Weekend is coming 💖',
                        body: isArabic ? 'وش رايك تدلعين نفسك؟ ✨' : 'Ready for your glow?',
                        sendOnceKey: "weekend_prep",
                        notificationEvent: INOTIFICATION_EVENT.VISIT,
                        saveToDatabase: false
                    });
                }
            });
        } catch (error) {
            console.error("Thursday cron error:", error);
        }
    });

    // 3️⃣ Friday Noon (#15, #16) at 12:00 PM
    cron.schedule("0 12 * * 5", async () => {
        try {
            console.log("Friday noon cron started");
            const users = await UserModel.find({ fcmToken: { $exists: true, $ne: "" } }).select("+fcmToken languages coins");
            
            users.forEach(user => {
                const isArabic = (user as any).languages === 'AR';
                if (user.coins && user.coins >= 300) {
                    firebaseNotificationBuilder({
                        user,
                        title: isArabic ? '🎁 ويكند مثالي لمكافأتك' : 'Perfect weekend for your reward 🎁',
                        body: isArabic ? 'زيارة وحدة وتاخذينها 💖✨' : 'One visit and it’s yours!',
                        sendOnceKey: "weekend_reward",
                        notificationEvent: INOTIFICATION_EVENT.VISIT,
                        saveToDatabase: false
                    });
                } else {
                    firebaseNotificationBuilder({
                        user,
                        title: isArabic ? '✨ صالونات قريبة منك' : 'Top salons near you ✨',
                        body: isArabic ? 'اختاري دلعك اليوم 💖' : 'Ready for a glow session?',
                        sendOnceKey: "nearby_salon",
                        notificationEvent: INOTIFICATION_EVENT.VISIT,
                        saveToDatabase: false
                    });
                }
            });
        } catch (error) {
            console.error("Friday cron error:", error);
        }
    });

    // 4️⃣ Saturday Evening Reminder (#17) at 6:00 PM
    cron.schedule("0 18 * * 6", async () => {
        try {
            console.log("Saturday evening cron started");
            const fridayStart = new Date();
            fridayStart.setDate(fridayStart.getDate() - 1);
            fridayStart.setHours(0, 0, 0, 0);

            const usersNoVisitWeekend = await UserModel.aggregate([
                { $match: { role: "USER", fcmToken: { $exists: true, $ne: "" } } },
                {
                    $lookup: {
                        from: "viewrewards",
                        let: { userId: "$_id" },
                        pipeline: [
                            {
                                $match: {
                                    $expr: { $eq: ["$userId", "$$userId"] },
                                    lastVisitAt: { $gte: fridayStart }
                                }
                            }
                        ],
                        as: "weekendVisits"
                    }
                },
                { $match: { "weekendVisits.0": { $exists: false } } },
                { $project: { fcmToken: 1, name: 1, email: 1, languages: 1 } }
            ]);

            usersNoVisitWeekend.forEach(user => {
                const isArabic = user.languages === 'AR';
                firebaseNotificationBuilder({
                    user,
                    title: isArabic ? '✨ آخر فرصة هالويكند' : 'Last chance this weekend ✨',
                    body: isArabic ? 'لا يفوتك الدلع 💖' : 'Don’t miss your glow',
                    sendOnceKey: "weekend_last_call",
                    notificationEvent: INOTIFICATION_EVENT.VISIT,
                    saveToDatabase: false
                });
            });
        } catch (error) {
            console.error("Saturday cron error:", error);
        }
    });

    // 5️⃣ End of Month Push (#20) at 10:00 AM on 25th to 31st
    cron.schedule("0 10 25-31 * *", async () => {
        try {
            console.log("End of month cron started");
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

            const usersWithLowVisits = await UserModel.aggregate([
                { $match: { role: "USER", fcmToken: { $exists: true, $ne: "" } } },
                {
                    $lookup: {
                        from: "viewrewards",
                        let: { userId: "$_id" },
                        pipeline: [
                            {
                                $match: {
                                    $expr: { $eq: ["$userId", "$$userId"] },
                                    lastVisitAt: { $gte: startOfMonth }
                                }
                            }
                        ],
                        as: "monthVisits"
                    }
                },
                {
                    $match: {
                        $expr: { $lt: [{ $size: "$monthVisits" }, 3] }
                    }
                },
                { $project: { fcmToken: 1, name: 1, email: 1, languages: 1 } }
            ]);

            usersWithLowVisits.forEach(user => {
                const isArabic = user.languages === 'AR';
                firebaseNotificationBuilder({
                    user,
                    title: isArabic ? '✨ لا يفوتك glow هذا الشهر' : 'Don’t miss your monthly glow ✨',
                    body: isArabic ? 'زيارة وحدة وتكملين 💖' : 'One more visit?',
                    sendOnceKey: "end_month",
                    notificationEvent: INOTIFICATION_EVENT.VISIT,
                    saveToDatabase: false
                });
            });
        } catch (error) {
            console.error("End of month cron error:", error);
        }
    });
};
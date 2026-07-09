import AppError from "../../../errorHalper.ts/AppError";
import { saveNotification, socketHelper } from "../../../helpers/socketHelper";
import { INOTIFICATION_EVENT, INOTIFICATION_TYPE, IREFERENCE_TYPE } from "../../notification/notification.interface";
import { PointIssuedHistory, ViewReward } from "../../reward/reward.model";
import { Rule, TimeDayRule } from "../../Setting/rule/rule.model";
import { RuleType } from "../../Setting/rule/rule.interface";
import { IStatus, USER_ROLE } from "../../user/user.interface";
import { UserModel } from "../../user/user.model";
import { SalonModel } from "./salon.model";
import { firebaseNotificationBuilder } from "../../../shared/sendNotification";

export const visitSalon = async (
  salonId: string,
  userId: string,
  payload: any = {}
) => {
  console.log("\n================= visitSalon START =================");
  console.log("Salon ID:", salonId);
  console.log("User ID:", userId);
  console.log("Payload:", JSON.stringify(payload, null, 2));

  try {
    console.log("STEP 1: Find salon...");
    const salon = await SalonModel.findById(salonId);
    console.log("Salon:", salon);
    if (!salon) throw new AppError(404, "Salon not found");

    console.log("STEP 2: Find user...");
    const user = await UserModel.findById(userId);
    console.log("User:", user);
    if (!user) throw new AppError(404, "User not found");

    console.log("STEP 3: Find smart rule and time/day rules...");
    const smartRule = await Rule.findOne({ ruleType: RuleType.SMART_RULE });
    
    let everyVisitCoins = 0;
    let timeZoneBonusCoins = 0;
    let totalVisitBonusCoins = 0;

    if (smartRule) {
      if (smartRule.everyVisitIsActive && smartRule.everyVisitCoins) {
        everyVisitCoins = smartRule.everyVisitCoins;
      }

      if (smartRule.timeZoneIsActive && smartRule.timeZoneGetCoin) {
        const currentHour = new Date().getHours();
        const start = smartRule.timeZoneStart || 0;
        const end = smartRule.timeZoneEnd || 0;
        
        let isInTimeZone = false;
        if (start <= end) {
          isInTimeZone = currentHour >= start && currentHour <= end;
        } else {
          isInTimeZone = currentHour >= start || currentHour <= end;
        }

        if (isInTimeZone) {
          timeZoneBonusCoins = smartRule.timeZoneGetCoin;
        }
      }

      if (smartRule.totalVisitIsActive && smartRule.totalVist && smartRule.totalVisitGetCoin) {
        const viewReward = await ViewReward.findOne({ userId, salonId });
        const currentViewCount = viewReward ? viewReward.viewCount : 0;
        
        if ((currentViewCount + 1) % smartRule.totalVist === 0) {
          totalVisitBonusCoins = smartRule.totalVisitGetCoin;
        }
      }
    }

    let multiplier = 1;
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDay = daysOfWeek[new Date().getDay()];
    const currentHour = new Date().getHours();

    const activeTimeDayRule = await TimeDayRule.findOne({
      isActive: true,
      applicableDays: currentDay,
      timeStart: { $lte: currentHour },
      timeEnd: { $gte: currentHour }
    });

    if (activeTimeDayRule) {
      multiplier = activeTimeDayRule.pointsMultiplier || 1;
    }

    const total = Math.round((everyVisitCoins + timeZoneBonusCoins + totalVisitBonusCoins) * multiplier);

    const coinsBreakdown = {
      everyVisitCoins,
      timeZoneBonusCoins,
      totalVisitBonusCoins,
      multiplier,
      total
    };

    console.log("Coins Calculated:", coinsBreakdown);

    console.log("STEP 4: Find or create ViewReward...");
    let reward = await ViewReward.findOne({ salonId, userId });

    const isApproved = payload.status === IStatus.APPROVED;

    if (reward) {
      reward.everyVisitCoins = everyVisitCoins;
      reward.timeZoneBonusCoins = timeZoneBonusCoins;
      reward.totalVisitBonusCoins = totalVisitBonusCoins;
      reward.pendingCoins = (reward.pendingCoins || 0) + total;
      reward.viewCount = (reward.viewCount || 0) + 1;
      reward.lastVisitAt = new Date();
      if (isApproved) {
        reward.status = IStatus.APPROVED;
      } else {
        reward.status = IStatus.PENDING;
      }
      await reward.save();
    } else {
      reward = await ViewReward.create({
        salonId,
        userId,
        everyVisitCoins,
        timeZoneBonusCoins,
        totalVisitBonusCoins,
        totalCoins: 0,
        pendingCoins: total,
        services: payload.services || [],
        totalBill: payload.totalBill || 0,
        status: isApproved ? IStatus.APPROVED : IStatus.PENDING,
        viewCount: 1,
        lastVisitAt: new Date(),
    });
    }

    console.log("Reward Saved:", reward);

    console.log("STEP 5: Create visit history if approved...");
    let visit = null;
    if (isApproved) {
      visit = await PointIssuedHistory.create({
        userId,
        salonId,
        points: total,
        services: payload.services || [],
        totalBill: payload.totalBill || 0,
      });
      console.log("PointIssuedHistory Created:", visit);
    }

    const response = {
      visit,
      reward,
      coinsBreakdown,
    };

    console.log("STEP 6: Response:");
    console.log(JSON.stringify(response, null, 2));

    console.log("================= visitSalon END =================\n");

    return response;
  } catch (error) {
    console.error("================= visitSalon ERROR =================");
    console.error(error);

    if (error instanceof Error) {
      console.error("Message:", error.message);
      console.error("Stack:", error.stack);
    }

    console.error("================= END ERROR =================");

    throw error;
  }
};

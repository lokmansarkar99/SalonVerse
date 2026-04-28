import { StatusCodes } from 'http-status-codes';
import { EPermissionType, IRule, RuleType } from './rule.interface';
import { Rule, TimeDayRule, Tire } from './rule.model';
import AppError from '../../../errorHalper.ts/AppError';
import { UserModel } from '../../user/user.model';
import { USER_ROLE } from '../../user/user.interface';

const globalRule = async (payload: any) => {
     const result = await Rule.findOneAndUpdate({ ruleType: RuleType.GLOBAL_RULE }, { ...payload, ruleType: RuleType.GLOBAL_RULE }, { upsert: true, new: true });
     return result;
}

const smartRule = async (payload: any) => {
     const result = await Rule.findOneAndUpdate({ ruleType: RuleType.SMART_RULE }, { ...payload, ruleType: RuleType.SMART_RULE }, { upsert: true, new: true });
     return result;
}



const getRule = async (ruleType: string) => {
     const result = await Rule.findOne({ ruleType });
     return result;
}

const tireRule = async (payload: any, userId: string) => {
     const user = await UserModel.findById(userId);
     if (!user) {
          throw new AppError(StatusCodes.NOT_FOUND, "User not found",)
     }
     if (user.role !== USER_ROLE.SUPER_ADMIN) {
          throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized to create tire",)
     }
     const checkTire = await Tire.findOne({ tireName: payload.tireName });
     if (checkTire) {
          throw new AppError(StatusCodes.BAD_REQUEST, "Tire already exists",)
     }
     const createTire = await Tire.create({ userId, ...payload });
     return createTire;
}

const getTire = async () => {
     const result = await Tire.find();
     if (result.length === 0) {
          return [];
     }
     return result;
}    

const updateTire = async (payload: any, id: string) => {
     const result = await Tire.findByIdAndUpdate(id, payload, { new: true });
     if (!result) throw new AppError(StatusCodes.NOT_FOUND, "Tire not found");
     return result;
}

// Time & Day Rule CRUD
const createTimeDayRule = async (payload: any) => {
     const result = await TimeDayRule.create(payload);
     return result;
}

const getAllTimeDayRules = async () => {
     const result = await TimeDayRule.find().sort({ createdAt: -1 });
     return result;
}

const toggleTimeDayRule = async (id: string, isActive: boolean) => {
     const result = await TimeDayRule.findByIdAndUpdate(id, { isActive }, { new: true });
     if (!result) throw new AppError(StatusCodes.NOT_FOUND, "Time & Day Rule not found");
     return result;
}

const deleteTimeDayRule = async (id: string) => {
     const result = await TimeDayRule.findByIdAndDelete(id);
     if (!result) throw new AppError(StatusCodes.NOT_FOUND, "Time & Day Rule not found");
     return result;
}

const updateSmartRule = async (id: string, payload: any) => {
     const result = await Rule.findOneAndUpdate({ _id: id }, { ...payload }, { upsert: true, new: true });
     return result;
}

const tireIsActive = async (id: string) => {
     const result = await Tire.findById(id);
     if (!result) throw new AppError(StatusCodes.NOT_FOUND, "Tire not found");
     result.isActive = !result.isActive;
     await result.save();
     return result;
}

export const RuleService = {
     globalRule,
     smartRule,
     getRule,
     tireRule,
     getTire,
     updateTire,
     createTimeDayRule,
     getAllTimeDayRules,
     toggleTimeDayRule,
     deleteTimeDayRule,
     updateSmartRule,
     tireIsActive,
}

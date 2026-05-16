// customer.controller.ts
import { NextFunction, Request, Response } from "express";
import catchAsync from "../../../utils/catchAsync";
import { CustomerService } from "./customer.service";
import { JwtPayload } from "jsonwebtoken";




// user.controller.ts
const createCustomerManually = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const result = await CustomerService.createCustomerManually(req.body, req.user.userId as string);
    res.status(200).json({
        success: true,
        message: "Customer created and visit added successfully",
        data: result,
    });
});

const getAllCustomer = catchAsync(async (req: Request, res: Response, next: NextFunction) => {

    const result = await CustomerService.getAllCustomer(req.query, req.user.userId as string);
    res.status(200).json({
        success: true,
        message: "All Visit Record fetched successfully",
        meta: result.meta,
        dashBoardData: result.dashboardData,
        data: result.data,

    })
})

const singleUser = catchAsync(async (req: Request, res: Response, next: NextFunction) => {

    const result = await CustomerService.getSingleUser(req.params.id as string, req.user as JwtPayload);
    res.status(200).json({
        success: true,
        message: "Single user fetched successfully",
        data: result,

    })
})

const approvedReward = catchAsync(async (req: Request, res: Response, next: NextFunction) => {

    const result = await CustomerService.approvedReward(req.params.id as string, req.user as JwtPayload);
    res.status(200).json({
        success: true,
        message: "Reward approved successfully",
        data: result,

    })
})

export const CustomerController = {
    createCustomerManually,
    getAllCustomer,
    singleUser,
    approvedReward
}
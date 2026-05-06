// visit.controller.ts
import { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";
import catchAsync from "../../../utils/catchAsync";
import { VisitService } from "./visit.service";




// user.controller.ts
const getAllVisitRecord = catchAsync(async (req: Request, res: Response, next: NextFunction) => {

    const result = await VisitService.getAllVisitRecord({ ...req.query, reqUserId: req.user.userId });
    res.status(200).json({
        success: true,
        message: "All Visit Record fetched successfully",
        data: result
    })
})



// VISIT confirm By Owner
const confirmVisit = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const result = await VisitService.approveVisitCoin(req.params.id as string, req.user.userId as string);
    res.status(200).json({
        success: true,
        message: "Visit confirmed successfully",
        data: result
    })
})

export const VisitController = {
    getAllVisitRecord,
    confirmVisit
}
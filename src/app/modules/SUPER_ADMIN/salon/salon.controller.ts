// salon.controller.ts
import { Request, Response, NextFunction } from "express";
import { salonService } from "./salon.service";
import catchAsync from "../../../utils/catchAsync";
import AppError from "../../../errorHalper.ts/AppError";
import httpStatus from "http-status-codes";

const createSalon = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user.userId;
    const result = await salonService.createSalon(req.body, user);

    res.status(200).json({
        success: true,
        message: "Salon created successfully",
        data: result,
    });
});

const getAllSalon = catchAsync(async (req: Request, res: Response) => {
    const query = req.query;
    const result = await salonService.getAllSalon(query);

    res.status(200).json({
        success: true,
        meta: result.meta,
        data: result.allData,

    });
});

const getSingleSalon = catchAsync(async (req: Request, res: Response) => {
    const user = req.user.userId;
    const { lat1, lon1 } = req.query;
    const result = await salonService.getSingleSalon(req.params.id as string, user, lat1 as string, lon1 as string);

    res.status(200).json({
        success: true,
        data: result,
    });
});
const getSalonSetting = catchAsync(async (req: Request, res: Response) => {
    const user = req.user.userId;
    const result = await salonService.getSalonSetting(user);

    res.status(200).json({
        success: true,
        data: result,
    });
});

const updateSalon = catchAsync(async (req: Request, res: Response) => {
    if (req.files && "image" in req.files && req.files.image) {
        req.body.image = `/image/${req.files.image[0].filename}`;
    }
    const user = req.user.userId;

    const result = await salonService.updateSalon(req.body, user);

    res.status(200).json({
        success: true,
        message: "Salon updated successfully",
        data: result,
    });
});

const deleteSalon = catchAsync(async (req: Request, res: Response) => {
    const user = req.user.userId;
    await salonService.deleteSalon(req.params.id as string, user);

    res.status(200).json({
        success: true,
        message: "Salon deleted successfully",
    });
});


const visitConfirm = catchAsync(async (req: Request, res: Response) => {
    const user = req.user.userId;
    const { lat1, lon1 } = req.query;
    if (!lat1 || !lon1) {
        throw new AppError(httpStatus.BAD_REQUEST, "Latitude and longitude are required");
    }
    const result = await salonService.visitConfirm(req.params.id as string, user, lat1 as string, lon1 as string);

    res.status(200).json({
        success: true,
        message: result.message
    });
});


const salonMenagement = catchAsync(async (req: Request, res: Response) => {
    const user = req.user.userId;
    const result = await salonService.salonMenagement(user);

    res.status(200).json({
        success: true,
        data: result,
    });
});

const createRating = catchAsync(async (req: Request, res: Response) => {
    const user = req.user.userId;
    const { rating, comment } = req.body;
    const result = await salonService.updateSalonRating(req.params.id as string, user, rating, comment);

    res.status(200).json({
        success: true,
        message: "Salon rating updated successfully",
        data: result,
    });
});
export const salonController = {
    createSalon,
    getAllSalon,
    getSingleSalon,
    updateSalon,
    deleteSalon,
    visitConfirm,
    getSalonSetting,
    salonMenagement,
    createRating
};

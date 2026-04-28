import AppError from "../../errorHalper.ts/AppError";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { NotificationModel } from "./notification.model";
import httpStatus from "http-status-codes";

// notification.service.ts
const sendNotification = async (query: any) => {

}

const getAllNotification = async (query: any, userId: string) => {

    const queryBuilder = new QueryBuilder(NotificationModel.find({ receiverId: userId, isDeleted: false }), query)
        .sort()
        .paginate()
        .fields()

    const [data, meta] = await Promise.all([
        queryBuilder.build(), queryBuilder.getMeta()
    ]);

    return { data, meta }
}

const getSingleNotification = async (id: string) => {
    const notification = await NotificationModel.findById(id)
    if (!notification) {
        throw new AppError(httpStatus.NOT_FOUND, "Notification not found")
    }

    notification.read = true;
    await notification.save();
    return notification
}

const deleteNotification = async (id: string) => {
    const notification = await NotificationModel.findById(id)
    if (!notification) {
        throw new AppError(httpStatus.NOT_FOUND, "Notification not found")
    }
    notification.isDeleted = true;
    await notification.save();
    return notification
}


const getNotificationCount = async (userId: string) => {
    const notification = await NotificationModel.countDocuments({ receiverId: userId, isDeleted: false, read: false })
    if (!notification) {
        return 0;
    }
    return notification;
}

export const NotificationService = {
    sendNotification,
    getAllNotification,
    getSingleNotification,
    deleteNotification,
    getNotificationCount
}
import { firebaseAdmin } from "../middleware/firebaseAdmin";
import { NotificationModel } from "../modules/notification/notification.model";
import { NotificationLogModel } from "../modules/notification/notificationLog.model";

// Event list for DB saving
const EVENTS_TO_SAVE = ['LOGIN', 'LOGOUT', 'MESSAGE', 'LIKE', 'COMMENT', 'FOLLOW', 'EVENT_REMINDER'];

// Notification payload interface
interface NotificationPayload {
    user: any;
    title: string;
    body: string;
    receiverId?: string;
    notificationEvent?: string;
    notificationType?: string;
    referenceId?: string;
    referenceType?: string;
    image?: string;
    saveToDatabase?: boolean;
    sendOnceKey?: string;
}

// Main reusable notification function
export const firebaseNotificationBuilder = async ({
    user,
    title,
    body,
    receiverId,
    notificationEvent,
    notificationType,
    referenceId,
    referenceType,
    image = "",
    saveToDatabase = true,
    sendOnceKey
}: NotificationPayload) => {

    if (sendOnceKey && user?._id) {
        const alreadySent = await NotificationLogModel.findOne({ userId: user._id, type: sendOnceKey });
        if (alreadySent) {
            console.log(`Notification ${sendOnceKey} already sent to user ${user._id}. Skipping.`);
            return;
        }
    }

    if (!title || !body) return; // Prevent empty notifications

    const promises: Promise<any>[] = [];

    // ✅ 1️⃣ Send Firebase Notification (FIXED)
    if (user?.fcmToken) {
        const sound = user.isSoundNotificationEnabled ? "default" : undefined;

        promises.push(
            firebaseAdmin.messaging().send({
                token: user.fcmToken,

                // 🔥 IMPORTANT: notification payload added
                notification: {
                    title,
                    body
                },

                data: {
                    title: title || '',
                    body: body || '',
                    notificationEvent: notificationEvent || '',
                    notificationType: notificationType || '',
                    referenceId: referenceId || '',
                    referenceType: referenceType || '',
                    image: image || '',
                },

                android: {
                    priority: "high",
                    notification: {
                        sound: sound || undefined
                    }
                },

                apns: {
                    headers: {
                        "apns-push-type": "alert",
                        "apns-priority": "10"
                    },
                    payload: {
                        aps: {
                            alert: { title, body },
                            ...(sound && { sound })
                        }
                    }
                }
            })
        );
    }

    // ✅ 2️⃣ Save to DB (Improved Logic)
    const shouldSave =
        saveToDatabase &&
        notificationEvent &&
        EVENTS_TO_SAVE.includes(notificationEvent);

    if (shouldSave) {
        promises.push(
            NotificationModel.create({
                senderId: user?._id || null, // safer
                receiverId: receiverId || null, // avoid wrong fallback
                title,
                body,
                referenceType,
                referenceId,
                notificationType,
                notificationEvent,
                read: false
            })
        );
    }

    if (sendOnceKey && user?._id) {
        promises.push(
            NotificationLogModel.create({
                userId: user._id,
                type: sendOnceKey
            })
        );
    }

    // ✅ 3️⃣ Handle Results (Improved)
    const results = await Promise.allSettled(promises);

    results.forEach((result, index) => {
        if (result.status === "rejected") {
            console.error(`Notification task ${index} failed:`, result.reason);
        }
    });
};
import { Types } from "mongoose";

// user.interface.ts
export enum USER_ROLE {
    OWNER = 'ADMIN',
    USER = 'USER',
    SUPER_ADMIN = 'SUPER_ADMIN',
}

export enum LANGUAGES {
    EN = 'EN',
    AR= 'AR'
}

export enum IStatus {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
    COMPLETED = 'COMPLETED',
    ACTIVE = 'ACTIVE',
    INACTIVE = 'INACTIVE',
    EXPIRED = 'EXPIRED',
    BLOCKED = 'BLOCKED',
    SUSPENDED = 'SUSPENDED',
    DELETED = 'DELETED',
}

// authProviders
export interface IAuthProvider {
    provider: "google" | "credentials",
    providerId: string
}

export interface IUser {
    _id: Types.ObjectId;
    name: string;
    email: string;
    password: string;
    role: USER_ROLE;
    image?: string;
    phoneNumber: string;
    status?: IStatus;
    verified?: boolean;
    auths: IAuthProvider[];
    personalInfo?: {
        address: string;
        city: string;
        country: string;
        zipCode?: string;
    };
languages: LANGUAGES;
    coins?: number;
    pendingCoins?: number;
    spentCoins?: number;
    referralCode?: string;
    invitedBy?: string;
    successfulInvites?: number;

    secretRefreshToken?: [string]
    dateOfBirth?: Date;
    notification: boolean;
    isVibrationNotificationEnabled?: boolean;
    isSoundNotificationEnabled?: boolean;
    fcmToken?: string; //for firebase cloud messaging

    // Payment ----------💸💸💸
    stripeAccountInfo?: {
        stripeAccountId: string;
    };
    stripeConnectedAccount?: string;
    isCompleted?: boolean;
    lastActiveAt?: Date;
    isOnline?: boolean;
    userLat?: string;
    userLon?: string;
}
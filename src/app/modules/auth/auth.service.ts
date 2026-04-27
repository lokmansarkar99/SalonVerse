import AppError from '../../errorHalper.ts/AppError';
import { firebaseAdmin } from '../../middleware/firebaseAdmin';
import { UserModel } from '../user/user.model';
import { IAuthProvider, IStatus, IUser, USER_ROLE } from '../user/user.interface';
import { CreateUserToken, createNewAccessTokenWinthRefreshToken } from '../../utils/userToken';
import { JwtPayload } from 'jsonwebtoken';
import { verifyToken } from '../../utils/jwt';
import { envVar } from '../../config/env';
import { redisClient } from '../../config/redis.config';
import generateNumber, { generateHashCode } from '../../utils/generate';
import { sendEmail } from '../../utils/sendEmail';
import { INOTIFICATION_EVENT } from '../notification/notification.interface';
import { firebaseNotificationBuilder } from '../../shared/sendNotification';
import httpStatus from 'http-status-codes';
import bcrypt from 'bcrypt';
import twilio from 'twilio';

const twilioClient = twilio(envVar.TWILIO_ACCOUNT_SID, envVar.TWILIO_AUTH_TOKEN);

const googleLogin = async (idToken: string) => {
  try {
    const decodedToken = await firebaseAdmin.auth().verifyIdToken(idToken);
    const { uid, email, name, picture } = decodedToken;

    if (!email) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Email not found in token');
    }

    let user = await UserModel.findOne({ email }).select('+auths +fcmToken');
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      const googleAuthProvider: IAuthProvider = {
        provider: 'google',
        providerId: uid,
      };
      user = await UserModel.create({
        name: name || email.split('@')[0],
        email,
        image: picture,
        role: USER_ROLE.USER,
        status: IStatus.ACTIVE,
        verified: true,
        auths: [googleAuthProvider],
      });
    } else {
      const hasGoogleAuth = user.auths.some(
        (auth) => auth.provider === 'google' && auth.providerId === uid,
      );
      if (!hasGoogleAuth) {
        user.auths.push({ provider: 'google', providerId: uid });
        await user.save();
      }
    }

    const tokens = await CreateUserToken(user);

    if (isNewUser && user && (user as any).fcmToken) {
      firebaseNotificationBuilder({
        user,
        title: 'Welcome to Zena',
        body: 'Your glow journey starts here',
        notificationEvent: INOTIFICATION_EVENT.LOGIN,
      });
    }

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        image: user.image,
      },
      isNewUser,
    };
  } catch (error: any) {
    if (error.code === 'auth/id-token-expired') {
      throw new AppError(httpStatus.UNAUTHORIZED, 'Token expired');
    }
    if (error.code === 'auth/argument-error') {
      throw new AppError(httpStatus.BAD_REQUEST, 'Invalid token');
    }
    if (error instanceof AppError) throw error;
    throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'Google authentication failed');
  }
};

const loginCredential = async (data: { phoneNumber: string; otp: string }) => {
  try {
    const verificationCheck = await twilioClient.verify.v2
      .services(envVar.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({
        to: data.phoneNumber,
        code: data.otp,
      });

    if (verificationCheck.status !== 'approved') {
      throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid or expired OTP');
    }
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    if (err.code === 20404) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        'OTP expired or already used. Please request a new code.',
      );
    }
    throw new AppError(httpStatus.UNAUTHORIZED, 'OTP verification failed');
  }

  const result = await UserModel.findOne({ phoneNumber: data.phoneNumber });
  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }
  if (result.status !== IStatus.ACTIVE) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'User is not active');
  }

  if (!result.verified) {
    result.verified = true;
    await result.save();
  }

  const token = await CreateUserToken(result);
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    userId: result._id,
  };
};

const loginSuperAdmin = async (data: IUser) => {
  const result = await UserModel.findOne({
    email: data.email,
    role: { $in: [USER_ROLE.SUPER_ADMIN, USER_ROLE.OWNER] },
  }).select('name email role image verified password');

  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }
  if (!result.verified) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'User not verified');
  }

  const isPasswordMatched = await bcrypt.compare(data.password, result.password);
  if (!isPasswordMatched) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Password not matched');
  }

  const token = await CreateUserToken(result);
  return {
    user: {
      _id: result._id,
      name: result.name,
      email: result.email,
      role: result.role,
      image: result.image,
    },
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
  };
};

const refreshToken = async (data: { refreshToken: string }) => {
  const { refreshToken } = data;
  const accessToken = await createNewAccessTokenWinthRefreshToken(refreshToken);
  return { accessToken };
};

const logout = async (data: { refreshToken: string }) => {
  const { refreshToken } = data;
  const decoded = verifyToken(refreshToken, envVar.JWT_REFRESH_SECRET) as JwtPayload;

  const user = await UserModel.findOne({ email: decoded.email }).select('secretRefreshToken');
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  const signature = refreshToken.split('.')[2];
  await UserModel.updateOne(
    { _id: user._id },
    { $pull: { secretRefreshToken: signature } },
  );

  return { message: 'Logout successful' };
};

const sendOtp = async (email: string) => {
  const user = await UserModel.findOne({ email });
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  const otp = generateNumber();
  const hashCode = generateHashCode(user);
  const redisKey = `email:${email}:${hashCode}`;

  await redisClient.set(redisKey, otp.toString(), { EX: 60 * 2 });

  await sendEmail({
    to: email,
    subject: 'OTP Verification',
    templateName: 'otp',
    templateData: { name: user.name, otp },
  });

  return { otp, hashCode };
};

const userVerify = async (data: { email: string; otp: number; hash: string }) => {
  const { email, otp, hash } = data;
  const redisKey = `email:${email}:${hash}`;
  const storedOTP = await redisClient.get(redisKey);

  if (!storedOTP) {
    throw new AppError(httpStatus.BAD_REQUEST, 'OTP expired or invalid');
  }
  if (storedOTP !== String(otp)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Wrong OTP');
  }

  await redisClient.del(redisKey);

  const user = await UserModel.findOne({ email });
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }
  if (user.verified) {
    throw new AppError(httpStatus.BAD_REQUEST, 'User already verified');
  }

  user.verified = true;
  await user.save();

  return { message: 'OTP verified successfully' };
};

const forgetPassword = async (data: {
  email: string;
  otp: number;
  hash: string;
  password: string;
}) => {
  const { email, otp, hash, password } = data;
  const redisKey = `email:${email}:${hash}`;
  const storedOTP = await redisClient.get(redisKey);

  if (!storedOTP) {
    throw new AppError(httpStatus.BAD_REQUEST, 'OTP expired or invalid');
  }
  if (storedOTP !== String(otp)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Wrong OTP');
  }

  await redisClient.del(redisKey);

  const user = await UserModel.findOne({ email });
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const result = await UserModel.updateOne({ email }, { $set: { password: hashedPassword } });

  if (result.modifiedCount === 0) {
    throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'Password was not updated');
  }

  await sendEmail({
    to: email,
    subject: 'Password Reset Successful',
    templateName: 'forget',
    templateData: { name: user.name },
  });

  return { message: 'Password reset successfully' };
};

const changePassword = async (data: {
  oldPassword: string;
  newPassword: string;
  user: JwtPayload;
}) => {
  const { oldPassword, newPassword, user } = data;

  const userInfo = await UserModel.findOne({ email: user.email }).select('+password');
  if (!userInfo) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  const isPasswordMatched = await bcrypt.compare(oldPassword, userInfo.password);
  if (!isPasswordMatched) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Password not matched');
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  const result = await UserModel.updateOne(
    { email: user.email },
    { $set: { password: hashedPassword } },
  );

  if (result.modifiedCount === 0) {
    throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'Password was not updated');
  }

  return { message: 'Password changed successfully' };
};


const sendPhoneOtp = async (phoneNumber: string) => {
  await twilioClient.verify.v2
    .services(envVar.TWILIO_VERIFY_SERVICE_SID)
    .verifications.create({ to: phoneNumber, channel: 'sms' });
  return { message: 'OTP sent' };
};


export const authService = {
  loginCredential,
  loginSuperAdmin,
  refreshToken,
  logout,
  sendOtp,
  userVerify,
  forgetPassword,
  changePassword,
  googleLogin,
  sendPhoneOtp
};
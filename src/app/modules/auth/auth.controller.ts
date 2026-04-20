// auth.controller.ts
import { NextFunction, Request, Response } from "express"
import catchAsync from "../../utils/catchAsync"
import { authService } from "./auth.service"
import { setAuthCookie } from "../../utils/setCookie"
import { JwtPayload } from "jsonwebtoken"
import httpStatus from "http-status-codes"
import AppError from "../../errorHalper.ts/AppError"


// user.controller.ts
const loginCredential = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const result = await authService.loginCredential(req.body)

    setAuthCookie(res, { refreshToken: result.refreshToken })    //IF USE set cookie
    res.status(200).json({
        success: true,
        message: "User Login successfully",
        data: result
    })
})
const loginSuperAdmin = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const result = await authService.loginSuperAdmin(req.body)

    setAuthCookie(res, { refreshToken: result.refreshToken })    //IF USE set cookie
    res.status(200).json({
        success: true,
        message: "User Login successfully",
        data: { ...result }
    })
})
// 🔥🔥🔥🔥 Google Login
const googleLogin = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const { idToken } = req.body;

    if (!idToken) {
        throw new AppError(httpStatus.BAD_REQUEST, "ID Token is required");
    }

    const result = await authService.googleLogin(idToken);

    setAuthCookie(res, { refreshToken: result.refreshToken });

    res.status(200).json({
        success: true,
        message: result.isNewUser ? "Account created successfully" : "Login successful",
        data: {
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            user: result.user
        }
    });
});

const refreshToken = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const result = await authService.refreshToken(req.body)
    res.status(200).json({
        success: true,
        message: "User Login successfully",
        accessToken: result.accessToken
    })
})

const logout = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const result = await authService.logout(req.body)
    // res.clearCookie("refreshToken", {
    //     httpOnly: true,
    //     secure: false,
    //     sameSite: "lax"
    // });
    res.status(200).json({
        success: true,
        message: "User Logout successfully",
        data: result
    })
})

const sendOtp = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const { email } = req.body
    const result = await authService.sendOtp(email)
    res.status(200).json({
        success: true,
        message: "OTP send successfully",
        data: result
    })
})

const userVerify = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const result = await authService.userVerify(req.body)
    res.status(200).json({
        success: true,
        message: "User Verify successfully",
        data: result
    })
})

const forgetPassword = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const { email, hash, otp, password } = req.body
    await authService.forgetPassword({ email, hash, otp, password })
    res.status(200).json({
        success: true,
        message: "Password Reset successfully",
        data: null
    })
})

const changePassword = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const { oldPassword, newPassword } = req.body
    const user = req.user as JwtPayload
    const result = await authService.changePassword({ oldPassword, newPassword, user })
    res.status(200).json({
        success: true,
        message: result.message,
    })
})


const sendPhoneOtp = catchAsync(async (req: Request, res: Response, next: NextFunction) => { 
    const { phoneNumber } = req.body
    const result = await authService.sendPhoneOtp(phoneNumber)
    res.status(200).json({
        success: true,
        message: "OTP sent successfully",
        data: result
    })

})

export const authController = {
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
}
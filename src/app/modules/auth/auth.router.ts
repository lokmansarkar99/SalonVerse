import { Router } from "express";
import { authController } from "./auth.controller";
import { checkAuth } from "../../middleware/checkAuth";
import { USER_ROLE } from "../user/user.interface";

// auth.router.ts
const router = Router()


router.post("/login", authController.loginCredential)
router.post("/login-admin", authController.loginSuperAdmin)
// 🔥 NEW: Google Authentication Route
router.post("/google-login", authController.googleLogin);
router.post("/refresh-token", authController.refreshToken)
router.post("/logout", authController.logout)
// ------------- OTP Send & Verify -------------
router.post("/send-otp", authController.sendOtp)
router.post("/verify-user", authController.userVerify)
router.post("/forget-password", authController.forgetPassword)

// ----------- 
router.post("/change-password", checkAuth(USER_ROLE.SUPER_ADMIN, USER_ROLE.USER, USER_ROLE.OWNER), authController.changePassword)

router.post("/send-phone-otp", authController.sendPhoneOtp)

export const authRouter = router
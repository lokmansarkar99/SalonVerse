// salon.router.ts
import express from "express";
import { salonController } from "./salon.controller";
import catchAsync from "../../../utils/catchAsync";
import { USER_ROLE } from "../../user/user.interface";
import { checkAuth } from "../../../middleware/checkAuth";
import fileUploadHandler from "../../../middleware/fileUploadHandlare";
import { parseFormDataMiddleware } from "../../../middleware/parseFromData";


const router = express.Router();

router.post("/", checkAuth(USER_ROLE.SUPER_ADMIN), catchAsync(salonController.createSalon));
router.patch("/setting", checkAuth(USER_ROLE.OWNER),
    fileUploadHandler(),
    parseFormDataMiddleware,
    catchAsync(salonController.updateSalon));
router.get("/setting", checkAuth(USER_ROLE.OWNER), catchAsync(salonController.getSalonSetting));

router.get("/", checkAuth(USER_ROLE.SUPER_ADMIN, USER_ROLE.OWNER, USER_ROLE.USER), catchAsync(salonController.getAllSalon));
router.get("/salon-menagement", checkAuth(USER_ROLE.SUPER_ADMIN), catchAsync(salonController.salonMenagement));

router.get("/:id", checkAuth(USER_ROLE.SUPER_ADMIN, USER_ROLE.USER, USER_ROLE.OWNER), catchAsync(salonController.getSingleSalon));
router.post("/rating/:id", checkAuth(USER_ROLE.USER), catchAsync(salonController.createRating));


router.delete("/:id", checkAuth(USER_ROLE.SUPER_ADMIN), catchAsync(salonController.deleteSalon));
router.post("/visit-confirm/:id", checkAuth(USER_ROLE.USER), catchAsync(salonController.visitConfirm))

export const SalonRoutes = router;

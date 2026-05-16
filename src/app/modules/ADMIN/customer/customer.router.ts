import { Router } from "express";
import { checkAuth } from "../../../middleware/checkAuth";
import { USER_ROLE } from "../../user/user.interface";
import { CustomerController } from "./customer.controller";

// customer.router.ts
const router = Router();

router.route("/")
    .get(checkAuth(USER_ROLE.SUPER_ADMIN, USER_ROLE.OWNER), CustomerController.getAllCustomer)

router.route("/create")
    .post(checkAuth(USER_ROLE.OWNER, USER_ROLE.SUPER_ADMIN), CustomerController.createCustomerManually)



router.route("/:id")
    .get(checkAuth(USER_ROLE.OWNER, USER_ROLE.SUPER_ADMIN, USER_ROLE.USER), CustomerController.singleUser)

router.route("/approved-reward/:id")
    .patch(checkAuth(USER_ROLE.OWNER, USER_ROLE.SUPER_ADMIN), CustomerController.approvedReward)



export const CustomerRoutes = router;
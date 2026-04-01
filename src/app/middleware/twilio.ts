import twilio from "twilio";
import { envVar } from "../config/env";

// Single Twilio client instance
const client = twilio(
    envVar.TWILIO_ACCOUNT_SID,
    envVar.TWILIO_AUTH_TOKEN
);

const SERVICE_SID = envVar.TWILIO_VERIFY_SERVICE_SID;

export const sendOTP = async (phoneNumber: string) => {
    try {
        // Ensure E.164 format
        const formattedPhone = phoneNumber.startsWith("+") ? phoneNumber : `+${phoneNumber}`;

        const verification = await client.verify.v2
            .services(SERVICE_SID)
            .verifications.create({
                to: formattedPhone,
                channel: "sms",
            });

        console.log(`[Twilio] OTP sent successfully. Status: ${verification.status}`);
        return verification;
    } catch (error: any) {
        console.error(`[Twilio] Failed to send OTP:`, error?.message || error);
        throw error;
    }
};

export const verifyOTP = async (phoneNumber: string, code: string) => {
    try {
        // Ensure E.164 format
        const formattedPhone = phoneNumber.startsWith("+") ? phoneNumber : `+${phoneNumber}`;
        const result = await client.verify.v2
            .services(SERVICE_SID)
            .verificationChecks.create({
                to: formattedPhone,
                code,
            });

        console.log(`[Twilio] Verification result: ${result.status}`);

        if (result.status !== "approved") {
            throw new Error("Invalid or expired OTP");
        }

        return true;
    } catch (error: any) {
        console.error(`[Twilio] OTP verification failed:`, error?.message || error);
        throw error;
    }
};

// Export the client for reuse
export { client as twilioClient };
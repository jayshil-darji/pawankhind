import { z } from "zod";

const mobile = (message: string) => z.string({ error: message }).regex(/^[6-9][0-9]{9}$/, message);

const isoDate = z
  .string({ error: "Select your date of birth" })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Select your date of birth")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Enter a valid date of birth")
  .refine(
    (s) => s >= "1900-01-01" && s <= new Date().toISOString().slice(0, 10),
    "Enter a valid date of birth",
  );

export const participantSchema = z.object({
  fullName: z
    .string({ error: "Enter your full name" })
    .trim()
    .min(2, "Enter your full name")
    .max(100, "Name must be 100 characters or fewer"),
  dateOfBirth: isoDate,
  gender: z.enum(["male", "female", "other"], { error: "Select your gender" }),
  mobile: mobile("Enter a valid 10-digit mobile number"),
  tshirtSize: z.enum(["XS", "S", "M", "L", "XL", "XXL"], { error: "Select your T-shirt size" }),
  city: z
    .string({ error: "Enter your city" })
    .trim()
    .min(1, "Enter your city")
    .max(100, "City must be 100 characters or fewer"),
  emergencyContactName: z
    .string({ error: "Enter your emergency contact's name" })
    .trim()
    .min(1, "Enter your emergency contact's name")
    .max(100, "Name must be 100 characters or fewer"),
  emergencyContactMobile: mobile("Enter a valid 10-digit mobile number for your emergency contact"),
});

/** What the registration form sends: the participant plus the two declarations. */
export const registrationRequestSchema = participantSchema.extend({
  healthDeclaration: z.literal(true, {
    error: "Please confirm the health declaration to continue",
  }),
  termsAccepted: z.literal(true, {
    error: "Please accept the Terms, Privacy and Refund policies to continue",
  }),
});

export const verifyPaymentSchema = z.object({
  registrationId: z.string().uuid(),
  razorpayPaymentId: z.string().min(1).max(100),
  razorpaySignature: z.string().min(1).max(200),
});

export const registrationIdSchema = z.string().uuid();

import { z } from "zod";

const mobile = z.string().regex(/^[6-9][0-9]{9}$/, "enter a 10-digit Indian mobile number");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "not a real date")
  .refine(
    (s) => s >= "1900-01-01" && s <= new Date().toISOString().slice(0, 10),
    "date of birth out of range",
  );

export const participantSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  dateOfBirth: isoDate,
  gender: z.enum(["male", "female", "other"]),
  mobile,
  tshirtSize: z.enum(["XS", "S", "M", "L", "XL", "XXL"]),
  city: z.string().trim().min(1).max(100),
  emergencyContactName: z.string().trim().min(1).max(100),
  emergencyContactMobile: mobile,
});

export const verifyPaymentSchema = z.object({
  registrationId: z.string().uuid(),
  razorpayPaymentId: z.string().min(1).max(100),
  razorpaySignature: z.string().min(1).max(200),
});

export const registrationIdSchema = z.string().uuid();

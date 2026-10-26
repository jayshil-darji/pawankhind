import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { participantSchema } from "@pawankhind/schemas";
import type { FieldIssue, ParticipantInput } from "./api.js";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:border-slate-900 focus:outline-none";

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {error && (
        <span role="alert" className="mt-1 block text-sm text-red-600">
          {error}
        </span>
      )}
    </label>
  );
}

interface Props {
  /** Returns field issues from the server, if it rejected the input. */
  onSubmit: (values: ParticipantInput) => Promise<FieldIssue[] | undefined>;
}

export function RegistrationForm({ onSubmit }: Props) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ParticipantInput>({ resolver: zodResolver(participantSchema) });

  const submit = handleSubmit(async (values) => {
    const issues = await onSubmit(values);
    for (const issue of issues ?? []) {
      setError(issue.field as keyof ParticipantInput, { message: issue.message });
    }
  });

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
      <Field label="Full name" error={errors.fullName?.message}>
        <input className={inputClass} autoComplete="name" {...register("fullName")} />
      </Field>

      <Field label="Date of birth" error={errors.dateOfBirth?.message}>
        <input type="date" className={inputClass} {...register("dateOfBirth")} />
      </Field>

      <Field label="Gender" error={errors.gender?.message}>
        <select className={inputClass} defaultValue="" {...register("gender")}>
          <option value="" disabled>
            Select
          </option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </select>
      </Field>

      <Field label="Mobile number" error={errors.mobile?.message}>
        <input
          className={inputClass}
          inputMode="numeric"
          maxLength={10}
          autoComplete="tel-national"
          {...register("mobile")}
        />
      </Field>

      <Field label="T-shirt size" error={errors.tshirtSize?.message}>
        <select className={inputClass} defaultValue="" {...register("tshirtSize")}>
          <option value="" disabled>
            Select
          </option>
          {["XS", "S", "M", "L", "XL", "XXL"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>

      <Field label="City" error={errors.city?.message}>
        <input className={inputClass} autoComplete="address-level2" {...register("city")} />
      </Field>

      <Field label="Emergency contact name" error={errors.emergencyContactName?.message}>
        <input className={inputClass} {...register("emergencyContactName")} />
      </Field>

      <Field label="Emergency contact mobile" error={errors.emergencyContactMobile?.message}>
        <input
          className={inputClass}
          inputMode="numeric"
          maxLength={10}
          {...register("emergencyContactMobile")}
        />
      </Field>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-lg bg-slate-900 px-4 py-3 font-medium text-white disabled:opacity-50"
      >
        {isSubmitting ? "Please wait…" : "Register and pay ₹200"}
      </button>
    </form>
  );
}

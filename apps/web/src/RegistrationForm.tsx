import type { ReactNode } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { registrationRequestSchema } from "@pawankhind/schemas";
import type { FieldIssue, ParticipantInput } from "./api.js";
import { EVENT } from "./event.js";

const base =
  "w-full rounded-lg border bg-white px-3 py-2 text-base text-stone-900 focus:outline-none focus:ring-2";

/** Shared look for every input and select, with a red state when the field has an error. */
function control(error?: unknown) {
  return {
    className: `${base} ${
      error
        ? "border-red-500 focus:ring-red-300"
        : "border-stone-300 focus:border-orange-600 focus:ring-orange-200"
    }`,
    "aria-invalid": error ? true : undefined,
  };
}

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}

function Field({ label, error, hint, wide, children }: FieldProps) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-stone-800">{label}</span>
        {children}
      </label>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1 text-xs text-stone-500">{hint}</p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-3 w-full border-b border-orange-600/40 pb-1 font-display text-xl tracking-widest text-stone-900">
        {title}
      </legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Checkbox({
  input,
  error,
  children,
}: {
  input: UseFormRegisterReturn;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="flex items-start gap-3 text-sm text-stone-800">
        <input
          type="checkbox"
          aria-invalid={error ? true : undefined}
          className="mt-0.5 h-5 w-5 shrink-0 rounded border-stone-400 accent-orange-600"
          {...input}
        />
        <span>{children}</span>
      </label>
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
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
  } = useForm<ParticipantInput>({ resolver: zodResolver(registrationRequestSchema) });

  const submit = handleSubmit(async (values) => {
    const issues = await onSubmit(values);
    for (const issue of issues ?? []) {
      setError(issue.field as keyof ParticipantInput, { message: issue.message });
    }
  });

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-8">
      <Section title="ABOUT YOU">
        <Field
          label="Full name"
          wide
          error={errors.fullName?.message}
          hint="As on your photo ID. You will need it at kit collection."
        >
          <input autoComplete="name" {...control(errors.fullName)} {...register("fullName")} />
        </Field>

        <Field label="Date of birth" error={errors.dateOfBirth?.message}>
          <input type="date" {...control(errors.dateOfBirth)} {...register("dateOfBirth")} />
        </Field>

        <Field label="Gender" error={errors.gender?.message}>
          <select defaultValue="" {...control(errors.gender)} {...register("gender")}>
            <option value="" disabled>
              Select
            </option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </Field>
      </Section>

      <Section title="CONTACT AND KIT">
        <Field
          label="Mobile number"
          error={errors.mobile?.message}
          hint="10 digits. We use it to contact you about the event."
        >
          <input
            inputMode="numeric"
            maxLength={10}
            autoComplete="tel-national"
            {...control(errors.mobile)}
            {...register("mobile")}
          />
        </Field>

        <Field label="T-shirt size" error={errors.tshirtSize?.message}>
          <select defaultValue="" {...control(errors.tshirtSize)} {...register("tshirtSize")}>
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

        <Field label="City" wide error={errors.city?.message}>
          <input autoComplete="address-level2" {...control(errors.city)} {...register("city")} />
        </Field>
      </Section>

      <Section title="EMERGENCY CONTACT">
        <Field label="Emergency contact name" error={errors.emergencyContactName?.message}>
          <input {...control(errors.emergencyContactName)} {...register("emergencyContactName")} />
        </Field>

        <Field
          label="Emergency contact mobile"
          error={errors.emergencyContactMobile?.message}
          hint="Someone we can call if you need help."
        >
          <input
            inputMode="numeric"
            maxLength={10}
            {...control(errors.emergencyContactMobile)}
            {...register("emergencyContactMobile")}
          />
        </Field>
      </Section>

      <div className="space-y-3">
        <Checkbox input={register("healthDeclaration")} error={errors.healthDeclaration?.message}>
          I confirm that I am medically fit to take part in a 5 km run, and I understand that I take
          part at my own risk.
        </Checkbox>

        <Checkbox input={register("termsAccepted")} error={errors.termsAccepted?.message}>
          I have read and agree to the{" "}
          <a href="/terms" target="_blank" rel="noreferrer" className="underline">
            Terms of Use
          </a>
          ,{" "}
          <a href="/privacy" target="_blank" rel="noreferrer" className="underline">
            Privacy Policy
          </a>{" "}
          and{" "}
          <a href="/refunds" target="_blank" rel="noreferrer" className="underline">
            Refund Policy
          </a>
          .
        </Checkbox>
      </div>

      <div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="cursor-pointer w-full rounded-lg bg-orange-600 px-4 py-3 text-lg font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {isSubmitting ? "Please wait…" : `Register and pay ₹${EVENT.feeRupees}`}
        </button>
        <p className="mt-3 text-center text-xs text-stone-500">Registrations are non-refundable.</p>
      </div>
    </form>
  );
}

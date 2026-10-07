/** JSON body of POST /sell/upload. */
export type LeadUploadResponse =
  | { ok: true; photo: { file: string; thumbUrl: string; width: number; height: number } }
  | { ok: false; message: string };

export type SellFormField = "name" | "email" | "phone" | "itemsDescription" | "message" | "consent" | "photos";

/** State of the submit action. */
export type SellFormState =
  | {
      ok: boolean;
      error?: string;
      fieldErrors?: Partial<Record<SellFormField, string>>;
      values?: { name: string; email: string; phone: string; itemsDescription: string; message: string; consent: boolean };
      /** Increments on every response so the Turnstile widget resets (tokens are single use). */
      attempt: number;
    }
  | undefined;

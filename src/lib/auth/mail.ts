// Mail seam: no mailer is specified yet. Default logs to stdout (dev); tests and the real transport call setMailer.
export type Mail = { to: string; kind: "verify-email" | "password-reset" | "invite"; token: string };
let mailer: (m: Mail) => Promise<void> | void = (m) => { if (process.env.NODE_ENV !== "production") console.log(`[mail] ${m.kind} -> ${m.to}`); };
export const setMailer = (f: typeof mailer) => { mailer = f; };
export const sendMail = (m: Mail) => mailer(m);

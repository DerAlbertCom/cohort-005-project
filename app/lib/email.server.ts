import type { Email } from "~/lib/emails";

/**
 * Delivers an email. There is no mail transport wired up yet, so the message
 * goes to the server log.
 */
export function sendEmail(email: Email) {
  console.log(`[email] to=${email.to} subject=${email.subject}\n${email.body}`);
}

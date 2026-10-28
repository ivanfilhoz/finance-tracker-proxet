import { env } from "#/server/env";

//
// Minimal provider abstraction for transactional email. Three modes, chosen
// once at startup by src/server/env.ts:
//   - "console": logs the message to stdout (development default)
//   - "test":    captures messages in memory for E2E assertions (TEST_MODE)
//   - "resend":  sends via the Resend HTTP API
// Handlers must never depend on which mode is active.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

// In-memory capture for TEST_MODE — read back by the /test-emails route so
// E2E tests can extract verification/reset links.
const capturedEmails: EmailMessage[] = [];

export function getCapturedEmails(to?: string): EmailMessage[] {
  return to ? capturedEmails.filter((e) => e.to === to) : [...capturedEmails];
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  switch (env.email.provider) {
    case "test":
      capturedEmails.push(message);
      return;
    case "console":
      // Deliberately raw console output, not the structured logger: printing
      // the full body (with its verification/reset link) to the dev terminal
      // IS the delivery mechanism for this provider, and it never runs in
      // production.
      console.log(
        `[email] To: ${message.to}\n[email] Subject: ${message.subject}\n${message.text}`,
      );
      return;
    case "resend": {
      // Financial mutations now send budget alerts. Bound the provider request
      // (including reading an error body) so an outage cannot hang a saved edit.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${env.email.resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: env.email.from,
            to: message.to,
            subject: message.subject,
            text: message.text,
          }),
        });
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(`Resend API error ${response.status}: ${body.slice(0, 500)}`);
        }
      } finally {
        clearTimeout(timeout);
      }
      return;
    }
  }
}

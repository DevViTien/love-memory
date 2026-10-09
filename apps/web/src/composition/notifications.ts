import { getSystemEmailEnvironment } from "@/config/system-email";
import {
  createSystemEmailHandler,
  type EmailSender,
  SYSTEM_EMAIL_JOB,
} from "@/modules/notifications/application/system-emails";
import {
  createCaptureEmailSender,
  createResendEmailSender,
} from "@/modules/notifications/infrastructure/email-sender";
import { mongoSystemEmailRecipients } from "@/modules/notifications/infrastructure/mongo-system-email-recipients";

/** The provider of sign-in emails, or the capture file on loopback development and E2E servers. */
function createEmailSender(): EmailSender {
  const environment = getSystemEmailEnvironment();
  return environment.capturePath
    ? createCaptureEmailSender(environment.capturePath)
    : createResendEmailSender(environment.resendApiKey, environment.emailFrom);
}

/** `email.send.v1` (`system-emails`); the environment is read when a job runs. */
export function createSystemEmailJobHandler() {
  return createSystemEmailHandler({
    appUrl: () => getSystemEmailEnvironment().appUrl,
    recipients: mongoSystemEmailRecipients,
    sender: createEmailSender,
  });
}

/** Wakes a worker for system emails a commit just enqueued; never throws (`background-jobs`). */
export async function wakeSystemEmailJobs(): Promise<void> {
  // Loaded on use: `composition/jobs` builds on the modules that call this.
  await (await import("@/composition/jobs")).jobDispatcher.dispatch(SYSTEM_EMAIL_JOB);
}

import { getAuthEnvironment } from "@/modules/auth/infrastructure/auth-environment";
import { createMongoRateLimiter } from "@/modules/rate-limits/infrastructure/mongo-rate-limiter";

/** The one rate limiter of the application (D2): counters keyed with the auth secret. */
export const rateLimiter = createMongoRateLimiter(() => getAuthEnvironment().secret);

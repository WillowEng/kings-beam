import type { Monitor } from "./health";
import type { Scope } from "../core/models";
export interface EmailConfig { scope: Scope; from?: string; to?: string; binding?: SendEmail; message?: (from: string, to: string, raw: string) => EmailMessage }
/** A separate, optional free Cloudflare Email Routing binding per Worker. No account configuration occurs here. */
export function emailNotifications(config: EmailConfig): Monitor {
  const valid = (v: string | undefined): v is string => Boolean(v && /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v));
  return { async send(signal, scope, id) {
    if (scope !== config.scope || signal === "heartbeat" || !config.binding || !valid(config.from) || !valid(config.to) || !/^[a-zA-Z0-9_.:@-]{1,240}$/.test(id)) return false;
    try {
      const raw = `From: ${config.from}\r\nTo: ${config.to}\r\nSubject: [Kings Beam ${scope.toUpperCase()}] ${signal === "test" ? "Test alert" : signal === "open" ? "Incident opened" : "Incident recovered"}\r\nMessage-ID: <${id.replace(/:/g, ".")}@beam.invalid>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nEnvironment: ${scope}\nEvent: ${signal}\nDelivery ID: ${id}\nReview the private dashboard for details.`;
      const message = config.message ? config.message(config.from, config.to, raw) : new (await import("cloudflare:email")).EmailMessage(config.from, config.to, raw);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          config.binding.send(message).then(() => true),
          new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 5_000); }),
        ]);
      } finally { clearTimeout(timer); }
    } catch { return false; }
  } };
}

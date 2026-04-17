/**
 * Toast service — thin wrapper around Sonner.
 * Import this everywhere instead of using Sonner directly,
 * so the notification layer can be swapped in one place.
 */
import { toast as sonner } from 'sonner';

type ToastOptions = Parameters<typeof sonner>[1];

export const toast = {
  /** Neutral informational message */
  info(message: string, opts?: ToastOptions) {
    return sonner(message, opts);
  },

  /** Operation succeeded */
  success(message: string, opts?: ToastOptions) {
    return sonner.success(message, opts);
  },

  /** Non-fatal warning */
  warning(message: string, opts?: ToastOptions) {
    return sonner.warning(message, opts);
  },

  /** Error — visible longer by default */
  error(message: string, opts?: ToastOptions) {
    return sonner.error(message, {
      duration: 6000,
      ...opts,
    });
  },

  /** Show a loading toast, returns an ID to dismiss/update */
  loading(message: string, opts?: ToastOptions) {
    return sonner.loading(message, opts);
  },

  /** Dismiss by ID or dismiss all */
  dismiss(id?: string | number) {
    return sonner.dismiss(id);
  },

  /** Resolve or reject a promise with toast feedback */
  promise<T>(
    promise: Promise<T>,
    messages: { loading: string; success: string; error: string | ((err: unknown) => string) },
    opts?: ToastOptions,
  ) {
    return sonner.promise(promise, { ...messages, ...opts });
  },
};

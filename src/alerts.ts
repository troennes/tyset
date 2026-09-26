// GitHub alerts (`> [!NOTE]` and friends), drawn as minium alerts in the editor and in exports.

export type AlertKind = "note" | "tip" | "important" | "warning" | "caution";

/** In the order Ctrl+Shift+A cycles through them. */
export const ALERT_KINDS: readonly AlertKind[] = ["note", "tip", "important", "warning", "caution"];

interface Alert {
  label: string;
  /** minium colour modifier: `.alert.info`, `--color-info-fill`, ... */
  tone: string;
  /** Mask image for the icon; the lucide ones are defined in export.css. */
  icon: string;
}

export const ALERTS: Record<AlertKind, Alert> = {
  note: { label: "Note", tone: "info", icon: "var(--icon-info)" },
  tip: { label: "Tip", tone: "success", icon: "var(--icon-alert-tip)" },
  important: { label: "Important", tone: "accent", icon: "var(--icon-alert-important)" },
  warning: { label: "Warning", tone: "warning", icon: "var(--icon-alert-warning)" },
  caution: { label: "Caution", tone: "danger", icon: "var(--icon-alert-caution)" },
};

/** The first line of an alert: `> [!NOTE]`. */
export const ALERT_TITLE = /^\s*>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;

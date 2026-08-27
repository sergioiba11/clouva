export const CLOUVA_COMPANY_CONTACTS = {
  admin: {
    email: "admin@clouva.com.ar",
    label: "Administración",
    purpose: "Administración general y contacto administrativo de CLOUVA.",
  },
  contact: {
    email: "contacto@clouva.com.ar",
    label: "Contacto",
    purpose: "Contacto público general de CLOUVA.",
  },
  support: {
    email: "support@clouva.com.ar",
    label: "Soporte",
    purpose: "Soporte y asistencia a usuarios.",
  },
  business: {
    email: "business@clouva.com.ar",
    label: "Negocios",
    purpose: "Negocios, acuerdos, alianzas e ingresos.",
  },
  press: {
    email: "press@clouva.com.ar",
    label: "Prensa",
    purpose: "Prensa, medios y colaboraciones.",
  },
  legal: {
    email: "legal@clouva.com.ar",
    label: "Legal",
    purpose: "Contratos, marca y asuntos legales.",
  },
} as const;

export type ClouvaCompanyContactKey = keyof typeof CLOUVA_COMPANY_CONTACTS;
export type ClouvaCompanyContact =
  (typeof CLOUVA_COMPANY_CONTACTS)[ClouvaCompanyContactKey];

export const CLOUVA_COMPANY_EMAILS = Object.fromEntries(
  Object.entries(CLOUVA_COMPANY_CONTACTS).map(([key, contact]) => [key, contact.email]),
) as Record<ClouvaCompanyContactKey, string>;

export const CLOUVA_PRIMARY_CONTACT_EMAIL = CLOUVA_COMPANY_CONTACTS.contact.email;
export const CLOUVA_SUPPORT_EMAIL = CLOUVA_COMPANY_CONTACTS.support.email;
export const CLOUVA_LEGAL_EMAIL = CLOUVA_COMPANY_CONTACTS.legal.email;

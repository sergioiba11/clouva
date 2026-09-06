export type DLocalConfig = {
  apiBaseUrl: string;
  xLogin: string;
  xTransKey: string;
  secretKey: string;
  payoutsAccessToken: string;
};

export function getDLocalConfig(): DLocalConfig {
  return {
    apiBaseUrl: (process.env.DLOCAL_API_BASE_URL?.trim() || "https://api.dlocal.com").replace(/\/$/, ""),
    xLogin: process.env.DLOCAL_X_LOGIN?.trim() || "",
    xTransKey: process.env.DLOCAL_X_TRANS_KEY?.trim() || "",
    secretKey: process.env.DLOCAL_SECRET_KEY?.trim() || "",
    payoutsAccessToken: process.env.DLOCAL_PAYOUTS_ACCESS_TOKEN?.trim() || "",
  };
}

export function isDLocalPayInConfigured(config: DLocalConfig = getDLocalConfig()) {
  return Boolean(config.xLogin && config.xTransKey && config.secretKey);
}

export function isDLocalPayoutConfigured(config: DLocalConfig = getDLocalConfig()) {
  return Boolean(config.payoutsAccessToken);
}

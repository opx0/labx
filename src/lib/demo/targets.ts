const P = "urn:li:dataset:(urn:li:dataPlatform:demo,{},PROD)";

export const TARGETS = {
  customer_prod: P.replace("{}", "customer_prod"),
  regulated_core: P.replace("{}", "regulated_core"),
  analytics_test: "urn:li:dataset:(urn:li:dataPlatform:demo,analytics_test,DEV)",
} as const;

export const DRIFT_URN = P.replace("{}", "fraud_alerts");

export const CANDIDATES = ["revenue_daily", "exec_dashboard_feed", "fraud_alerts"].map((n) =>
  P.replace("{}", n),
);

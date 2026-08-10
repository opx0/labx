export const dynamic = "force-dynamic";

// One-click reviewer access to the DataHub catalog. Performs the catalog's own
// /logIn as the shared read-only judge account and forwards the resulting
// session cookies to the browser. The reverse proxy serves this route under
// catalog.opxz.dev/demo-login, so the cookies land on the catalog host.
// It grants nothing the published judge/judge credentials do not already grant.
export async function GET() {
  const frontend = process.env.DATAHUB_FRONTEND_URL ?? "http://localhost:9002";
  const res = await fetch(`${frontend}/logIn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: process.env.DEMO_CATALOG_USER ?? "judge",
      password: process.env.DEMO_CATALOG_PASSWORD ?? "judge",
    }),
  });
  if (!res.ok) return new Response("demo login unavailable", { status: 502 });

  const headers = new Headers({ Location: "/" });
  for (const cookie of res.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

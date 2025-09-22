export const dynamic = "force-dynamic";

import ClaimClient from "./ClaimClient";

// In the latest Next, `params` must be awaited.
// Typing it as a Promise fixes both TS and the runtime warning.
export default async function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ClaimClient token={token} />;
}

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Do not emit AGENTS.md / CLAUDE.md into the repo.
  agentRules: false,
};

export default nextConfig;

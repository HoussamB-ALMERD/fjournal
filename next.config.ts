import type { NextConfig } from "next";

// Every Fjournal page renders live community data (reviews, votes, versions),
// so we use request-time rendering rather than Cache Components for now.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

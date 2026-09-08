import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  headers: async () => [
    {
      // MediaPipe's GPU delegate and WASM threads are happier with these,
      // and the camera stream never leaves the page anyway.
      source: "/(.*)",
      headers: [
        { key: "Permissions-Policy", value: "camera=(self)" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ],
    },
  ],
};

export default nextConfig;

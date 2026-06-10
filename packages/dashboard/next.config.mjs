/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // The Next.js image optimiser wants to bind a blocking PID. We don't use
  // external images today; turn it off to keep the Docker image lean.
  images: { unoptimized: true },
  experimental: {
    // Tell Next not to try to statically-analyse this package across the
    // workspace. postgres-js is a side-effect import at runtime.
    serverComponentsExternalPackages: ['postgres', 'drizzle-orm'],
  },
};

export default nextConfig;

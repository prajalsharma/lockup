/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Optional integration inside the Privy SDK that this app does not use.
    config.resolve.alias["@farcaster/mini-app-solana"] = false;
    return config;
  },
};
export default nextConfig;

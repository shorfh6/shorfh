/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	devIndicators: false,
	async headers() {
		const headers = [
			{ key: "X-Content-Type-Options", value: "nosniff" },
			{ key: "X-Frame-Options", value: "DENY" },
			{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
			{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
		];
		if (process.env.NODE_ENV === "production") {
			headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000" });
		}
		return [{ source: "/:path*", headers }];
	},
};

export default nextConfig;
